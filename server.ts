import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import si from "systeminformation";
import { spawn, ChildProcess } from "child_process";
import multer from "multer";
import fs from "fs";
import AdmZip from "adm-zip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const UPLOADS_DIR = path.join(__dirname, "server_files");

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  let minecraftProcess: ChildProcess | null = null;
  let serverStatus = "stopped"; // stopped, starting, running, stopping
  let serverJarName = "";

  // Set default jar if exists
  const files = fs.readdirSync(UPLOADS_DIR);
  const jars = files.filter(f => f.endsWith('.jar'));
  if (jars.length > 0) {
    serverJarName = jars[0];
  }

  // API Routes
  app.get("/api/status", (req, res) => {
    const files = fs.readdirSync(UPLOADS_DIR);
    const hasScript = files.some(f => f === 'start_server.bat' || f === 'start_server.sh');
    
    res.json({ 
      status: serverStatus, 
      jar: serverJarName,
      availableJars: files.filter(f => f.endsWith('.jar')),
      hasScript,
      scriptName: files.find(f => f === 'start_server.bat' || f === 'start_server.sh') || ""
    });
  });

  app.post("/api/start", express.json(), (req, res) => {
    if (minecraftProcess) {
      return res.status(400).json({ error: "O servidor já está rodando." });
    }

    const files = fs.readdirSync(UPLOADS_DIR);
    const script = files.find(f => f === 'start_server.bat' || f === 'start_server.sh');

    if (!script) {
      return res.status(400).json({ error: "Arquivo 'start_server.bat' não encontrado! Por favor, renomeie seu arquivo de inicialização." });
    }

    try {
      serverStatus = "starting";
      io.emit("status_change", { status: serverStatus });
      io.emit("console_log", `[MineControl] Iniciando via script: ${script}...`);

      const isBat = script.endsWith('.bat');
      
      // No Linux/Sandbox, tentamos rodar o .bat como shell se possível ou usamos o interpretador correto
      const command = isBat ? "sh" : "sh"; // Em ambientes Linux, usamos sh. Se for Windows local real, seria cmd.exe
      const args = [script];

      // Se for Linux, garantimos permissão de execução
      if (process.platform !== 'win32') {
        try { fs.chmodSync(path.join(UPLOADS_DIR, script), '755'); } catch(e) {}
      }

      minecraftProcess = spawn(command, args, {
        cwd: UPLOADS_DIR,
        shell: true // Crucial para arquivos de lote/scripts
      });

      minecraftProcess.stdout?.on("data", (data) => {
        const output = data.toString();
        io.emit("console_log", output);
        if (output.includes("Done") || output.includes("For help, type \"help\"")) {
          serverStatus = "running";
          io.emit("status_change", { status: serverStatus });
        }
      });

      minecraftProcess.stderr?.on("data", (data) => {
        io.emit("console_log", `[ERROR] ${data.toString()}`);
      });

      minecraftProcess.on("close", (code) => {
        io.emit("console_log", `[MineControl] Server stopped with code ${code}`);
        minecraftProcess = null;
        serverStatus = "stopped";
        io.emit("status_change", { status: serverStatus });
      });

      res.json({ message: "Starting server" });
    } catch (error: any) {
      console.error(error);
      serverStatus = "stopped";
      io.emit("status_change", { status: serverStatus });
      res.status(500).json({ error: "Failed to start server: " + error.message });
    }
  });

  app.post("/api/stop", (req, res) => {
    if (!minecraftProcess) {
      return res.status(400).json({ error: "Server is not running" });
    }

    serverStatus = "stopping";
    io.emit("status_change", { status: serverStatus });
    io.emit("console_log", "[MineControl] Sending stop command...");
    
    minecraftProcess.stdin?.write("stop\n");
    
    // Fallback kill after 30 seconds
    setTimeout(() => {
      if (minecraftProcess) {
        minecraftProcess.kill();
        minecraftProcess = null;
        serverStatus = "stopped";
        io.emit("status_change", { status: serverStatus });
      }
    }, 30000);

    res.json({ message: "Stopping server" });
  });

  // API de Upload em Chunks
  const CHUNKS_TEMP_DIR = path.join(__dirname, "temp_chunks");
  if (!fs.existsSync(CHUNKS_TEMP_DIR)) fs.mkdirSync(CHUNKS_TEMP_DIR);

  app.post("/api/upload/chunk", multer().single("chunk"), (req: any, res) => {
    const { filename, chunkIndex, totalChunks } = req.body;
    const chunk = req.file;

    if (!chunk) return res.status(400).json({ error: "No chunk received" });

    const chunkDir = path.join(CHUNKS_TEMP_DIR, filename);
    if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

    const chunkPath = path.join(chunkDir, `chunk-${chunkIndex}`);
    fs.writeFileSync(chunkPath, chunk.buffer);

    res.json({ success: true, message: `Chunk ${chunkIndex}/${totalChunks} saved` });
  });

  app.post("/api/upload/finalize", express.json(), async (req, res) => {
    const { filename, totalChunks } = req.body;
    const finalPath = path.join(UPLOADS_DIR, filename);
    const chunkDir = path.join(CHUNKS_TEMP_DIR, filename);

    try {
      const writeStream = fs.createWriteStream(finalPath);
      
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(chunkDir, `chunk-${i}`);
        const chunkBuffer = fs.readFileSync(chunkPath);
        writeStream.write(chunkBuffer);
        fs.unlinkSync(chunkPath); // Limpa o chunk após usar
      }
      
      writeStream.end();

      writeStream.on('finish', async () => {
        fs.rmSync(chunkDir, { recursive: true, force: true });

        if (filename.endsWith('.zip')) {
          console.log(`[ZIP] Iniciando extração pesada via sistema: ${filename}`);
          io.emit("console_log", `[MineControl] Extraindo arquivo grande: ${filename}...`);

          // Usamos o comando 'unzip' do sistema para eficiência máxima (Task 2 do pedido)
          const unzip = spawn("unzip", ["-o", filename, "-d", "."], { cwd: UPLOADS_DIR });

          unzip.stdout.on('data', (data) => console.log(`unzip: ${data}`));
          unzip.stderr.on('data', (data) => console.error(`unzip-err: ${data}`));

          unzip.on('close', (code) => {
            if (code === 0) {
              console.log(`[ZIP] Extração concluída via sistema.`);
              io.emit("console_log", `[MineControl] Extração concluída com sucesso!`);
              
              const files = fs.readdirSync(UPLOADS_DIR);
              const jarFile = files.find(f => f.endsWith('.jar'));
              if (jarFile && !serverJarName) serverJarName = jarFile;

              res.json({ message: "Servidor extraído com sucesso via sistema!", filename, extracted: true });
            } else {
              res.status(500).json({ error: "Erro na extração via sistema (unzip). Código: " + code });
            }
          });
        } else {
          res.json({ message: "Arquivo carregado e reconstruído com sucesso!", filename });
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: "Erro ao finalizar upload: " + err.message });
    }
  });

  app.post("/api/upload", upload.single("file"), (req: any, res) => {

    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const { originalname, path: filePath } = req.file;

    try {
      if (originalname.endsWith('.zip')) {
        console.log(`[ZIP] Iniciando extração de: ${originalname}`);
        const zip = new AdmZip(filePath);
        zip.extractAllTo(UPLOADS_DIR, true);
        console.log(`[ZIP] Extração concluída: ${originalname}`);
        
        // Scan for a .jar file if we don't have one set yet
        const files = fs.readdirSync(UPLOADS_DIR);
        const jarFile = files.find(f => f.endsWith('.jar'));
        if (jarFile && !serverJarName) {
            serverJarName = jarFile;
        }

        return res.json({ 
          message: "Servidor extraído e salvo com sucesso!", 
          filename: originalname,
          extracted: true,
          detectedJar: jarFile
        });
      }

      if (originalname.endsWith('.jar')) {
          serverJarName = originalname;
      }

      return res.json({ 
        message: "Arquivo carregado com sucesso!", 
        filename: originalname 
      });
    } catch (err: any) {
      console.error("Upload error:", err);
      return res.status(500).json({ error: "Erro ao processar o arquivo: " + err.message });
    }
  });

  // File Manager API
  app.get("/api/files", (req, res) => {
    const relativePath = (req.query.path as string) || ".";
    const fullPath = path.join(UPLOADS_DIR, relativePath);

    if (!fullPath.startsWith(UPLOADS_DIR)) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      const files = fs.readdirSync(fullPath, { withFileTypes: true });
      const result = files.map(file => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        size: file.isDirectory() ? 0 : fs.statSync(path.join(fullPath, file.name)).size,
        mtime: fs.statSync(path.join(fullPath, file.name)).mtime
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/file/read", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "Path required" });

    const fullPath = path.join(UPLOADS_DIR, filePath);
    if (!fullPath.startsWith(UPLOADS_DIR)) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      res.json({ content });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/file/write", express.json(), (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: "Path required" });

    const fullPath = path.join(UPLOADS_DIR, filePath);
    if (!fullPath.startsWith(UPLOADS_DIR)) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      fs.writeFileSync(fullPath, content, 'utf-8');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/file/delete", express.json(), (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: "Path required" });

    const fullPath = path.join(UPLOADS_DIR, filePath);
    if (!fullPath.startsWith(UPLOADS_DIR)) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      if (fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/file/create", express.json(), (req, res) => {
    const { path: filePath, isDirectory } = req.body;
    if (!filePath) return res.status(400).json({ error: "Path required" });

    const fullPath = path.join(UPLOADS_DIR, filePath);
    if (!fullPath.startsWith(UPLOADS_DIR)) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      if (isDirectory) {
        fs.mkdirSync(fullPath, { recursive: true });
      } else {
        fs.writeFileSync(fullPath, "", 'utf-8');
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/command", express.json(), (req, res) => {
    const { command } = req.body;
    if (!minecraftProcess) {
      return res.status(400).json({ error: "Server is not running" });
    }
    if (!command) return res.status(400).json({ error: "Command required" });

    minecraftProcess.stdin?.write(command + "\n");
    res.json({ success: true });
  });

  // Socket.io stats broadcasting
  let cachedHardwareInfo: any = null;

  setInterval(async () => {
    try {
      if (!cachedHardwareInfo) {
        const cpuInfo = await si.cpu();
        cachedHardwareInfo = {
          cpuModel: `${cpuInfo.brand} ${cpuInfo.model}`.trim()
        };
      }

      const cpuLoad = await si.currentLoad();
      const mem = await si.mem();
      const gpu = await si.graphics();
      
      // Filtra adaptadores virtuais (como Parsec, Microsoft Remote Display, etc.)
      const realGpu = gpu.controllers.find(c => 
        !c.model.toLowerCase().includes('parsec') && 
        !c.model.toLowerCase().includes('virtual') &&
        !c.model.toLowerCase().includes('microsoft remote') &&
        !c.model.toLowerCase().includes('basic render') &&
        !c.model.toLowerCase().includes('citrix')
      ) || gpu.controllers[0];

      // Fallback for RAM if si returns 0
      const totalRam = mem.total > 0 ? mem.total : os.totalmem();
      const usedRam = mem.used > 0 ? mem.used : (os.totalmem() - os.freemem());

      const stats = {
        cpuLoad: isNaN(cpuLoad.currentLoad) ? "0.0" : cpuLoad.currentLoad.toFixed(1),
        cpuModel: cachedHardwareInfo.cpuModel,
        ram: {
          used: (usedRam / 1024 / 1024 / 1024).toFixed(2),
          total: (totalRam / 1024 / 1024 / 1024).toFixed(2),
          percent: totalRam > 0 ? ((usedRam / totalRam) * 100).toFixed(1) : "0.0"
        },
        gpu: realGpu ? realGpu.model : "N/A",
        gpuVram: realGpu ? realGpu.vram : 0,
        timestamp: new Date().toLocaleTimeString()
      };
      
      io.emit("system_stats", stats);
    } catch (err) {
      // Ignore stats errors
    }
  }, 2000);

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`MineControl Dashboard running at http://localhost:${PORT}`);
  });
}

startServer();

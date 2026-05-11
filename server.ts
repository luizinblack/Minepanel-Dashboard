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
import unzipper from "unzipper";
import crypto from "crypto";
import { finished } from "stream/promises";

type JobStatus =
  | "UPLOADING"
  | "UPLOADED"
  | "VALIDATING"
  | "QUEUED"
  | "EXTRACTING"
  | "STARTING"
  | "DONE"
  | "FAILED";

interface ServerJob {
  id: string;
  filename: string;
  filePath: string;
  outputPath: string;
  status: JobStatus;
  hash?: string;
  createdAt: number;
  error?: string;
  progress?: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const UPLOADS_DIR = path.join(__dirname, "server_files");
const LOGS_DIR = path.join(__dirname, "logs");
const LATEST_LOG_PATH = path.join(LOGS_DIR, "latest.log");

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR);
}
// Clear latest log on startup
fs.writeFileSync(LATEST_LOG_PATH, `--- MineControl Log Started at ${new Date().toLocaleString()} ---\n`);

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

  // Jobs System
  const jobs: ServerJob[] = [];
  let isProcessingQueue = false;

  const getFileHash = async (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  };

  const appendToLog = (data: string) => {
    fs.appendFileSync(LATEST_LOG_PATH, data);
  };

  const logToConsole = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${message}\n`;
    appendToLog(formatted);
    io.emit("console_log", formatted);
  };

  const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (true) {
      const job = jobs.find(j => j.status === "QUEUED");
      if (!job) break;

      console.log(`[WORKER] Iniciando Job: ${job.id} (${job.filename})`);
      try {
        updateJob(job.id, { status: "EXTRACTING" });
        logToConsole(`[MineControl] Worker: Extraindo ${job.filename}...`);

        if (job.filename.endsWith('.zip')) {
          await fs.createReadStream(job.filePath)
            .pipe(unzipper.Extract({ path: job.outputPath }))
            .promise();
          
          // Cleanup ZIP after extraction if requested (manual extract removes it)
          if (job.id.startsWith('manual-')) {
            try { fs.unlinkSync(job.filePath); } catch(e) {}
          }
        }

        updateJob(job.id, { status: "DONE" });
        logToConsole(`[MineControl] Worker: Job ${job.id} finalizado.`);

        // Refresh JAR detection
        const filesAfter = fs.readdirSync(UPLOADS_DIR);
        const jarFile = filesAfter.find(f => f.endsWith('.jar'));
        if (jarFile && !serverJarName) {
            serverJarName = jarFile;
            io.emit("status_change", { status: serverStatus, jar: serverJarName });
        }
      } catch (err: any) {
        console.error(`[WORKER ERROR] Job ${job.id}:`, err);
        updateJob(job.id, { status: "FAILED", error: err.message });
        logToConsole(`[MineControl] Worker: Falha no Job ${job.id} - ${err.message}`);
      }
    }

    isProcessingQueue = false;
  };

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
      logToConsole(`[MineControl] Iniciando via script: ${script}...`);

      const scriptPath = path.join(UPLOADS_DIR, script);
      const isWindows = os.platform() === "win32";
      
      // Determine correct command and arguments based on OS and file type
      let command = "";
      let args: string[] = [];

      if (isWindows) {
        if (script.endsWith(".bat")) {
          command = "cmd.exe";
          args = ["/c", script];
        } else {
          command = "bash"; // Try bash if available on Windows (git bash/WSL)
          args = [script];
        }
      } else {
        // Linux/Unix environment
        try { fs.chmodSync(scriptPath, '755'); } catch(e) {}
        command = script.endsWith(".sh") ? "bash" : "sh";
        args = [script];
      }

      minecraftProcess = spawn(command, args, {
        cwd: UPLOADS_DIR,
        shell: isWindows // Only use shell: true on Windows for cmd.exe
      });

      minecraftProcess.stdout?.on("data", (data) => {
        const output = data.toString();
        appendToLog(output);
        io.emit("console_log", output);
        if (output.includes("Done") || output.includes("For help, type \"help\"")) {
          serverStatus = "running";
          io.emit("status_change", { status: serverStatus });
        }
      });

      minecraftProcess.stderr?.on("data", (data) => {
        const output = `[ERROR] ${data.toString()}`;
        appendToLog(output);
        io.emit("console_log", output);
      });

      minecraftProcess.on("close", (code) => {
        logToConsole(`[MineControl] Server stopped with code ${code}`);
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
    logToConsole("[MineControl] Sending stop command...");
    
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

    const jobId = `upload-${Date.now()}`;
    const newJob: ServerJob = {
      id: jobId,
      filename,
      filePath: finalPath,
      outputPath: UPLOADS_DIR,
      status: "UPLOADING",
      createdAt: Date.now()
    };
    jobs.push(newJob);
    io.emit("job_update", newJob);

    try {
      const writeStream = fs.createWriteStream(finalPath);
      
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(chunkDir, `chunk-${i}`);
        if (fs.existsSync(chunkPath)) {
          const chunkBuffer = fs.readFileSync(chunkPath);
          writeStream.write(chunkBuffer);
          fs.unlinkSync(chunkPath);
        }
      }
      
      writeStream.end();

      await finished(writeStream);
      
      console.log(`[UPLOAD] Finalizado: ${filename}. Validando integridade...`);
      updateJob(jobId, { status: "VALIDATING" });
      
      const hash = await getFileHash(finalPath);
      console.log(`[UPLOAD] SHA256: ${hash}`);
      
      fs.rmSync(chunkDir, { recursive: true, force: true });
      
      updateJob(jobId, { status: "QUEUED", hash });
      processQueue(); // Start worker if not running

      res.json({ message: "Upload finalizado e enviado para fila de processamento.", jobId, hash });

    } catch (err: any) {
      updateJob(jobId, { status: "FAILED", error: err.message });
      res.status(500).json({ error: "Erro ao finalizar upload: " + err.message });
    }
  });

  app.post("/api/upload", upload.single("file"), async (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const { originalname, path: filePath } = req.file;
    const jobId = `direct-${Date.now()}`;

    const newJob: ServerJob = {
      id: jobId,
      filename: originalname,
      filePath: filePath,
      outputPath: UPLOADS_DIR,
      status: "UPLOADED",
      createdAt: Date.now()
    };
    jobs.push(newJob);
    io.emit("job_update", newJob);

    try {
      updateJob(jobId, { status: "VALIDATING" });
      const hash = await getFileHash(filePath);
      
      if (originalname.endsWith('.jar') && !serverJarName) {
        serverJarName = originalname;
      }

      updateJob(jobId, { status: "QUEUED", hash });
      processQueue();

      return res.json({ 
        message: "Arquivo recebido e enviado para processamento.", 
        jobId,
        hash
      });
    } catch (err: any) {
      updateJob(jobId, { status: "FAILED", error: err.message });
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

  app.post("/api/files/extract", async (req, res) => {
    const { filename, currentPath } = req.body;
    // Previne Directory Traversal
    const relativeDir = currentPath || ".";
    const filePath = path.join(UPLOADS_DIR, relativeDir, filename);

    if (!filePath.startsWith(UPLOADS_DIR) || !filename.endsWith('.zip')) {
      return res.status(400).json({ error: "Arquivo inválido para extração" });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Arquivo não encontrado" });
    }

    const extractDir = path.dirname(filePath);
    const jobId = `manual-${Date.now()}`;

    const newJob: ServerJob = {
      id: jobId,
      filename,
      filePath,
      outputPath: extractDir,
      status: "QUEUED",
      createdAt: Date.now()
    };
    jobs.push(newJob);
    io.emit("job_update", newJob);
    processQueue();

    res.json({ message: "Extração adicionada à fila.", jobId });
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

  app.get("/api/jobs", (req, res) => {
    res.json(jobs.slice(-10)); // return last 10 jobs
  });

  app.get("/api/logs", (req, res) => {
    try {
      const content = fs.readFileSync(LATEST_LOG_PATH, 'utf-8');
      res.json({ content });
    } catch (e) {
      res.status(500).json({ error: "Could not read logs" });
    }
  });

  app.post("/api/logs/clear", (req, res) => {
    try {
      fs.writeFileSync(LATEST_LOG_PATH, `--- Log Cleared at ${new Date().toLocaleString()} ---\n`);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Could not clear logs" });
    }
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

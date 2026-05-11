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
import { 
  searchModrinth, 
  searchCurseForge, 
  getModrinthVersions, 
  getCurseForgeVersions,
  downloadFile
} from "./marketplace.js";

type JobStatus =
  | "UPLOADING"
  | "UPLOADED"
  | "VALIDATING"
  | "QUEUED"
  | "DOWNLOADING"
  | "INSTALLING"
  | "EXTRACTING"
  | "DETECTING"
  | "CONFIGURING"
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
  metadata?: any;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODPACKS_CACHE_PATH = path.join(__dirname, "modpacks_cache.json");

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
    // Handle subdirectories if relative path is provided in body
    // Note: relPath must be sent BEFORE the file in the FormData
    const relPath = req.body.relPath || "";
    const targetDir = path.join(UPLOADS_DIR, relPath);
    
    // Security: Ensure targetDir is inside UPLOADS_DIR
    if (!targetDir.startsWith(UPLOADS_DIR)) {
      return cb(new Error("Invalid upload path"), UPLOADS_DIR);
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
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
      if (!fs.existsSync(filePath)) return reject(new Error("File not found"));
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

  const updateJob = (jobId: string, updates: Partial<ServerJob>) => {
    const jobIndex = jobs.findIndex(j => j.id === jobId);
    if (jobIndex !== -1) {
      jobs[jobIndex] = { ...jobs[jobIndex], ...updates };
      io.emit("job_update", jobs[jobIndex]);
    }
  };

  const logToConsole = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${message}\n`;
    appendToLog(formatted);
    io.emit("console_log", formatted);
  };

  // Sync Service
  let isSyncingMarket = false;
  let lastSyncTime = 0;

  const syncMarketplace = async () => {
    if (isSyncingMarket) return;
    isSyncingMarket = true;
    logToConsole(`[Marketplace] Iniciando sincronização completa de modpacks...`);

    const allModpacks: any[] = [];
    const PAGE_SIZE = 50;

    try {
      // Sync Modrinth (First 250 modpacks)
      logToConsole(`[Modrinth] Sincronizando principais modpacks...`);
      for (let offset = 0; offset < 250; offset += PAGE_SIZE) {
        const page = await searchModrinth("", PAGE_SIZE, offset);
        if (page.length === 0) break;
        allModpacks.push(...page);
        logToConsole(`[Modrinth] Sincronizados ${allModpacks.length} itens...`);
      }

      // Sync CurseForge (First 250 modpacks)
      logToConsole(`[CurseForge] Sincronizando principais modpacks...`);
      for (let index = 0; index < 250; index += PAGE_SIZE) {
        const page = await searchCurseForge("", index, PAGE_SIZE);
        if (page.length === 0) break;
        allModpacks.push(...page);
        logToConsole(`[Marketplace] Total sincronizado: ${allModpacks.length} itens...`);
      }

      // Save to cache
      fs.writeFileSync(MODPACKS_CACHE_PATH, JSON.stringify({
        lastSync: Date.now(),
        modpacks: allModpacks
      }, null, 2));

      lastSyncTime = Date.now();
      logToConsole(`[Marketplace] Sincronização concluída! ${allModpacks.length} modpacks em cache.`);
    } catch (err: any) {
      logToConsole(`[Marketplace] ERRO na sincronização: ${err.message}`);
    } finally {
      isSyncingMarket = false;
    }
  };

  // Run sync every 6 hours
  setInterval(syncMarketplace, 6 * 60 * 60 * 1000);
  
  // Initial sync check
  if (!fs.existsSync(MODPACKS_CACHE_PATH)) {
    setTimeout(syncMarketplace, 5000);
  }

  const findStartScript = (dir: string): string | null => {
    const files = fs.readdirSync(dir);
    
    // Priority specific names
    const priority = ["start_server.bat", "run.bat", "start.bat", "start_server.sh", "run.sh", "start.sh"];
    for (const name of priority) {
      const fullPath = path.join(dir, name);
      if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isDirectory()) {
        return fullPath;
      }
    }

    // Recursive scan
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const found = findStartScript(fullPath);
        if (found) return found;
      }
    }
    return null;
  };

  const findJarFile = (dir: string): string | null => {
    const files = fs.readdirSync(dir);
    const priority = [
      /^forge.*\.jar$/i,
      /^fabric-server-launch\.jar$/i,
      /^server\.jar$/i,
      /^paper.*\.jar$/i,
      /^spigot.*\.jar$/i
    ];

    for (const pattern of priority) {
      for (const file of files) {
        if (pattern.test(file)) return path.join(dir, file);
      }
    }

    // Fallback to any jar
    const anyJar = files.find(f => f.endsWith('.jar'));
    if (anyJar) return path.join(dir, anyJar);

    // Recursive
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        const found = findJarFile(fullPath);
        if (found) return found;
      }
    }
    return null;
  };

  const worker = async (job: ServerJob) => {
    try {
      console.log(`[WORKER] Iniciando Job: ${job.id} (${job.filename})`);
      
      // Handle Marketplace Installation
      if (job.id.startsWith('install-')) {
        updateJob(job.id, { status: "DOWNLOADING" });
        logToConsole(`[Marketplace] Baixando Modpack: ${job.metadata.title}...`);
        
        const downloadUrl = job.metadata.downloadUrl;
        if (!downloadUrl) throw new Error("Download URL missing");

        await downloadFile(downloadUrl, job.filePath, (percent) => {
          updateJob(job.id, { progress: percent });
        });
        
        updateJob(job.id, { status: "UPLOADED", progress: 100 });
      }

      // 1. Validation
      updateJob(job.id, { status: "VALIDATING" });
      if (fs.existsSync(job.filePath)) {
        const hash = await getFileHash(job.filePath);
        updateJob(job.id, { hash });
      }

      // 2. Extraction
      if (job.filename.endsWith('.zip')) {
        updateJob(job.id, { status: "EXTRACTING" });
        logToConsole(`[MineControl] Worker: Extraindo ${job.filename}...`);
        
        const zipPath = job.filePath;
        const extractionPath = job.outputPath;

        await fs.createReadStream(zipPath)
          .pipe(unzipper.Extract({ path: extractionPath }))
          .promise();
        
        // Post-extraction: Check for CurseForge manifest.json
        const manifestPath = path.join(extractionPath, "manifest.json");
        if (fs.existsSync(manifestPath)) {
          logToConsole(`[MineControl] Manifest.json detectado. Iniciando download de mods...`);
          // This is where we would implement full CF manifest parsing if needed.
          // For now, we assume standard server packs or simple extractions.
        }

        try { fs.unlinkSync(zipPath); } catch(e) {}
      }

      // 3. Detection
      updateJob(job.id, { status: "DETECTING" });
      logToConsole(`[MineControl] Worker: Escaneando arquivos para auto-deploy...`);
      
      const script = findStartScript(UPLOADS_DIR);
      const jar = findJarFile(UPLOADS_DIR);

      if (script) {
        logToConsole(`[MineControl] Auto-Detect: Script encontrado: ${path.basename(script)}`);
      }
      if (jar) {
        serverJarName = path.basename(jar);
        logToConsole(`[MineControl] Auto-Detect: JAR encontrado: ${serverJarName}`);
        io.emit("status_change", { status: serverStatus, jar: serverJarName });
      }

      // 4. Configuration (Mocked for now, usually setting EULA=true)
      updateJob(job.id, { status: "CONFIGURING" });
      const eulaPath = path.join(UPLOADS_DIR, "eula.txt");
      fs.writeFileSync(eulaPath, "eula=true\n");
      logToConsole(`[MineControl] Config: EULA aceito automaticamente.`);

      updateJob(job.id, { status: "DONE", progress: 100 });
      logToConsole(`[MineControl] Worker: Tarefa ${job.filename} concluída.`);

      io.emit("refresh_data");
    } catch (err: any) {
      console.error(`[WORKER ERROR] Job ${job.id}:`, err);
      updateJob(job.id, { status: "FAILED", error: err.message });
      logToConsole(`[MineControl] Worker: Falha na Tarefa ${job.filename} - ${err.message}`);
    }
  };

  const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (true) {
      const job = jobs.find(j => j.status === "QUEUED");
      if (!job) break;

      await worker(job);
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
    const script = findStartScript(UPLOADS_DIR);
    const hasScript = !!script;
    const files = fs.readdirSync(UPLOADS_DIR);
    
    res.json({ 
      status: serverStatus, 
      jar: serverJarName,
      availableJars: files.filter(f => f.endsWith('.jar')),
      hasScript,
      scriptName: script ? path.relative(UPLOADS_DIR, script) : ""
    });
  });

  app.get("/api/marketplace/search", async (req, res) => {
    const { q, page = "1", limit = "20", loader, version, sort } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    try {
      let results: any[] = [];

      // If there's a search query, fetch from APIs live for better relevance
      if (q && q !== "") {
        const [modrinth, curseforge] = await Promise.all([
          searchModrinth(q as string, limitNum, offset),
          searchCurseForge(q as string, offset, limitNum)
        ]);
        results = [...modrinth, ...curseforge];
      } else {
        // Use local cache for browsing
        if (fs.existsSync(MODPACKS_CACHE_PATH)) {
          const cache = JSON.parse(fs.readFileSync(MODPACKS_CACHE_PATH, 'utf-8'));
          results = cache.modpacks || [];
        } else {
          // Fallback if no cache
          const [modrinth, curseforge] = await Promise.all([
            searchModrinth("", limitNum, offset),
            searchCurseForge("", offset, limitNum)
          ]);
          results = [...modrinth, ...curseforge];
        }
      }

      // Apply Filters
      if (loader) {
        results = results.filter(m => m.loaders?.some((l: string) => l.toLowerCase().includes((loader as string).toLowerCase())));
      }
      if (version) {
        results = results.filter(m => m.minecraft_versions?.includes(version as string));
      }

      // Apply Sorting
      if (sort === 'downloads') {
        results.sort((a, b) => b.downloads - a.downloads);
      } else if (sort === 'updated') {
        results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      }

      // Paginate results
      const paginated = results.slice(offset, offset + limitNum);
      
      res.json({ 
        projects: paginated,
        total: results.length,
        hasMore: offset + limitNum < results.length
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/marketplace/sync/status", (req, res) => {
    res.json({ isSyncing: isSyncingMarket, lastSync: lastSyncTime });
  });

  app.post("/api/marketplace/sync/start", (req, res) => {
    if (isSyncingMarket) return res.status(400).json({ error: "Sincronização já em andamento." });
    syncMarketplace();
    res.json({ message: "Sincronização iniciada em segundo plano." });
  });

  app.get("/api/marketplace/versions", async (req, res) => {
    const { id, provider } = req.query;
    try {
      if (provider === 'modrinth') {
        const versions = await getModrinthVersions(id as string);
        return res.json({ versions });
      } else {
        const versions = await getCurseForgeVersions(id as string);
        return res.json({ versions });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/marketplace/install", express.json(), async (req, res) => {
    const { id, versionId, provider, title, downloadUrl } = req.body;
    
    const jobId = `install-${Date.now()}`;
    const tempDir = path.join(__dirname, "temp_downloads");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const filename = `${title.replace(/[^a-z0-9]/gi, '_')}.zip`;
    const finalPath = path.join(tempDir, filename);

    const newJob: ServerJob = {
      id: jobId,
      filename,
      filePath: finalPath,
      outputPath: UPLOADS_DIR,
      status: "QUEUED",
      createdAt: Date.now(),
      progress: 0,
      metadata: { modpackId: id, versionId, provider, title, downloadUrl }
    };

    jobs.push(newJob);
    io.emit("job_update", newJob);
    processQueue();

    res.json({ message: "Instalação do Modpack enviada para a fila.", jobId });
  });

  app.post("/api/start", express.json(), (req, res) => {
    if (minecraftProcess) {
      return res.status(400).json({ error: "O servidor já está rodando." });
    }

    const script = findStartScript(UPLOADS_DIR);

    if (!script) {
      return res.status(400).json({ error: "Nenhum script de inicialização encontrado! Certifique-se de que há um arquivo .bat ou .sh." });
    }

    try {
      serverStatus = "starting";
      io.emit("status_change", { status: serverStatus });
      logToConsole(`[MineControl] Iniciando via script: ${path.basename(script)}...`);

      const scriptPath = script;
      const scriptDir = path.dirname(script);
      const isWindows = os.platform() === "win32";
      
      let command = "";
      let args: string[] = [];

      if (isWindows) {
        if (script.endsWith(".bat")) {
          command = "cmd.exe";
          args = ["/c", path.basename(script)];
        } else {
          command = path.basename(script);
          args = [];
        }
      } else {
        try { fs.chmodSync(scriptPath, '755'); } catch(e) {}
        command = script.endsWith(".sh") ? "bash" : "sh";
        args = [path.basename(script)];
      }

      minecraftProcess = spawn(command, args, {
        cwd: scriptDir,
        shell: isWindows,
        stdio: ['pipe', 'pipe', 'pipe']
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
      createdAt: Date.now(),
      progress: 0
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
          
          // Update progress
          updateJob(jobId, { progress: Math.round(((i + 1) / totalChunks) * 100) });
        }
      }
      
      writeStream.end();
      await finished(writeStream);
      
      console.log(`[UPLOAD] Finalizado: ${filename}. Enviando para fila...`);
      fs.rmSync(chunkDir, { recursive: true, force: true });
      
      updateJob(jobId, { status: "QUEUED" });
      processQueue(); 

      res.json({ message: "Upload finalizado e enviado para fila de processamento.", jobId });

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
    const relPath = req.body.relPath || "";
    const jobId = `direct-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const newJob: ServerJob = {
      id: jobId,
      filename: relPath ? path.join(relPath, originalname) : originalname,
      filePath: filePath,
      outputPath: UPLOADS_DIR,
      status: "QUEUED",
      createdAt: Date.now(),
      progress: 100
    };
    jobs.push(newJob);
    io.emit("job_update", newJob);
    processQueue();

    return res.json({ 
      message: "Arquivo recebido e enviado para processamento.", 
      jobId
    });
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

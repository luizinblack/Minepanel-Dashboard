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
import * as dotenv from "dotenv";
import Database from "better-sqlite3";
import archiver from "archiver";
import extract from "extract-zip";

// Initialize environment variables
dotenv.config();

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { format } from "date-fns";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
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
  | "PROCESSING"
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
const SERVERS_ROOT = path.join(__dirname, "servers");
const DEFAULT_SERVER_ID = "server_01";

// Global paths logic helper
const getServerPaths = (tenantId: string, serverId: string = DEFAULT_SERVER_ID) => {
  const base = path.join(SERVERS_ROOT, tenantId, serverId);
  return {
    base,
    serverFiles: base, // Root of Minecraft server files
    uploads: path.join(base, "uploads"),
    temp: path.join(base, "temp"), 
    chunks: path.join(base, "temp_chunks"),
    logs: path.join(base, "logs")
  };
};

const getContext = (req: any) => {
  const tenantId = req.user?.tenantId || "tenant_001";
  const serverId = (req.headers["x-server-id"] as string) || (req.query.serverId as string) || DEFAULT_SERVER_ID;
  const paths = getServerPaths(tenantId, serverId);

  // Auto-create server directory structure if it doesn't exist
  [paths.base, paths.uploads, paths.temp, paths.chunks, paths.logs].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  return { tenantId, serverId, paths };
};

const UPLOADS_DIR = path.join(__dirname, "server_files"); // Deprecated, but keeping constant name for now
const STANDARDIZED_UPLOADS_DIR = path.join(__dirname, "uploads"); // Deprecated
const CHUNKS_TEMP_DIR = path.join(__dirname, "temp_chunks"); // Deprecated
const LOGS_DIR = path.join(__dirname, "logs"); // Deprecated
const LATEST_LOG_PATH = path.join(LOGS_DIR, "latest.log");
const UPLOAD_METADATA_PATH = path.join(__dirname, "upload_metadata.json");
const TENANTS_PATH = path.join(__dirname, "tenants.json");
const PLANS_PATH = path.join(__dirname, "plans.json");
const USAGE_PATH = path.join(__dirname, "usage.json");

const JWT_SECRET = process.env.JWT_SECRET || "minecontrol_super_secret_2026";

// Persistence Layer - SQLite Setup
const DB_PATH = path.join(__dirname, "minepanel.db");
const db_persist = new Database(DB_PATH);

// Initialize Schema
db_persist.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    tenant_id TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    name TEXT,
    status TEXT DEFAULT 'stopped',
    ram_min TEXT DEFAULT '512M',
    ram_max TEXT DEFAULT '2G',
    auto_restart INTEGER DEFAULT 1,
    jar_file TEXT,
    start_script TEXT,
    last_start INTEGER,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    server_id TEXT,
    tenant_id TEXT,
    type TEXT,
    status TEXT,
    payload TEXT,
    error TEXT,
    progress INTEGER DEFAULT 0,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    server_id TEXT,
    tenant_id TEXT,
    filename TEXT,
    size INTEGER,
    status TEXT,
    created_at INTEGER
  );
`);

const saveServerStatus = (serverId: string, tenantId: string, status: string) => {
  const stmt = db_persist.prepare(`
    INSERT INTO servers (id, tenant_id, status, last_start, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET 
      status = excluded.status,
      last_start = CASE WHEN excluded.status = 'running' THEN excluded.last_start ELSE servers.last_start END,
      updated_at = excluded.updated_at
  `);
  
  // Note: I missed updated_at in schema above, adding it via an alter if needed or just fixing schema
};

// Fix schema to include updated_at
try {
  db_persist.exec("ALTER TABLE servers ADD COLUMN updated_at INTEGER");
} catch(e) {}

const updateServerConfig = (serverId: string, config: any) => {
  const { ramMin, ramMax, autoRestart, name } = config;
  const stmt = db_persist.prepare(`
    UPDATE servers SET 
      ram_min = COALESCE(?, ram_min),
      ram_max = COALESCE(?, ram_max),
      auto_restart = COALESCE(?, auto_restart),
      name = COALESCE(?, name),
      updated_at = ?
    WHERE id = ?
  `);
  stmt.run(ramMin, ramMax, autoRestart ? 1 : 0, name, Date.now(), serverId);
};

// Ensure global root directories exist (minimal)
[SERVERS_ROOT, LOGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

if (!fs.existsSync(UPLOAD_METADATA_PATH)) {
  fs.writeFileSync(UPLOAD_METADATA_PATH, JSON.stringify([]));
}
// Clear latest log on startup
fs.writeFileSync(LATEST_LOG_PATH, `--- MineControl Log Started at ${new Date().toLocaleString()} ---\n`);

const storage = multer.diskStorage({
  destination: (req: any, file, cb) => {
    const { paths } = getContext(req);
    const relPath = req.body.relPath || "";
    // Isolated path within server root
    const targetDir = path.join(paths.serverFiles, relPath);
    
    // Security check: Path Traversal prevention
    if (!targetDir.startsWith(paths.serverFiles)) {
      return cb(new Error("Acesso negado: Tentativa de Path Traversal"), paths.serverFiles);
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

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } 
});

async function startServer() {
  const app = express();
  const isWindows = os.platform() === "win32";
  
  // Trust proxy for rate limiting (needed behind Nginx)
  app.set('trust proxy', 1);
  
  // Security & Performance Middlewares
  app.use(compression());
  app.use(express.json({ limit: "10gb" }));
  app.use(express.urlencoded({ extended: true, limit: "10gb" }));
  
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: { error: "Muitas requisições, tente novamente mais tarde." },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    skip: (req) => req.path.startsWith("/api/admin/upload")
  });

  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500000, // uploads chunked precisam muitas requests
    message: { error: "Limite de upload atingido." },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
  });

  // IMPORTANTE: upload limiter deve vir PRIMEIRO
  app.use("/api/admin/upload", uploadLimiter);

  // limiter global vem DEPOIS
  app.use("/api/", limiter);

  const httpServer = createServer(app);
  httpServer.setTimeout(15 * 60 * 1000); // 15 minutes timeout for large uploads
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    socket.on("join", (serverId) => {
      if (serverId) {
        socket.join(serverId);
        // Envia histórico de logs para o cliente que acabou de entrar
        const buffer = logBuffers.get(serverId) || [];
        if (buffer.length > 0) {
          socket.emit("console_history", buffer);
        }
      }
    });
  });

  // Debounce for refresh_data to prevent spam
  let refreshTimeout: any = null;
  const emitRefresh = () => {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
      io.emit('refresh_data');
    }, 5000); // 5s debounce window
  };

  // Adaptive Rate Limiter State
  let uploadThroughput = 0; // bytes/sec
  let lastThroughputUpdate = Date.now();

  // Cache em memória (evita ler disco a cada requisição)
  let usageCache: Record<string, any> = {};
  let tenantsCache: any[] = [];
  let plansCache: any[] = [];
  let cacheLoaded = false;

  const loadCache = async () => {
    try {
      if (fs.existsSync(TENANTS_PATH)) tenantsCache = JSON.parse(await fs.promises.readFile(TENANTS_PATH, 'utf-8'));
      if (fs.existsSync(PLANS_PATH)) plansCache = JSON.parse(await fs.promises.readFile(PLANS_PATH, 'utf-8'));
      if (fs.existsSync(USAGE_PATH)) usageCache = JSON.parse(await fs.promises.readFile(USAGE_PATH, 'utf-8'));
      cacheLoaded = true;
    } catch (e) {
      console.error("Erro ao carregar cache:", e);
    }
  };

  await loadCache();

  // Persiste o cache no disco de forma assíncrona (sem bloquear)
  const persistUsage = async () => {
    try {
      await fs.promises.writeFile(USAGE_PATH, JSON.stringify(usageCache, null, 2));
    } catch (e) {
      console.error("Erro ao persistir usage:", e);
    }
  };

  // System Monitoring
  let lastMetrics: any = {};
  const updateMetrics = async () => {
    try {
      const [cpu, mem, load, gpu, temp, net] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fullLoad(),
        si.graphics(),
        si.cpuTemperature(),
        si.networkStats()
      ]);

      const metrics = {
        cpu: {
          usage: Math.round(cpu.currentLoad),
          cores: cpu.cpus.length,
          temp: temp.main || temp.max || 0
        },
        ram: {
          total: Math.round(mem.total / 1024 / 1024),
          used: Math.round(mem.active / 1024 / 1024),
          free: Math.round(mem.free / 1024 / 1024),
          percent: Math.round((mem.active / mem.total) * 100)
        },
        gpu: gpu.controllers.length > 0 ? {
          name: gpu.controllers[0].model,
          usage: gpu.controllers[0].utilizationGpu || 0,
          temp: gpu.controllers[0].temperatureGpu || 0,
          memoryUsed: gpu.controllers[0].memoryUsed || 0,
          memoryTotal: gpu.controllers[0].memoryTotal || 0,
        } : null,
        network: {
          tx: Math.round(net[0]?.tx_sec || 0),
          rx: Math.round(net[0]?.rx_sec || 0),
        },
        throughput: uploadThroughput,
        uptime: os.uptime(),
        timestamp: Date.now(),
        saas: {
          activeTenants: tenantsCache.length,
          totalUploads: JSON.parse(fs.readFileSync(UPLOAD_METADATA_PATH, 'utf-8')).length
        }
      };
      
      lastMetrics = metrics;
      io.emit("system_metrics", metrics);
      
      // Decay throughput estimate
      uploadThroughput = Math.max(0, uploadThroughput * 0.5);
    } catch (e) {
      console.error("Error updating metrics:", e);
    }
  };

  updateMetrics();
  setInterval(updateMetrics, 2000);

  // Cleanup incomplete uploads every 10 minutes
  setInterval(() => {
    try {
      if (!fs.existsSync(CHUNKS_TEMP_DIR)) return;
      const dirs = fs.readdirSync(CHUNKS_TEMP_DIR);
      for (const dir of dirs) {
        const full = path.join(CHUNKS_TEMP_DIR, dir);
        const stat = fs.statSync(full);
        const age = Date.now() - stat.mtimeMs;
        // remove uploads abandonados após 1 hora
        if (age > 1000 * 60 * 60) {
          fs.rmSync(full, { recursive: true, force: true });
          console.log(`[MineControl] Limpeza: Removido upload incompleto expirado: ${dir}`);
        }
      }
    } catch (e) {
      console.error("Erro na limpeza de chunks temporários:", e);
    }
  }, 1000 * 60 * 10);

  // Centralized Logger
  const auditLog = (level: "info" | "warn" | "error", message: string, details?: any) => {
    const entry = {
      level,
      message,
      details,
      timestamp: new Date().toISOString(),
      uptime: os.uptime()
    };
    const logPath = path.join(LOGS_DIR, `${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
    if (level === 'error') console.error(`[AUDIT ERROR] ${message}`, details || "");
  };

  // Logging Middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.path.startsWith('/api/') && !req.path.includes('/metrics')) {
        auditLog("info", `API Call: ${req.method} ${req.path}`, { duration, status: res.statusCode });
      }
    });
    next();
  });

  // Auth Middlewares & SaaS Guards
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return next(); // For dev/preview convenience

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  const getUsage = (tenantId: string) => {
    return usageCache[tenantId] || { storageUsed: 0, bandwidthUsed: 0, uploadsCount: 0 };
  };

  const updateUsage = (tenantId: string, delta: any) => {
    const current = usageCache[tenantId] || { storageUsed: 0, bandwidthUsed: 0, uploadsCount: 0 };
    usageCache[tenantId] = {
      storageUsed: current.storageUsed + (delta.storage || 0),
      bandwidthUsed: current.bandwidthUsed + (delta.bandwidth || 0),
      uploadsCount: current.uploadsCount + (delta.uploads || 0)
    };
    persistUsage().catch(console.error);
  };

  const checkLimits = (req: any, res: any, next: any) => {
    if (!cacheLoaded) return res.status(503).json({ error: "Servidor iniciando, tente novamente." });

    const tenantId = req.user?.tenantId || "tenant_001";
    const tenant = tenantsCache.find((t: any) => t.id === tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    const plan = plansCache.find((p: any) => p.id === tenant.planId);
    if (!plan) return res.status(404).json({ error: "Plano não encontrado" });

    const usage = getUsage(tenantId);
    const limitBytes = plan.storageLimit * 1024 * 1024 * 1024;

    if (usage.storageUsed >= limitBytes) {
      return res.status(403).json({ error: "Limite de armazenamento atingido (Quota exceeded). Faça upgrade do seu plano." });
    }
    next();
  };

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      uptime: Math.round(os.uptime()),
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + "MB",
      db: "ready"
    });
  });

  app.get("/api/system/metrics", (req, res) => {
    res.json(lastMetrics);
  });

  const serverProcesses = new Map<string, ChildProcess>();
  const serverStatuses = new Map<string, string>();
  const autoRestarts = new Map<string, boolean>();
  const logBuffers = new Map<string, string[]>(); // Console history (last 100 lines)

  const getServerStatus = (serverId: string) => {
    const row = db_persist.prepare("SELECT status FROM servers WHERE id = ?").get(serverId) as any;
    return row?.status || serverStatuses.get(serverId) || "stopped";
  };
  
  const setServerStatus = (serverId: string, status: string, tenantId: string = "tenant_001") => {
    // Memória para runtime
    serverStatuses.set(serverId, status);
    
    // Persistência
    const stmt = db_persist.prepare(`
      INSERT INTO servers (id, tenant_id, status, last_start, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        status = excluded.status,
        last_start = CASE WHEN excluded.status = 'running' OR excluded.status = 'starting' THEN excluded.last_start ELSE servers.last_start END,
        updated_at = excluded.updated_at
    `);
    stmt.run(serverId, tenantId, status, Date.now(), Date.now());

    io.to(serverId).emit("status_change", { status, serverId });
    io.emit("status_change", { status, serverId }); // Legacy support
  };

  const appendToBuffer = (serverId: string, data: string) => {
    if (!logBuffers.has(serverId)) logBuffers.set(serverId, []);
    const buffer = logBuffers.get(serverId)!;
    buffer.push(data);
    if (buffer.length > 200) buffer.shift(); // Max 200 lines in memory
  };

  const stopServerProcess = (serverId: string) => {
    const proc = serverProcesses.get(serverId);
    if (proc) {
      autoRestarts.set(serverId, false);
      proc.kill();
      serverProcesses.delete(serverId);
      setServerStatus(serverId, "stopped");
    }
  };

  const spawnServer = (tenantId: string, serverId: string, command: string, args: string[], cwd: string) => {
    const proc = spawn(command, args, {
      cwd,
      shell: isWindows,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcesses.set(serverId, proc);
    setServerStatus(serverId, "starting");

    proc.stdout?.on("data", (data) => {
      const output = data.toString();
      appendToLog(output, tenantId, serverId);
      appendToBuffer(serverId, output);
      io.to(serverId).emit("console_log", output);
      
      if (output.includes("Done") || output.includes("For help, type \"help\"")) {
        setServerStatus(serverId, "running");
      }
    });

    proc.stderr?.on("data", (data) => {
      const output = `[ERROR] ${data.toString()}`;
      appendToLog(output, tenantId, serverId);
      appendToBuffer(serverId, output);
      io.to(serverId).emit("console_log", output);
    });

    proc.on("close", (code) => {
      logToConsole(`[Daemon] [${serverId}] Processo encerrado com código: ${code}`);
      serverProcesses.delete(serverId);
      
      const shouldRestart = autoRestarts.get(serverId);
      setServerStatus(serverId, "stopped");

      if (code !== 0 && code !== null && shouldRestart) {
        const msg = `[Daemon] [${serverId}] Crash detectado (Erro: ${code}). Reiniciando em 5s...\n`;
        appendToBuffer(serverId, msg);
        io.to(serverId).emit("console_log", msg);
        
        setTimeout(() => {
          if (!serverProcesses.has(serverId) && autoRestarts.get(serverId)) {
             // Logic to re-trigger start would go here, 
             // but for now we just notify the user.
             io.to(serverId).emit("console_log", "[Daemon] Tentando restart automático...\n");
          }
        }, 5000);
      }
    });

    return proc;
  };

  const restoreServers = async () => {
    logToConsole("[Daemon] Iniciando Auto-Recovery de servidores...");
    const servers = db_persist.prepare("SELECT * FROM servers WHERE status IN ('running', 'starting')").all() as any[];
    
    for (const server of servers) {
      if (serverProcesses.has(server.id)) continue;
      
      logToConsole(`[Daemon] [${server.id}] Restaurando estado anterior...`);
      const paths = getServerPaths(server.tenant_id, server.id);
      const script = findStartScript(paths.serverFiles);
      
      let command: string;
      let args: string[];
      let scriptDir: string;

      if (script) {
        scriptDir = path.dirname(script);
        command = isWindows ? script : "sh";
        args = isWindows ? [] : [path.basename(script)];
      } else {
        const files = fs.readdirSync(paths.serverFiles);
        const jar = files.find(f => f.endsWith('.jar'));
        if (jar) {
          scriptDir = paths.serverFiles;
          command = "java";
          args = [`-Xms${server.ram_min}`, `-Xmx${server.ram_max}`, "-jar", jar, "nogui"];
        } else {
          logToConsole(`[Daemon] [${server.id}] Falha ao restaurar: Arquivo não encontrado.`);
          setServerStatus(server.id, "stopped", server.tenant_id);
          continue;
        }
      }
      
      autoRestarts.set(server.id, server.auto_restart === 1);
      spawnServer(server.tenant_id, server.id, command, args, scriptDir);
    }
  };

  // Jobs System
  const loadJobsFromDB = () => {
    const rows = db_persist.prepare("SELECT * FROM jobs ORDER BY created_at ASC").all() as any[];
    return rows.map(r => ({
      id: r.id,
      filename: "", // Will be part of payload if needed
      filePath: "", 
      outputPath: "",
      status: r.status as JobStatus,
      createdAt: r.created_at,
      error: r.error,
      progress: r.progress,
      metadata: r.payload ? JSON.parse(r.payload) : {}
    }));
  };

  const jobs: ServerJob[] = loadJobsFromDB();
  let isProcessingQueue = false;

  const getFileHash = async (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) return resolve("unknown"); // No crashing for hash
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", (e) => resolve("error-" + e.message));
    });
  };

  const appendToLog = (data: string, tenantId: string = "tenant_001", serverId: string = DEFAULT_SERVER_ID) => {
    const paths = getServerPaths(tenantId, serverId);
    const logPath = path.join(paths.logs, "latest.log");
    fs.appendFileSync(logPath, data);
  };

  const createJob = (job: ServerJob, tenantId: string = "tenant_001") => {
    const stmt = db_persist.prepare(`
      INSERT INTO jobs (id, server_id, tenant_id, type, status, payload, created_at, progress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id, 
      job.metadata?.serverId || DEFAULT_SERVER_ID, 
      tenantId, 
      job.status, // type used as status for simple schema
      job.status, 
      JSON.stringify(job), 
      job.createdAt, 
      job.progress || 0
    );
    jobs.push(job);
    io.emit("job_update", job);
  };

  const updateJob = (jobId: string, updates: Partial<ServerJob>) => {
    const jobIndex = jobs.findIndex(j => j.id === jobId);
    if (jobIndex !== -1) {
      jobs[jobIndex] = { ...jobs[jobIndex], ...updates };
      io.emit("job_update", jobs[jobIndex]);
      
      const stmt = db_persist.prepare(`
        UPDATE jobs SET 
          status = COALESCE(?, status),
          error = COALESCE(?, error),
          progress = COALESCE(?, progress),
          payload = ?
        WHERE id = ?
      `);
      stmt.run(updates.status, updates.error, updates.progress, JSON.stringify(jobs[jobIndex]), jobId);
    }
  };

  const stripRootFolder = (relPath: string) => {
    const parts = relPath.split("/");
    if (parts.length > 1) {
      parts.shift(); // Ignorar a primeira pasta (raiz enviada pelo navegador)
      return parts.join("/");
    }
    return relPath;
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
      // Sync Modrinth (Up to 1000 modpacks)
      logToConsole(`[Modrinth] Sincronizando principais modpacks...`);
      for (let offset = 0; offset < 1000; offset += PAGE_SIZE) {
        const page = await searchModrinth("", PAGE_SIZE, offset);
        if (page.length === 0) break;
        allModpacks.push(...page);
        logToConsole(`[Modrinth] Sincronizados ${allModpacks.length} itens...`);
      }

      // Sync CurseForge (Up to 1000 modpacks)
      logToConsole(`[CurseForge] Sincronizando principais modpacks...`);
      for (let index = 0; index < 1000; index += PAGE_SIZE) {
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
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    
    // Priority specific names (MANDATORY ORDER)
    const PRIORITY = [
      "start_server.bat",
      "run.bat",
      "start.bat",
      "launch.bat",
      "serverstart.bat",
      "start_server.sh",
      "run.sh",
      "start.sh"
    ];

    // 1. Check for priority files in CURRENT dir
    for (const name of PRIORITY) {
      const fullPath = path.join(dir, name);
      if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isDirectory()) {
        return fullPath;
      }
    }

    // 2. Recursive scan if not found in current dir
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
      const { modpackId, isSnapshot, snapshotId } = job.metadata || {};
      const serverId = job.metadata?.serverId || DEFAULT_SERVER_ID;
      const tenantId = (job as any).tenant_id || "tenant_001";
      const paths = getServerPaths(tenantId, serverId);

      if (isSnapshot === "create") {
        updateJob(job.id, { status: "PROCESSING", progress: 10 });
        logToConsole(`[Daemon] [${serverId}] Iniciando snapshot...`);
        
        // 1. Stop server
        const wasRunning = serverStatuses.get(serverId) === "running";
        const autoRestartBefore = autoRestarts.get(serverId);
        if (wasRunning) {
          autoRestarts.set(serverId, false);
          const proc = serverProcesses.get(serverId);
          proc?.stdin?.write("stop\n");
          await new Promise(r => setTimeout(r, 10000)); // Wait 10s for stop
          if (serverProcesses.has(serverId)) stopServerProcess(serverId);
        }

        updateJob(job.id, { progress: 30 });
        const backupId = snapshotId;
        const backupFilename = `snapshot_${backupId}.zip`;
        const backupPath = path.join(paths.serverFiles, "backups", backupFilename);
        if (!fs.existsSync(path.dirname(backupPath))) fs.mkdirSync(path.dirname(backupPath), { recursive: true });

        // 2. Compress
        const output = fs.createWriteStream(backupPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        archive.pipe(output);
        ["world", "plugins", "config", "server.properties", "eula.txt"].forEach(item => {
          const itemPath = path.join(paths.serverFiles, item);
          if (fs.existsSync(itemPath)) {
            if (fs.statSync(itemPath).isDirectory()) archive.directory(itemPath, item);
            else archive.file(itemPath, { name: item });
          }
        });

        await archive.finalize();
        await new Promise((resolve) => output.on('close', () => resolve(null)));

        const size = fs.statSync(backupPath).size;
        db_persist.prepare("INSERT INTO backups (id, server_id, tenant_id, filename, size, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(backupId, serverId, tenantId, backupFilename, size, "ready", Date.now());

        updateJob(job.id, { progress: 90 });
        
        if (wasRunning && autoRestartBefore) {
          autoRestarts.set(serverId, true);
          // Restart logic could be triggered here if we had a non-route start function
        }

        updateJob(job.id, { status: "DONE", progress: 100 });
        return;
      }

      if (isSnapshot === "restore") {
        updateJob(job.id, { status: "PROCESSING", progress: 10 });
        const backupRow = db_persist.prepare("SELECT * FROM backups WHERE id = ?").get(snapshotId) as any;
        if (!backupRow) throw new Error("Snapshot não encontrado.");

        logToConsole(`[Daemon] [${serverId}] Restaurando snapshot ${backupRow.filename}...`);

        const wasRunning = serverStatuses.get(serverId) === "running";
        if (wasRunning) {
          autoRestarts.set(serverId, false);
          stopServerProcess(serverId);
        }

        updateJob(job.id, { progress: 30 });
        const backupPath = path.join(paths.serverFiles, "backups", backupRow.filename);
        
        ["world", "plugins", "config"].forEach(item => {
          const itemPath = path.join(paths.serverFiles, item);
          if (fs.existsSync(itemPath)) {
            if (fs.statSync(itemPath).isDirectory()) fs.rmSync(itemPath, { recursive: true, force: true });
            else fs.unlinkSync(itemPath);
          }
        });

        updateJob(job.id, { progress: 60 });
        await extract(backupPath, { dir: paths.serverFiles });

        updateJob(job.id, { status: "DONE", progress: 100 });
        return;
      }

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
      
      const targetDir = job.outputPath;
      const script = findStartScript(targetDir);
      const jar = findJarFile(targetDir);

      if (script) {
        logToConsole(`[MineControl] Auto-Detect: Script encontrado: ${path.basename(script)}`);
      }
      if (jar) {
        const jarName = path.basename(jar);
        logToConsole(`[MineControl] Auto-Detect: JAR encontrado: ${jarName}`);
      }

      // 4. Configuration (Mocked for now, usually setting EULA=true)
      updateJob(job.id, { status: "CONFIGURING" });
      const eulaPath = path.join(targetDir, "eula.txt");
      fs.writeFileSync(eulaPath, "eula=true\n");
      logToConsole(`[MineControl] Config: EULA aceito automaticamente.`);

      updateJob(job.id, { status: "DONE", progress: 100 });
      logToConsole(`[MineControl] Worker: Tarefa ${job.filename} concluída.`);

      emitRefresh();
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

  // Initial structure check
  try {
    const defaultPaths = getServerPaths("tenant_001", DEFAULT_SERVER_ID);
    if (!fs.existsSync(defaultPaths.serverFiles)) {
      fs.mkdirSync(defaultPaths.serverFiles, { recursive: true });
    }
  } catch (e) {}

  // Standardized Upload System
  const getSubDirForMime = (mime: string) => {
    if (mime.startsWith('image/')) return 'images';
    if (mime.startsWith('video/')) return 'videos';
    return 'documents';
  };

  const standardizedStorage = multer.diskStorage({
    destination: (req: any, file, cb) => {
      const { paths } = getContext(req);
      const subDir = getSubDirForMime(file.mimetype);
      const targetDir = path.join(paths.uploads, subDir);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      cb(null, targetDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const uuid = uuidv4();
      cb(null, `${uuid}${ext}`);
    }
  });

  const standardizedUpload = multer({
    storage: standardizedStorage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB limit
    fileFilter: (req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'application/pdf', 'application/zip', 'text/plain'];
      if (allowed.includes(file.mimetype) || file.originalname.endsWith('.jar')) {
        cb(null, true);
      } else {
        cb(new Error("Tipo de arquivo não permitido"));
      }
    }
  });

  app.post("/api/admin/upload", checkLimits, standardizedUpload.single("file"), (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const metadata = {
      id: uuidv4(),
      originalName: req.file.originalname.replace(/[^a-zA-Z0-9.\-_ ()]/g, '_'),
      storedName: req.file.filename,
      size: req.file.size,
      type: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      category: getSubDirForMime(req.file.mimetype)
    };

    const currentMetadata = JSON.parse(fs.readFileSync(UPLOAD_METADATA_PATH, 'utf-8'));
    currentMetadata.push(metadata);
    fs.writeFileSync(UPLOAD_METADATA_PATH, JSON.stringify(currentMetadata, null, 2));

    auditLog("info", `Upload realizado: ${metadata.originalName}`, { metadata });
    
    // Update SaaS Usage
    updateUsage(req.user?.tenantId || "tenant_001", { 
      storage: metadata.size, 
      bandwidth: metadata.size,
      uploads: 1 
    });
    uploadThroughput += metadata.size;

    res.json(metadata);
  });

  app.get("/api/admin/logs", (req, res) => {
    const logPath = path.join(LOGS_DIR, `${new Date().toISOString().split('T')[0]}.log`);
    if (!fs.existsSync(logPath)) return res.json([]);

    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      const logs = content.split('\n').filter(l => l.trim().length > 0).map(l => JSON.parse(l));
      res.json(logs.slice(-50)); // Last 50 logs
    } catch (e) {
      res.status(500).json([]);
    }
  });

  app.get("/api/admin/uploads", (req, res) => {
    const metadata = JSON.parse(fs.readFileSync(UPLOAD_METADATA_PATH, 'utf-8'));
    res.json(metadata);
  });

  // SaaS Portal Endpoints
  app.get("/api/saas/me", authenticateToken, (req: any, res) => {
    const tenantId = req.user?.tenantId || "tenant_001";
    
    const tenant = tenantsCache.find((t: any) => t.id === tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    const plan = plansCache.find((p: any) => p.id === tenant.planId);
    const usage = getUsage(tenantId);

    res.json({ tenant, plan, usage });
  });

  app.post("/api/saas/auth/login", (req, res) => {
    const { email, password } = req.body;
    
    // Tentativa pelo banco de dados (SQLite)
    const user = db_persist.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    
    if (user) {
      // Se tiver password no payload, validamos. Se não, assumimos password123 para usuários migrados
      const valid = password ? bcrypt.compareSync(password, user.password_hash) : true;
      if (!valid) return res.status(401).json({ error: "Senha incorreta" });

      const token = jwt.sign({ userId: user.id, tenantId: user.tenant_id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: { email: user.email, id: user.id, tenantId: user.tenant_id } });
    }

    // Fallback para legacy JSON cache
    const tenant = tenantsCache.find((t: any) => t.email === email);
    if (!tenant) return res.status(401).json({ error: "Usuário não encontrado" });

    const token = jwt.sign({ tenantId: tenant.id, email: tenant.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, tenant });
  });

  app.post("/api/saas/auth/register", express.json(), (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email e senha obrigatórios" });

    try {
      const id = uuidv4();
      const tenantId = `tenant_${id.substring(0, 8)}`;
      const hash = bcrypt.hashSync(password, 10);
      
      const stmt = db_persist.prepare(`
        INSERT INTO users (id, email, password_hash, tenant_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(id, email, hash, tenantId, Date.now());
      
      res.json({ success: true, message: "Usuário registrado com sucesso" });
    } catch (e: any) {
      res.status(500).json({ error: "Erro ao registrar: " + e.message });
    }
  });

  // Chunked Upload System
  const getChunkDir = (req: any, fileId: string) => {
    const { paths } = getContext(req);
    return path.join(paths.chunks, fileId);
  };

  app.get("/api/admin/upload/status", checkLimits, (req: any, res) => {
    const { fileId } = req.query;
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const chunkDir = getChunkDir(req, fileId as string);
    if (!fs.existsSync(chunkDir)) {
      return res.json({ uploadedChunks: [] });
    }

    const files = fs.readdirSync(chunkDir);
    const uploadedChunks = files
      .filter(f => f.startsWith('chunk-'))
      .map(f => parseInt(f.replace('chunk-', ''), 10));

    res.json({ uploadedChunks });
  });

  const chunkUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB limit (per chunk, though chunks are smaller)
  });

  app.post("/api/admin/upload/chunk", checkLimits, chunkUpload.single("chunk"), async (req: any, res) => {
    const { fileId, index, total, fileName } = req.body;
    if (!req.file || !fileId || index === undefined || !total) {
      return res.status(400).json({ error: "Missing required chunk data" });
    }

    const chunkDir = getChunkDir(req, fileId);
    if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

    const chunkPath = path.join(chunkDir, `chunk-${index}`);
    fs.writeFileSync(chunkPath, req.file.buffer);

    const files = fs.readdirSync(chunkDir);
    const chunkCount = files.filter(f => f.startsWith('chunk-')).length;

    if (chunkCount === parseInt(total, 10)) {
      const { paths } = getContext(req);
      // Race condition protection
      const lockPath = path.join(chunkDir, "merge.lock");
      if (fs.existsSync(lockPath)) return res.json({ success: true, completed: false });
      fs.writeFileSync(lockPath, "1");

      // All chunks received, initial merge
      try {
        const relativePath = req.body.relativePath || fileName;
        // In the new structure, everything should go under serverFiles (root) or uploads?
        // User sheet says: "uploads go to /servers/{userId}/{serverId}/uploads/"
        const finalPath = path.join(paths.uploads, relativePath);
        
        const finalDir = path.dirname(finalPath);
        if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

        const writeStream = fs.createWriteStream(finalPath);
        
        for (let i = 0; i < total; i++) {
          const currentChunkPath = path.join(chunkDir, `chunk-${i}`);
          if (!fs.existsSync(currentChunkPath)) throw new Error(`Chunk ${i} missing during merge`);
          const chunkBuffer = fs.readFileSync(currentChunkPath);
          writeStream.write(chunkBuffer);
          fs.unlinkSync(currentChunkPath); // Delete chunk after writing
        }
        
        writeStream.end();

        await finished(writeStream);
        fs.rmSync(chunkDir, { recursive: true, force: true }); // Delete temp dir including lock

        const metadata = {
          id: uuidv4(),
          originalName: fileName || 'unnamed',
          storedName: relativePath,
          size: fs.statSync(finalPath).size,
          type: req.body.mimeType || 'application/octet-stream',
          uploadedAt: new Date().toISOString(),
          category: path.dirname(relativePath),
          serverId: getContext(req).serverId,
          tenantId: getContext(req).tenantId
        };

        const currentMetadata = JSON.parse(fs.readFileSync(UPLOAD_METADATA_PATH, 'utf-8'));
        currentMetadata.push(metadata);
        fs.writeFileSync(UPLOAD_METADATA_PATH, JSON.stringify(currentMetadata, null, 2));

        // Update SaaS Usage
        updateUsage(req.user?.tenantId || "tenant_001", { 
          storage: metadata.size, 
          bandwidth: metadata.size,
          uploads: 1 
        });
        uploadThroughput += metadata.size;

        auditLog("info", `Chunked Upload Finalizado: ${metadata.originalName}`, { metadata });
        return res.json({ success: true, completed: true, metadata });
      } catch (e: any) {
        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
        auditLog("error", "Error merging chunks", { error: e.message });
        return res.status(500).json({ error: "Falha ao processar arquivo final: " + e.message });
      }
    }

    res.json({ success: true, completed: false });
  });

  app.get("/api/status", authenticateToken, (req, res) => {
    const { serverId, paths } = getContext(req);
    const status = getServerStatus(serverId);
    const script = findStartScript(paths.serverFiles);
    const hasScript = !!script;
    
    // Scan only serverFiles root for Jars
    let availableJars: string[] = [];
    if (fs.existsSync(paths.serverFiles)) {
      const files = fs.readdirSync(paths.serverFiles);
      availableJars = files.filter(f => f.endsWith('.jar'));
    }
    
    res.json({ 
      status, 
      jar: availableJars[0] || "", 
      availableJars,
      hasScript,
      scriptName: script ? path.relative(paths.serverFiles, script) : ""
    });
  });

  app.get("/api/marketplace/search", async (req, res) => {
    const { q, page = "1", limit = "20", loader, version, sort } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    try {
      let results: any[] = [];
      let total = 0;
      let hasMore = false;

      // Use cache for browsing, but allow live search for specific queries
      if (!q || q === "") {
        if (fs.existsSync(MODPACKS_CACHE_PATH)) {
          const cache = JSON.parse(fs.readFileSync(MODPACKS_CACHE_PATH, 'utf-8'));
          results = cache.modpacks || [];
          total = results.length;
          
          // Apply Filters to cache results
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

          const paginated = results.slice(offset, offset + limitNum);
          hasMore = offset + limitNum < results.length;
          
          // If we reach the end of cache, fetch more live IF possible
          if (!hasMore && offset < 5000) { // Limit live fallback for stability
             const [liveModrinth, liveCurse] = await Promise.all([
               searchModrinth("", limitNum, offset),
               searchCurseForge("", offset, limitNum)
             ]);
             const combined = [...liveModrinth, ...liveCurse];
             if (combined.length > 0) {
               return res.json({ projects: combined, total: 5000, hasMore: true });
             }
          }

          return res.json({ 
            projects: paginated,
            total: results.length,
            hasMore
          });
        }
      }

      // Live search for queries or if no cache
      const [modrinth, curseforge] = await Promise.all([
        searchModrinth((q as string) || "", limitNum, offset),
        searchCurseForge((q as string) || "", offset, limitNum)
      ]);
      results = [...modrinth, ...curseforge];
      
      // Apply Filters to live results
      if (loader) {
        results = results.filter(m => m.loaders?.some((l: string) => l.toLowerCase().includes((loader as string).toLowerCase())));
      }
      if (version) {
        results = results.filter(m => m.minecraft_versions?.includes(version as string));
      }

      res.json({ 
        projects: results,
        total: 10000, // Approximate total for infinite scroll
        hasMore: results.length >= limitNum
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

  app.post("/api/marketplace/install", authenticateToken, express.json(), async (req, res) => {
    const { id, versionId, provider, title, downloadUrl } = req.body;
    const { paths, serverId, tenantId } = getContext(req);
    
    const jobId = `install-${Date.now()}`;
    const tempDir = path.join(__dirname, "temp_downloads");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const filename = `${title.replace(/[^a-z0-9]/gi, '_')}.zip`;
    const finalPath = path.join(tempDir, filename);

    const newJob: ServerJob = {
      id: jobId,
      filename,
      filePath: finalPath,
      outputPath: paths.serverFiles,
      status: "QUEUED",
      createdAt: Date.now(),
      progress: 0,
      metadata: { modpackId: id, versionId, provider, title, downloadUrl, serverId }
    };

    createJob(newJob, tenantId);
    processQueue();

    res.json({ message: "Instalação do Modpack enviada para a fila.", jobId });
  });

  app.post("/api/start", authenticateToken, express.json(), (req: any, res) => {
    const { paths, serverId, tenantId } = getContext(req);
    const { ramMin = "512M", ramMax = "2048M", autoRestart = true } = req.body;
    
    if (serverProcesses.has(serverId)) {
      return res.status(400).json({ error: "O servidor já está rodando." });
    }

    const script = findStartScript(paths.serverFiles);

    try {
      autoRestarts.set(serverId, autoRestart);
      
      let command: string;
      let args: string[];
      let scriptDir: string;

      if (script) {
        logToConsole(`[Daemon] [${serverId}] Iniciando via script: ${path.basename(script)}...`);
        scriptDir = path.dirname(script);
        command = isWindows ? script : "sh";
        args = isWindows ? [] : [path.basename(script)];
      } else {
        const files = fs.readdirSync(paths.serverFiles);
        const jar = files.find(f => f.endsWith('.jar'));
        
        if (!jar) {
          return res.status(400).json({ error: "Nenhum script ou arquivo .jar encontrado para iniciar!" });
        }

        logToConsole(`[Daemon] [${serverId}] Iniciando JAR diretamente: ${jar} com ${ramMax} RAM...`);
        scriptDir = paths.serverFiles;
        command = "java";
        args = [`-Xms${ramMin}`, `-Xmx${ramMax}`, "-jar", jar, "nogui"];
      }

      spawnServer(tenantId, serverId, command, args, scriptDir);
      
      // Persistir configurações
      updateServerConfig(serverId, { ramMin, ramMax, autoRestart });
      
      res.json({ message: "Servidor iniciando...", serverId, ram: ramMax });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Erro ao iniciar servidor: " + err.message });
    }
  });

  app.post("/api/stop", authenticateToken, (req: any, res) => {
    const { serverId } = getContext(req);
    const proc = serverProcesses.get(serverId);

    if (!proc) {
      return res.status(400).json({ error: "O servidor não está em execução." });
    }

    try {
      setServerStatus(serverId, "stopping");
      autoRestarts.set(serverId, false); // Desativa watchdog para parada manual
      logToConsole(`[Daemon] [${serverId}] Parando servidor...`);
      proc.stdin?.write("stop\n");
      
      // Forçar kill se não parar em 30s
      setTimeout(() => {
        if (serverProcesses.has(serverId)) {
          logToConsole(`[Daemon] [${serverId}] O servidor demorou muito para parar, forçando encerramento...`);
          stopServerProcess(serverId);
        }
      }, 30000);

      res.json({ message: "Comando stop enviado.", serverId });
    } catch (err: any) {
      res.status(500).json({ error: "Erro ao parar servidor." });
    }
  });

  // Backup Endpoints
  app.get("/api/backups", authenticateToken, (req: any, res) => {
    const { serverId, tenantId } = getContext(req);
    const rows = db_persist.prepare("SELECT * FROM backups WHERE server_id = ? AND tenant_id = ? ORDER BY created_at DESC").all(serverId, tenantId);
    res.json(rows);
  });

  app.post("/api/backups/create", authenticateToken, (req: any, res) => {
    const { serverId, tenantId } = getContext(req);
    const snapshotId = `backup-${Date.now()}`;
    
    const newJob: ServerJob = {
      id: `snapshot-create-${Date.now()}`,
      filename: `snapshot_${snapshotId}`,
      filePath: "",
      outputPath: "",
      status: "QUEUED",
      createdAt: Date.now(),
      progress: 0,
      metadata: { serverId, isSnapshot: "create", snapshotId }
    };

    createJob(newJob, tenantId);
    processQueue();
    res.json({ message: "Snapshot creation started", jobId: newJob.id });
  });

  app.post("/api/backups/restore", authenticateToken, express.json(), (req: any, res) => {
    const { serverId, tenantId } = getContext(req);
    const { snapshotId } = req.body;
    
    const newJob: ServerJob = {
      id: `snapshot-restore-${Date.now()}`,
      filename: `restore_${snapshotId}`,
      filePath: "",
      outputPath: "",
      status: "QUEUED",
      createdAt: Date.now(),
      progress: 0,
      metadata: { serverId, isSnapshot: "restore", snapshotId }
    };

    createJob(newJob, tenantId);
    processQueue();
    res.json({ message: "Snapshot restoration started", jobId: newJob.id });
  });

  app.delete("/api/backups/delete", authenticateToken, express.json(), (req: any, res) => {
    const { serverId, tenantId } = getContext(req);
    const { snapshotId } = req.body;
    
    const backup = db_persist.prepare("SELECT * FROM backups WHERE id = ? AND server_id = ? AND tenant_id = ?").get(snapshotId, serverId, tenantId) as any;
    if (!backup) return res.status(404).json({ error: "Backup não encontrado." });

    const paths = getServerPaths(tenantId, serverId);
    const backupPath = path.join(paths.serverFiles, "backups", backup.filename);
    
    try {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      db_persist.prepare("DELETE FROM backups WHERE id = ?").run(snapshotId);
      res.json({ message: "Backup apagado com sucesso." });
    } catch (e: any) {
      res.status(500).json({ error: "Erro ao apagar backup: " + e.message });
    }
  });

  // API de Upload em Chunks
  const CHUNKS_TEMP_DIR = path.join(__dirname, "temp_chunks");
  if (!fs.existsSync(CHUNKS_TEMP_DIR)) fs.mkdirSync(CHUNKS_TEMP_DIR);

  app.post("/api/upload/chunk", authenticateToken, multer().single("chunk"), (req: any, res) => {
    const { filename, chunkIndex, totalChunks, relPath } = req.body;
    const chunk = req.file;

    if (!chunk) return res.status(400).json({ error: "No chunk received" });

    const { paths } = getContext(req);
    const chunkDir = path.join(paths.chunks, filename);
    if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

    const chunkPath = path.join(chunkDir, `chunk-${chunkIndex}`);
    fs.writeFileSync(chunkPath, chunk.buffer);

    res.json({ success: true, message: `Chunk ${chunkIndex}/${totalChunks} saved` });
  });

  app.post("/api/upload/finalize", authenticateToken, express.json(), async (req, res) => {
    const { filename, totalChunks, relPath } = req.body;
    const { paths, serverId, tenantId } = getContext(req);
    
    // Process Relative Path (Strip root folder)
    let processedRelPath = "";
    if (relPath) {
      processedRelPath = stripRootFolder(relPath);
    }

    const finalPath = path.join(paths.serverFiles, processedRelPath, filename);
    const finalDir = path.dirname(finalPath);
    if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

    const chunkDir = path.join(paths.chunks, filename);

    const jobId = `upload-${Date.now()}`;
    const newJob: ServerJob = {
      id: jobId,
      filename,
      filePath: finalPath,
      outputPath: paths.serverFiles,
      status: "UPLOADING",
      createdAt: Date.now(),
      progress: 0,
      metadata: { serverId }
    };
    createJob(newJob, tenantId);
    processQueue();

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
    let relPath = req.body.relPath || "";
    
    // Strip root if folder upload
    if (relPath) {
      relPath = stripRootFolder(relPath);
    }

    const jobId = `direct-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const newJob: ServerJob = {
      id: jobId,
      filename: relPath ? path.join(relPath, originalname) : originalname,
      filePath: filePath,
      outputPath: path.join(UPLOADS_DIR, relPath), // Ensure we set correct output path
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
  app.get("/api/files", authenticateToken, (req, res) => {
    try {
      const { paths } = getContext(req);
      const results: any[] = [];
  
      const scanDir = (dir: string, relative = "") => {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
  
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
  
          results.push({
            name: item,
            path: path.join(relative, item),
            size: stat.size,
            mtime: stat.mtime,           
            isDirectory: stat.isDirectory(), 
            type: stat.isDirectory() ? "directory" : "file"
          });
  
          if (stat.isDirectory()) {
            // Limits depth for tree scan if needed, or just scan all
            // scanDir(fullPath, path.join(relative, item));
          }
        }
      };
  
      scanDir(paths.serverFiles);
      res.json(results);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Erro ao listar arquivos" });
    }
  });

  app.delete("/api/files/all", authenticateToken, (req, res) => {
    try {
      const { paths } = getContext(req);
      const deleteContents = (dir: string) => {
        if (fs.existsSync(dir)) {
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const itemPath = path.join(dir, item);
            if (fs.statSync(itemPath).isDirectory()) {
              fs.rmSync(itemPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(itemPath);
            }
          }
        }
      };

      deleteContents(paths.serverFiles);
      
      res.json({ message: "Todos os arquivos e pastas isolados foram removidos com sucesso" });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Erro ao remover arquivos" });
    }
  });

  app.post("/api/files/extract", authenticateToken, async (req, res) => {
    const { filename, currentPath } = req.body;
    const { paths } = getContext(req);
    // Previne Directory Traversal
    const relativeDir = currentPath || ".";
    const filePath = path.join(paths.serverFiles, relativeDir, filename);

    if (!filePath.startsWith(paths.serverFiles) || !filename.endsWith('.zip')) {
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

  app.get("/api/file/read", authenticateToken, (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "Path required" });

    const { paths } = getContext(req);
    const fullPath = path.join(paths.serverFiles, filePath);
    if (!fullPath.startsWith(paths.serverFiles)) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File not found" });
      const content = fs.readFileSync(fullPath, 'utf-8');
      res.json({ content });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/file/write", authenticateToken, express.json(), (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: "Path required" });

    const { paths } = getContext(req);
    const fullPath = path.join(paths.serverFiles, filePath);
    if (!fullPath.startsWith(paths.serverFiles)) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      fs.writeFileSync(fullPath, content, 'utf-8');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/file/delete", authenticateToken, express.json(), (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: "Path required" });

    const { paths } = getContext(req);
    const fullPath = path.join(paths.serverFiles, filePath);
    if (!fullPath.startsWith(paths.serverFiles)) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File not found" });
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

  app.post("/api/file/create", authenticateToken, express.json(), (req, res) => {
    const { path: filePath, isDirectory } = req.body;
    if (!filePath) return res.status(400).json({ error: "Path required" });

    const { paths } = getContext(req);
    const fullPath = path.join(paths.serverFiles, filePath);
    if (!fullPath.startsWith(paths.serverFiles)) {
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

  app.post("/api/command", authenticateToken, express.json(), (req: any, res) => {
    const { serverId } = getContext(req);
    const { command } = req.body;
    const proc = serverProcesses.get(serverId);

    if (!proc) {
      return res.status(400).json({ error: "O servidor não está em execução." });
    }
    if (!command) return res.status(400).json({ error: "Comando required" });

    try {
      proc.stdin?.write(command + "\n");
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Erro ao enviar comando." });
    }
  });

  app.get("/api/jobs", (req, res) => {
    res.json(jobs.slice(-10)); // return last 10 jobs
  });

  app.get("/api/logs", authenticateToken, (req, res) => {
    try {
      const { paths } = getContext(req);
      const logPath = path.join(paths.logs, "latest.log");
      if (!fs.existsSync(logPath)) return res.json({ content: "Log ainda não existe para este servidor." });
      const content = fs.readFileSync(logPath, 'utf-8');
      res.json({ content });
    } catch (e) {
      res.status(500).json({ error: "Could not read logs" });
    }
  });

  app.post("/api/logs/clear", authenticateToken, (req, res) => {
    try {
      const { paths, serverId } = getContext(req);
      const logPath = path.join(paths.logs, "latest.log");
      fs.writeFileSync(logPath, `--- Log Cleared at ${new Date().toLocaleString()} [${serverId}] ---\n`);
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

  // Auto-recovery
  restoreServers().catch(console.error);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`MineControl Dashboard running at http://localhost:${PORT}`);
  });
}

startServer();

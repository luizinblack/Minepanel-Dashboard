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
    res.json({ 
      status: serverStatus, 
      jar: serverJarName,
      availableJars: fs.readdirSync(UPLOADS_DIR).filter(f => f.endsWith('.jar'))
    });
  });

  app.post("/api/start", express.json(), (req, res) => {
    const { jar } = req.body;
    if (jar) serverJarName = jar;

    if (minecraftProcess) {
      return res.status(400).json({ error: "Server already running" });
    }

    if (!serverJarName) {
      return res.status(400).json({ error: "No server jar selected" });
    }

    const jarPath = path.join(UPLOADS_DIR, serverJarName);
    
    if (!fs.existsSync(jarPath)) {
      return res.status(400).json({ error: "Jar file not found" });
    }

    try {
      serverStatus = "starting";
      io.emit("status_change", { status: serverStatus });
      io.emit("console_log", `[MineControl] Initializing ${serverJarName}...`);

      // Using -Xmx1024M -Xms1024M as reasonable defaults. nogui is essential.
      minecraftProcess = spawn("java", ["-Xmx1024M", "-Xms1024M", "-jar", serverJarName, "nogui"], {
        cwd: UPLOADS_DIR,
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

  app.post("/api/upload", upload.single("file"), (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { originalname, path: filePath } = req.file;

    if (originalname.endsWith('.zip')) {
      try {
        const zip = new AdmZip(filePath);
        zip.extractAllTo(UPLOADS_DIR, true);
        // Delete the zip after extraction
        fs.unlinkSync(filePath);
        return res.json({ 
          message: "Files extracted successfully", 
          filename: originalname,
          extracted: true
        });
      } catch (err: any) {
        return res.status(500).json({ error: "Failed to extract zip: " + err.message });
      }
    }

    if (originalname.endsWith('.jar')) {
        serverJarName = originalname;
    }

    res.json({ 
      message: "File uploaded successfully", 
      filename: originalname 
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
      
      const stats = {
        cpuLoad: cpuLoad.currentLoad.toFixed(1),
        cpuModel: cachedHardwareInfo.cpuModel,
        ram: {
          used: (mem.active / 1024 / 1024 / 1024).toFixed(2),
          total: (mem.total / 1024 / 1024 / 1024).toFixed(2),
          percent: ((mem.active / mem.total) * 100).toFixed(1)
        },
        gpu: gpu.controllers.length > 0 ? gpu.controllers[0].model : "N/A",
        gpuVram: gpu.controllers.length > 0 ? gpu.controllers[0].vram : 0,
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

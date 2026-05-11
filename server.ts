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
    if (req.file.originalname.endsWith('.jar')) {
        serverJarName = req.file.originalname;
    }
    res.json({ 
      message: "File uploaded successfully", 
      filename: req.file.originalname 
    });
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

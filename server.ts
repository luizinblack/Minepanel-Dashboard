import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs-extra";
import unzipper from "unzipper"; // Import standard unzipper
import { exec } from "child_process";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Paths
  const BASE_PATH = path.join(process.cwd(), "minecraft-servers");
  const UPLOAD_PATH = path.join(process.cwd(), "uploads");

  await fs.ensureDir(BASE_PATH);
  await fs.ensureDir(UPLOAD_PATH);

  // 📦 Upload config
  const storage = multer.diskStorage({
    destination: UPLOAD_PATH,
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    }
  });

  const upload = multer({ storage });

  // --- API Routes ---

  // 📤 UPLOAD SERVER (ZIP)
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const serverId = Date.now().toString();
    const serverPath = path.join(BASE_PATH, serverId);

    try {
      await fs.ensureDir(serverPath);

      // Extract ZIP
      await fs.createReadStream(req.file.path)
        .pipe(unzipper.Extract({ path: serverPath }))
        .promise();

      // Limpar upload temporário
      await fs.remove(req.file.path);

      res.json({ success: true, serverId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Falha ao processar upload", details: err instanceof Error ? err.message : String(err) });
    }
  });

  // 🚀 START SERVER MINECRAFT
  app.post("/api/start/:id", (req, res) => {
    const serverPath = path.join(BASE_PATH, req.params.id);

    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: "Servidor não encontrado" });
    }

    // Nota: Em ambiente Cloud Run/AI Studio, 'java' pode não estar disponível.
    // O código abaixo é o que rodaria em uma VPS real conforme solicitado.
    console.log(`[MC ${req.params.id}] Iniciando processo...`);
    
    // Simulação para o ambiente de preview se 'java' falhar
    const command = `cd ${serverPath} && java -Xms512M -Xmx1G -jar server.jar nogui`;
    
    const process = exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`[MC ${req.params.id}] Erro ao rodar script: ${error.message}`);
        return;
      }
      if (stderr) console.error(`[MC ${req.params.id}] stderr: ${stderr}`);
      console.log(`[MC ${req.params.id}] stdout: ${stdout}`);
    });

    res.json({ status: "starting", message: "Comando enviado com sucesso" });
  });

  // ⛔ STOP SERVER
  app.post("/api/stop/:id", (req, res) => {
    // Nota: Isso é agressivo e mataria qualquer processo com o ID.
    // Em produção real, você usaria RCON ou mataria pelo PID salvo.
    exec(`pkill -f ${req.params.id}`);
    res.json({ status: "stopped" });
  });

  // 📁 LIST SERVERS
  app.get("/api/servers", async (req, res) => {
    try {
      const folders = await fs.readdir(BASE_PATH);
      res.json(folders.map(id => ({ id, name: `Servidor ${id}` })));
    } catch (err) {
      res.json([]);
    }
  });

  // --- Vite Middleware ---
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MinePanel Backend rodando em http://localhost:${PORT}`);
  });
}

startServer();

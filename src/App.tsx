import React, { useState } from 'react';
import { 
  Server, 
  Terminal, 
  ShieldCheck, 
  Copy, 
  Check, 
  ChevronRight,
  Info,
  Settings,
  FileCode,
  Layout,
  Lock,
  Globe,
  Monitor,
  Activity,
  Key,
  FolderOpen,
  CloudUpload,
  Box,
  Save,
  Download,
  AlertTriangle,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Config {
  serverName: string;
  panelUrl: string;
  serverId: string;
  apiKey: string;
  vpsPath: string;
  adminUser: string;
  adminPassword: string;
  jwtSecret: string;
  curseForgeKey: string;
  domain: string;
  backendPort: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'config' | 'backend' | 'frontend' | 'infra' | 'readme'>('config');
  const [copied, setCopied] = useState<string | null>(null);

  const [config, setConfig] = useState<Config>({
    serverName: 'Meu Servidor Modpack',
    panelUrl: 'https://ptero.meudominio.com',
    serverId: 'id_aqui',
    apiKey: 'ptlc_chave_aqui',
    vpsPath: '/var/lib/pterodactyl/volumes/id_aqui',
    adminUser: 'admin',
    adminPassword: 'senha_segura_123',
    jwtSecret: 'secreta_muito_longa_e_aleatoria',
    curseForgeKey: 'cf_api_key_opcional',
    domain: 'minepaneldashboard.com.br',
    backendPort: '3000'
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // --- Generated Content ---

  const envExample = `# Pterodactyl Link
PTERODACTYL_URL=${config.panelUrl}
PTERODACTYL_API_KEY=${config.apiKey}
SERVER_ID=${config.serverId}
SERVER_PATH=${config.vpsPath}

# Painel Auth
ADMIN_USER=${config.adminUser}
ADMIN_PASSWORD=${config.adminPassword}
JWT_SECRET=${config.jwtSecret}

# Extras
PORT=${config.backendPort}
CURSEFORGE_API_KEY=${config.curseForgeKey}
NODE_ENV=production`;

  const serverJsContent = `// backend/server.js - API Comentada em Português
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const unzipper = require('unzipper');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const SERVER_PATH = process.env.SERVER_PATH;
const PTERO_URL = process.env.PTERODACTYL_URL;
const API_KEY = process.env.PTERODACTYL_API_KEY;
const SERVER_ID = process.env.SERVER_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// --- Middleware de Autenticação (JWT) ---
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Acesso Negado: Faça login' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Sessão expirada' });
    }
};

// --- Rota de Login ---
app.post('/api/login', (req, res) => {
    const { user, password } = req.body;
    if (user === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ user }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, success: true });
    } else {
        res.status(401).json({ error: 'Dados inválidos' });
    }
});

// --- Cliente Pterodactyl Configurado ---
const ptero = axios.create({
    baseURL: \`\${PTERO_URL}/api/client/servers/\${SERVER_ID}\`,
    headers: { 'Authorization': \`Bearer \${API_KEY}\` }
});

// Busca recursos (CPU, RAM, Status)
app.get('/api/status', authenticate, async (req, res) => {
    try {
        const { data } = await ptero.get('/resources');
        res.json(data.attributes);
    } catch (e) { res.status(500).json({ error: 'Erro ao conectar ao Pterodactyl' }); }
});

// Controle de Energia (start, stop, restart, kill)
app.post('/api/power', authenticate, async (req, res) => {
    try {
        await ptero.post('/power', { signal: req.body.signal });
        res.json({ success: true, action: req.body.signal });
    } catch (e) { res.status(500).json({ error: 'Falha ao enviar sinal' }); }
});

// --- Gerenciador de Arquivos (Nativo) ---
app.get('/api/files/list', authenticate, async (req, res) => {
    const relativePath = req.query.path || '';
    const fullPath = path.join(SERVER_PATH, relativePath);
    try {
        const items = await fs.readdir(fullPath, { withFileTypes: true });
        const list = items.map(item => {
            const stats = fs.statSync(path.join(fullPath, item.name));
            return {
                name: item.name,
                isDirectory: item.isDirectory(),
                size: stats.size,
                modified: stats.mtime
            };
        });
        res.json(list);
    } catch (e) { res.status(500).json({ error: 'Erro ao listar diretório' }); }
});

app.get('/api/files/read', authenticate, async (req, res) => {
    const fullPath = path.join(SERVER_PATH, req.query.path);
    try {
        const content = await fs.readFile(fullPath, 'utf8');
        res.json({ content });
    } catch (e) { res.status(500).json({ error: 'Não foi possível ler o arquivo' }); }
});

app.post('/api/files/save', authenticate, async (req, res) => {
    const fullPath = path.join(SERVER_PATH, req.body.path);
    try {
        await fs.writeFile(fullPath, req.body.content);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Não foi possível salvar' }); }
});

// --- Upload de Pasta Integrado (via .zip) ---
const upload = multer({ dest: 'uploads/' });
app.post('/api/upload-folder', authenticate, upload.single('file'), async (req, res) => {
    try {
        await fs.createReadStream(req.file.path)
            .pipe(unzipper.Extract({ path: SERVER_PATH }))
            .promise();
        await fs.remove(req.file.path); // Limpa temp
        res.json({ success: true, message: 'Arquivos extraídos com sucesso na pasta do servidor!' });
    } catch (e) { res.status(500).json({ error: 'Erro na extração dos arquivos' }); }
});

// --- Sistema de Backup do Mundo ---
app.post('/api/backup/world', authenticate, async (req, res) => {
    const worldPath = path.join(SERVER_PATH, 'world');
    const backupFolder = path.join(SERVER_PATH, '..', 'backups-painel');
    const backupName = \`world-backup-\${new Date().toISOString().replace(/:/g, '-')}.zip\`;
    const outputPath = path.join(backupFolder, backupName);
    
    await fs.ensureDir(backupFolder);
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => res.json({ success: true, name: backupName }));
    archive.pipe(output);
    archive.directory(worldPath, 'world');
    archive.finalize();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(\`MinePanel Backend Rodando na porta \${PORT}\`));`;

  const frontendHtml = `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.serverName} | Painel Pro</title>
    <link rel="stylesheet" href="style.css">
    <script src="https://unpkg.com/lucide@latest"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
</head>
<body class="dark">
    <!-- Tela de Login -->
    <div id="login-screen" class="screen">
        <div class="login-card">
            <div class="brand">
                <i data-lucide="shield-check" class="emerald"></i>
                <h1>Mine<span>Panel</span></h1>
            </div>
            <p>Seja bem-vindo. Insira suas credenciais.</p>
            <div class="input-group">
                <input type="text" id="user" placeholder="Usuário Admin">
                <input type="password" id="pass" placeholder="Senha Mestre">
            </div>
            <button onclick="login()" class="btn-primary">Acessar Painel</button>
        </div>
    </div>

    <!-- Painel Principal -->
    <div id="main-screen" class="screen hidden">
        <aside class="sidebar">
            <div class="logo">MINE<span>PANEL</span></div>
            <nav>
                <div class="nav-item active" onclick="showTab('dash')"><i data-lucide="layout"></i> Dashboard</div>
                <div class="nav-item" onclick="showTab('files')"><i data-lucide="folder-open"></i> Arquivos</div>
                <div class="nav-item" onclick="showTab('mods')"><i data-lucide="box"></i> Modpacks</div>
                <div class="nav-item" onclick="showTab('backup')"><i data-lucide="save"></i> Backups</div>
            </nav>
            <div class="logout" onclick="logout()"><i data-lucide="log-out"></i> Encerrar Sessão</div>
        </aside>

        <main class="content">
            <!-- Aba Dashboard -->
            <section id="tab-dash" class="tab-content active">
                <div class="content-header">
                    <h2>Visão Geral</h2>
                    <div id="server-status" class="status-badge offline">OFFLINE</div>
                </div>
                
                <div class="grid-stats">
                    <div class="stat-card">
                        <label>USO DE CPU</label>
                        <h3 id="stat-cpu">0.0%</h3>
                    </div>
                    <div class="stat-card">
                        <label>MEMÓRIA RAM</label>
                        <h3 id="stat-ram">0 MB</h3>
                    </div>
                    <div class="stat-card">
                        <label>JOGADORES</label>
                        <h3 id="stat-players">-</h3>
                    </div>
                </div>

                <div class="power-actions">
                    <button class="btn-pwr btn-start" onclick="power('start')">INICIAR</button>
                    <button class="btn-pwr btn-stop" onclick="power('stop')">PARAR</button>
                    <button class="btn-pwr btn-restart" onclick="power('restart')">REINICIAR</button>
                </div>
            </section>

            <!-- Aba Arquivos -->
            <section id="tab-files" class="tab-content">
                <div class="content-header">
                    <h2>Gerenciador de Arquivos</h2>
                    <button class="btn-upload" onclick="triggerUpload()">
                       <i data-lucide="cloud-upload"></i> Subir Pasta (.zip)
                    </button>
                    <input type="file" id="folder-upload" class="hidden" accept=".zip">
                </div>
                <div class="file-table-container">
                    <div id="file-list" class="file-list">
                         <!-- Itens do diretório via JS -->
                    </div>
                </div>
            </section>
        </main>
    </div>
    <script src="app.js"></script>
    <script>lucide.createIcons();</script>
</body>
</html>`;

  const frontendCss = `/* frontend/style.css */
:root {
    --bg: #09090b;
    --card: #18181b;
    --accent: #10b981;
    --accent-hover: #059669;
    --text: #f4f4f5;
    --text-dim: #71717a;
    --border: #27272a;
}

* { box-sizing: border-box; }
body { 
    margin: 0; background: var(--bg); color: var(--text); 
    font-family: 'Inter', sans-serif; overflow: hidden;
}

.hidden { display: none !important; }

/* Login */
.screen { height: 100vh; width: 100vw; display: flex; }
#login-screen { justify-content: center; align-items: center; background: radial-gradient(circle at top right, #064e3b33, transparent); }
.login-card { background: var(--card); padding: 3.5rem; border-radius: 2rem; width: 440px; border: 1px solid var(--border); box-shadow: 0 50px 100px -20px rgba(0,0,0,0.5); }
.brand { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; justify-content: center; }
.brand i { width: 48px; height: 48px; }
.brand h1 { font-size: 1.8rem; font-weight: 900; color: white; letter-spacing: -1px; margin: 0; }
.brand span { color: var(--accent); }
.login-card p { text-align: center; color: var(--text-dim); font-size: 0.9rem; margin-bottom: 2rem; }
.input-group input { width: 100%; padding: 1.25rem; border-radius: 1rem; background: #00000044; border: 1px solid var(--border); color: white; margin-bottom: 1rem; outline: none; }
.btn-primary { width: 100%; background: var(--accent); color: #064e3b; padding: 1.25rem; border: none; border-radius: 1rem; font-weight: 900; cursor: pointer; text-transform: uppercase; }

/* Layout Geral */
.sidebar { width: 280px; background: var(--card); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 2.5rem 0; }
.logo { font-weight: 900; font-size: 1.5rem; margin-bottom: 3rem; text-align: center; font-style: italic; }
.logo span { color: var(--accent); }
.nav-item { padding: 1.25rem 2.5rem; display: flex; align-items: center; gap: 1.25rem; color: var(--text-dim); cursor: pointer; font-weight: 700; transition: 0.2s; border-left: 4px solid transparent; }
.nav-item.active { background: #27272a; color: white; border-left-color: var(--accent); }
.nav-item:hover:not(.active) { color: white; }
.logout { margin-top: auto; padding: 1.25rem 2.5rem; cursor: pointer; color: #ef4444; font-weight: 800; text-transform: uppercase; font-size: 0.75rem; }

.content { flex: 1; padding: 4rem; overflow-y: auto; }
.content-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3rem; }
.status-badge { padding: 0.5rem 1.5rem; border-radius: 99px; font-weight: 900; font-size: 0.7rem; border: 1px solid transparent; }
.status-badge.online { background: #064e3b33; color: var(--accent); border-color: #10b98133; }
.status-badge.offline { background: #450a0a33; color: #f87171; border-color: #f8717133; }

.grid-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; margin-bottom: 4rem; }
.stat-card { background: var(--card); padding: 2rem; border-radius: 1.5rem; border: 1px solid var(--border); }
.stat-card label { font-size: 0.65rem; font-weight: 900; color: var(--text-dim); }
.power-actions { display: flex; gap: 1.5rem; }
.btn-pwr { flex: 1; padding: 1.75rem; border-radius: 1.25rem; border: none; font-weight: 900; font-size: 0.85rem; cursor: pointer; transition: 0.3s; }
.btn-start { background: var(--accent); color: #064e3b; }
.btn-stop { background: #27272a; color: white; }
`;

  const nginxConf = `server {
    listen 80;
    server_name ${config.domain};

    # Limite de 10GB para facilitar upload de modpacks via painel
    client_max_body_size 10240M;

    location / {
        root /var/www/minepanel;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Proxy reverso para API Node.js
    location /api/ {
        proxy_pass http://localhost:${config.backendPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts estendidos para uploads lentos
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}`;

  const readmeInstructions = `# Plano de Implementação MinePanel PRO (VPS Ubuntu 24/Pterodactyl)

Siga este guia para colocar seu painel estilo EnxadaHost no ar em minutos.

### 🐧 1. Preparação da VPS
Primeiro, vamos instalar o básico na sua VPS:
\`\`\`bash
sudo apt update && sudo apt upgrade -y
# Instale Node.js 20 e Nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs npm nginx unzip
# Gerenciador de processos para o backend não cair
sudo npm install -g pm2
\`\`\`

### 📂 2. Organização de Arquivos
Crie as pastas para o seu sistema:
\`\`\`bash
# Pasta do Backend (Node.js)
mkdir -p /opt/minepanel/backend
# Pasta do Frontend (Site)
mkdir -p /var/www/minepanel
\`\`\`

### 🔗 3. Configurando o Backend
\`\`\`bash
cd /opt/minepanel/backend
npm init -y
npm install express axios cors jsonwebtoken fs-extra multer archiver unzipper dotenv
# Copie o código do server.js e crie seu arquivo .env com os dados deste gerador
pm2 start server.js --name minepanel
pm2 save
\`\`\`

### 🌐 4. Nginx e Segurança (SSL)
\`\`\`bash
sudo nano /etc/nginx/sites-available/minepanel
# Cole a configuração do Nginx gerada ao lado
sudo ln -s /etc/nginx/sites-available/minepanel /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# SSL Gratuito com Certbot
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d ${config.domain}
\`\`\`

### 🛡️ IMPORTANTE: Permissões de Pasta
O Pterodactyl roda como usuário \`pterodactyl\`. Para o seu painel conseguir extrair arquivos e fazer backup, você pode precisar ajustar as permissões:
\`\`\`bash
# Garante que o painel consiga ler os arquivos do servidor
sudo chmod -R 775 ${config.vpsPath}
sudo chown -R $USER:pterodactyl ${config.vpsPath}
\`\`\`
`;

  return (
    <div className="min-h-screen bg-[#09090b] text-slate-300 font-sans selection:bg-emerald-500/30">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-5%] right-[-5%] w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[140px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-[500px] h-[500px] bg-emerald-600/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div>
            <div className="flex items-center gap-4 mb-3">
              <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 shadow-lg shadow-emerald-500/10">
                <Box className="text-emerald-400" size={32} />
              </div>
              <div>
                <h1 className="text-3xl font-black text-white italic tracking-tighter uppercase leading-none">
                  MinePanel <span className="text-emerald-500">PRO</span>
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] bg-emerald-500 text-black px-2 py-0.5 rounded-md font-bold tracking-widest">v2.1</span>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">— Start Over Edition</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl">
             {[
               { id: 'config', label: '1. Config', icon: Settings },
               { id: 'backend', label: '2. Backend', icon: Terminal },
               { id: 'frontend', label: '3. Frontend', icon: Globe },
               { id: 'infra', label: '4. Infra', icon: ShieldCheck },
               { id: 'readme', label: '5. Manual', icon: FileCode }
             ].map((tab) => (
               <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id as any)}
                 className={`flex items-center gap-2 px-5 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ease-out duration-300 ${
                   activeTab === tab.id 
                    ? 'bg-emerald-500 text-black shadow-xl shadow-emerald-500/20 scale-105' 
                    : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
                 }`}
               >
                 <tab.icon size={14} />
                 <span className="hidden lg:inline">{tab.label}</span>
               </button>
             ))}
          </div>
        </header>

        <main className="grid grid-cols-1 gap-8">
          <AnimatePresence mode="wait">
            {activeTab === 'config' && (
              <motion.div
                key="config"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 lg:grid-cols-3 gap-8"
              >
                {/* Visual Settings */}
                <div className="bg-[#121214] border border-white/10 rounded-[2.5rem] p-10 space-y-8 shadow-2xl">
                  <SectionHeader icon={Info} title="Info do Servidor" />
                  <InputGroup 
                    label="NOME NO PAINEL" 
                    value={config.serverName} 
                    onChange={v => setConfig({...config, serverName: v})} 
                    placeholder="Ex: CraftWorld Forge" 
                  />
                  <InputGroup 
                    label="DOMÍNIO FINAL" 
                    value={config.domain} 
                    onChange={v => setConfig({...config, domain: v})} 
                    placeholder="minepaneldashboard.com.br" 
                  />
                  <InputGroup 
                    label="ID DO SERVIDOR (URL)" 
                    value={config.serverId} 
                    onChange={v => setConfig({...config, serverId: v})} 
                    placeholder="Ex: 8f2c3a1b" 
                  />
                </div>

                {/* API Settings */}
                <div className="bg-[#121214] border border-white/10 rounded-[2.5rem] p-10 space-y-8 shadow-2xl">
                  <SectionHeader icon={Key} title="Credenciais API" />
                  <InputGroup 
                    label="CLIENT API KEY" 
                    value={config.apiKey} 
                    onChange={v => setConfig({...config, apiKey: v})} 
                    placeholder="ptlc_xxxxxxxxxxxxxx" 
                  />
                   <InputGroup 
                    label="PTERODACTYL URL" 
                    value={config.panelUrl} 
                    onChange={v => setConfig({...config, panelUrl: v})} 
                    placeholder="https://pterodactyl.com" 
                  />
                  <InputGroup 
                    label="CAMINHO NA VPS (VOLUMES)" 
                    value={config.vpsPath} 
                    onChange={v => setConfig({...config, vpsPath: v})} 
                    placeholder="/var/lib/pterodactyl/volumes/..." 
                  />
                </div>

                {/* Auth Settings */}
                <div className="bg-[#121214] border border-white/10 rounded-[2.5rem] p-10 space-y-8 shadow-2xl">
                  <SectionHeader icon={Lock} title="Acesso & Segurança" />
                   <div className="grid grid-cols-2 gap-6">
                    <InputGroup 
                      label="USUÁRIO" 
                      value={config.adminUser} 
                      onChange={v => setConfig({...config, adminUser: v})} 
                      placeholder="admin" 
                    />
                    <InputGroup 
                      label="PORTA" 
                      value={config.backendPort} 
                      onChange={v => setConfig({...config, backendPort: v})} 
                      placeholder="3000" 
                    />
                  </div>
                  <InputGroup 
                    label="SENHA DE LOGIN" 
                    value={config.adminPassword} 
                    onChange={v => setConfig({...config, adminPassword: v})} 
                    placeholder="Senha secreta" 
                    type="password"
                  />
                   <InputGroup 
                    label="JWT SECRET" 
                    value={config.jwtSecret} 
                    onChange={v => setConfig({...config, jwtSecret: v})} 
                    placeholder="Chave para tokens" 
                    type="password"
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'backend' && (
              <motion.div
                key="backend"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="space-y-8"
              >
                <CodeBlock 
                  title=".env (Arquivo de Configuração)" 
                  content={envExample} 
                  language="plaintext" 
                  onCopy={() => handleCopy(envExample, 'env')}
                  isCopied={copied === 'env'}
                />
                <CodeBlock 
                  title="backend/server.js (Node.js API)" 
                  content={serverJsContent} 
                  language="javascript" 
                  onCopy={() => handleCopy(serverJsContent, 'serverjs')}
                  isCopied={copied === 'serverjs'}
                />
              </motion.div>
            )}

            {activeTab === 'frontend' && (
              <motion.div
                key="frontend"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                className="space-y-8"
              >
                <CodeBlock 
                  title="frontend/index.html (Página do Painel)" 
                  content={frontendHtml} 
                  language="html" 
                  onCopy={() => handleCopy(frontendHtml, 'html')}
                  isCopied={copied === 'html'}
                />
                <CodeBlock 
                  title="frontend/style.css (Design Escuro)" 
                  content={frontendCss} 
                  language="css" 
                  onCopy={() => handleCopy(frontendCss, 'css')}
                  isCopied={copied === 'css'}
                />
              </motion.div>
            )}

            {activeTab === 'infra' && (
              <motion.div
                key="infra"
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50 }}
                className="space-y-8"
              >
                <CodeBlock 
                  title="Configuração do Nginx (/etc/nginx/sites-available/minepanel)" 
                  content={nginxConf} 
                  language="nginx" 
                  onCopy={() => handleCopy(nginxConf, 'nginx')}
                  isCopied={copied === 'nginx'}
                />
              </motion.div>
            )}

            {activeTab === 'readme' && (
              <motion.div
                key="readme"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="space-y-6"
              >
                <CodeBlock 
                  title="Manual de Instalação Completo (Portugês)" 
                  content={readmeInstructions} 
                  language="markdown" 
                  onCopy={() => handleCopy(readmeInstructions, 'readme')}
                  isCopied={copied === 'readme'}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="mt-24 border-t border-white/5 pt-16 flex flex-col lg:flex-row items-center justify-between gap-12 pb-16">
          <div className="flex flex-wrap items-center justify-center gap-10">
            <span className="text-[10px] font-black uppercase text-slate-600 tracking-[0.2em]">Pterodactyl API v1</span>
            <span className="text-[10px] font-black uppercase text-slate-600 tracking-[0.2em]">Node.js FS Integration</span>
            <span className="text-[10px] font-black uppercase text-slate-600 tracking-[0.2em]">JWT Secure Session</span>
          </div>
          <div className="text-[11px] font-black text-slate-700 uppercase tracking-[0.4em] flex items-center gap-4">
            <Monitor size={14} className="text-emerald-500/20" /> MINEPANEL-CORE / 2026-REBOOT
          </div>
        </footer>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: any, title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <Icon size={18} className="text-emerald-400" />
      <h2 className="text-[10px] font-black text-white uppercase italic tracking-[0.25em]">{title}</h2>
    </div>
  );
}

function InputGroup({ label, value, onChange, placeholder, type = "text" }: { label: string, value: string, onChange: (v: string) => void, placeholder: string, type?: string }) {
  return (
    <div className="flex flex-col gap-3 group">
      <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.15em] group-focus-within:text-emerald-500 transition-colors uppercase italic">{label}</label>
      <input 
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-black/50 border border-white/5 rounded-2xl px-6 py-4.5 text-sm text-white outline-none focus:border-emerald-500/40 focus:ring-8 focus:ring-emerald-500/5 transition-all placeholder:text-slate-800 font-medium tracking-wide shadow-inner"
      />
    </div>
  );
}

function CodeBlock({ title, content, language, onCopy, isCopied }: { title: string, content: string, language: string, onCopy: () => void, isCopied: boolean }) {
  return (
    <div className="bg-[#0f0f12] border border-white/10 rounded-[2rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] group flex flex-col">
      <div className="px-10 py-6 bg-[#141417] border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex gap-2 mr-3">
            <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40" />
            <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/40" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
          </div>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic flex items-center gap-2">
            <FileCode size={12} /> {title}
          </span>
        </div>
        <button 
          onClick={onCopy}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black tracking-widest transition-all duration-300 ${
            isCopied ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/30' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-emerald-500/30'
          }`}
        >
          {isCopied ? <Check size={14} /> : <Copy size={14} />}
          {isCopied ? 'COPIADO' : 'COPIAR'}
        </button>
      </div>
      <div className="p-10 overflow-hidden bg-black/40">
        <pre className="text-xs font-mono text-emerald-400/80 leading-relaxed overflow-x-auto custom-scrollbar">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  );
}

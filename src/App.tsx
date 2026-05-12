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
PTERODACTYL_URL=\${config.panelUrl}
PTERODACTYL_API_KEY=\${config.apiKey}
SERVER_ID=\${config.serverId}
SERVER_PATH=\${config.vpsPath}

# Painel Auth
ADMIN_USER=\${config.adminUser}
ADMIN_PASSWORD=\${config.adminPassword}
JWT_SECRET=\${config.jwtSecret}

# Extras
PORT=\${config.backendPort}
CURSEFORGE_API_KEY=\${config.curseForgeKey}
NODE_ENV=production`;

  const serverJsContent = `// backend/server.js
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

// --- Middlewares ---
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Sessão inválida' });
    }
};

// --- Auth Routes ---
app.post('/api/login', (req, res) => {
    const { user, password } = req.body;
    if (user === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ user }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }
});

// --- Pterodactyl Proxy ---
const ptero = axios.create({
    baseURL: \`\${PTERO_URL}/api/client/servers/\${SERVER_ID}\`,
    headers: { 'Authorization': \`Bearer \${API_KEY}\` }
});

app.get('/api/status', authenticate, async (req, res) => {
    try {
        const { data } = await ptero.get('/resources');
        res.json(data.attributes);
    } catch (e) { res.status(500).json({ error: 'Pterodactyl offline' }); }
});

app.post('/api/power', authenticate, async (req, res) => {
    try {
        await ptero.post('/power', { signal: req.body.signal });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Falha no comando' }); }
});

// --- File Manager ---
app.get('/api/files/list', authenticate, async (req, res) => {
    const relativePath = req.query.path || '';
    const fullPath = path.join(SERVER_PATH, relativePath);
    try {
        const items = await fs.readdir(fullPath, { withFileTypes: true });
        const list = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            size: item.isDirectory() ? 0 : fs.statSync(path.join(fullPath, item.name)).size
        }));
        res.json(list);
    } catch (e) { res.status(500).json({ error: 'Caminho não encontrado' }); }
});

app.get('/api/files/read', authenticate, async (req, res) => {
    const fullPath = path.join(SERVER_PATH, req.query.path);
    try {
        const content = await fs.readFile(fullPath, 'utf8');
        res.json({ content });
    } catch (e) { res.status(500).json({ error: 'Erro ao ler arquivo' }); }
});

app.post('/api/files/save', authenticate, async (req, res) => {
    const fullPath = path.join(SERVER_PATH, req.body.path);
    try {
        await fs.writeFile(fullPath, req.body.content);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao salvar' }); }
});

// --- Upload de Pasta (ZIP) ---
const upload = multer({ dest: 'uploads/' });
app.post('/api/upload-folder', authenticate, upload.single('file'), async (req, res) => {
    try {
        await fs.createReadStream(req.file.path)
            .pipe(unzipper.Extract({ path: SERVER_PATH }))
            .promise();
        await fs.remove(req.file.path);
        res.json({ success: true, message: 'Arquivos extraídos!' });
    } catch (e) { res.status(500).json({ error: 'Falha no upload/extração' }); }
});

// --- Backups ---
app.post('/api/backup/create', authenticate, async (req, res) => {
    const worldPath = path.join(SERVER_PATH, 'world');
    const backupName = \`world-backup-\${new Date().getTime()}.zip\`;
    const outputPath = path.join(SERVER_PATH, '..', 'backups', backupName);
    
    await fs.ensureDir(path.join(SERVER_PATH, '..', 'backups'));
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => res.json({ success: true, name: backupName }));
    archive.pipe(output);
    archive.directory(worldPath, 'world');
    archive.finalize();
});

app.listen(process.env.PORT, '0.0.0.0', () => console.log('Painel Pro Ativo!'));`;

  const frontendHtml = `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <title>\${config.serverName} | Painel Pro</title>
    <link rel="stylesheet" href="style.css">
    <script src="https://unpkg.com/lucide@latest"></script>
</head>
<body class="dark">
    <div id="login-screen" class="screen">
        <div class="login-card">
            <i data-lucide="shield-check" class="brand-icon"></i>
            <h1>Área Restrita</h1>
            <input type="text" id="user" placeholder="Usuário">
            <input type="password" id="pass" placeholder="Senha">
            <button onclick="login()">Acessar Painel</button>
        </div>
    </div>

    <div id="main-screen" class="screen hidden">
        <aside class="sidebar">
            <div class="logo">MINE<span>PANEL</span></div>
            <nav>
                <div class="nav-item active" onclick="showTab('dash')"><i data-lucide="layout"></i> Dashboard</div>
                <div class="nav-item" onclick="showTab('files')"><i data-lucide="folder-open"></i> Arquivos</div>
                <div class="nav-item" onclick="showTab('mods')"><i data-lucide="box"></i> Modpacks</div>
                <div class="nav-item" onclick="showTab('backup')"><i data-lucide="save"></i> Backups</div>
            </nav>
            <div class="logout" onclick="logout()"><i data-lucide="log-out"></i> Sair</div>
        </aside>

        <main class="content">
            <section id="tab-dash" class="tab-content active">
                <div class="header">
                    <h2>Dashboard</h2>
                    <div id="server-status" class="status-indicator">OFFLINE</div>
                </div>
                <div class="stats-grid">
                    <div class="stat-card"><span>CPU</span><h3 id="stat-cpu">-</h3></div>
                    <div class="stat-card"><span>RAM</span><h3 id="stat-ram">-</h3></div>
                </div>
                <div class="power-controls">
                    <button class="btn-start" onclick="power('start')">Ligar</button>
                    <button class="btn-stop" onclick="power('stop')">Desligar</button>
                    <button class="btn-restart" onclick="power('restart')">Reiniciar</button>
                </div>
            </section>

            <section id="tab-files" class="tab-content">
                <h2>Gerenciador de Arquivos</h2>
                <div class="file-browser" id="file-list"></div>
                <div class="file-actions">
                    <input type="file" id="folder-upload" class="hidden">
                    <button onclick="document.getElementById('folder-upload').click()">Upload Pasta (.zip)</button>
                </div>
            </section>
        </main>
    </div>
    <script src="app.js"></script>
</body>
</html>`;

  const frontendCss = `/* frontend/style.css */
:root {
    --bg: #09090b;
    --card: #18181b;
    --accent: #10b981;
    --text: #f4f4f5;
}

body { 
    margin: 0; background: var(--bg); color: var(--text); 
    font-family: 'Inter', system-ui, sans-serif;
}

.screen { 
    height: 100vh; display: flex; align-items: center; justify-content: center;
}

.hidden { display: none !important; }

/* Sidebar */
.sidebar {
    width: 260px; background: var(--card); border-right: 1px solid #27272a;
    display: flex; flex-direction: column; padding: 2rem 0;
}

.logo { font-weight: 900; font-size: 1.5rem; text-align: center; margin-bottom: 2rem; }
.logo span { color: var(--accent); }

.nav-item {
    padding: 1rem 2rem; cursor: pointer; display: flex; align-items: center; gap: 1rem;
    color: #71717a; transition: all 0.2s;
}

.nav-item:hover, .nav-item.active { color: white; background: #27272a; }
.nav-item.active { border-left: 4px solid var(--accent); }

/* Dashboard */
.content { flex: 1; padding: 3rem; overflow-y: auto; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
.status-indicator { 
    padding: 0.5rem 1rem; border-radius: 99px; font-weight: 900; font-size: 0.7rem;
    background: #450a0a; color: #f87171;
}

.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; }
.stat-card { background: var(--card); padding: 1.5rem; border-radius: 1rem; border: 1px solid #27272a; }
.stat-card span { font-size: 0.7rem; color: #71717a; font-weight: 900; }

.power-controls { margin-top: 2rem; display: flex; gap: 1rem; }
button { 
    padding: 1rem 2rem; border-radius: 0.75rem; border: none; font-weight: 700;
    cursor: pointer; transition: 0.2s;
}

.btn-start { background: var(--accent); color: #064e3b; }
.btn-stop { background: #3f3f46; color: white; }

/* File Browser */
.file-browser { background: var(--card); border-radius: 1rem; min-height: 400px; padding: 1rem; }
`;

  const nginxConf = `server {
    listen 80;
    server_name \${config.domain};

    # Limite de 10GB para pastas de modpack
    client_max_body_size 10240M;

    location / {
        root /var/www/minepanel;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:\${config.backendPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Timeout longo para uploads pesados
        proxy_read_timeout 600s;
        proxy_connect_timeout 600s;
    }
}`;

  const readmeInstructions = `# Manual MinePanel PRO (Estilo EnxadaHost)

Esta ferramenta gera um sistema de controle completo. Siga os passos:

### 1. Instalação de Dependências
Na sua VPS Ubuntu 24:
\`\`\`bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm nginx unzip
sudo npm install -g pm2
\`\`\`

### 2. Organização
\`\`\`bash
mkdir -p /opt/minepanel/backend
mkdir -p /var/www/minepanel
\`\`\`

### 3. Backend Setup
Vá em \`/opt/minepanel/backend\`:
1. Copie o **server.js**
2. Rode \`npm init -y\`
3. Instale: \`npm install express axios cors jsonwebtoken fs-extra multer archiver unzipper dotenv\`
4. Configure o **.env**
5. Inicie com PM2: \`pm2 start server.js --name minepanel\`

### 4. Frontend Setup
Vá em \`/var/www/minepanel\`:
1. Salve **index.html**, **style.css** e **app.js** (lógica).

### 5. Configuração Nginx & SSL
\`\`\`bash
sudo nano /etc/nginx/sites-available/minepanel
# Cole a configuração do Nginx aqui
sudo ln -s /etc/nginx/sites-available/minepanel /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# SSL Gratuito
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d \${config.domain}
\`\`\`

### 🚀 DICA DE OURO: Permissões
Certifique-se que o usuário que roda o painel tem acesso à pasta do Pterodactyl:
\`\`\`bash
sudo chown -R www-data:www-data \${config.vpsPath}
sudo chmod -R 775 \${config.vpsPath}
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
                  <span className="text-[10px] bg-emerald-500 text-black px-2 py-0.5 rounded-md font-bold tracking-widest">v2.0</span>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">— Enxada Style Generator</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl">
             {[
               { id: 'config', label: '1. Ajustes', icon: Settings },
               { id: 'backend', label: '2. Backend', icon: Terminal },
               { id: 'frontend', label: '3. Frontend', icon: Globe },
               { id: 'infra', label: '4. Infra', icon: ShieldCheck },
               { id: 'readme', label: '5. Guia', icon: FileCode }
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
                  <SectionHeader icon={Layout} title="Visual & Acesso Web" />
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
                   <div className="grid grid-cols-2 gap-6">
                    <InputGroup 
                      label="USUÁRIO" 
                      value={config.adminUser} 
                      onChange={v => setConfig({...config, adminUser: v})} 
                      placeholder="admin" 
                    />
                    <InputGroup 
                      label="PAINEL PORT" 
                      value={config.backendPort} 
                      onChange={v => setConfig({...config, backendPort: v})} 
                      placeholder="3000" 
                    />
                  </div>
                  <InputGroup 
                    label="SENHA DE ACESSO" 
                    value={config.adminPassword} 
                    onChange={v => setConfig({...config, adminPassword: v})} 
                    placeholder="Senha do site" 
                    type="password"
                  />
                </div>

                {/* API Settings */}
                <div className="bg-[#121214] border border-white/10 rounded-[2.5rem] p-10 space-y-8 shadow-2xl">
                  <SectionHeader icon={Key} title="Conexão Pterodactyl" />
                  <InputGroup 
                    label="URL DO PAINEL PTERO" 
                    value={config.panelUrl} 
                    onChange={v => setConfig({...config, panelUrl: v})} 
                    placeholder="https://pterodactyl.com" 
                  />
                  <InputGroup 
                    label="ID DO SERVIDOR (URL)" 
                    value={config.serverId} 
                    onChange={v => setConfig({...config, serverId: v})} 
                    placeholder="Ex: 8f2c3a1b" 
                  />
                  <InputGroup 
                    label="CLIENT API KEY" 
                    value={config.apiKey} 
                    onChange={v => setConfig({...config, apiKey: v})} 
                    placeholder="ptlc_xxxxxxxxxxxxxx" 
                  />
                </div>

                {/* System Settings */}
                <div className="bg-[#121214] border border-white/10 rounded-[2.5rem] p-10 space-y-8 shadow-2xl">
                  <SectionHeader icon={ShieldCheck} title="Sistema & VPS" />
                  <InputGroup 
                    label="CAMINHO NA VPS (VOLUMES)" 
                    value={config.vpsPath} 
                    onChange={v => setConfig({...config, vpsPath: v})} 
                    placeholder="/var/lib/pterodactyl/volumes/..." 
                  />
                  <InputGroup 
                    label="JWT SECRET (TOKEN)" 
                    value={config.jwtSecret} 
                    onChange={v => setConfig({...config, jwtSecret: v})} 
                    placeholder="Uma chave longa aleatória" 
                  />
                  <InputGroup 
                    label="CURSEFORGE API KEY" 
                    value={config.curseForgeKey} 
                    onChange={v => setConfig({...config, curseForgeKey: v})} 
                    placeholder="Cozinha opcional" 
                  />
                  <div className="p-5 bg-amber-500/5 rounded-2xl border border-amber-500/20">
                     <p className="text-[10px] text-amber-500 leading-relaxed italic">
                       *O caminho dos volumes é onde o Pterodactyl guarda os arquivos. Geralmente em <code className="bg-black/20 px-1">/var/lib/pterodactyl/volumes/</code>
                     </p>
                  </div>
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
                <div className="flex flex-col lg:flex-row gap-6">
                   <div className="lg:w-1/3">
                      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-3xl p-8 sticky top-6">
                        <SectionHeader icon={Terminal} title="Estrutura do Backend" />
                        <ul className="mt-6 space-y-4 text-xs">
                          <li className="flex items-start gap-3">
                            <Check size={14} className="text-emerald-500 mt-1" />
                            <span><strong>Auth JWT:</strong> Sessões seguras por 7 dias.</span>
                          </li>
                          <li className="flex items-start gap-3">
                            <Check size={14} className="text-emerald-500 mt-1" />
                            <span><strong>File Stream:</strong> Gerenciador de arquivos via Node FS.</span>
                          </li>
                          <li className="flex items-start gap-3">
                            <Check size={14} className="text-emerald-500 mt-1" />
                            <span><strong>Auto-Backup:</strong> Zip da pasta \`world\` em tempo real.</span>
                          </li>
                          <li className="flex items-start gap-3">
                            <Check size={14} className="text-emerald-500 mt-1" />
                            <span><strong>Zip Upload:</strong> Extração rápida de pastas completas.</span>
                          </li>
                        </ul>
                      </div>
                   </div>
                   <div className="lg:w-2/3 space-y-8">
                      <CodeBlock 
                        title=".env (Secret)" 
                        content={envExample} 
                        language="plaintext" 
                        onCopy={() => handleCopy(envExample, 'env')}
                        isCopied={copied === 'env'}
                      />
                      <CodeBlock 
                        title="backend/server.js (API Completa)" 
                        content={serverJsContent} 
                        language="javascript" 
                        onCopy={() => handleCopy(serverJsContent, 'serverjs')}
                        isCopied={copied === 'serverjs'}
                      />
                   </div>
                </div>
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
                  title="frontend/index.html" 
                  content={frontendHtml} 
                  language="html" 
                  onCopy={() => handleCopy(frontendHtml, 'html')}
                  isCopied={copied === 'html'}
                />
                <CodeBlock 
                  title="frontend/style.css" 
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
                <div className="bg-red-500/5 border border-red-500/20 rounded-3xl p-8 flex gap-6 items-start">
                  <AlertTriangle className="text-red-500 mt-1" size={24} />
                  <div>
                    <h4 className="text-red-500 font-bold uppercase text-xs tracking-widest mb-1">Cuidado com Limites do Nginx</h4>
                    <p className="text-sm text-slate-400">
                      Arquivos de modpack podem ser imensos. O parâmetro <code className="bg-white/5 px-1 rounded">client_max_body_size 10240M</code> na configuração abaixo permite até 10GB de upload. Não esqueça de reiniciar o Nginx após aplicar.
                    </p>
                  </div>
                </div>
                <CodeBlock 
                  title="Nginx VirtualHost (/etc/nginx/sites-available/minepanel)" 
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
                  title="Guia de Instalação (README.md)" 
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
            <FooterLink label="Pterodacty API Docs" />
            <FooterLink label="PM2 Management" />
            <FooterLink label="Nginx Proxying" />
            <FooterLink label="Security Headers" />
          </div>
          <div className="text-[11px] font-black text-slate-700 uppercase tracking-[0.4em] flex items-center gap-4">
            <Monitor size={14} className="text-emerald-500/20" /> MINEPANEL-PRO-GEN / 2026-STABLE
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
      <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.15em] group-focus-within:text-emerald-500 transition-colors">{label}</label>
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

function FooterLink({ label }: { label: string }) {
  return (
    <a href="#" className="text-[10px] font-black uppercase text-slate-600 hover:text-emerald-400 transition-all tracking-[0.2em]">
      {label}
    </a>
  );
}

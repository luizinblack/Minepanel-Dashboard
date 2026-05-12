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
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Config {
  serverName: string;
  panelUrl: string;
  serverId: string;
  apiKey: string;
  dashboardPassword: string;
  vpsIp: string;
  domain: string;
  backendPort: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'config' | 'frontend' | 'backend' | 'infra' | 'readme'>('config');
  const [copied, setCopied] = useState<string | null>(null);

  const [config, setConfig] = useState<Config>({
    serverName: 'Meu Servidor Forge',
    panelUrl: 'https://painel.meudominio.com',
    serverId: 'id_da_url_aqui',
    apiKey: 'seu_client_api_key_aqui',
    dashboardPassword: 'senha_secreta',
    vpsIp: '123.123.123.123',
    domain: 'minepaneldashboard.com.br',
    backendPort: '3000'
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // --- Generated Content ---

  const envExample = `# Configurações do Pterodactyl
PTERODACTYL_URL=\${config.panelUrl}
PTERODACTYL_API_KEY=\${config.apiKey}
SERVER_ID=\${config.serverId}

# Configurações do Painel Customizado
PAINEL_PASSWORD=\${config.dashboardPassword}
PORT=\${config.backendPort}
NODE_ENV=production`;

  const serverJsContent = `// backend/server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PTERO_URL = process.env.PTERODACTYL_URL;
const API_KEY = process.env.PTERODACTYL_API_KEY;
const SERVER_ID = process.env.SERVER_ID;
const ADMIN_PASSWORD = process.env.PAINEL_PASSWORD;

// Middleware de Autenticação
const authMiddleware = (req, res, next) => {
    const password = req.headers['x-panel-password'];
    if (password === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'Senha incorreta' });
    }
};

const pteroClient = axios.create({
    baseURL: \`\${PTERO_URL}/api/client/servers/\${SERVER_ID}\`,
    headers: {
        'Authorization': \`Bearer \${API_KEY}\`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
});

// GET /status - Retorna status, CPU, RAM e players
app.get('/api/status', async (req, res) => {
    try {
        const response = await pteroClient.get('/resources');
        const data = response.data.attributes;
        res.json({
            status: data.current_state,
            is_online: data.current_state === 'running',
            memory: \`\${(data.resources.memory_bytes / 1024 / 1024).toFixed(0)} MB\`,
            cpu: \`\${data.resources.cpu_absolute.toFixed(1)}%\`
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao conectar com Pterodactyl' });
    }
});

// POST /power - Iniciar ou Parar (Requer Senha)
app.post('/api/power', authMiddleware, async (req, res) => {
    const { action } = req.body; // 'start', 'stop', 'restart'
    try {
        await pteroClient.post('/power', { signal: action });
        res.json({ success: true, message: \`Sinal \${action} enviado!\` });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao enviar comando de energia' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(\`Backend rodando na porta \${PORT}\`);
});`;

  const frontendHtml = `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>\${config.serverName} | Painel</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        :root { --bg: #0c0a09; --card: #1c1917; --primary: #10b981; --online: #10b981; --offline: #ef4444; }
        body { font-family: 'Inter', sans-serif; background: var(--bg); color: #e7e5e4; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .container { background: var(--card); padding: 2.5rem; border-radius: 1.5rem; width: 100%; max-width: 420px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8); text-align: center; border: 1px solid rgba(255,255,255,0.03); }
        h1 { margin: 0; font-size: 1.75rem; font-weight: 900; letter-spacing: -0.05em; text-transform: uppercase; font-style: italic; color: white; }
        .status-badge { display: inline-block; padding: 0.6rem 1.2rem; border-radius: 99px; font-size: 0.7rem; font-weight: 900; margin: 2rem 0; text-transform: uppercase; letter-spacing: 0.1em; }
        .online { background: rgba(16, 185, 129, 0.1); color: var(--online); border: 1px solid rgba(16, 185, 129, 0.2); }
        .offline { background: rgba(239, 68, 68, 0.1); color: var(--offline); border: 1px solid rgba(239, 68, 68, 0.2); }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2.5rem; }
        .stat-item { background: rgba(0,0,0,0.3); padding: 1.25rem; border-radius: 1rem; border: 1px solid rgba(255,255,255,0.02); }
        .stat-label { font-size: 0.65rem; color: #78716c; text-transform: uppercase; font-weight: 900; margin-bottom: 0.5rem; }
        .stat-value { font-size: 1.25rem; font-weight: 700; color: white; }
        .actions { display: flex; flex-direction: column; gap: 1rem; }
        button { border: none; padding: 1.1rem; border-radius: 1rem; font-weight: 900; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .btn-start { background: var(--primary); color: #064e3b; }
        .btn-stop { background: #292524; color: #a8a29e; }
        button:hover { transform: translateY(-3px); box-shadow: 0 10px 20px -5px rgba(16, 185, 129, 0.3); }
        .btn-stop:hover { box-shadow: 0 10px 20px -5px rgba(0,0,0,0.5); }
        .password-input { width: 100%; padding: 1.1rem; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 1rem; color: white; box-sizing: border-box; margin-bottom: 1.5rem; text-align: center; outline: none; transition: border-color 0.2s; }
        .password-input:focus { border-color: var(--primary); }
    </style>
</head>
<body>
    <div class="container">
        <h1>\${config.serverName}</h1>
        <div id="status" class="status-badge offline">Carregando...</div>
        
        <div class="stats">
            <div class="stat-item">
                <div class="stat-label">CPU</div>
                <div id="cpu" class="stat-value">-</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">RAM</div>
                <div id="ram" class="stat-value">-</div>
            </div>
        </div>

        <input type="password" id="password" class="password-input" placeholder="DIGITE A SENHA DO PAINEL">
        
        <div class="actions">
            <button class="btn-start" onclick="power('start')">Iniciar Servidor</button>
            <button class="btn-stop" onclick="power('stop')">Desligar Servidor</button>
        </div>
    </div>

    <script>
        const API_BASE = window.location.origin + '/api';

        const updateStatus = async () => {
            try {
                const res = await fetch(API_BASE + '/status');
                const data = await res.json();
                const badge = document.getElementById('status');
                badge.textContent = data.status === 'running' ? 'ESTADO: ONLINE' : 'ESTADO: ' + data.status.toUpperCase();
                badge.className = 'status-badge ' + (data.status === 'running' ? 'online' : 'offline');
                document.getElementById('cpu').textContent = data.cpu;
                document.getElementById('ram').textContent = data.memory;
            } catch (e) { console.error('Erro ao buscar status'); }
        };

        const power = async (action) => {
            const password = document.getElementById('password').value;
            if(!password) return alert('Insira a senha mestre!');
            
            try {
                const res = await fetch(API_BASE + '/power', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-panel-password': password },
                    body: JSON.stringify({ action })
                });
                const data = await res.json();
                if(data.error) alert(data.error);
                else alert(data.message);
                updateStatus();
            } catch (e) { alert('Erro na conexão com o backend'); }
        };

        setInterval(updateStatus, 5000);
        updateStatus();
    </script>
</body>
</html>`;

  const nginxConf = `server {
    listen 80;
    server_name \${config.domain};

    # Servir o Frontend Estático
    location / {
        root /var/www/minepanel;
        index index.html;
        try_files $uri $uri/ =404;
    }

    # Proxy para o Backend Node.js
    location /api/ {
        proxy_pass http://localhost:\${config.backendPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}`;

  const systemdService = `[Unit]
Description=MinePanel Dashboard Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/minepanel/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production
# Opcional: Carregar ENV de arquivo separado
# EnvironmentFile=/opt/minepanel/backend/.env

[Install]
WantedBy=multi-user.target`;

  const readmeInstructions = `# Plano de Implementação: minepaneldashboard.com.br

### 🚀 1. Setup Inicial da VPS
Conecte-se na sua VPS Ubuntu 24 e instale o ambiente necessário:
\`\`\`bash
sudo apt update && sudo apt upgrade -y
# Instalar Node.js 20+ e Nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx
\`\`\`

### 📂 2. Estrutura de Pastas
\`\`\`bash
sudo mkdir -p /opt/minepanel/backend
sudo mkdir -p /var/www/minepanel
sudo chown -R $USER:$USER /opt/minepanel
sudo chown -R $USER:$USER /var/www/minepanel
\`\`\`

### ⚙️ 3. Backend (Node.js)
Abra a pasta do backend, inicie o projeto e crie os arquivos:
\`\`\`bash
cd /opt/minepanel/backend
npm init -y
npm install express axios dotenv cors
# Crie o server.js e o .env com os códigos gerados aqui
\`\`\`

### 🌐 4. Frontend & Nginx
1. Salve o **index.html** em \`/var/www/minepanel/index.html\`
2. Crie a config do Nginx: \`sudo nano /etc/nginx/sites-available/minepanel\`
3. Ative a config:
\`\`\`bash
sudo ln -s /etc/nginx/sites-available/minepanel /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
\`\`\`

### 🔒 5. SSL (HTTPS Gratuito)
\`\`\`bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d \${config.domain}
\`\`\`

### 🔋 6. Persistência (SystemD)
Crie o serviço para que o painel nunca caia:
\`\`\`bash
sudo nano /etc/systemd/system/minepanel.service
# Cole o conteúdo do SystemD gerado aqui
sudo systemctl daemon-reload
sudo systemctl enable minepanel
sudo systemctl start minepanel
\`\`\`
`;

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-slate-300 font-sans selection:bg-emerald-500/30">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-emerald-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] bg-emerald-600/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <Activity className="text-emerald-400" size={24} />
              </div>
              <h1 className="text-2xl font-black text-white italic tracking-tighter uppercase">
                MinePanel <span className="text-emerald-500">Forge</span> <span className="text-[10px] bg-emerald-500 text-black px-2 py-0.5 rounded-full not-italic ml-2 tracking-normal uppercase font-bold">Dashboard Generator</span>
              </h1>
            </div>
            <p className="text-slate-500 text-sm font-medium">
              Gere toda a infraestrutura para o seu painel de controle customizado na VPS.
            </p>
          </div>
          
          <div className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/10 rounded-2xl">
             {[
               { id: 'config', label: '1. Config', icon: Settings },
               { id: 'frontend', label: '2. Frontend', icon: Globe },
               { id: 'backend', label: '3. Backend', icon: Terminal },
               { id: 'infra', label: '4. Infra', icon: ShieldCheck },
               { id: 'readme', label: '5. Manual', icon: FileCode }
             ].map((tab) => (
               <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id as any)}
                 className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ease-out duration-300 \${
                   activeTab === tab.id 
                    ? 'bg-emerald-500 text-black shadow-xl shadow-emerald-500/20 scale-105' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                 }`}
               >
                 <tab.icon size={14} />
                 <span className="hidden sm:inline">{tab.label}</span>
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
                className="grid grid-cols-1 md:grid-cols-2 gap-8"
              >
                <div className="bg-[#111111] border border-white/10 rounded-3xl p-10 space-y-8 shadow-2xl">
                  <div className="flex items-center gap-3 mb-2">
                    <Layout size={20} className="text-emerald-400" />
                    <h2 className="text-xs font-black text-white uppercase italic tracking-[0.2em]">Personalização Visual</h2>
                  </div>
                  <InputGroup 
                    label="NOME DO SERVIDOR" 
                    value={config.serverName} 
                    onChange={v => setConfig({...config, serverName: v})} 
                    placeholder="Ex: CraftWorld Forge" 
                  />
                  <InputGroup 
                    label="DOMÍNIO (URL)" 
                    value={config.domain} 
                    onChange={v => setConfig({...config, domain: v})} 
                    placeholder="minepaneldashboard.com.br" 
                  />
                  <InputGroup 
                    label="SENHA DO DASHBOARD" 
                    value={config.dashboardPassword} 
                    onChange={v => setConfig({...config, dashboardPassword: v})} 
                    placeholder="Defina uma senha forte" 
                    type="password"
                  />
                </div>

                <div className="bg-[#111111] border border-white/10 rounded-3xl p-10 space-y-8 shadow-2xl">
                  <div className="flex items-center gap-3 mb-2">
                    <Key size={20} className="text-emerald-400" />
                    <h2 className="text-xs font-black text-white uppercase italic tracking-[0.2em]">Credenciais Pterodactyl</h2>
                  </div>
                  <InputGroup 
                    label="URL DO PAINEL" 
                    value={config.panelUrl} 
                    onChange={v => setConfig({...config, panelUrl: v})} 
                    placeholder="https://painel.meudominio.com" 
                  />
                  <div className="grid grid-cols-2 gap-6">
                    <InputGroup 
                      label="ID DO SERVIDOR" 
                      value={config.serverId} 
                      onChange={v => setConfig({...config, serverId: v})} 
                      placeholder="Ex: 99abc123" 
                    />
                    <InputGroup 
                      label="PORTA BACKEND" 
                      value={config.backendPort} 
                      onChange={v => setConfig({...config, backendPort: v})} 
                      placeholder="3000" 
                    />
                  </div>
                  <InputGroup 
                    label="CLIENT API KEY" 
                    value={config.apiKey} 
                    onChange={v => setConfig({...config, apiKey: v})} 
                    placeholder="ptlc_xxxxxxxxxxxxxx" 
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'frontend' && (
              <motion.div
                key="frontend"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="space-y-6"
              >
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-3xl p-8 flex gap-6 items-center">
                   <div className="p-4 bg-emerald-500/10 rounded-2xl">
                     <Monitor size={32} className="text-emerald-500" />
                   </div>
                   <div>
                     <h4 className="text-emerald-500 font-black uppercase text-sm mb-1 tracking-widest italic">Página Web UI</h4>
                     <p className="text-slate-400 text-sm leading-relaxed max-w-2xl">
                       Este código gera um arquivo <code className="bg-white/5 px-1.5 py-0.5 rounded text-emerald-400 font-mono">index.html</code> único, contendo CSS moderno e JavaScript para atualização em tempo real de CPU/RAM e controle de energia.
                     </p>
                   </div>
                </div>
                <CodeBlock 
                  title="frontend/index.html (HTML5 + CSS3 + Vanilla JS)" 
                  content={frontendHtml} 
                  language="html" 
                  onCopy={() => handleCopy(frontendHtml, 'html')}
                  isCopied={copied === 'html'}
                />
              </motion.div>
            )}

            {activeTab === 'backend' && (
              <motion.div
                key="backend"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                className="space-y-6"
              >
                <CodeBlock 
                  title=".env (Variáveis de Ambiente)" 
                  content={envExample} 
                  language="plaintext" 
                  onCopy={() => handleCopy(envExample, 'env')}
                  isCopied={copied === 'env'}
                />
                <CodeBlock 
                  title="server.js (Node.js API)" 
                  content={serverJsContent} 
                  language="javascript" 
                  onCopy={() => handleCopy(serverJsContent, 'serverjs')}
                  isCopied={copied === 'serverjs'}
                />
              </motion.div>
            )}

            {activeTab === 'infra' && (
              <motion.div
                key="infra"
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50 }}
                className="space-y-6"
              >
                <CodeBlock 
                  title="Nginx Config - /etc/nginx/sites-available/minepanel" 
                  content={nginxConf} 
                  language="nginx" 
                  onCopy={() => handleCopy(nginxConf, 'nginx')}
                  isCopied={copied === 'nginx'}
                />
                <CodeBlock 
                  title="SystemD Service - /etc/systemd/system/minepanel.service" 
                  content={systemdService} 
                  language="systemd" 
                  onCopy={() => handleCopy(systemdService, 'systemd')}
                  isCopied={copied === 'systemd'}
                />
              </motion.div>
            )}

            {activeTab === 'readme' && (
              <motion.div
                key="readme"
                initial={{ opacity: 0, scale: 1.1 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="space-y-6"
              >
                <CodeBlock 
                  title="Manual de Instalação (README.md)" 
                  content={readmeInstructions} 
                  language="markdown" 
                  onCopy={() => handleCopy(readmeInstructions, 'readme')}
                  isCopied={copied === 'readme'}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="mt-24 border-t border-white/5 pt-12 flex flex-col md:flex-row items-center justify-between gap-8 pb-12">
          <div className="flex items-center gap-10">
            <a href="#" className="text-[10px] font-black uppercase text-slate-500 hover:text-emerald-400 transition-all tracking-widest">Suporte VPS</a>
            <a href="#" className="text-[10px] font-black uppercase text-slate-500 hover:text-emerald-400 transition-all tracking-widest">Pterodactyl API</a>
            <a href="#" className="text-[10px] font-black uppercase text-slate-500 hover:text-emerald-400 transition-all tracking-widest">Segurança SSH</a>
          </div>
          <div className="text-[11px] font-black text-slate-600 uppercase tracking-[0.3em] flex items-center gap-3">
            <Activity size={14} className="text-emerald-500/30" /> MinePanel.AI Build 2026
          </div>
        </footer>
      </div>
    </div>
  );
}

function InputGroup({ label, value, onChange, placeholder, type = "text" }: { label: string, value: string, onChange: (v: string) => void, placeholder: string, type?: string }) {
  return (
    <div className="flex flex-col gap-3 group">
      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-focus-within:text-emerald-500 transition-colors">{label}</label>
      <input 
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-sm text-white outline-none focus:border-emerald-500/40 focus:ring-4 focus:ring-emerald-500/10 transition-all placeholder:text-slate-800 font-medium"
      />
    </div>
  );
}

function CodeBlock({ title, content, language, onCopy, isCopied }: { title: string, content: string, language: string, onCopy: () => void, isCopied: boolean }) {
  return (
    <div className="bg-[#111] border border-white/10 rounded-3xl overflow-hidden shadow-2xl group flex flex-col">
      <div className="px-8 py-5 bg-[#151515] border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5 mr-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/30 border border-red-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/30 border border-amber-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/30 border border-emerald-500/50" />
          </div>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic">{title}</span>
        </div>
        <button 
          onClick={onCopy}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all duration-300 \${
            isCopied ? 'bg-emerald-500 text-black' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-emerald-500/20'
          }`}
        >
          {isCopied ? <Check size={14} /> : <Copy size={14} />}
          {isCopied ? 'COPIADO' : 'COPIAR CÓDIGO'}
        </button>
      </div>
      <div className="p-8 overflow-hidden bg-black/20">
        <pre className="text-xs font-mono text-emerald-400/90 leading-relaxed overflow-x-auto custom-scrollbar">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { 
  Github, 
  Server, 
  Terminal, 
  Key, 
  ShieldCheck, 
  Copy, 
  Check, 
  Download, 
  ChevronRight,
  Info,
  ExternalLink,
  Code2,
  Settings,
  Cloud,
  FileCode,
  Layout
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Config {
  mcVersion: string;
  forgeVersion: string;
  localPath: string;
  serverId: string;
  panelUrl: string;
  sshUser: string;
  vpsIp: string;
  githubRepo: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'config' | 'pc' | 'vps' | 'guide'>('config');
  const [copied, setCopied] = useState<string | null>(null);

  const [config, setConfig] = useState<Config>({
    mcVersion: '1.20.1',
    forgeVersion: '47.2.0',
    localPath: 'C:\\servidores\\minecraft-forge',
    serverId: '99abc123',
    panelUrl: 'https://painel.meudominio.com',
    sshUser: 'root',
    vpsIp: '123.123.123.123',
    githubRepo: 'usuario/meu-modpack'
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // --- Generated Scripts Content ---

  const gitignoreContent = `# Minecraft Server Gitignore
world/
logs/
crash-reports/
*.log
*.tmp
debug.txt
backups/
.mixin.out
usercache.json
whitelist.json
ops.json
banned-ips.json
banned-players.json
# Forge specific
run/
.gradle/
build/`;

  const deployPs1Content = `# Script de Deploy Automático (Windows PowerShell)
# Local: ${config.localPath}

$commitMsg = $args[0]
if (-not $commitMsg) {
    $commitMsg = "Update: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Write-Host ">>> Iniciando Deploy para ${config.githubRepo}..." -ForegroundColor Cyan

# 1. Git Push
Write-Host "[1/3] Enviando arquivos para o GitHub..." -ForegroundColor Yellow
git add .
git commit -m "$commitMsg"
git push origin main

# 2. Trigger VPS via SSH
Write-Host "[2/3] Conectando na VPS via SSH (${config.vpsIp})..." -ForegroundColor Yellow
ssh ${config.sshUser}@${config.vpsIp} "bash /home/${config.sshUser}/update-server.sh"

Write-Host "[3/3] Processo finalizado com sucesso!" -ForegroundColor Green
`;

  const updateServerShContent = `#!/bin/bash

# --- CONFIGURAÇÕES ---
SERVER_ID="${config.serverId}"
PANEL_URL="${config.panelUrl}"
# Defina PTERO_API_KEY no seu ~/.bashrc ou use um arquivo .env
# PTERO_API_KEY="seu_token_aqui"

SERVER_PATH="/var/lib/pterodactyl/volumes/$SERVER_ID"

echo ">>> Iniciando atualização do servidor Minecraft..."

# 1. Parar o servidor
echo "[1/4] Parando servidor via API..."
curl -X POST "$PANEL_URL/api/client/servers/$SERVER_ID/power" \\
  -H "Authorization: Bearer $PTERO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"signal": "stop"}'

# Aguardar um pouco para garantir que parou
sleep 5

# 2. Atualizar arquivos
echo "[2/4] Sincronizando com GitHub..."
cd "$SERVER_PATH" || exit
git pull origin main

# 3. Iniciar o servidor
echo "[3/4] Reiniciando servidor via API..."
curl -X POST "$PANEL_URL/api/client/servers/$SERVER_ID/power" \\
  -H "Authorization: Bearer $PTERO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"signal": "start"}'

echo "[4/4] VPS: Operação concluída!"
`;

  const readmeContent = `# Minecraft Server - Forge ${config.mcVersion}
Estrutura do Repositório:
- \`mods/\`: Lista de mods sincronizada.
- \`config/\`: Configurações do servidor e dos mods.
- \`server.properties\`: Configurações base.
- \`scripts/\`: (Se houver KubeJS ou CraftTweaker).
- \`forge-*.jar\`: Executável do servidor.

*Nota: A pasta \`world/\` não está inclusa no repositório para evitar arquivos pesados e corrupção de dados.*
`;

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-slate-300 font-sans">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-indigo-500/10 rounded-lg">
                <Cloud className="text-indigo-400" size={24} />
              </div>
              <h1 className="text-2xl font-black text-white italic tracking-tight uppercase">
                MineDeploy <span className="text-indigo-500">Pipeline</span>
              </h1>
            </div>
            <p className="text-slate-500 text-sm font-medium">
              Gere scripts automatizados para seu servidor Minecraft Forge via GitHub e Pterodactyl.
            </p>
          </div>
          
          <div className="flex items-center gap-2 p-1 bg-white/5 border border-white/10 rounded-xl">
             {[
               { id: 'config', label: 'Configurar', icon: Settings },
               { id: 'pc', label: 'Local PC', icon: Layout },
               { id: 'vps', label: 'VPS Script', icon: Terminal },
               { id: 'guide', label: 'Guia SSH/API', icon: ShieldCheck }
             ].map((tab) => (
               <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id as any)}
                 className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                   activeTab === tab.id 
                    ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                    : 'text-slate-500 hover:text-slate-300'
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
                className="grid grid-cols-1 md:grid-cols-2 gap-6"
              >
                <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Server size={18} className="text-indigo-400" />
                    <h2 className="text-sm font-black text-white uppercase italic tracking-widest">Informações de Versão</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <InputGroup 
                      label="Minecraft" 
                      value={config.mcVersion} 
                      onChange={v => setConfig({...config, mcVersion: v})} 
                      placeholder="Ex: 1.20.1" 
                    />
                    <InputGroup 
                      label="Forge" 
                      value={config.forgeVersion} 
                      onChange={v => setConfig({...config, forgeVersion: v})} 
                      placeholder="Ex: 47.2.0" 
                    />
                  </div>
                  <InputGroup 
                    label="Caminho Local (Windows)" 
                    value={config.localPath} 
                    onChange={v => setConfig({...config, localPath: v})} 
                    placeholder="C:\servidores\meu-servidor" 
                  />
                  <InputGroup 
                    label="GitHub Repo (usuario/projeto)" 
                    value={config.githubRepo} 
                    onChange={v => setConfig({...config, githubRepo: v})} 
                    placeholder="github-user/modpack-repo" 
                  />
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Terminal size={18} className="text-indigo-400" />
                    <h2 className="text-sm font-black text-white uppercase italic tracking-widest">Acesso VPS & Painel</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <InputGroup 
                      label="IP da VPS" 
                      value={config.vpsIp} 
                      onChange={v => setConfig({...config, vpsIp: v})} 
                      placeholder="123.45.67.89" 
                    />
                    <InputGroup 
                      label="Usuário SSH" 
                      value={config.sshUser} 
                      onChange={v => setConfig({...config, sshUser: v})} 
                      placeholder="root" 
                    />
                  </div>
                  <InputGroup 
                    label="URL do Painel (Pterodactyl)" 
                    value={config.panelUrl} 
                    onChange={v => setConfig({...config, panelUrl: v})} 
                    placeholder="https://painel.exemplo.com" 
                  />
                  <InputGroup 
                    label="ID do Servidor (No ID)" 
                    value={config.serverId} 
                    onChange={v => setConfig({...config, serverId: v})} 
                    placeholder="abcdef12" 
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'pc' && (
              <motion.div
                key="pc"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1 space-y-6">
                    <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-6">
                      <h3 className="text-white font-black text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
                        <FileCode size={16} className="text-indigo-400" /> Estrutura Sugerida
                      </h3>
                      <pre className="text-[10px] font-mono text-slate-400 leading-relaxed">
{`${config.localPath}\\
├── mods/
├── config/
├── server.properties
├── forge-${config.mcVersion}-${config.forgeVersion}.jar
├── .gitignore
├── deploy.ps1
└── README.md`}
                      </pre>
                    </div>
                    
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                      <h4 className="text-white font-bold text-xs uppercase mb-3">Como usar o script:</h4>
                      <ol className="text-xs text-slate-400 space-y-2 list-decimal list-inside">
                        <li>Fique na pasta do servidor no PowerShell</li>
                        <li>Rode: <code className="bg-white/5 px-1 py-0.5 rounded">. \\deploy.ps1 "mensagem"</code></li>
                        <li>O script fará o Git Push e chamará a VPS</li>
                      </ol>
                    </div>
                  </div>

                  <div className="lg:col-span-2 space-y-6">
                    <CodeBlock 
                      title=".gitignore" 
                      content={gitignoreContent} 
                      language="plaintext" 
                      onCopy={() => handleCopy(gitignoreContent, 'gitignore')}
                      isCopied={copied === 'gitignore'}
                    />
                    <CodeBlock 
                      title="deploy.ps1 (PowerShell)" 
                      content={deployPs1Content} 
                      language="powershell" 
                      onCopy={() => handleCopy(deployPs1Content, 'deployps1')}
                      isCopied={copied === 'deployps1'}
                    />
                     <CodeBlock 
                      title="README.md" 
                      content={readmeContent} 
                      language="markdown" 
                      onCopy={() => handleCopy(readmeContent, 'readme')}
                      isCopied={copied === 'readme'}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'vps' && (
              <motion.div
                key="vps"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-6 flex gap-4 items-start">
                   <div className="p-2 bg-amber-500/10 rounded-lg">
                     <Info size={18} className="text-amber-500" />
                   </div>
                   <div className="text-xs">
                     <h4 className="text-amber-500 font-black uppercase mb-1">Passo importante na VPS:</h4>
                     <p className="text-slate-400 italic">
                       Salve o script abaixo em <code className="bg-white/5 px-1 rounded">/home/{config.sshUser}/update-server.sh</code> e dê permissão de execução com: 
                       <code className="block mt-2 bg-black/40 p-2 rounded text-indigo-400">chmod +x /home/{config.sshUser}/update-server.sh</code>
                     </p>
                   </div>
                </div>

                <CodeBlock 
                  title="update-server.sh (BASH)" 
                  content={updateServerShContent} 
                  language="bash" 
                  onCopy={() => handleCopy(updateServerShContent, 'updatesh')}
                  isCopied={copied === 'updatesh'}
                />
              </motion.div>
            )}

            {activeTab === 'guide' && (
              <motion.div
                key="guide"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <section className="bg-white/5 border border-white/10 rounded-2xl p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <Key className="text-indigo-400" size={24} />
                    <h2 className="text-xl font-black text-white italic uppercase tracking-tight">1. SSH Sem Senha (Chaves RSA)</h2>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest">No seu PC (Windows)</h3>
                      <div className="text-sm space-y-4">
                        <p>1. Abra o PowerShell e gere a chave:</p>
                        <code className="block bg-black/40 p-3 rounded-lg text-indigo-300 text-xs">ssh-keygen -t rsa -b 4096</code>
                        <p>2. Envie para a VPS:</p>
                        <code className="block bg-black/40 p-3 rounded-lg text-indigo-300 text-xs">ssh-copy-id {config.sshUser}@{config.vpsIp}</code>
                        <p className="text-[11px] text-slate-500 italic">*Se o ssh-copy-id não existir no Windows, você precisará colar o conteúdo de ~/.ssh/id_rsa.pub manualmente no arquivo ~/.ssh/authorized_keys da VPS.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest">No GitHub</h3>
                      <div className="text-sm space-y-4">
                        <p>1. Copie sua chave pública:</p>
                        <code className="block bg-black/40 p-3 rounded-lg text-indigo-300 text-xs">cat ~/.ssh/id_rsa.pub | clip</code>
                        <p>2. Vá em Settings &gt; SSH and GPG keys &gt; New SSH Key e cole.</p>
                        <div className="bg-indigo-500/10 p-3 rounded-lg border border-indigo-500/20">
                          <p className="text-[11px] text-indigo-300 flex items-center gap-2">
                            <shield-check size={14} /> Isso permite que a VPS faça 'git pull' sem senha também.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="bg-white/5 border border-white/10 rounded-2xl p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <Settings className="text-indigo-400" size={24} />
                    <h2 className="text-xl font-black text-white italic uppercase tracking-tight">2. API do Pterodactyl</h2>
                  </div>
                  
                  <div className="space-y-6">
                    <div className="flex flex-col md:flex-row gap-6">
                      <div className="flex-1 space-y-3">
                         <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest">Onde gerar a API Key?</h3>
                         <ul className="text-sm text-slate-400 space-y-2">
                           <li className="flex items-center gap-2"><ChevronRight size={14} /> Entre no seu Painel Pterodactyl</li>
                           <li className="flex items-center gap-2"><ChevronRight size={14} /> Clique no ícone do usuário (Canto superior direito)</li>
                           <li className="flex items-center gap-2"><ChevronRight size={14} /> Vá em <strong>API Credentials</strong></li>
                           <li className="flex items-center gap-2"><ChevronRight size={14} /> Clique em <strong>Create New</strong></li>
                         </ul>
                      </div>
                      <div className="flex-1 bg-black/40 p-6 rounded-xl border border-white/5">
                        <h3 className="text-xs font-black text-white uppercase tracking-widest mb-3">Segurança Máxima</h3>
                        <p className="text-xs text-slate-400 leading-relaxed italic mb-4">
                          Nunca coloque a chave diretamente no script se o repositório for público. Na VPS, adicione ao seu bashrc:
                        </p>
                        <code className="block bg-black p-3 rounded text-[11px] text-indigo-400">
                          echo 'export PTERO_API_KEY="seu_token"' &gt;&gt; ~/.bashrc<br/>
                          source ~/.bashrc
                        </code>
                      </div>
                    </div>
                  </div>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="mt-20 border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <a href="#" className="text-[10px] font-black uppercase text-slate-500 hover:text-indigo-400 transition-colors">Documentação Oficial</a>
            <a href="https://github.com" className="text-[10px] font-black uppercase text-slate-500 hover:text-indigo-400 transition-colors">GitHub</a>
            <a href="#" className="text-[10px] font-black uppercase text-slate-500 hover:text-indigo-400 transition-colors">Discord Suporte</a>
          </div>
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
            Minecraft Deployer Tool • Build 2024
          </div>
        </footer>
      </div>
    </div>
  );
}

function InputGroup({ label, value, onChange, placeholder }: { label: string, value: string, onChange: (v: string) => void, placeholder: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</label>
      <input 
        type="text" 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all placeholder:text-slate-700"
      />
    </div>
  );
}

function CodeBlock({ title, content, language, onCopy, isCopied }: { title: string, content: string, language: string, onCopy: () => void, isCopied: boolean }) {
  return (
    <div className="bg-[#161616] border border-white/10 rounded-2xl overflow-hidden shadow-xl group">
      <div className="px-6 py-4 bg-[#1a1a1a] border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/30" />
          <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/30" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/30" />
          <span className="ml-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">{title}</span>
        </div>
        <button 
          onClick={onCopy}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            isCopied ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-500 hover:text-white hover:bg-white/10'
          }`}
        >
          {isCopied ? <Check size={14} /> : <Copy size={14} />}
          {isCopied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
      <div className="p-6 overflow-hidden">
        <pre className="text-xs font-mono text-indigo-300 leading-relaxed overflow-x-auto custom-scrollbar">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  );
}

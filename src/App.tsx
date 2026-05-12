import React, { useState, useEffect } from 'react';
import { 
  Server, 
  Terminal, 
  Upload, 
  Settings, 
  Power, 
  Activity, 
  Shield, 
  Database, 
  Plus, 
  HardDrive,
  Box,
  ChevronRight,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';

// --- Types ---

interface ServerData {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'starting';
  ram: string;
  players: string;
}

// --- Main App ---

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [servers, setServers] = useState<ServerData[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'files' | 'settings'>('dashboard');
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  // Load servers on mount
  useEffect(() => {
    fetchServers();
  }, []);

  const fetchServers = async () => {
    try {
      const res = await axios.get('/api/servers');
      const formatted = res.data.map((s: any) => ({
        ...s,
        status: 'offline', // Default for simulation
        ram: '0/2GB',
        players: '0/20'
      }));
      setServers(formatted);
    } catch (err) {
      console.error("Erro ao carregar servidores", err);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    const form = new FormData();
    form.append('file', file);

    try {
      const res = await axios.post('/api/upload', form);
      alert(`Servidor criado com ID: ${res.data.serverId}`);
      setFile(null);
      fetchServers();
    } catch (err) {
      alert("Falha no upload");
    } finally {
      setIsUploading(false);
    }
  };

  const startServer = async (id: string) => {
    try {
      setServers(prev => prev.map(s => s.id === id ? { ...s, status: 'starting' } : s));
      await axios.post(`/api/start/${id}`);
      // Simulate startup delay
      setTimeout(() => {
        setServers(prev => prev.map(s => s.id === id ? { ...s, status: 'online' } : s));
      }, 3000);
    } catch (err) {
      alert("Falha ao iniciar servidor");
    }
  };

  const stopServer = async (id: string) => {
    try {
      await axios.post(`/api/stop/${id}`);
      setServers(prev => prev.map(s => s.id === id ? { ...s, status: 'offline' } : s));
    } catch (err) {
      alert("Falha ao parar servidor");
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-400 font-sans selection:bg-emerald-500/30">
      {/* Background Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-5%] right-[-5%] w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative flex min-h-screen">
        {/* Sidebar */}
        <aside className="w-64 border-r border-zinc-800 bg-zinc-950/50 backdrop-blur-xl flex flex-col p-6 sticky top-0 h-screen">
          <div className="flex items-center gap-3 mb-10 px-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Box className="text-zinc-950" size={18} />
            </div>
            <h1 className="text-lg font-black text-white italic uppercase tracking-tighter">
              Mine<span className="text-emerald-500">Panel</span>
            </h1>
          </div>

          <nav className="flex-1 space-y-1">
            <SidebarLink active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={Server} label="Servidores" />
            <SidebarLink active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={FolderOpen} label="Arquivos" />
            <SidebarLink active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={Settings} label="Ajustes" />
          </nav>

          <div className="mt-auto pt-6 border-t border-zinc-800">
            <div className="flex items-center gap-3 px-2">
              <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 overflow-hidden">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Admin" alt="avatar" />
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-bold text-white truncate">Administrator</p>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">VPS Master</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-10 overflow-y-auto">
          {activeTab === 'dashboard' && (
            <div className="max-w-6xl mx-auto space-y-10">
              <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h2 className="text-3xl font-black text-white italic tracking-tight uppercase">Meus Servidores</h2>
                  <p className="text-zinc-500 mt-1 uppercase text-[10px] font-black tracking-widest">— Gerencie suas instâncias de Minecraft</p>
                </div>
                <div className="flex items-center gap-3 bg-zinc-900/50 p-1.5 rounded-2xl border border-zinc-800 backdrop-blur-xl">
                  <input 
                    type="file" 
                    id="file-upload" 
                    className="hidden" 
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    accept=".zip"
                  />
                  <label 
                    htmlFor="file-upload"
                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 text-zinc-950 rounded-xl text-xs font-black uppercase tracking-widest cursor-pointer hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                  >
                    {isUploading ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
                    {isUploading ? 'Processando...' : 'Criar Novo (ZIP)'}
                  </label>
                  {file && (
                    <button 
                      onClick={handleUpload}
                      className="px-4 py-2.5 bg-zinc-800 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-700 transition-all"
                    >
                      Confirmar
                    </button>
                  )}
                </div>
              </header>

              {/* Server Grid */}
              {servers.length === 0 ? (
                <div className="border border-dashed border-zinc-800 rounded-[2rem] p-20 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mb-6 border border-zinc-800">
                    <Server className="text-zinc-600" size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Nenhum servidor ativo</h3>
                  <p className="text-zinc-500 text-sm max-w-sm">Suba um arquivo .zip contendo seu servidor Minecraft (server.jar) para começar.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {servers.map((server) => (
                    <ServerCard 
                      key={server.id} 
                      server={server} 
                      onStart={() => startServer(server.id)}
                      onStop={() => stopServer(server.id)}
                      onSelect={() => setSelectedServerId(server.id)}
                    />
                  ))}
                </div>
              )}

              {/* Selected Server Console Simulator */}
              {selectedServerId && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] overflow-hidden backdrop-blur-xl"
                >
                  <div className="px-8 py-6 bg-zinc-800/30 border-b border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Terminal size={18} className="text-emerald-500" />
                      <h3 className="text-sm font-black text-white uppercase italic tracking-widest">Console: {selectedServerId}</h3>
                    </div>
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-zinc-700" />
                      <div className="w-3 h-3 rounded-full bg-zinc-700" />
                      <div className="w-3 h-3 rounded-full bg-zinc-700" />
                    </div>
                  </div>
                  <div className="p-8 h-80 overflow-y-auto font-mono text-xs space-y-1 text-emerald-500/80 bg-black/40">
                    <p className="opacity-40">[{new Date().toLocaleTimeString()}] System: Attached to container...</p>
                    <p>[INFO] Starting minecraft server version 1.20.1</p>
                    <p>[INFO] Loading properties...</p>
                    <p>[INFO] Default game type: SURVIVAL</p>
                    <p className="text-zinc-500">— Log principal oculto para demonstração —</p>
                  </div>
                  <div className="p-4 bg-zinc-900 border-t border-zinc-800">
                    <input 
                      type="text" 
                      placeholder="Enviar comando..." 
                      className="w-full bg-black border border-zinc-800 rounded-xl px-6 py-3 text-sm text-emerald-500 outline-none focus:border-emerald-500/40 transition-all font-mono"
                    />
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {activeTab === 'files' && (
            <div className="flex items-center justify-center h-full text-center">
               <div>
                  <FolderOpen size={48} className="mx-auto mb-4 opacity-20" />
                  <h2 className="text-xl font-bold text-white uppercase italic tracking-widest">Painel de Arquivos</h2>
                  <p className="text-zinc-500 text-sm mt-2 font-black uppercase text-[10px] tracking-widest">Disponível em VPS Linux (Modo Root)</p>
               </div>
            </div>
          )}
        </main>
      </div>

      {/* Footer / Stats Bar */}
      <footer className="fixed bottom-0 left-0 right-0 h-10 bg-zinc-950 border-t border-zinc-900 flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-6 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Cluster: Online
          </div>
          <div>API v2.4—Stable</div>
        </div>
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
          MinePanel Pro Generator — 2026 Edition
        </div>
      </footer>
    </div>
  );
}

// --- Helper Components ---

function SidebarLink({ active, icon: Icon, label, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 font-bold text-sm tracking-tight ${
        active 
        ? 'bg-emerald-500 text-zinc-950 shadow-xl shadow-emerald-500/10' 
        : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50'
      }`}
    >
      <Icon size={18} className={active ? 'text-zinc-950' : 'text-zinc-600'} />
      {label}
    </button>
  );
}

function ServerCard({ server, onStart, onStop, onSelect }: { server: ServerData, onStart: () => void, onStop: () => void, onSelect: () => void }) {
  const isOnline = server.status === 'online';
  const isStarting = server.status === 'starting';

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="group bg-zinc-900/50 border border-zinc-800 rounded-[2rem] p-6 hover:border-emerald-500/30 transition-all hover:bg-zinc-900 shadow-2xl relative overflow-hidden"
    >
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
            isOnline ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-zinc-800 border-zinc-700 text-zinc-600'
          }`}>
            <Server size={20} />
          </div>
          <div>
            <h4 className="font-black text-white text-sm uppercase italic tracking-widest">{server.name}</h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700'}`} />
              <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">
                {server.status}
              </p>
            </div>
          </div>
        </div>
        <button onClick={onSelect} className="p-2.5 bg-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-colors">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-zinc-950/50 p-4 rounded-2xl border border-zinc-800">
          <div className="flex items-center gap-2 mb-1 opacity-40">
            <Activity size={12} />
            <span className="text-[9px] font-black uppercase tracking-widest text-white">CPU/RAM</span>
          </div>
          <p className="text-xl font-black text-white tracking-tighter">{server.ram}</p>
        </div>
        <div className="bg-zinc-950/50 p-4 rounded-2xl border border-zinc-800">
          <div className="flex items-center gap-2 mb-1 opacity-40">
            <Users size={12} />
            <span className="text-[9px] font-black uppercase tracking-widest text-white">Jogadores</span>
          </div>
          <p className="text-xl font-black text-white tracking-tighter">{server.players}</p>
        </div>
      </div>

      <div className="flex gap-2.5">
        {!isOnline ? (
          <button 
            onClick={onStart}
            disabled={isStarting}
            className="flex-1 flex items-center justify-center gap-2 py-4 bg-emerald-500 text-zinc-950 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-400 transition-all disabled:opacity-50"
          >
            {isStarting ? <Loader2 className="animate-spin" size={14} /> : <Power size={14} />}
            Ligar
          </button>
        ) : (
          <button 
            onClick={onStop}
            className="flex-1 flex items-center justify-center gap-2 py-4 bg-zinc-800 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all group/stop"
          >
            <Power size={14} className="group-hover/stop:rotate-180 transition-transform" />
            Parar
          </button>
        )}
      </div>

      {/* Decorative corner */}
      <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none">
        <div className="absolute top-[-24px] right-[-24px] w-12 h-12 bg-white/5 rotate-45" />
      </div>
    </motion.div>
  );
}

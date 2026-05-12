import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Files, 
  Box, 
  Settings, 
  Power, 
  RotateCcw, 
  StopCircle, 
  Cpu, 
  Database, 
  Network, 
  Users, 
  Search, 
  Download, 
  Trash2, 
  Folder, 
  FileText, 
  ChevronRight,
  HardDrive,
  Activity,
  ShieldCheck,
  LayoutDashboard,
  Menu,
  X,
  Bell,
  User,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

// --- Tipos & Interfaces ---

type ServerStatus = 'online' | 'offline' | 'starting' | 'stopping' | 'hidden';

interface ConsoleLine {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'warn' | 'success' | 'command';
}

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size: string;
  modified: string;
}

interface Modpack {
  id: string;
  name: string;
  version: string;
  vendor: string;
  downloads: string;
  logo: string;
}

// --- Dados de Exemplo ---

const MOCK_FILES: FileItem[] = [
  { name: 'mods', type: 'directory', size: '--', modified: '12/05/2026 14:30' },
  { name: 'world', type: 'directory', size: '--', modified: '12/05/2026 18:21' },
  { name: 'config', type: 'directory', size: '--', modified: '11/05/2026 09:15' },
  { name: 'server.properties', type: 'file', size: '2.4 KB', modified: '12/05/2026 10:00' },
  { name: 'eula.txt', type: 'file', size: '0.1 KB', modified: '10/05/2026 11:00' },
  { name: 'ops.json', type: 'file', size: '0.4 KB', modified: '12/05/2026 17:45' },
  { name: 'whitelist.json', type: 'file', size: '0.2 KB', modified: '01/05/2026 12:00' },
  { name: 'forge-1.20.1.jar', type: 'file', size: '42.5 MB', modified: '05/05/2026 20:30' },
];

const MOCK_MODPACKS: Modpack[] = [
  { id: '1', name: 'Better Minecraft', version: 'v25', vendor: 'Forge', downloads: '1.2M', logo: 'https://media.forgecdn.net/avatars/402/894/637604470129206627.png' },
  { id: '2', name: 'All the Mods 9', version: 'v1.4.2', vendor: 'Forge', downloads: '850K', logo: 'https://media.forgecdn.net/avatars/615/656/637953284074213794.png' },
  { id: '3', name: 'RLCraft', version: 'v2.9.3', vendor: 'Forge', downloads: '3.4M', logo: 'https://media.forgecdn.net/avatars/158/899/636662491104648753.png' },
  { id: '4', name: 'SkyFactory 4', version: 'v4.2.4', vendor: 'Forge', downloads: '2.8M', logo: 'https://media.forgecdn.net/avatars/200/524/636906209867905814.png' },
];

// --- Sub-componentes ---

const MetricCard = ({ icon: Icon, label, value, subtext, color }: any) => (
  <div className="bg-[#1a1a1a] border border-white/5 p-4 rounded-xl space-y-3">
    <div className="flex items-center justify-between">
      <div className={`p-2 rounded-lg bg-${color}-500/10 text-${color}-500`}>
        <Icon size={20} />
      </div>
      <div className="text-[10px] uppercase tracking-wider text-white/40 font-mono">Real-time</div>
    </div>
    <div>
      <div className="text-2xl font-mono font-medium text-white">{value}</div>
      <div className="text-xs text-white/50 flex items-center gap-1">
        {label} <span className="text-[10px] opacity-30">•</span> {subtext}
      </div>
    </div>
  </div>
);

// --- Componente Principal ---

export default function App() {
  const [status, setStatus] = useState<ServerStatus>('online');
  const [activeTab, setActiveTab] = useState<'console' | 'files' | 'modpacks' | 'backups' | 'settings'>('console');
  const [consoleOutput, setConsoleOutput] = useState<ConsoleLine[]>([]);
  const [command, setCommand] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Simular métricas (CPU/RAM)
  const [metricsData, setMetricsData] = useState<any[]>([]);

  useEffect(() => {
    // Gerar dados iniciais do gráfico
    const initial = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      cpu: Math.floor(Math.random() * 40) + 10,
      ram: Math.floor(Math.random() * 20) + 60,
    }));
    setMetricsData(initial);

    // Atualizar métricas a cada 3s
    const interval = setInterval(() => {
      setMetricsData(prev => {
        const next = [...prev.slice(1), {
          time: prev[prev.length - 1].time + 1,
          cpu: Math.floor(Math.random() * 40) + 10,
          ram: Math.floor(Math.random() * 20) + 60,
        }];
        return next;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Simular logs de console aleatórios
  useEffect(() => {
    const messages = [
      '[Server thread/INFO]: Player JohnDoe joined the game',
      '[Server thread/INFO]: जॉन joined the game',
      '[Server thread/WARN]: Can\'t keep up! Is the server overloaded?',
      '[Server thread/INFO]: JohnDoe issued server command: /tps',
      '[Server thread/INFO]: TPM in world "world" is 20.0 (100%)',
      '[Server thread/INFO]: Chunk saved in 45ms',
    ];

    const logInterval = setInterval(() => {
      if (status === 'online') {
        const msg = messages[Math.floor(Math.random() * messages.length)];
        addLog(msg);
      }
    }, 8000);

    return () => clearInterval(logInterval);
  }, [status]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [consoleOutput]);

  const addLog = (message: string, type: ConsoleLine['type'] = 'info') => {
    const newLine: ConsoleLine = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
      message,
      type
    };
    setConsoleOutput(prev => [...prev.slice(-100), newLine]);
  };

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    addLog(`> ${command}`, 'command');
    setCommand('');
    
    // Simular resposta a comandos
    if (command.toLowerCase() === 'help') {
      addLog('Comandos disponíveis: help, tps, list, stop, say', 'success');
    } else if (command.toLowerCase() === 'tps') {
      addLog('TPS from last 1m, 5m, 15m: 20.0, 19.98, 19.95', 'info');
    }
  };

  const togglePower = () => {
    if (status === 'online') {
      setStatus('stopping');
      addLog('Enviando sinal de encerramento...', 'warn');
      setTimeout(() => {
        setStatus('offline');
        addLog('Servidor desligado com sucesso.', 'error');
      }, 3000);
    } else if (status === 'offline') {
      setStatus('starting');
      addLog('Iniciando servidor Forge 1.20.1...', 'info');
      setTimeout(() => {
        setStatus('online');
        addLog('Servidor pronto e ouvindo na porta 25565!', 'success');
      }, 5000);
    }
  };

  return (
    <div className="flex h-screen bg-[#0f0f0f] text-white overflow-hidden font-sans selection:bg-orange-500/30">
      
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 80 }}
        className="bg-[#141414] border-r border-white/5 flex flex-col z-20"
      >
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-600 rounded flex items-center justify-center shrink-0 shadow-lg shadow-orange-900/20">
            <LayoutDashboard size={18} className="text-white" />
          </div>
          {isSidebarOpen && (
            <motion.span 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-bold text-lg tracking-tight"
            >
              MinePanel <span className="text-orange-500">Pro</span>
            </motion.span>
          )}
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-4">
          <NavItem active={activeTab === 'console'} onClick={() => setActiveTab('console')} icon={Terminal} label="Console" collapsed={!isSidebarOpen} />
          <NavItem active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={Files} label="Arquivos" collapsed={!isSidebarOpen} />
          <NavItem active={activeTab === 'modpacks'} onClick={() => setActiveTab('modpacks')} icon={Box} label="Modpacks" collapsed={!isSidebarOpen} />
          <NavItem active={activeTab === 'backups'} onClick={() => setActiveTab('backups')} icon={RotateCcw} label="Backups" collapsed={!isSidebarOpen} />
          <NavItem active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={Settings} label="Configurações" collapsed={!isSidebarOpen} />
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-white/10 overflow-hidden">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Admin" alt="avatar" />
            </div>
            {isSidebarOpen && (
              <div className="flex-1 overflow-hidden">
                <div className="text-sm font-medium truncate">Master Admin</div>
                <div className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Plano Diamond</div>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        
        {/* Header */}
        <header className="h-16 border-b border-white/5 bg-[#141414]/50 backdrop-blur-md flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-6">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/60">
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-white/40 text-sm">Meu Servidor</span>
              <ChevronRight size={14} className="text-white/20" />
              <span className="text-sm font-medium">Survival SMP</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-3 px-4 py-1.5 bg-[#1a1a1a] border border-white/5 rounded-full">
              <div className={`w-2 h-2 rounded-full ${
                status === 'online' ? 'bg-green-500 animate-pulse' : 
                status === 'starting' ? 'bg-yellow-500 animate-pulse' : 
                'bg-red-500'
              }`} />
              <span className="text-xs font-medium uppercase tracking-wider text-white/80">
                {status === 'online' ? 'Servidor Online' : 
                 status === 'offline' ? 'Fora do Ar' : 
                 status === 'starting' ? 'Iniciando...' : 'Desligando...'}
              </span>
            </div>
            
            <div className="flex items-center gap-2 border-l border-white/10 pl-4 ml-2">
              <button onClick={togglePower} className={`p-2 rounded-lg transition-all ${status === 'offline' ? 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20' : 'bg-red-600/10 hover:bg-red-600/20 text-red-500'}`}>
                {status === 'offline' ? <Power size={18} /> : <StopCircle size={18} />}
              </button>
              <button disabled={status === 'offline'} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-white/60 disabled:opacity-30">
                <RotateCcw size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Viewport */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          
          <AnimatePresence mode="wait">
            {activeTab === 'console' && (
              <motion.div 
                key="console"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <MetricCard icon={Cpu} label="Uso de CPU" value="24%" subtext="Cores: 4/12" color="blue" />
                  <MetricCard icon={Database} label="Uso de RAM" value="3.2 GB" subtext="Limite: 8 GB" color="purple" />
                  <MetricCard icon={Network} label="Latência" value="12ms" subtext="Porta: 25565" color="green" />
                  <MetricCard icon={Users} label="Jogadores" value="12/50" subtext="Pico: 34" color="orange" />
                </div>

                {/* Charts & Stats */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 bg-[#1a1a1a] border border-white/5 rounded-2xl p-6 h-[400px]">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-semibold text-white/80 flex items-center gap-2">
                        <Activity size={18} className="text-orange-500" />
                        Desempenho Histórico
                      </h3>
                      <div className="flex gap-2">
                        <span className="text-[10px] uppercase font-mono text-blue-400 bg-blue-500/10 px-2 py-1 rounded">CPU %</span>
                        <span className="text-[10px] uppercase font-mono text-purple-400 bg-purple-500/10 px-2 py-1 rounded">RAM %</span>
                      </div>
                    </div>
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={metricsData}>
                          <defs>
                            <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                          <XAxis dataKey="time" hide />
                          <YAxis stroke="#555" fontSize={10} axisLine={false} tickLine={false} domain={[0, 100]} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                            itemStyle={{ fontSize: '12px' }}
                          />
                          <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCpu)" />
                          <Area type="monotone" dataKey="ram" stroke="#a855f7" fillOpacity={1} fill="url(#colorRam)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-[#1a1a1a] border border-white/5 rounded-2xl p-6 flex flex-col">
                    <h3 className="font-semibold text-white/80 mb-6 flex items-center gap-2">
                      <ShieldCheck size={18} className="text-green-500" />
                      Status do Daemon
                    </h3>
                    <div className="flex-1 space-y-6">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/40">Versão do Daemon</span>
                        <span className="text-sm font-mono text-white/80">v1.14.2</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/40">Uptime</span>
                        <span className="text-sm font-mono text-white/80">14d 02h 55m</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/40">Sincronização</span>
                        <span className="text-sm font-mono text-green-500 flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                          Estável
                        </span>
                      </div>
                      <div className="pt-6 border-t border-white/5">
                        <div className="text-xs text-white/40 mb-3 uppercase tracking-widest font-mono">Ações Rápidas</div>
                        <div className="grid grid-cols-2 gap-2">
                          <button className="flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors text-xs font-medium">
                            <Box size={14} /> Backups
                          </button>
                          <button className="flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors text-xs font-medium">
                            <Settings size={14} /> Props
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Real Console */}
                <div className="bg-black border border-white/10 rounded-2xl overflow-hidden flex flex-col h-[500px] shadow-2xl">
                  <div className="bg-[#141414] px-6 py-3 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono text-white/60">
                      <Terminal size={14} /> /home/container/console
                    </div>
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500/20" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500/20" />
                      <div className="w-3 h-3 rounded-full bg-green-500/20" />
                    </div>
                  </div>
                  
                  <div 
                    ref={scrollRef}
                    className="flex-1 p-6 font-mono text-sm overflow-y-auto space-y-1.5 custom-scrollbar bg-[#050505]"
                  >
                    {consoleOutput.length === 0 && (
                      <div className="text-white/20 italic select-none">Nenhuma atividade registrada ainda...</div>
                    )}
                    {consoleOutput.map(line => (
                      <div key={line.id} className="group flex gap-3 animate-in fade-in slide-in-from-left-4 duration-300">
                        <span className="shrink-0 text-white/20 select-none">{line.timestamp}</span>
                        <span className={`
                          ${line.type === 'error' ? 'text-red-400' : ''}
                          ${line.type === 'warn' ? 'text-yellow-400' : ''}
                          ${line.type === 'success' ? 'text-green-400' : ''}
                          ${line.type === 'command' ? 'text-blue-400 font-bold' : 'text-white/80'}
                        `}>
                          {line.message}
                        </span>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleCommand} className="p-4 bg-[#141414] border-t border-white/5 flex gap-4">
                    <div className="flex-1 relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 font-bold">$</span>
                      <input 
                        type="text" 
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        placeholder="Digite um comando para o servidor..." 
                        className="w-full bg-black border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm font-mono focus:outline-none focus:border-blue-500/50 transition-colors"
                      />
                    </div>
                    <button type="submit" className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl font-medium transition-all shadow-lg shadow-blue-900/20">
                      Executar
                    </button>
                  </form>
                </div>
              </motion.div>
            )}

            {activeTab === 'files' && (
              <motion.div 
                key="files"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h2 className="text-2xl font-bold">Gerenciador de Arquivos</h2>
                    <p className="text-white/50 text-sm">Visualize e gerencie a estrutura de arquivos da sua instância.</p>
                  </div>
                  <div className="flex gap-3">
                    <button className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl transition-colors text-sm">
                      <Folder size={16} /> Nova Pasta
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-xl transition-colors text-sm font-medium shadow-lg shadow-orange-900/20">
                      <Plus size={16} /> Upload
                    </button>
                  </div>
                </div>

                <div className="bg-[#1a1a1a] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                  <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/5 text-[10px] uppercase tracking-widest text-white/40 font-mono">
                    <div className="col-span-6">Nome</div>
                    <div className="col-span-2">Tamanho</div>
                    <div className="col-span-3">Modificado em</div>
                    <div className="col-span-1 text-right">Ação</div>
                  </div>

                  <div className="divide-y divide-white/5">
                    {MOCK_FILES.map((file, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-white/[0.02] cursor-pointer group transition-colors">
                        <div className="col-span-6 flex items-center gap-3">
                          {file.type === 'directory' ? <Folder className="text-orange-500" size={18} /> : <FileText className="text-white/40" size={18} />}
                          <span className="text-sm font-medium group-hover:text-orange-400 transition-colors">{file.name}</span>
                        </div>
                        <div className="col-span-2 text-sm text-white/40 font-mono">{file.size}</div>
                        <div className="col-span-3 text-sm text-white/40 font-mono">{file.modified}</div>
                        <div className="col-span-1 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'modpacks' && (
              <motion.div 
                key="modpacks"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                  <div className="space-y-1">
                    <h2 className="text-2xl font-bold">Mercado de Modpacks</h2>
                    <p className="text-white/50 text-sm">Instalação de modpacks em um clique diretamente dos repositórios oficiais.</p>
                  </div>
                  <div className="w-full md:w-96 relative">
                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                    <input 
                      type="text" 
                      placeholder="Pesquisar modpacks (ex: SkyBlock)..." 
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-orange-500/50 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {MOCK_MODPACKS.map(pack => (
                    <div key={pack.id} className="bg-[#1a1a1a] border border-white/5 rounded-2xl overflow-hidden group hover:border-orange-500/30 transition-all hover:shadow-2xl hover:shadow-orange-900/10 flex flex-col">
                      <div className="relative h-48 overflow-hidden bg-slate-800">
                        <img 
                          src={pack.logo} 
                          alt={pack.name} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 opacity-80"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a1a] to-transparent" />
                        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                          <div className="px-2 py-1 bg-black/50 backdrop-blur-md rounded text-[10px] font-bold uppercase tracking-widest text-orange-400 border border-orange-500/20">
                            {pack.vendor}
                          </div>
                        </div>
                      </div>
                      <div className="p-5 space-y-4 flex-1 flex flex-col">
                        <div>
                          <h4 className="font-bold text-lg leading-tight mb-1">{pack.name}</h4>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-white/30">{pack.version}</span>
                            <span className="text-xs text-white/30 flex items-center gap-1">
                              <Download size={12} /> {pack.downloads}
                            </span>
                          </div>
                        </div>
                        <div className="pt-4 mt-auto">
                          <button className="w-full py-3 bg-white/5 hover:bg-orange-600 rounded-xl transition-all font-semibold text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                            Instalar Modpack
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {/* Custom Install */}
                  <div className="bg-transparent border border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-4 hover:border-orange-500/40 hover:bg-orange-500/[0.02] transition-all cursor-pointer group">
                    <div className="w-12 h-12 bg-white/5 group-hover:bg-orange-500/10 rounded-full flex items-center justify-center text-white/30 group-hover:text-orange-500 transition-colors">
                      <Download size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold">Instalação Custom</h4>
                      <p className="text-xs text-white/30 mt-1">Envie seu próprio .zip de modpack</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Mini Status Bar (Bottom) */}
      <footer className="fixed bottom-0 left-0 right-0 h-8 bg-[#0a0a0a] border-t border-white/5 flex items-center justify-between px-6 text-[10px] font-mono text-white/30 z-30">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
            DAEMON: ESTÁVEL
          </div>
          <div className="hidden sm:block">UPTIME: 14:02:55:12</div>
          <div className="hidden sm:block">SERVER IP: 144.22.10.45:25565</div>
        </div>
        <div className="flex items-center gap-4 uppercase tracking-widest">
          <span>Mem: 3.2GB / 8GB</span>
          <span className="text-orange-500/60 transition-pulse">Sync Active</span>
        </div>
      </footer>
    </div>
  );
}

// --- Componentes Auxiliares UI ---

function NavItem({ icon: Icon, label, active, onClick, collapsed }: any) {
  return (
    <button 
      onClick={onClick}
      className={`
        w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all group relative
        ${active ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/20' : 'text-white/40 hover:text-white/80 hover:bg-white/5'}
      `}
    >
      <Icon size={20} className={active ? 'text-white' : 'text-white/20 group-hover:text-white/60 transition-colors'} />
      {!collapsed && (
        <span className="text-sm font-medium transition-opacity">{label}</span>
      )}
      {active && collapsed && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-l-full" />
      )}
    </button>
  );
}

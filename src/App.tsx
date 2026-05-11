import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Server as ServerIcon, 
  Cpu, 
  Database, 
  Terminal, 
  Play, 
  Square, 
  Upload, 
  Activity,
  HardDrive,
  Settings,
  ChevronRight,
  Folder,
  File as FileIcon,
  Trash2,
  Edit,
  Plus,
  ArrowLeft,
  Save,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { cn } from './lib/utils';

// Socket connection
const socket = io();

interface SystemStats {
  cpuLoad: string;
  cpuModel: string;
  ram: {
    used: string;
    total: string;
    percent: string;
  };
  gpu: string;
  gpuVram: number;
  timestamp: string;
}

export default function App() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsHistory, setStatsHistory] = useState<any[]>([]);
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running' | 'stopping'>('stopped');
  const [logs, setLogs] = useState<string[]>([]);
  const [currentJar, setCurrentJar] = useState<string>("");
  const [availableJars, setAvailableJars] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'monitor' | 'files'>('monitor');
  const [currentPath, setCurrentPath] = useState<string>(".");
  const [fileList, setFileList] = useState<any[]>([]);
  const [editingFile, setEditingFile] = useState<{ path: string, content: string } | null>(null);
  const [isCreating, setIsCreating] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState("");
  const [command, setCommand] = useState("");
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const fetchFiles = async (pathStr: string) => {
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(pathStr)}`);
      const data = await res.json();
      if (res.ok) {
        setFileList(data);
        setCurrentPath(pathStr);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeTab === 'files') {
      fetchFiles(currentPath);
    }
  }, [activeTab, currentPath]);

  useEffect(() => {
    // Initial status fetch
    try {
      fetch('/api/status')
        .then(res => res.json())
        .then(data => {
          setStatus(data.status);
          setCurrentJar(data.jar);
          setAvailableJars(data.availableJars);
        });
    } catch (e) {
      console.warn("API status fetch failed (expected if server hasn't restarted yet)");
    }

    socket.on('system_stats', (newStats: SystemStats) => {
      setStats(newStats);
      setStatsHistory(prev => {
        const next = [...prev, {
          time: newStats.timestamp,
          cpu: parseFloat(newStats.cpuLoad),
          ram: parseFloat(newStats.ram.percent)
        }].slice(-20);
        return next;
      });
    });

    socket.on('status_change', (data: { status: any }) => {
      setStatus(data.status);
    });

    socket.on('console_log', (log: string) => {
      setLogs(prev => [...prev, log].slice(-200));
    });

    return () => {
      socket.off('system_stats');
      socket.off('status_change');
      socket.off('console_log');
    };
  }, []);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleStart = async () => {
    if (!currentJar && availableJars.length > 0) {
      setCurrentJar(availableJars[0]);
    }
    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jar: currentJar || availableJars[0] })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleStop = async () => {
    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', e.target.files[0]);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setAvailableJars(prev => Array.from(new Set([...prev, data.filename])));
        if (data.filename.endsWith('.jar')) setCurrentJar(data.filename);
        if (activeTab === 'files') fetchFiles(currentPath);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileAction = {
    open: async (file: any) => {
      const fullPath = currentPath === "." ? file.name : `${currentPath}/${file.name}`;
      if (file.isDirectory) {
        fetchFiles(fullPath);
      } else {
        try {
          const res = await fetch(`/api/file/read?path=${encodeURIComponent(fullPath)}`);
          const data = await res.json();
          if (res.ok) {
            setEditingFile({ path: fullPath, content: data.content });
          }
        } catch (err) {
          console.error(err);
        }
      }
    },
    delete: async (file: any) => {
      if (!confirm(`Deseja apagar ${file.name}?`)) return;
      const fullPath = currentPath === "." ? file.name : `${currentPath}/${file.name}`;
      try {
        const res = await fetch('/api/file/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fullPath })
        });
        if (res.ok) fetchFiles(currentPath);
      } catch (err) {
        console.error(err);
      }
    },
    save: async () => {
      if (!editingFile) return;
      try {
        const res = await fetch('/api/file/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: editingFile.path, content: editingFile.content })
        });
        if (res.ok) setEditingFile(null);
      } catch (err) {
        console.error(err);
      }
    },
    create: async () => {
      const fullPath = currentPath === "." ? newName : `${currentPath}/${newName}`;
      try {
        const res = await fetch('/api/file/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fullPath, isDirectory: isCreating === 'folder' })
        });
        if (res.ok) {
          setIsCreating(null);
          setNewName("");
          fetchFiles(currentPath);
        }
      } catch (err) {
        console.error(err);
      }
    },
    goBack: () => {
      if (currentPath === ".") return;
      const parts = currentPath.split('/');
      parts.pop();
      const parent = parts.join('/') || ".";
      fetchFiles(parent);
    }
  };

  const sendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || status !== 'running') return;
    
    try {
      await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: command.trim() })
      });
      setCommand("");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-[#E1E1E6] font-sans selection:bg-[#38e11d]/30">
      {/* Grid Pattern Overlay */}
      <div className="fixed inset-0 bg-[radial-gradient(#1A1A1C_1px,transparent_1px)] [background-size:20px_20px] opacity-10 pointer-events-none" />

      {/* Top Header */}
      <header className="relative z-10 border-b border-[#2d2d2d] bg-[#1a1a1a] h-16">
        <div className="max-w-7xl mx-auto px-8 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#38e11d] rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(56,225,29,0.3)]">
              <ServerIcon size={20} className="text-black" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase italic text-white flex items-center gap-1.5">
                MINEPANEL <span className="text-[#38e11d]">LOCAL</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-3 h-3 rounded-full",
                status === 'running' ? "bg-[#38e11d] animate-pulse shadow-[0_0_10px_rgba(56,225,29,0.8)]" : 
                status === 'stopped' ? "bg-[#ff3e3e]" : "bg-amber-500 animate-pulse"
              )} />
              <span className={cn(
                "text-xs font-bold uppercase tracking-widest",
                status === 'running' ? "text-[#38e11d]" : 
                status === 'stopped' ? "text-red-400" : "text-amber-400"
              )}>
                {status === 'running' ? 'Server Online' : status === 'stopped' ? 'Server Offline' : status}
              </span>
            </div>

            <div className="h-8 w-[1px] bg-[#2d2d2d] hidden md:block"></div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={status === 'stopped' ? handleStart : handleStop}
                disabled={status === 'starting' || status === 'stopping'}
                className={cn(
                  "px-6 py-2 rounded font-black text-xs uppercase transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
                  status === 'stopped' 
                    ? "bg-[#38e11d] text-black hover:bg-[#4cf531] shadow-[0_0_20px_rgba(56,225,29,0.2)]" 
                    : "bg-[#ff3e3e] text-black hover:bg-[#ff5f5f]"
                )}
              >
                {status === 'stopped' ? 'Iniciar Servidor' : 'Desligar Servidor'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Stats & Monitoring */}
        <div className="lg:col-span-8 space-y-6">
          
          <div className="flex items-center gap-1 p-1 bg-[#161616] border border-[#2d2d2d] rounded-xl w-fit">
            <button 
              onClick={() => setActiveTab('monitor')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeTab === 'monitor' ? "bg-[#38e11d] text-black" : "text-slate-500 hover:text-white"
              )}
            >
              Monitoramento
            </button>
            <button 
              onClick={() => setActiveTab('files')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeTab === 'files' ? "bg-[#38e11d] text-black" : "text-slate-500 hover:text-white"
              )}
            >
              Arquivos do Servidor
            </button>
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'monitor' ? (
              <motion.div 
                key="monitor"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                {/* Main Grid Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <MetricCard 
                    label="Processador" 
                    value={stats?.cpuModel ? (stats.cpuModel.length > 12 ? stats.cpuModel.substring(0, 12) + ".." : stats.cpuModel) : "Lendo..."} 
                    icon={<Cpu className="text-[#00d1ff]" size={16} />}
                    subLabel={`Carga: ${stats?.cpuLoad || "0"}%`}
                    color="#00d1ff"
                    percentage={stats?.cpuLoad || "0"}
                  />
                  <MetricCard 
                    label="Memória RAM" 
                    value={stats?.ram ? `${stats.ram.used}/${stats.ram.total}GB` : "0/0GB"} 
                    icon={<Database className="text-[#38e11d]" size={16} />}
                    subLabel={`Uso do Servidor`}
                    color="#38e11d"
                    percentage={stats?.ram.percent || "0"}
                  />
                  <MetricCard 
                    label="Placa Gráfica" 
                    value={stats?.gpu === "N/A" ? "Indisponível" : (stats?.gpu?.length || 0) > 12 ? stats?.gpu?.substring(0, 12) + "..." : stats?.gpu || "Lendo..."} 
                    icon={<Activity className="text-[#bd00ff]" size={16} />}
                    subLabel={stats?.gpuVram ? `${stats.gpuVram}MB VRAM` : "Monitorando hardware"}
                    color="#bd00ff"
                    percentage={stats?.gpuVram ? "20" : "0"}
                  />
                </div>

                {/* Performance Chart */}
                <div className="bg-[#161616] border border-[#2d2d2d] rounded-2xl p-6 shadow-xl relative overflow-hidden">
                  <div className="flex items-center justify-between mb-6 relative z-10">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-4 bg-[#38e11d] rounded-full" />
                      <h3 className="text-sm font-black text-white italic uppercase tracking-wider">Performance Analítica</h3>
                    </div>
                    <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-[#00d1ff]" />
                        <span className="text-slate-500">CPU</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-[#38e11d]" />
                        <span className="text-slate-500">RAM</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="h-[240px] w-full relative z-10">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={statsHistory}>
                        <defs>
                          <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00d1ff" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#00d1ff" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38e11d" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#38e11d" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                        <XAxis 
                          dataKey="time" 
                          hide 
                        />
                        <YAxis 
                          stroke="rgba(255,255,255,0.2)" 
                          fontSize={10} 
                          tickFormatter={(val) => `${val}%`}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#161616', border: '1px solid #2d2d2d', borderRadius: '8px', fontSize: '12px' }}
                          itemStyle={{ color: '#fff' }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="cpu" 
                          stroke="#00d1ff" 
                          fillOpacity={1} 
                          fill="url(#colorCpu)" 
                          strokeWidth={3}
                          isAnimationActive={false}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="ram" 
                          stroke="#38e11d" 
                          fillOpacity={1} 
                          fill="url(#colorRam)" 
                          strokeWidth={3}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Console Output */}
                <div className="bg-black border border-[#2d2d2d] rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[400px]">
                   <div className="bg-[#1a1a1a] px-6 py-4 border-b border-[#2d2d2d] flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-500">
                         <Terminal size={14} />
                         <span className="text-[10px] font-black uppercase tracking-[0.2em]">Console do Servidor</span>
                      </div>
                      <div className="flex gap-1.5">
                         <div className="w-2 h-2 rounded-full bg-[#ff3e3e]/30" />
                         <div className="w-2 h-2 rounded-full bg-amber-500/30" />
                         <div className="w-2 h-2 rounded-full bg-[#38e11d]/30" />
                      </div>
                   </div>
                   <div className="p-6 font-mono text-sm overflow-y-auto flex-1 custom-scrollbar text-green-400 opacity-80">
                      {logs.length === 0 && <div className="text-slate-600 italic">Aguardando saída do servidor...</div>}
                      {logs.map((log, i) => (
                        <p key={i} className="mb-1 leading-relaxed">
                          <span className="text-slate-600 mr-3">[{new Date().toLocaleTimeString()}]</span>
                          <span className="whitespace-pre-wrap">{log}</span>
                        </p>
                      ))}
                      <div ref={consoleEndRef} />
                   </div>
                   <div className="px-6 py-4 bg-black border-t border-[#2d2d2d] flex gap-3 items-center">
                      <span className="text-[#38e11d] font-bold text-lg select-none">&gt;</span>
                      <form onSubmit={sendCommand} className="flex-1">
                        <input 
                          type="text" 
                          className="bg-transparent border-none outline-none w-full text-slate-300 font-mono text-sm" 
                          placeholder="Digite um comando para o servidor..."
                          disabled={status !== 'running'}
                          value={command}
                          onChange={(e) => setCommand(e.target.value)}
                        />
                      </form>
                   </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="files"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-[#161616] border border-[#2d2d2d] rounded-2xl overflow-hidden shadow-xl flex flex-col h-[750px]"
              >
                <div className="bg-[#1a1a1a] px-6 py-4 border-b border-[#2d2d2d] flex items-center justify-between">
                   <div className="flex items-center gap-4">
                      <button 
                        onClick={handleFileAction.goBack}
                        disabled={currentPath === "."}
                        className="p-2 hover:bg-white/5 rounded-lg disabled:opacity-20 transition-colors"
                      >
                         <ArrowLeft size={16} />
                      </button>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Diretório Atual</span>
                        <span className="text-xs font-mono text-white/80">{currentPath}</span>
                      </div>
                   </div>
                   <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setIsCreating('file')}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#38e11d]/10 text-[#38e11d] border border-[#38e11d]/20 rounded-lg text-[10px] font-black uppercase hover:bg-[#38e11d]/20 transition-all"
                      >
                        <Plus size={12} /> arquivo
                      </button>
                      <button 
                        onClick={() => setIsCreating('folder')}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#00d1ff]/10 text-[#00d1ff] border border-[#00d1ff]/20 rounded-lg text-[10px] font-black uppercase hover:bg-[#00d1ff]/20 transition-all"
                      >
                        <Plus size={12} /> pasta
                      </button>
                   </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                   {isCreating && (
                     <div className="p-4 bg-white/5 rounded-xl border border-white/10 mb-4 flex gap-4">
                        <input 
                          autoFocus
                          type="text" 
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder={`Nome do ${isCreating === 'file' ? 'arquivo' : 'pasta'}...`}
                          className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-xs flex-1 outline-none text-white focus:border-[#38e11d]/50"
                        />
                        <button onClick={handleFileAction.create} className="px-4 py-2 bg-[#38e11d] text-black rounded-lg text-[10px] font-black uppercase">Criar</button>
                        <button onClick={() => setIsCreating(null)} className="px-4 py-2 hover:bg-white/5 text-white/50 text-[10px] font-black uppercase">Cancelar</button>
                     </div>
                   )}

                   <div className="grid grid-cols-1 gap-1">
                      {fileList.sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name)).map(file => (
                        <div 
                          key={file.name}
                          className="group flex items-center justify-between p-3 rounded-xl hover:bg-white/[0.03] border border-transparent hover:border-white/5 transition-all text-sm"
                        >
                           <button 
                             onClick={() => handleFileAction.open(file)}
                             className="flex items-center gap-4 flex-1 text-left"
                           >
                              <div className={cn(
                                "w-10 h-10 rounded-lg flex items-center justify-center",
                                file.isDirectory ? "bg-[#38e11d]/10 text-[#38e11d]" : "bg-blue-500/10 text-blue-400"
                              )}>
                                 {file.isDirectory ? <Folder size={18} /> : <FileIcon size={18} />}
                              </div>
                              <div className="flex flex-col">
                                 <span className="font-bold text-white/90 group-hover:text-white">{file.name}</span>
                                 <span className="text-[10px] text-slate-500 uppercase font-medium">
                                   {file.isDirectory ? "Pasta" : `${(file.size / 1024).toFixed(1)} KB`} • {new Date(file.mtime).toLocaleDateString()}
                                 </span>
                              </div>
                           </button>
                           <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              {!file.isDirectory && (
                                <button 
                                  onClick={() => handleFileAction.open(file)}
                                  className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"
                                >
                                  <Edit size={16} />
                                </button>
                              )}
                              <button 
                                onClick={() => handleFileAction.delete(file)}
                                className="p-2 hover:bg-red-500/20 rounded-lg text-red-500/50 hover:text-red-400"
                              >
                                 <Trash2 size={16} />
                              </button>
                           </div>
                        </div>
                      ))}
                      {fileList.length === 0 && !isCreating && (
                        <div className="py-20 text-center text-slate-600 italic">Este diretório está vazio</div>
                      )}
                   </div>
                </div>

                {editingFile && (
                  <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8">
                     <motion.div 
                       initial={{ scale: 0.95, opacity: 0 }}
                       animate={{ scale: 1, opacity: 1 }}
                       className="bg-[#161616] border border-[#2d2d2d] rounded-2xl w-full max-w-5xl h-[80vh] flex flex-col shadow-2xl overflow-hidden"
                     >
                        <div className="px-6 py-4 border-b border-[#2d2d2d] bg-[#1a1a1a] flex items-center justify-between">
                           <div className="flex items-center gap-3">
                              <FileIcon size={18} className="text-[#38e11d]" />
                              <span className="text-sm font-bold text-white truncate">{editingFile.path}</span>
                           </div>
                           <div className="flex gap-2">
                              <button 
                                onClick={handleFileAction.save}
                                className="flex items-center gap-2 px-4 py-2 bg-[#38e11d] text-black rounded-lg text-[10px] font-black uppercase shadow-lg shadow-[#38e11d]/10 hover:bg-[#4cf531] transition-all"
                              >
                                <Save size={14} /> Salvar
                              </button>
                              <button 
                                onClick={() => setEditingFile(null)}
                                className="p-2 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white transition-colors"
                              >
                                <X size={20} />
                              </button>
                           </div>
                        </div>
                        <div className="flex-1 bg-black/40 p-4 font-mono text-sm">
                           <textarea 
                             className="w-full h-full bg-transparent border-none outline-none text-slate-300 resize-none custom-scrollbar"
                             value={editingFile.content}
                             onChange={(e) => setEditingFile({ ...editingFile, content: e.target.value })}
                           />
                        </div>
                     </motion.div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Files & Tools */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* File Management */}
          <div className="bg-[#161616] border border-[#2d2d2d] rounded-2xl p-6 shadow-xl flex flex-col min-h-[460px]">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-6">Configuração Local</h3>
            
            <div className="flex-1 flex flex-col">
               <label className={cn(
                 "relative cursor-pointer flex-1 flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl transition-all duration-300 bg-[#1c1c1c] group",
                 isUploading 
                    ? "border-[#38e11d]/50 bg-[#38e11d]/5" 
                    : "border-[#2d2d2d] hover:border-[#38e11d]"
               )}>
                  <input type="file" className="hidden" accept=".jar" onChange={handleFileUpload} disabled={isUploading} />
                  <div className={cn(
                    "w-16 h-16 rounded-full bg-[#242424] flex items-center justify-center mb-4 transition-all duration-300 group-hover:bg-[#38e11d] group-hover:text-black",
                    isUploading && "animate-spin"
                  )}>
                    <Upload size={24} className={isUploading ? "text-emerald-500" : "text-white/40"} />
                  </div>
                  <h4 className="font-bold mb-1 text-white uppercase tracking-tight">Anexar Arquivo</h4>
                  <p className="text-xs text-slate-500">Arraste o arquivo .jar do seu servidor aqui</p>
                  <button className="mt-6 w-full py-3 bg-[#2d2d2d] rounded-lg text-[11px] font-black uppercase hover:bg-[#3d3d3d] transition-colors">
                    Explorar Arquivos
                  </button>
               </label>

               <div className="mt-8 space-y-4">
                  <span className="text-[10px] uppercase font-bold text-slate-500 tracking-[0.2em]">Executável Selecionado</span>
                  
                  <div className="p-4 bg-black/50 rounded-xl border border-[#2d2d2d]">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-10 h-10 shrink-0 rounded bg-[#2d2d2d] flex items-center justify-center text-slate-400 font-mono text-[10px] font-bold uppercase">
                        jar
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-sm font-bold truncate text-white">{currentJar || "Nenhum selecionado"}</p>
                        <p className="text-[9px] text-slate-600 truncate uppercase tracking-widest mt-0.5">MinePanel/Binários/</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => handleStart()}
                      disabled={status !== 'stopped'}
                      className="py-4 bg-[#38e11d] text-black font-black text-xs rounded-xl uppercase shadow-lg shadow-[#38e11d]/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-30 disabled:hover:scale-100"
                    >
                      Reiniciar
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTab('files');
                        fetchFiles(".");
                      }}
                      className="py-4 bg-[#242424] text-white font-black text-xs rounded-xl uppercase border border-[#2d2d2d] hover:bg-[#2d2d2d] transition-colors"
                    >
                      Arquivos
                    </button>
                  </div>
               </div>
            </div>
          </div>

          {/* IP Banner */}
          <div className="bg-gradient-to-br from-[#38e11d] to-[#00d1ff] rounded-2xl p-7 flex flex-col justify-center text-black shadow-xl">
             <p className="text-[10px] font-black uppercase tracking-[0.3em] mb-1 opacity-60">IP de Acesso</p>
             <p className="text-2xl font-black italic tracking-tighter">192.168.1.30:25565</p>
          </div>

          <div className="bg-[#161616] border border-[#2d2d2d] rounded-2xl p-6">
             <div className="flex items-center gap-2 mb-4">
                <Settings size={14} className="text-[#38e11d]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Motor: OpenJDK Hotspot</span>
             </div>
             <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                Servidor rodando em ambiente local sandbox. A latência é otimizada para o hardware atual.
             </p>
          </div>
        </div>
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700;800;900&display=swap');
        
        body {
          font-family: 'Inter', sans-serif;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 20px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(16, 185, 129, 0.2);
        }
      `}</style>
    </div>
  );
}

function MetricCard({ label, value, icon, subLabel, color, percentage, className }: any) {
  return (
    <div className={cn(
      "bg-[#161616] p-6 rounded-2xl border border-[#2d2d2d] shadow-xl hover:bg-[#1c1c1c] transition-all group overflow-hidden relative", 
      className
    )}>
      <div className="flex justify-between items-start mb-4 relative z-10">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</span>
        <span className="text-xs font-mono font-bold" style={{ color }}>{percentage}%</span>
      </div>
      <div className="text-4xl font-black mb-4 italic text-white flex items-baseline gap-1 relative z-10">
        {value.includes('/') ? (
          <>
            {value.split('/')[0]}
            <span className="text-lg text-slate-500">/{value.split('/')[1]}</span>
          </>
        ) : (
          value
        )}
      </div>
      <div className="w-full bg-[#242424] h-2 rounded-full overflow-hidden relative z-10 p-0.5 border border-white/5">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className="h-full rounded-full shadow-[0_0_8px_rgba(255,255,255,0.1)]"
          style={{ backgroundColor: color }}
        />
      </div>
      
      {/* Decorative background icon */}
      <div className="absolute -bottom-4 -right-4 opacity-5 group-hover:opacity-10 transition-opacity">
         {React.cloneElement(icon as React.ReactElement, { size: 80 })}
      </div>
    </div>
  );
}

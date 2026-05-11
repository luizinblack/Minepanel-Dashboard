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
  PackageOpen,
  Archive,
  X,
  Download,
  ScrollText,
  RotateCcw,
  Search
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
  cpu: {
    usage: number;
    cores: number;
    temp: number;
  };
  ram: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  gpu: {
    name: string;
    usage: number;
    temp: number;
    memoryUsed: number;
    memoryTotal: number;
  } | null;
  uptime: number;
  timestamp: string;
}

type JobStatus =
  | "UPLOADING"
  | "UPLOADED"
  | "VALIDATING"
  | "QUEUED"
  | "DOWNLOADING"
  | "INSTALLING"
  | "EXTRACTING"
  | "DETECTING"
  | "CONFIGURING"
  | "STARTING"
  | "DONE"
  | "FAILED";

interface ServerJob {
  id: string;
  filename: string;
  filePath: string;
  outputPath: string;
  status: JobStatus;
  hash?: string;
  createdAt: number;
  error?: string;
  progress?: number;
}

export default function App() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsHistory, setStatsHistory] = useState<any[]>([]);
  const [jobs, setJobs] = useState<ServerJob[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running' | 'stopping'>('stopped');
  const [hasScript, setHasScript] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [currentJar, setCurrentJar] = useState<string>("");
  const [availableJars, setAvailableJars] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'monitor' | 'files' | 'console' | 'marketplace'>('monitor');
  const [currentPath, setCurrentPath] = useState<string>(".");
  const [fileList, setFileList] = useState<any[]>([]);
  const [editingFile, setEditingFile] = useState<{ path: string, content: string } | null>(null);
  const [isCreating, setIsCreating] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState("");
  const [command, setCommand] = useState("");
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  
  // Marketplace States
  const [marketQuery, setMarketQuery] = useState("");
  const [marketProjects, setMarketProjects] = useState<any[]>([]);
  const [isSearchingMarket, setIsSearchingMarket] = useState(false);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [projectVersions, setProjectVersions] = useState<any[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  
  const [marketPage, setMarketPage] = useState(1);
  const [hasMoreMarket, setHasMoreMarket] = useState(true);
  const [marketFilterLoader, setMarketFilterLoader] = useState("");
  const [marketFilterVersion, setMarketFilterVersion] = useState("");
  const [syncStatus, setSyncStatus] = useState<{ isSyncing: boolean, lastSync: number }>({ isSyncing: false, lastSync: 0 });

  const marketObserver = useRef<IntersectionObserver | null>(null);
  const marketLastElementRef = useRef<HTMLDivElement | null>(null);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);

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
          setHasScript(data.hasScript);
        });
    } catch (e) {
      console.warn("API status fetch failed (expected if server hasn't restarted yet)");
    }

    socket.on('system_metrics', (newMetrics: SystemStats) => {
      setStats(newMetrics);
      setStatsHistory(prev => {
        const cpuVal = newMetrics.cpu.usage;
        const ramVal = newMetrics.ram.percent;
        const next = [...prev, {
          time: new Date(newMetrics.timestamp).toLocaleTimeString(),
          cpu: cpuVal,
          ram: ramVal
        }].slice(-30);
        return next;
      });
    });

    socket.on('status_change', (data: { status: any }) => {
      setStatus(data.status);
    });

    socket.on('console_log', (log: string) => {
      setLogs(prev => [...prev, log].slice(-200));
    });

    socket.on('job_update', (updatedJob: ServerJob) => {
      setJobs(prev => {
        const index = prev.findIndex(j => j.id === updatedJob.id);
        if (index !== -1) {
          const next = [...prev];
          next[index] = updatedJob;
          return next;
        }
        return [...prev, updatedJob].slice(-10);
      });
    });

    socket.on('refresh_data', () => {
      fetch('/api/status')
        .then(res => res.json())
        .then(data => {
          setCurrentJar(data.jar);
          setAvailableJars(data.availableJars);
          setHasScript(data.hasScript);
        });
      fetchFiles(currentPath);
      fetch('/api/admin/logs').then(res => res.json()).then(setAuditLogs).catch(() => {});
    });

    // Initial audit logs fetch
    fetch('/api/admin/logs').then(res => res.json()).then(setAuditLogs).catch(() => {});

    // Initial data fetch
    const fetchInitialData = async () => {
      try {
        const [statusRes, jobsRes] = await Promise.all([
          fetch('/api/status'),
          fetch('/api/jobs')
        ]);
        
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setStatus(statusData.status);
          setCurrentJar(statusData.jar);
          setAvailableJars(statusData.availableJars);
          setHasScript(statusData.hasScript);
        }
        
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          setJobs(jobsData);
        }

        // Fetch initial logs
        const logsRes = await fetch('/api/logs');
        if (logsRes.ok) {
          const logsData = await logsRes.json();
          if (logsData.content) {
            setLogs(logsData.content.split('\n').filter((l: string) => l.length > 0));
          }
        }
      } catch (e) {
        console.warn("Initial data fetch failed");
      }
    };

    fetchInitialData();

    // Check Sync Status periodically
    const syncInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/marketplace/sync/status');
        if (res.ok) setSyncStatus(await res.json());
      } catch (e) {}
    }, 10000);

    return () => {
      socket.off('system_stats');
      socket.off('status_change');
      socket.off('console_log');
      socket.off('job_update');
      clearInterval(syncInterval);
    };
  }, []);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleStart = async () => {
    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const uploadChunked = async (file: File, relativePath: string = "") => {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const filename = file.name;
    const PARALLEL_UPLOADS = 3;
    let uploadedChunks = 0;

    // Helper to upload a single chunk
    const uploadChunk = async (i: number) => {
      if (i >= totalChunks) return;

      let success = false;
      let retries = 3;

      while (!success && retries > 0) {
        try {
          const start = i * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const chunk = file.slice(start, end);

          const formData = new FormData();
          formData.append('chunk', chunk);
          formData.append('filename', filename);
          formData.append('chunkIndex', i.toString());
          formData.append('totalChunks', totalChunks.toString());
          formData.append('relPath', relativePath); // Send the directory path

          const res = await fetch('/api/upload/chunk', {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) throw new Error(`Status ${res.status}`);
          success = true;
        } catch (err) {
          retries--;
          if (retries === 0) throw err;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      
      uploadedChunks++;
      // We don't update global progress here if we are doing multiple files
      // but we could if we wanted to.
      await uploadChunk(i + PARALLEL_UPLOADS);
    };

    const pool = [];
    for (let i = 0; i < Math.min(PARALLEL_UPLOADS, totalChunks); i++) {
      pool.push(uploadChunk(i));
    }
    await Promise.all(pool);

    const finalizeRes = await fetch('/api/upload/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, totalChunks, relPath: relativePath }),
    });

    if (!finalizeRes.ok) {
      const data = await finalizeRes.json();
      throw new Error(data.error || "Erro ao finalizar upload");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      await uploadChunked(file);
      setUploadProgress(100);
    } catch (err: any) {
      console.error(err);
      alert("Falha no upload: " + err.message);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (e.target) e.target.value = '';
    }
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    const totalFiles = files.length;
    let processedCount = 0;

    try {
      // For folder uploads, we process files one by one to keep it stable, 
      // but each file gets chunked if large.
      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        const fullPath = (file as any).webkitRelativePath || file.name;
        const relativeDir = fullPath.includes('/') ? fullPath.substring(0, fullPath.lastIndexOf('/')) : '';
        
        await uploadChunked(file, relativeDir);
        
        processedCount++;
        setUploadProgress(Math.round((processedCount / totalFiles) * 100));
      }

      alert(`PASTA ENVIADA: ${processedCount}/${totalFiles} arquivos processados.`);
    } catch (err: any) {
      console.error(err);
      alert("Erro fatal no upload da pasta: " + err.message);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (e.target) e.target.value = '';
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
    extract: async (file: any) => {
      try {
        setIsUploading(true);
        const res = await fetch('/api/files/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, currentPath }),
        });
        const data = await res.json();
        if (!res.ok) {
          alert("Erro ao adicionar na fila: " + data.error);
        }
      } catch (err) {
        console.error(err);
        alert("Erro ao conectar com o servidor.");
      } finally {
        setIsUploading(false);
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

  const clearLogs = async () => {
    try {
      const res = await fetch('/api/logs/clear', { method: 'POST' });
      if (res.ok) {
        setLogs([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const marketplaceActions = {
    search: async (e?: React.FormEvent, reset: boolean = true) => {
      e?.preventDefault();
      
      const newPage = reset ? 1 : marketPage + 1;
      if (reset) {
        setIsSearchingMarket(true);
        setMarketProjects([]);
        setMarketPage(1);
      }
      
      try {
        const params = new URLSearchParams({
          q: marketQuery,
          page: newPage.toString(),
          limit: "20",
          loader: marketFilterLoader,
          version: marketFilterVersion
        });
        
        const res = await fetch(`/api/marketplace/search?${params.toString()}`);
        const data = await res.json();
        
        if (reset) {
          setMarketProjects(data.projects || []);
        } else {
          setMarketProjects(prev => [...prev, ...(data.projects || [])]);
        }
        
        setHasMoreMarket(data.hasMore);
        setMarketPage(newPage);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearchingMarket(false);
      }
    },
    triggerSync: async () => {
      await fetch('/api/marketplace/sync/start', { method: 'POST' });
      alert("Sincronização forçada iniciada!");
    },
    selectProject: async (project: any) => {
      setSelectedProject(project);
      setIsLoadingVersions(true);
      try {
        const res = await fetch(`/api/marketplace/versions?id=${project.id}&provider=${project.provider}`);
        const data = await res.json();
        setProjectVersions(data.versions || []);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoadingVersions(false);
      }
    },
    install: async (version: any) => {
      if (!selectedProject) return;
      
      if (!confirm(`Deseja instalar o modpack "${selectedProject.title}" na versão "${version.name}"? Isso pode sobrescrever arquivos existentes.`)) return;

      try {
        const res = await fetch('/api/marketplace/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedProject.id,
            versionId: version.id,
            provider: selectedProject.provider,
            title: selectedProject.title,
            downloadUrl: selectedProject.provider === 'modrinth' 
              ? version.files.find((f: any) => f.primary)?.url || version.files[0].url 
              : version.download_url
          })
        });
        const data = await res.json();
        if (res.ok) {
          alert("Instalação iniciada! Acompanhe o progresso na barra lateral de jobs.");
          setSelectedProject(null);
        } else {
          alert("Erro: " + data.error);
        }
      } catch (err) {
        console.error(err);
        alert("Erro ao conectar com o servidor.");
      }
    }
  };

  // Infinite Scroll Observer
  useEffect(() => {
    if (activeTab !== 'marketplace' || isSearchingMarket || !hasMoreMarket) return;

    if (marketObserver.current) marketObserver.current.disconnect();

    marketObserver.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        marketplaceActions.search(undefined, false);
      }
    });

    if (marketLastElementRef.current) marketObserver.current.observe(marketLastElementRef.current);
    
    return () => marketObserver.current?.disconnect();
  }, [marketProjects, activeTab, isSearchingMarket, hasMoreMarket]);

  // Initial marketplace load
  useEffect(() => {
    if (activeTab === 'marketplace' && marketProjects.length === 0) {
      marketplaceActions.search();
    }
  }, [activeTab]);

  const downloadLogs = () => {
    const element = document.createElement("a");
    const file = new Blob([logs.join('\n')], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = "server_latest.log";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-[#E1E1E6] font-sans selection:bg-[#38e11d]/30">
      {/* Grid Pattern Overlay */}
      <div className="fixed inset-0 bg-[radial-gradient(#1A1A1C_1px,transparent_1px)] [background-size:20px_20px] opacity-10 pointer-events-none" />

      {/* Top Header */}
      <header className="relative z-10 border-b border-[#2d2d2d] bg-[#1a1a1a] h-16">
        <div className="max-w-full mx-auto px-4 md:px-8 h-full flex items-center justify-between">
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
            <div className="flex items-center gap-2 group relative">
              <HealthDot serverStatus={status} stats={stats} />
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

      <main className="relative z-10 max-w-full mx-auto px-4 md:px-12 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
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
            <button 
              onClick={() => setActiveTab('console')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeTab === 'console' ? "bg-[#38e11d] text-black" : "text-slate-500 hover:text-white"
              )}
            >
              Console do Servidor
            </button>
            <button 
              onClick={() => setActiveTab('marketplace')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeTab === 'marketplace' ? "bg-[#38e11d] text-black" : "text-slate-500 hover:text-white"
              )}
            >
              <Archive size={12} /> Marketplace
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
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <MetricCard 
                    label="CPU" 
                    value={`${stats?.cpu.usage ?? 0}%`} 
                    icon={<Cpu className="text-[#00d1ff]" size={16} />}
                    subLabel={`${stats?.cpu.cores ?? 0} Cores / ${stats?.cpu.temp ?? 0}°C`}
                    color="#00d1ff"
                    percentage={stats?.cpu.usage ?? 0}
                  />
                  <MetricCard 
                    label="RAM" 
                    value={`${stats?.ram.used ?? 0}/${stats?.ram.total ?? 0}GB`} 
                    icon={<Database className="text-[#38e11d]" size={16} />}
                    subLabel={`${stats?.ram.free ?? 0}GB Livres`}
                    color="#38e11d"
                    percentage={stats?.ram.percent ?? 0}
                  />
                  <MetricCard 
                    label="GPU" 
                    value={stats?.gpu ? `${stats.gpu.usage}%` : "Inativa"} 
                    icon={<Activity className="text-[#bd00ff]" size={16} />}
                    subLabel={stats?.gpu ? stats.gpu.name : "Monitorando..."}
                    color="#bd00ff"
                    percentage={stats?.gpu?.usage ?? 0}
                  />
                  <MetricCard 
                    label="Uptime" 
                    value={stats?.uptime ? (stats.uptime / 3600).toFixed(1) + "h" : "0.0h"} 
                    icon={<RotateCcw className="text-amber-500" size={16} />}
                    subLabel="Tempo Online"
                    color="#f59e0b"
                    percentage={Math.min((stats?.uptime || 0) / 3600, 100)}
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
                  
                  <div className="h-[300px] w-full relative z-10">
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
                <div className="bg-black border border-[#2d2d2d] rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[500px]">
                   <div className="bg-[#1a1a1a] px-6 py-4 border-b border-[#2d2d2d] flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-500">
                         <Terminal size={14} />
                         <span className="text-[10px] font-black uppercase tracking-[0.2em]">Live Output</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setActiveTab('console')}
                          className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded-md text-[9px] font-bold uppercase tracking-wider text-slate-400"
                        >
                          Tela Cheia
                        </button>
                         <div className="flex gap-1.5 ml-2">
                            <div className="w-2 h-2 rounded-full bg-[#ff3e3e]/30" />
                            <div className="w-2 h-2 rounded-full bg-amber-500/30" />
                            <div className="w-2 h-2 rounded-full bg-[#38e11d]/30" />
                         </div>
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

                {/* Audit Logs Section */}
                <div className="bg-[#161616] border border-[#2d2d2d] rounded-2xl overflow-hidden shadow-xl">
                  <div className="bg-[#1a1a1a] px-6 py-4 border-b border-[#2d2d2d] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <div className="w-1 h-3 bg-amber-500 rounded-full" />
                       <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">Auditoria de Eventos</h3>
                    </div>
                    <button 
                      onClick={() => fetch('/api/admin/logs').then(res => res.json()).then(setAuditLogs)}
                      className="text-[10px] font-bold text-slate-500 hover:text-white uppercase transition-colors"
                    >
                      Atualizar
                    </button>
                  </div>
                  <div className="p-4 max-h-[300px] overflow-y-auto custom-scrollbar space-y-2">
                    {auditLogs.length === 0 ? (
                      <div className="text-center py-8 text-slate-600 text-xs italic">Nenhum evento registrado recentemente.</div>
                    ) : (
                      auditLogs.map((log, idx) => (
                        <div key={idx} className="flex gap-4 p-3 bg-black/20 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                          <div className={cn(
                            "w-1 self-stretch rounded-full shrink-0",
                            log.level === 'error' ? "bg-red-500" : log.level === 'warn' ? "bg-amber-500" : "bg-[#38e11d]"
                          )} />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase text-white tracking-widest">{log.message}</span>
                              <span className="text-[8px] font-mono text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                            </div>
                            {log.details && (
                              <p className="text-[9px] text-slate-400 font-mono line-clamp-1">{JSON.stringify(log.details)}</p>
                            )}
                          </div>
                        </div>
                      )).reverse()
                    )}
                  </div>
                </div>
              </motion.div>
            ) : activeTab === 'console' ? (
              <motion.div 
                key="console"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-black border border-[#2d2d2d] rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[850px]"
              >
                  <div className="bg-[#1a1a1a] px-6 py-4 border-b border-[#2d2d2d] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Terminal size={18} className="text-[#38e11d]" />
                        <h2 className="text-sm font-black text-white italic uppercase tracking-wider">Interface de Comando Terminal</h2>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={downloadLogs}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-[10px] font-black uppercase transition-all"
                      >
                        <Download size={14} /> Baixar Logs
                      </button>
                      <button 
                        onClick={clearLogs}
                        className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-[10px] font-black uppercase transition-all"
                      >
                        <RotateCcw size={14} /> Limpar
                      </button>
                    </div>
                  </div>
                  
                  <div className="p-8 font-mono text-sm overflow-y-auto flex-1 custom-scrollbar bg-black/60">
                    <div className="max-w-4xl mx-auto space-y-1">
                      {logs.length === 0 && <div className="text-slate-700 italic border-l-2 border-slate-800 pl-4 py-2">Sem atividade no log no momento...</div>}
                      {logs.map((log, i) => {
                        const isError = log.includes('[ERROR]') || log.toLowerCase().includes('error') || log.toLowerCase().includes('fail');
                        const isWarn = log.toLowerCase().includes('warn');
                        const isInfo = log.includes('[MineControl]');
                        
                        return (
                          <div key={i} className={cn(
                            "group flex gap-4 py-0.5 border-l-2 whitespace-pre-wrap transition-colors",
                            isError ? "border-red-500/50 bg-red-500/5" : 
                            isWarn ? "border-amber-500/50 bg-amber-500/5" :
                            isInfo ? "border-[#38e11d]/50 bg-[#38e11d]/5" :
                            "border-transparent hover:bg-white/5"
                          )}>
                            <span className="text-[10px] text-slate-700 shrink-0 select-none w-20 text-right opacity-30 group-hover:opacity-100 italic">
                              {(i + 1).toString().padStart(4, '0')}
                            </span>
                            <span className={cn(
                              "flex-1",
                              isError ? "text-red-400" : 
                              isWarn ? "text-amber-400" :
                              isInfo ? "text-indigo-400 font-bold" :
                              "text-green-400/80"
                            )}>
                              {log}
                            </span>
                          </div>
                        );
                      })}
                      <div ref={consoleEndRef} />
                    </div>
                  </div>

                  <div className="px-8 py-6 bg-[#0a0a0a] border-t border-[#2d2d2d] flex gap-4 items-center">
                    <div className="flex h-10 w-10 items-center justify-center bg-[#38e11d]/10 rounded-lg border border-[#38e11d]/20">
                      <span className="text-[#38e11d] font-black text-xl select-none">$</span>
                    </div>
                    <form onSubmit={sendCommand} className="flex-1">
                      <input 
                        type="text" 
                        className="bg-transparent border-none outline-none w-full text-white font-mono text-base placeholder:text-slate-700" 
                        placeholder="Insira um comando direto para o runtime do servidor..."
                        autoFocus
                        disabled={status !== 'running'}
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                      />
                    </form>
                    <div className="text-[10px] text-slate-600 font-bold uppercase tracking-widest hidden md:block">
                      Pressione ENTER para enviar
                    </div>
                  </div>
              </motion.div>
            ) : activeTab === 'marketplace' ? (
              <motion.div 
                key="marketplace"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col gap-6 h-[calc(100vh-140px)] pt-2"
              >
                {/* Fixed Search Area */}
                <div className="bg-[#161616] border border-[#2d2d2d] rounded-2xl p-8 shadow-xl relative overflow-hidden shrink-0">
                  {/* Sync Indicator */}
                  <div className="absolute top-4 right-4 flex items-center gap-2">
                    {syncStatus.isSyncing && (
                      <div className="flex items-center gap-2 px-3 py-1 bg-[#38e11d]/10 border border-[#38e11d]/20 rounded-full animate-pulse">
                        <RotateCcw size={10} className="text-[#38e11d] animate-spin" />
                        <span className="text-[8px] font-black uppercase text-[#38e11d] tracking-widest">Sincronizando Database...</span>
                      </div>
                    )}
                    {!syncStatus.isSyncing && syncStatus.lastSync > 0 && (
                      <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">
                        Última Sinc: {new Date(syncStatus.lastSync).toLocaleTimeString()}
                      </span>
                    )}
                    <button 
                      onClick={marketplaceActions.triggerSync}
                      className="p-1.5 hover:bg-white/5 rounded-lg text-slate-600 hover:text-white transition-colors"
                      title="Sincronizar Manualmente"
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>

                  <div className="max-w-4xl mx-auto text-center space-y-4">
                    <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter">Marketplace de Modpacks</h2>
                    
                    <form onSubmit={(e) => marketplaceActions.search(e, true)} className="relative mt-4 group">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-[#38e11d] transition-colors" size={20} />
                      <input 
                        type="text" 
                        value={marketQuery}
                        onChange={(e) => setMarketQuery(e.target.value)}
                        placeholder="Procure por 'Better Minecraft', 'All the Mods'..."
                        className="w-full bg-black/40 border border-[#2d2d2d] rounded-xl pl-12 pr-32 py-4 text-white outline-none focus:border-[#38e11d]/50 transition-all font-medium"
                      />
                      <button 
                        type="submit"
                        disabled={isSearchingMarket}
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#38e11d] text-black px-6 py-2 rounded-lg font-black text-xs uppercase hover:bg-[#4cf531] disabled:opacity-50 transition-all"
                      >
                        {isSearchingMarket ? 'Buscando...' : 'Pesquisar'}
                      </button>
                    </form>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
                  {/* Horizontal Categories Bar - Sticky at the top of scrollable area */}
                  <div className="sticky top-0 z-20 pb-4 pt-1 bg-[#0c0c0c]/90 backdrop-blur-md space-y-3">
                    <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar scroll-smooth">
                      {['Tudo', 'RPG', 'Adventure', 'Tech', 'Magic', 'Hardcore', 'Skyblock', 'Quest', 'Vanilla+', 'Cobblemon', 'Horror', 'Expert', 'Multiplayer'].map(cat => (
                        <button 
                          key={cat}
                          onClick={() => {
                            setMarketQuery(cat === 'Tudo' ? "" : cat.toLowerCase());
                            setTimeout(() => marketplaceActions.search(undefined, true), 0);
                          }}
                          className={cn(
                            "grow shrink-0 px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border",
                            (marketQuery === cat.toLowerCase() || (cat === 'Tudo' && marketQuery === "")) 
                              ? "bg-[#38e11d] text-black border-[#38e11d] shadow-[0_0_15px_rgba(56,225,29,0.3)]" 
                              : "bg-[#161616] text-slate-400 border-[#2d2d2d] hover:border-[#38e11d]/50 hover:text-white"
                          )}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                      <div className="flex items-center gap-2 bg-[#161616] border border-[#2d2d2d] rounded-xl px-3 py-1.5 shrink-0">
                        <span className="text-[8px] font-black uppercase text-slate-500">Versão:</span>
                        <select 
                          value={marketFilterVersion}
                          onChange={(e) => {
                            setMarketFilterVersion(e.target.value);
                            setTimeout(() => marketplaceActions.search(undefined, true), 0);
                          }}
                          className="bg-transparent text-[10px] font-bold text-white outline-none cursor-pointer"
                        >
                          <option value="" className="bg-[#161616]">Todas</option>
                          <option value="1.21.1" className="bg-[#161616]">1.21.1</option>
                          <option value="1.20.1" className="bg-[#161616]">1.20.1</option>
                          <option value="1.19.2" className="bg-[#161616]">1.19.2</option>
                          <option value="1.18.2" className="bg-[#161616]">1.18.2</option>
                          <option value="1.16.5" className="bg-[#161616]">1.16.5</option>
                          <option value="1.12.2" className="bg-[#161616]">1.12.2</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2 bg-[#161616] border border-[#2d2d2d] rounded-xl px-3 py-1.5 shrink-0">
                        <span className="text-[8px] font-black uppercase text-slate-500">Loader:</span>
                        <select 
                          value={marketFilterLoader}
                          onChange={(e) => {
                            setMarketFilterLoader(e.target.value);
                            setTimeout(() => marketplaceActions.search(undefined, true), 0);
                          }}
                          className="bg-transparent text-[10px] font-bold text-white outline-none cursor-pointer"
                        >
                          <option value="" className="bg-[#161616]">Todos</option>
                          <option value="forge" className="bg-[#161616]">Forge</option>
                          <option value="fabric" className="bg-[#161616]">Fabric</option>
                        </select>
                      </div>

                      <button 
                        onClick={() => {
                          setMarketFilterVersion("");
                          setMarketFilterLoader("");
                          setMarketQuery("");
                          setTimeout(() => marketplaceActions.search(undefined, true), 0);
                        }}
                        className="shrink-0 text-[10px] font-black uppercase text-slate-600 hover:text-white transition-colors"
                      >
                        Resetar Tudo
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      {marketQuery ? `Resultados para "${marketQuery}"` : "Explorar Todos"}
                    </h3>
                  </div>

                  {/* Results Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
                  {marketProjects.map((project, idx) => {
                    const isLast = idx === marketProjects.length - 1;
                    return (
                      <motion.div 
                        key={`${project.provider}-${project.id}-${idx}`}
                        ref={isLast ? marketLastElementRef : null}
                        layoutId={`${project.provider}-${project.id}`}
                        className="bg-[#161616] border border-[#2d2d2d] rounded-2xl p-5 hover:border-[#38e11d]/30 transition-all flex flex-col gap-4 cursor-pointer group"
                        onClick={() => marketplaceActions.selectProject(project)}
                      >
                        <div className="flex gap-4">
                          <div className="w-16 h-16 bg-black/40 rounded-xl overflow-hidden shrink-0 border border-white/5 group-hover:border-[#38e11d]/20 transition-all">
                            {project.icon_url ? (
                              <img src={project.icon_url} alt={project.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Archive size={20} className="text-slate-700" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={cn(
                                "text-[8px] font-black uppercase px-2 py-0.5 rounded border",
                                project.provider === 'modrinth' ? "text-green-400 border-green-400/20 bg-green-400/5" : "text-orange-400 border-orange-400/20 bg-orange-400/5"
                              )}>
                                {project.provider}
                              </span>
                              <h4 className="font-black text-white truncate text-sm group-hover:text-[#38e11d] transition-colors tracking-tight">{project.title}</h4>
                            </div>
                            <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed h-10">{project.description}</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-4 border-t border-white/5">
                          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                            <span className="flex items-center gap-1"><Download size={12} /> {project.downloads.toLocaleString()}</span>
                          </div>
                          <div className="flex gap-1 overflow-hidden max-w-[80px]">
                            {project.loaders?.slice(0, 2).map((l: string) => (
                              <span key={l} className="text-[7px] bg-white/5 text-slate-400 px-1.5 py-0.5 rounded-full border border-white/5 uppercase font-black">{l}</span>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {isSearchingMarket && (
                  <div className="py-20 text-center space-y-4">
                    <RotateCcw className="mx-auto text-[#38e11d] animate-spin" size={32} />
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest animate-pulse">Explorando modpacks...</p>
                  </div>
                )}

                {marketProjects.length === 0 && !isSearchingMarket && (
                  <div className="py-20 text-center space-y-3 bg-[#161616] border border-[#2d2d2d] rounded-3xl">
                    <Archive size={40} className="mx-auto text-slate-800" />
                    <p className="text-slate-600 italic">Nenhum modpack encontrado em cache ou na busca.</p>
                    <button onClick={marketplaceActions.triggerSync} className="text-[#38e11d] text-xs font-bold uppercase border border-[#38e11d]/20 px-4 py-2 rounded-xl mt-4">Sincronizar Agora</button>
                  </div>
                )}

                {hasMoreMarket && !isSearchingMarket && marketProjects.length > 0 && (
                   <div className="py-8 flex justify-center">
                      <div className="w-8 h-8 rounded-full border-2 border-[#38e11d]/20 border-t-[#38e11d] animate-spin" />
                   </div>
                )}

                </div>

                {/* Project Details Modal */}
                <AnimatePresence>
                  {selectedProject && (
                    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8">
                       <motion.div 
                         initial={{ scale: 0.95, opacity: 0, y: 20 }}
                         animate={{ scale: 1, opacity: 1, y: 0 }}
                         exit={{ scale: 0.95, opacity: 0, y: 20 }}
                         className="bg-[#161616] border border-[#2d2d2d] rounded-3xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden"
                       >
                         {/* Modal Header */}
                         <div className="p-8 border-b border-[#2d2d2d] bg-[#1a1a1a] flex gap-8">
                            <div className="w-24 h-24 bg-black/40 rounded-2xl overflow-hidden shrink-0 shadow-xl border border-white/5">
                               {selectedProject.icon_url ? (
                                 <img src={selectedProject.icon_url} alt={selectedProject.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                               ) : (
                                 <div className="w-full h-full flex items-center justify-center"><Archive size={32} className="text-slate-700" /></div>
                               )}
                            </div>
                            <div className="flex-1 space-y-2">
                               <div className="flex items-center gap-3">
                                 <span className={cn(
                                   "text-[10px] font-black uppercase px-2 py-0.5 rounded border",
                                   selectedProject.provider === 'modrinth' ? "text-green-400 border-green-400/20 bg-green-400/5" : "text-orange-400 border-orange-400/20 bg-orange-400/5"
                                 )}>
                                   {selectedProject.provider}
                                 </span>
                                 <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">{selectedProject.title}</h2>
                               </div>
                               <p className="text-slate-400 text-sm leading-relaxed">{selectedProject.description}</p>
                            </div>
                            <button 
                              onClick={() => setSelectedProject(null)}
                              className="self-start p-2 hover:bg-white/5 rounded-full text-slate-500 hover:text-white transition-all"
                            >
                              <X size={24} />
                            </button>
                         </div>

                         {/* Version List */}
                         <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                            <div className="flex items-center justify-between mb-6">
                               <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#38e11d]">Selecione a Versão</h3>
                               <div className="text-[10px] font-bold text-slate-500 uppercase">Ordenado por data</div>
                            </div>

                            {isLoadingVersions ? (
                              <div className="py-20 text-center space-y-4">
                                <RotateCcw className="mx-auto text-[#38e11d] animate-spin" size={32} />
                                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest animate-pulse">Carregando versões disponíveis...</p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {projectVersions.map((version) => (
                                  <div 
                                    key={version.id}
                                    className="bg-black/30 border border-[#2d2d2d] rounded-2xl p-5 flex items-center justify-between group hover:border-[#38e11d]/40 transition-all border-l-4 border-l-transparent hover:border-l-[#38e11d]"
                                  >
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-3">
                                        <h5 className="font-bold text-white mb-0.5">{version.name}</h5>
                                        <div className="flex gap-1">
                                          {version.game_versions?.slice(0, 3).map((gv: string) => (
                                            <span key={gv} className="text-[8px] bg-white/5 text-slate-400 px-1.5 py-0.5 rounded uppercase font-bold">{gv}</span>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                        <span className="text-indigo-400">Minecraft {version.game_versions?.[0]}</span>
                                        {version.loaders?.length > 0 && (
                                          <span className="flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                            {version.loaders.join(', ')}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <button 
                                      onClick={() => marketplaceActions.install(version)}
                                      className="flex items-center gap-3 px-6 py-2.5 bg-[#38e11d] text-black rounded-xl font-black text-xs uppercase hover:bg-[#4cf531] transition-all shadow-lg active:scale-95 group-hover:shadow-[#38e11d]/20"
                                    >
                                      <Plus size={14} /> Instalar
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                         </div>
                       </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : (
              <motion.div 
                key="files"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-[#161616] border border-[#2d2d2d] rounded-2xl overflow-hidden shadow-xl flex flex-col h-[850px]"
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
                      {fileList.sort((a, b) => (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0) || a.name.localeCompare(b.name)).map(file => (
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
                           <div className="flex items-center gap-2">
                              {!file.isDirectory && file.name.endsWith('.zip') && (
                                <button 
                                  onClick={() => handleFileAction.extract(file)}
                                  className="flex items-center gap-2 px-3 py-1.5 bg-[#38e11d] text-black rounded-lg text-[11px] font-black uppercase hover:bg-[#38e11d]/80 transition-all shadow-[0_0_15px_rgba(56,225,29,0.5)] animate-pulse"
                                  title="Extrair agora e remover ZIP"
                                >
                                   <PackageOpen size={14} /> EXTRAIR AGORA
                                </button>
                              )}

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
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-6">Controle de Tarefas</h3>
            
            {/* Jobs Queue UI */}
            <div className="space-y-3 mb-6">
              {jobs.filter(j => j.status !== 'DONE' && j.status !== 'FAILED').length > 0 ? (
                (jobs.filter(j => j.status !== 'DONE' && j.status !== 'FAILED') as ServerJob[]).map(job => (
                  <JobCard key={job.id} job={job} />
                ))
              ) : (
                <div className="py-8 border border-dashed border-[#2d2d2d] rounded-xl flex flex-col items-center justify-center">
                  <PackageOpen size={24} className="text-slate-700 mb-2" />
                  <p className="text-[10px] uppercase font-bold text-slate-600 tracking-widest">Nenhuma tarefa ativa</p>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col">
               <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-4">
                 <div className="flex gap-3">
                   <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                     <Activity size={14} className="text-amber-500" />
                   </div>
                   <div>
                     <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">Aviso Importante</p>
                     <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                       Renomeie seu arquivo <span className="text-[#38e11d] font-bold">.bat</span> para <span className="text-white bg-white/5 px-1 font-mono">start_server.bat</span> para o painel conseguir ligar o servidor.
                     </p>
                   </div>
                 </div>
               </div>

                <div className="flex gap-4">
                 <label className={cn(
                   "relative cursor-pointer flex-1 flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl transition-all duration-300 bg-[#1c1c1c] group",
                   isUploading 
                      ? "border-[#38e11d]/50 bg-[#38e11d]/5" 
                      : "border-[#2d2d2d] hover:border-[#38e11d]"
                 )}>
                    <input type="file" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
                    <div className={cn(
                      "w-16 h-16 rounded-full bg-[#242424] flex items-center justify-center mb-4 transition-all duration-300 group-hover:bg-[#38e11d] group-hover:text-black",
                      isUploading && "animate-pulse"
                    )}>
                      <Upload size={24} className={isUploading ? "text-[#38e11d]" : "text-white/40"} />
                    </div>
                    <h4 className="font-bold mb-1 text-white uppercase tracking-tight">
                      {isUploading ? "SUBINDO..." : "ARQUIVO"}
                    </h4>
                    <p className="text-[10px] text-slate-500 text-center px-4">
                      {isUploading ? `Progresso: ${uploadProgress}%` : ".zip ou arquivos grandes"}
                    </p>
                 </label>

                 <label className={cn(
                   "relative cursor-pointer flex-1 flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl transition-all duration-300 bg-[#1c1c1c] group",
                   isUploading 
                      ? "border-[#00d1ff]/50 bg-[#00d1ff]/5" 
                      : "border-[#2d2d2d] hover:border-[#00d1ff]"
                 )}>
                    <input 
                      type="file" 
                      className="hidden" 
                      onChange={handleFolderUpload} 
                      disabled={isUploading} 
                      {...({ webkitdirectory: "", directory: "", multiple: true } as any)} 
                    />
                    <div className={cn(
                      "w-16 h-16 rounded-full bg-[#242424] flex items-center justify-center mb-4 transition-all duration-300 group-hover:bg-[#00d1ff] group-hover:text-black",
                      isUploading && "animate-pulse"
                    )}>
                      <Folder size={24} className={isUploading ? "text-[#00d1ff]" : "text-white/40"} />
                    </div>
                    <h4 className="font-bold mb-1 text-white uppercase tracking-tight">
                      {isUploading ? "SUBINDO..." : "PASTA"}
                    </h4>
                    <p className="text-[10px] text-slate-500 text-center px-4">
                      {isUploading ? `Progresso: ${uploadProgress}%` : "Mande a pasta inteira"}
                    </p>
                 </label>
                </div>

                {isUploading && (
                  <div className="w-full mt-4 bg-white/5 h-1.5 rounded-full overflow-hidden border border-white/5">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${uploadProgress}%` }}
                      className="h-full bg-[#38e11d] shadow-[0_0_10px_rgba(56,225,29,0.3)]"
                    />
                  </div>
                )}

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
  const safePercentage = isNaN(parseFloat(percentage)) ? 0 : parseFloat(percentage);
  const isCritical = safePercentage > 85;

  return (
    <div className={cn(
      "bg-[#161616] p-6 rounded-2xl border border-[#2d2d2d] shadow-xl hover:bg-[#1c1c1c] transition-all group overflow-hidden relative", 
      isCritical ? "border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]" : "",
      className
    )}>
      {isCritical && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.05, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 bg-red-500 pointer-events-none"
        />
      )}
      <div className="flex justify-between items-start mb-4 relative z-10">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</span>
        <span className="text-xs font-mono font-bold" style={{ color: isCritical ? "#ef4444" : color }}>{safePercentage.toFixed(1)}%</span>
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
          animate={{ width: `${safePercentage}%` }}
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

function HealthDot({ serverStatus, stats }: { serverStatus: string, stats: any }) {
  const isCritical = (stats?.cpu?.usage || 0) > 90 || (stats?.ram?.percent || 0) > 95;
  const isWarning = (stats?.cpu?.usage || 0) > 75 || (stats?.ram?.percent || 0) > 85;

  let color = "bg-[#38e11d]";
  if (serverStatus === 'stopped') color = "bg-[#ff3e3e]";
  else if (isCritical) color = "bg-red-500";
  else if (isWarning) color = "bg-amber-500";
  else if (serverStatus !== 'running') color = "bg-amber-500";

  return (
    <div className="relative">
      <div className={cn(
        "w-3 h-3 rounded-full transition-colors duration-500",
        color,
        (serverStatus === 'running' || serverStatus === 'starting') && "animate-pulse shadow-[0_0_10px_currentColor]"
      )} style={{ color: color.includes('38e11d') ? '#38e11d' : color.includes('red') ? '#ef4444' : '#f59e0b' }} />
      
      {/* Tooltip hint */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded px-2 py-1 whitespace-nowrap shadow-2xl">
          <p className="text-[8px] font-black uppercase text-white tracking-widest">
            Saúde: {isCritical ? "Crítica" : isWarning ? "Pesada" : "Nominal"}
          </p>
        </div>
      </div>
    </div>
  );
}

const JobCard: React.FC<{ job: ServerJob }> = ({ job }) => {
  const statusColors = {
    UPLOADING: "text-blue-400",
    UPLOADED: "text-blue-500",
    VALIDATING: "text-amber-500",
    QUEUED: "text-slate-500",
    DOWNLOADING: "text-blue-400 font-bold",
    INSTALLING: "text-[#38e11d]",
    EXTRACTING: "text-[#38e11d]",
    DETECTING: "text-indigo-400",
    CONFIGURING: "text-purple-400",
    STARTING: "text-indigo-500",
    DONE: "text-[#38e11d]",
    FAILED: "text-red-500"
  };

  const statusLabels = {
    UPLOADING: "Subindo Arquivos",
    UPLOADED: "Enviado",
    VALIDATING: "Validando SHA256",
    QUEUED: "Aguardando Fila",
    DOWNLOADING: "Baixando Modpack",
    INSTALLING: "Instalando",
    EXTRACTING: "Extraindo Backup",
    DETECTING: "Escaneando Root",
    CONFIGURING: "Configurando",
    STARTING: "Iniciando Worker",
    DONE: "Deploy Concluído",
    FAILED: "Falha Crítica"
  };

  return (
    <div className="p-4 bg-black/40 border border-[#2d2d2d] rounded-xl flex items-center gap-4 group hover:border-white/10 transition-all">
      <div className={cn(
        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
        (job.status === 'EXTRACTING' || job.status === 'DETECTING' || job.status === 'DOWNLOADING') ? "animate-pulse bg-[#38e11d]/10" : "bg-white/5",
        job.status === 'FAILED' && "bg-red-500/10"
      )}>
        {job.status === 'EXTRACTING' ? <PackageOpen className="text-[#38e11d] animate-bounce" size={18} /> : 
         job.status === 'DOWNLOADING' ? <Download className="text-blue-400 animate-bounce" size={18} /> :
         job.status === 'DETECTING' ? <Search className="text-indigo-400" size={18} /> :
         job.status === 'VALIDATING' ? <Activity className="text-amber-500 animate-pulse" size={18} /> :
         job.status === 'UPLOADING' ? <Upload className="text-blue-400 animate-pulse" size={18} /> :
         job.status === 'FAILED' ? <X className="text-red-500" size={18} /> :
         job.status === 'CONFIGURING' ? <Settings className="text-purple-400 animate-spin" size={18} /> :
         <Archive className="text-slate-400" size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-1">
          <p className="text-xs font-bold text-white truncate uppercase tracking-tight">{(job as any).metadata?.title || job.filename}</p>
          <span className={cn("text-[9px] font-black uppercase tracking-widest", (statusColors as any)[job.status])}>
            {(statusLabels as any)[job.status]} {job.progress && job.progress < 100 ? `(${job.progress}%)` : ""}
          </span>
        </div>
        <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
          {['UPLOADING', 'EXTRACTING', 'DOWNLOADING', 'INSTALLING'].includes(job.status) ? (
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${job.progress || 0}%` }}
              className="h-full bg-[#38e11d]"
            />
          ) : job.status === 'DONE' ? (
            <div className="w-full h-full bg-[#38e11d]" />
          ) : job.status === 'FAILED' ? (
            <div className="w-full h-full bg-red-500" />
          ) : (
             <div className="w-0 h-full bg-slate-500" />
          )}
        </div>
        {job.error && <p className="text-[9px] text-red-500/70 mt-1 truncate">{job.error}</p>}
      </div>
    </div>
  );
}

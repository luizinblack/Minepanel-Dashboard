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
  Settings,
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
  RotateCcw,
  Search,
  History,
  Trash,
  Info
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { motion, AnimatePresence } from 'motion/react';
import pLimit from 'p-limit';
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

// Limite global compartilhado entre TODOS os arquivos
const globalUploadLimit = pLimit(1);

// Cache System
const MEMORY_CACHE = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds

// --- TYPES & INTERFACES ---
interface SystemStats {
  cpu: { usage: number; cores: number; temp: number };
  ram: { total: number; used: number; free: number; percent: number };
  network: { tx: number; rx: number };
  throughput: number;
  uptime: number;
  timestamp: string;
}

type JobStatus = "UPLOADING" | "UPLOADED" | "VALIDATING" | "QUEUED" | "DOWNLOADING" | "INSTALLING" | "EXTRACTING" | "DETECTING" | "CONFIGURING" | "STARTING" | "DONE" | "FAILED";

interface ServerJob {
  id: string;
  filename: string;
  status: JobStatus;
  progress?: number;
  error?: string;
  metadata?: any;
}

export default function App() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsHistory, setStatsHistory] = useState<any[]>([]);
  const [jobs, setJobs] = useState<ServerJob[]>([]);
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running' | 'stopping'>('stopped');
  const [logs, setLogs] = useState<string[]>([]);
  const [currentJar, setCurrentJar] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const isUploadingRef = useRef(isUploading);
  useEffect(() => { isUploadingRef.current = isUploading; }, [isUploading]);

  const [activeUploads, setActiveUploads] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'monitor' | 'files' | 'console' | 'backups'>('monitor');
  const [backups, setBackups] = useState<any[]>([]);

  const [currentPath, setCurrentPath] = useState<string>(".");
  const currentPathRef = useRef(currentPath);
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);

  const [fileList, setFileList] = useState<any[]>([]);
  const [editingFile, setEditingFile] = useState<{ path: string, content: string } | null>(null);
  const [isCreating, setIsCreating] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState("");
  const [command, setCommand] = useState("");
  
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [currentServerId] = useState("server_01");
  const currentServerIdRef = useRef(currentServerId);

  // --- API FETCH WITH CACHE ---
  const apiFetch = async (url: string, options: any = {}, useCache = false) => {
    const cacheKey = url + JSON.stringify(options);
    
    if (useCache && MEMORY_CACHE.has(cacheKey)) {
      const cached = MEMORY_CACHE.get(cacheKey)!;
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }

    const token = localStorage.getItem('minecontrol_token');
    const headers = {
      ...options.headers,
      'x-server-id': currentServerIdRef.current,
      ...(token && token !== "null" ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch(url, { ...options, headers });
    const data = await response.json();
    
    if (useCache && response.ok) {
      MEMORY_CACHE.set(cacheKey, { data, timestamp: Date.now() });
    }
    
    return { ok: response.ok, status: response.status, data };
  };

  const fetchBackups = async () => {
    try {
      const { ok, data } = await apiFetch('/api/backups', {}, true);
      if (ok) setBackups(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeTab === 'backups') {
      fetchBackups();
    }
  }, [activeTab]);

  const handleCreateBackup = async () => {
    try {
      const { ok, data } = await apiFetch('/api/backups/create', { method: 'POST' });
      if (ok) {
        alert("Criação de backup iniciada. Acompanhe na fila de tarefas.");
      } else {
        alert("Erro: " + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRestoreBackup = async (id: string) => {
    if (!confirm("AVISO: Restaurar um backup irá apagar o mundo atual! Deseja continuar?")) return;
    try {
      const { ok, data } = await apiFetch('/api/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: id })
      });
      if (ok) {
        alert("Restauração iniciada. O servidor será parado e os arquivos substituídos.");
      } else {
        alert("Erro: " + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteBackup = async (id: string) => {
    if (!confirm("Deseja apagar permanentemente este backup?")) return;
    try {
      const { ok } = await apiFetch('/api/backups/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: id })
      });
      if (ok) {
        fetchBackups();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchFiles = async (pathStr: string) => {
    try {
      const { ok, data } = await apiFetch(`/api/files?path=${encodeURIComponent(pathStr)}`, {}, true);
      if (ok) {
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
    // Initial status fetch + jobs
    const fetchInitialData = async () => {
      if (isUploadingRef.current) return;
      try {
        const [statusRes, jobsRes, logsRes] = await Promise.all([
          apiFetch('/api/status', {}, true),
          apiFetch('/api/jobs', {}, true),
          apiFetch('/api/logs', {}, true)
        ]);
        
        if (statusRes.ok) {
          setStatus(statusRes.data.status);
          setCurrentJar(statusRes.data.jar);
        }
        
        if (jobsRes.ok) {
          if (Array.isArray(jobsRes.data)) setJobs(jobsRes.data);
        }

        if (logsRes.ok && logsRes.data.content) {
          setLogs(logsRes.data.content.split('\n').filter((l: string) => l.length > 0));
        }
      } catch (e) {
        console.warn("Initial data fetch failed");
      }
    };

    fetchInitialData();
    socket.emit("join", currentServerIdRef.current);

    socket.on('system_metrics', (newMetrics: SystemStats) => {
      setStats(newMetrics);
      setStatsHistory(prev => {
        const cpuVal = newMetrics.cpu.usage;
        const ramVal = newMetrics.ram.percent;
        const next = [...prev, {
          time: new Date(newMetrics.timestamp).toLocaleTimeString(),
          cpu: cpuVal,
          ram: ramVal,
          network: (newMetrics.network.tx + newMetrics.network.rx) / 1024 / 1024
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

    socket.on('console_history', (history: string[]) => {
      setLogs(history);
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

    const lastRefreshRef = { current: 0 };
    socket.on('refresh_data', () => {
      if (isUploadingRef.current) return;
      const now = Date.now();
      if (now - lastRefreshRef.current < 5000) return; // 5s throttle
      lastRefreshRef.current = now;
      
      fetchInitialData();
      fetchFiles(currentPathRef.current);
    });

    return () => {
      socket.off('system_metrics');
      socket.off('status_change');
      socket.off('console_log');
      socket.off('job_update');
      socket.off('refresh_data');
    };
  }, []);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleStart = async () => {
    try {
      const { ok, data } = await apiFetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ramMin: '512M', ramMax: '2048M', autoRestart: true })
      });
      if (!ok) {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleStop = async () => {
    try {
      await apiFetch('/api/stop', { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

  const uploadChunked = async (file: File, options: any = {}) => {
    const { 
      onProgress = () => {}, 
      fileId = `${file.name}-${file.size}-${file.lastModified}`,
      CHUNK_SIZE = 50 * 1024 * 1024, // 50MB per chunk (optimized for large sets)
      sharedLimit = globalUploadLimit,
      manageUploadState = true
    } = options;

    if (manageUploadState) setIsUploading(true);
    try {

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const token = localStorage.getItem('minecontrol_token');
      const headers: any = (token && token !== "null") ? { 'Authorization': `Bearer ${token}` } : {};

      // 1. Check status (Resume support)
      const statusRes = await fetch(`/api/admin/upload/status?fileId=${encodeURIComponent(fileId)}`, { headers });
      if (!statusRes.ok) {
         const errData = await statusRes.json().catch(() => ({}));
         throw new Error(errData.error || `Failed to check upload status: ${statusRes.status}`);
      }
      const { uploadedChunks } = await statusRes.json();
      
      const remainingChunks = [];
      for (let i = 0; i < totalChunks; i++) {
         if (!uploadedChunks.includes(i)) remainingChunks.push(i);
      }

      if (remainingChunks.length === 0) {
         onProgress(100);
         return;
      }

      // 2. Upload queue with global concurrency control and retry logic
      let finishedChunks = totalChunks - remainingChunks.length;
      
      const tasks = remainingChunks.map(index => sharedLimit(async () => {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          try {
            const start = index * CHUNK_SIZE;
            const end = Math.min(file.size, start + CHUNK_SIZE);
            const chunk = file.slice(start, end);

            const formData = new FormData();
            formData.append('chunk', chunk);
            formData.append('fileId', fileId);
            formData.append('index', index.toString());
            formData.append('total', totalChunks.toString());
            formData.append('fileName', file.name);
            formData.append('mimeType', file.type);
            formData.append('relativePath', file.webkitRelativePath || file.name);

            const res = await fetch('/api/admin/upload/chunk', {
              method: 'POST',
              headers,
              body: formData,
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              // Don't retry if it's a quota issue
              if (res.status === 403) throw new Error(errData.error || "Limite atingido (Quota exceeded)");
              if (res.status === 429) throw new Error("Muitas requisições (Rate Limit)");
              throw new Error(errData.error || `Upload failed: ${res.status}`);
            }
            
            finishedChunks++;
            onProgress(Math.round((finishedChunks / totalChunks) * 100));
            return; // Success
          } catch (err: any) {
            attempts++;
            if (attempts >= maxAttempts || err.message.includes("Limite atingido")) {
              throw err;
            }
            // Exponential backoff
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts)));
          }
        }
      }));

      const results = await Promise.allSettled(tasks);
      const failed = results.filter(r => r.status === "rejected");
      if (failed.length > 0) {
        const firstError: any = failed[0];
        throw new Error(`${failed.length} chunks falharam. Exemplo: ${firstError.reason?.message || "Unknown error"}`);
      }
    } finally {
      if (manageUploadState) setIsUploading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const newUpload = { id: uuidv4(), name: file.name, progress: 0, status: 'uploading' };
    setActiveUploads(prev => [...prev, newUpload]);

    try {
      await uploadChunked(file, {
        onProgress: (p: number) => {
          setActiveUploads(prev => prev.map(u => u.id === newUpload.id ? { ...u, progress: p } : u));
        }
      });
      setActiveUploads(prev => prev.map(u => u.id === newUpload.id ? { ...u, progress: 100, status: 'done' } : u));
      setTimeout(() => {
        setActiveUploads(prev => prev.filter(u => u.id !== newUpload.id));
      }, 5000);
    } catch (err: any) {
      console.error(err);
      setActiveUploads(prev => prev.map(u => u.id === newUpload.id ? { ...u, status: 'error', error: err.message } : u));
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const totalFiles = files.length;
    let processedCount = 0;

    const folderUploadId = uuidv4();
    const newUpload = { id: folderUploadId, name: `Pasta: ${files[0].webkitRelativePath.split('/')[0]}`, progress: 0, status: 'uploading', count: `0/${totalFiles}` };
    setActiveUploads(prev => [...prev, newUpload]);

    try {
      const tasks = [];
      for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        tasks.push(globalUploadLimit(async () => {
          await uploadChunked(file, { 
            sharedLimit: globalUploadLimit,
            manageUploadState: false
          });
          processedCount++;
          const p = Math.round((processedCount / totalFiles) * 100);
          setActiveUploads(prev => prev.map(u => u.id === folderUploadId 
            ? { ...u, progress: p, count: `${processedCount}/${totalFiles}` } 
            : u));
        }));
      }
      await Promise.all(tasks);
      setActiveUploads(prev => prev.map(u => u.id === folderUploadId ? { ...u, progress: 100, status: 'done' } : u));
      setTimeout(() => {
        setActiveUploads(prev => prev.filter(u => u.id !== folderUploadId));
      }, 5000);
    } catch (err: any) {
      console.error(err);
      setActiveUploads(prev => prev.map(u => u.id === folderUploadId ? { ...u, status: 'error', error: err.message } : u));
    } finally {
      setIsUploading(false);
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
          const { ok, data } = await apiFetch(`/api/file/read?path=${encodeURIComponent(fullPath)}`, {}, true);
          if (ok) {
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
        const { ok } = await apiFetch('/api/file/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fullPath })
        });
        if (ok) fetchFiles(currentPath);
      } catch (err) {
        console.error(err);
      }
    },
    save: async () => {
      if (!editingFile) return;
      try {
        const { ok } = await apiFetch('/api/file/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: editingFile.path, content: editingFile.content })
        });
        if (ok) setEditingFile(null);
      } catch (err) {
        console.error(err);
      }
    },
    create: async () => {
      const fullPath = currentPath === "." ? newName : `${currentPath}/${newName}`;
      try {
        const { ok } = await apiFetch('/api/file/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fullPath, isDirectory: isCreating === 'folder' })
        });
        if (ok) {
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
        const { ok, data } = await apiFetch('/api/files/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, currentPath }),
        });
        if (!ok) {
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
    },
    deleteAll: async () => {
      if (!confirm("AVISO: Isso irá apagar TODOS os arquivos e pastas do servidor! Deseja continuar?")) return;
      try {
        const { ok, data } = await apiFetch('/api/files/all', {
          method: 'DELETE'
        });
        if (ok) {
          fetchFiles(currentPath);
        } else {
          alert(data.error || "Erro ao apagar arquivos");
        }
      } catch (err) {
        console.error(err);
        alert("Erro na conexão com o servidor");
      }
    }
  };

  const sendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || status !== 'running') return;
    
    try {
      await apiFetch('/api/command', {
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
      const { ok } = await apiFetch('/api/logs/clear', { method: 'POST' });
      if (ok) {
        setLogs([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

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
              onClick={() => setActiveTab('backups')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeTab === 'backups' ? "bg-[#38e11d] text-black" : "text-slate-500 hover:text-white"
              )}
            >
              <History size={12} /> Backups
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
                    label="Rede (TX/RX)" 
                    value={`${((stats?.network.tx || 0) / 1024 / 1024).toFixed(1)} / ${((stats?.network.rx || 0) / 1024 / 1024).toFixed(1)} MB/s`} 
                    icon={<Activity className="text-[#bd00ff]" size={16} />}
                    subLabel={`Tráfego em Tempo Real`}
                    color="#bd00ff"
                    percentage={Math.min(((stats?.network.tx || 0) + (stats?.network.rx || 0)) / 10000000 * 100, 100)}
                  />
                  <MetricCard 
                    label="Disk I/O" 
                    value={`${((stats?.throughput || 0) / 1024 / 1024).toFixed(2)} MB/s`} 
                    icon={<RotateCcw className="text-amber-500" size={16} />}
                    subLabel="Taxa de I/O de Arquivos"
                    color="#f59e0b"
                    percentage={Math.min((stats?.throughput || 0) / 50000000 * 100, 100)}
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
            ) : activeTab === 'backups' ? (
              <motion.div 
                key="backups"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h2 className="text-3xl font-black italic uppercase tracking-tighter text-white">Snapshots & Backups</h2>
                    <p className="text-slate-500 text-sm">Gerencie o histórico de estados e restaure seu servidor com um clique.</p>
                  </div>
                  <button 
                    onClick={handleCreateBackup}
                    className="px-6 py-3 bg-[#38e11d] text-black font-black uppercase text-xs tracking-widest rounded-xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-[#38e11d]/20 flex items-center gap-2"
                  >
                    <Plus size={16} /> Criar Snapshot Agora
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {backups.length === 0 ? (
                    <div className="col-span-full py-20 text-center bg-[#161616] border border-[#2d2d2d] rounded-2xl border-dashed">
                      <History size={48} className="text-slate-700 mx-auto mb-4" />
                      <h3 className="text-lg font-bold text-slate-400 uppercase tracking-widest">Nenhum snapshot encontrado</h3>
                      <p className="text-slate-600 text-xs mt-2 italic">Seus backups aparecerão aqui após a criação.</p>
                    </div>
                  ) : backups.map(backup => (
                    <div key={backup.id} className="bg-[#161616] border border-[#2d2d2d] rounded-2xl p-6 group hover:border-[#38e11d] transition-all relative overflow-hidden">
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 rounded-lg bg-[#242424] flex items-center justify-center text-[#38e11d]">
                          <Database size={20} />
                        </div>
                        <span className="text-[10px] font-mono text-slate-600 uppercase">{backup.id.split('-').pop()}</span>
                      </div>
                      
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-sm font-black text-white uppercase truncate">{backup.filename}</h4>
                          <p className="text-[10px] text-slate-500 font-mono mt-1">{(backup.size / 1024 / 1024).toFixed(2)} MB • {new Date(backup.created_at).toLocaleString()}</p>
                        </div>

                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleRestoreBackup(backup.id)}
                            className="flex-1 py-3 bg-white/5 hover:bg-[#38e11d] text-white hover:text-black font-bold text-[10px] uppercase rounded-lg transition-all flex items-center justify-center gap-2"
                          >
                            <RotateCcw size={12} /> Restaurar
                          </button>
                          <button 
                            onClick={() => handleDeleteBackup(backup.id)}
                            className="w-12 py-3 bg-white/5 hover:bg-red-500/20 text-slate-500 hover:text-red-500 rounded-lg transition-all flex items-center justify-center"
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Visual accent */}
                      <div className="absolute top-0 right-0 w-32 h-32 bg-[#38e11d]/5 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-[#38e11d]/10 transition-colors" />
                    </div>
                  ))}
                </div>

                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-6 flex gap-4 items-start">
                  <div className="p-3 bg-amber-500/10 rounded-xl">
                    <Info size={20} className="text-amber-500" />
                  </div>
                  <div>
                    <h5 className="text-xs font-black text-amber-500 uppercase tracking-widest mb-1">Informações de Segurança</h5>
                    <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                      A restauração de um snapshot é irreversível e substituirá todos os arquivos do mundo, plugins e configurações atuais. 
                      Recomendamos criar um snapshot preventivo antes de qualquer restauração importante. O servidor será desligado automaticamente durante o processo.
                    </p>
                  </div>
                </div>
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
                      <button 
                        onClick={handleFileAction.deleteAll}
                        className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg text-[10px] font-black uppercase hover:bg-red-500/20 transition-all"
                      >
                        <Trash2 size={12} /> apagar tudo
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
                      ARQUIVO
                    </h4>
                    <p className="text-[10px] text-slate-500 text-center px-4">
                      .zip, .jar ou arquivos grandes
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
                      PASTA
                    </h4>
                    <p className="text-[10px] text-slate-500 text-center px-4">
                      Mande a pasta inteira
                    </p>
                 </label>
                </div>

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

        {/* Upload Queue Panel */}
        <AnimatePresence>
          {activeUploads.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.9 }}
              className="fixed bottom-8 right-8 z-[100] w-80 bg-[#161616] border border-[#2d2d2d] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden"
            >
              <div className="bg-[#1a1a1a] px-4 py-3 border-b border-[#2d2d2d] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#38e11d] rounded-full animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-white">Upload Manager</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">{activeUploads.filter(u => u.status === 'uploading').length} Ativos</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-3 space-y-2">
                {activeUploads.map(upload => (
                  <div key={upload.id} className="p-3 bg-black/20 rounded-xl border border-white/5 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-bold text-white truncate max-w-[180px]">{upload.name}</span>
                      <span className={cn(
                        "text-[9px] font-mono",
                        upload.status === 'error' ? "text-red-500" : "text-[#38e11d]"
                      )}>
                        {upload.status === 'error' ? 'Erro' : `${upload.progress}%`}
                      </span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${upload.progress}%` }}
                        className={cn(
                          "h-full transition-all duration-300",
                          upload.status === 'error' ? "bg-red-500" : "bg-[#38e11d]"
                        )}
                      />
                    </div>
                    {upload.count && (
                      <p className="text-[8px] text-slate-500 font-mono uppercase tracking-tight flex items-center justify-between">
                        <span>Progresso da Pasta</span>
                        <span>{upload.count} arquivos</span>
                      </p>
                    )}
                    {upload.error && (
                      <p className="text-[8px] text-red-500 font-normal line-clamp-1 italic">{upload.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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

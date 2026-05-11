import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { finished } from "stream/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function downloadFile(url: string, dest: string, onProgress?: (percent: number) => void) {
  const { data, headers } = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  const totalLength = parseInt(String(headers['content-length'] || "0"), 10);
  let downloadedLength = 0;

  const writer = fs.createWriteStream(dest);
  
  data.on('data', (chunk: Buffer) => {
    downloadedLength += chunk.length;
    if (totalLength > 0 && onProgress) {
      onProgress(Math.round((downloadedLength / totalLength) * 100));
    }
  });

  data.pipe(writer);

  await finished(writer);
}

export async function searchModrinth(query: string, limit: number = 20, offset: number = 0) {
  try {
    const url = query 
      ? `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&facets=[["project_type:modpack"]]`
      : `https://api.modrinth.com/v2/search?limit=${limit}&offset=${offset}&facets=[["project_type:modpack"]]`;
      
    const res = await fetch(url);
    if (!res.ok) throw new Error("Modrinth API error");
    const data = await res.json();
    return data.hits.map((hit: any) => ({
      id: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      downloads: hit.downloads,
      icon_url: hit.icon_url,
      provider: 'modrinth',
      updatedAt: hit.date_modified ? new Date(hit.date_modified).getTime() : Date.now(),
      minecraft_versions: hit.versions || [],
      loaders: hit.categories || []
    }));
  } catch (e) {
    console.error("Modrinth Search Error:", e);
    return [];
  }
}

export async function searchCurseForge(query: string, index: number = 0, pageSize: number = 20) {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey || apiKey === 'YOUR_KEY' || apiKey.trim() === '') {
    return [];
  }

  try {
    const url = `https://api.curseforge.com/v1/mods/search?gameId=432&classId=4471&pageSize=${pageSize}&index=${index}${query ? `&searchFilter=${encodeURIComponent(query)}` : ''}`;
    
    const res = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "Accept": "application/json",
        "User-Agent": "MineControl/1.0.0"
      }
    });
    
    if (!res.ok) {
      console.error(`CurseForge API Error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    return data.data.map((mod: any) => ({
      id: mod.id.toString(),
      slug: mod.slug,
      title: mod.name,
      description: mod.summary,
      downloads: mod.downloadCount,
      icon_url: mod.logo?.url,
      provider: 'curseforge',
      updatedAt: mod.dateModified ? new Date(mod.dateModified).getTime() : Date.now(),
      minecraft_versions: mod.latestFilesIndexes?.map((i: any) => i.gameVersion) || [],
      loaders: Array.from(new Set(mod.latestFilesIndexes?.map((i: any) => {
        if (i.modLoader === 1) return 'forge';
        if (i.modLoader === 4) return 'fabric';
        if (i.modLoader === 5) return 'quilt';
        if (i.modLoader === 6) return 'neoforge';
        return null;
      }).filter(Boolean)))
    }));
  } catch (e) {
    console.error("CurseForge Search Error:", e);
    return [];
  }
}

export async function getModrinthVersions(projectId: string) {
  try {
    const res = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`);
    if (!res.ok) throw new Error("Modrinth Versions API error");
    const data = await res.json();
    return data.map((v: any) => ({
      id: v.id,
      name: v.name,
      version_number: v.version_number,
      game_versions: v.game_versions,
      loaders: v.loaders,
      files: v.files.map((f: any) => ({
        url: f.url,
        filename: f.filename,
        primary: f.primary
      }))
    }));
  } catch (e) {
    console.error("Modrinth Versions Error:", e);
    return [];
  }
}

export async function getCurseForgeVersions(modId: string) {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(`https://api.curseforge.com/v1/mods/${modId}/files`, {
      headers: {
        "x-api-key": apiKey,
        "Accept": "application/json",
        "User-Agent": "MineControl/1.0.0"
      }
    });
    if (!res.ok) throw new Error("CurseForge Files API error");
    const data = await res.json();
    return data.data.map((f: any) => ({
      id: f.id.toString(),
      name: f.displayName,
      version_number: f.fileName,
      game_versions: f.gameVersions,
      loaders: [],
      download_url: f.downloadUrl
    }));
  } catch (e) {
    console.error("CurseForge Files Error:", e);
    return [];
  }
}

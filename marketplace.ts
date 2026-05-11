import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { finished } from "stream/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standardized User-Agent to avoid blocks
const USER_AGENT = "MineControl/1.0.0 (https://github.com/ais-dev)";

/**
 * Proxy for external API calls to keep keys safe and handle errors centrally
 */
const externalApi = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": USER_AGENT,
    "Accept": "application/json"
  }
});

export async function downloadFile(url: string, dest: string, onProgress?: (percent: number) => void) {
  const { data, headers } = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    headers: { "User-Agent": USER_AGENT }
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
    const params: any = {
      limit,
      offset,
      facets: '[["project_type:modpack"]]'
    };
    if (query) params.query = query;

    const res = await externalApi.get("https://api.modrinth.com/v2/search", { params });
    
    return res.data.hits.map((hit: any) => ({
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
  } catch (e: any) {
    console.error(`[Proxy] Modrinth Search Error: ${e.message}`);
    return [];
  }
}

export async function searchCurseForge(query: string, index: number = 0, pageSize: number = 20) {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey || apiKey === 'YOUR_KEY' || apiKey.trim() === '') {
    console.warn("[Proxy] CurseForge API Key missing or invalid in server environment.");
    return [];
  }

  try {
    const params: any = {
      gameId: 432,
      classId: 4471,
      pageSize,
      index
    };
    if (query) params.searchFilter = query;

    const res = await externalApi.get("https://api.curseforge.com/v1/mods/search", {
      params,
      headers: { "x-api-key": apiKey }
    });
    
    return res.data.data.map((mod: any) => ({
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
  } catch (e: any) {
    console.error(`[Proxy] CurseForge Search Error: ${e.message}`);
    return [];
  }
}

export async function getModrinthVersions(projectId: string) {
  try {
    const res = await externalApi.get(`https://api.modrinth.com/v2/project/${projectId}/version`);
    return res.data.map((v: any) => ({
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
  } catch (e: any) {
    console.error(`[Proxy] Modrinth Versions Error: ${e.message}`);
    return [];
  }
}

export async function getCurseForgeVersions(modId: string) {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await externalApi.get(`https://api.curseforge.com/v1/mods/${modId}/files`, {
      headers: { "x-api-key": apiKey }
    });
    return res.data.data.map((f: any) => ({
      id: f.id.toString(),
      name: f.displayName,
      version_number: f.fileName,
      game_versions: f.gameVersions,
      loaders: [],
      download_url: f.downloadUrl
    }));
  } catch (e: any) {
    console.error(`[Proxy] CurseForge Versions Error: ${e.message}`);
    return [];
  }
}

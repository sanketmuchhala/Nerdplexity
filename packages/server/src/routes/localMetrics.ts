import os from "os";
import type { Request, Response } from "express";
import { runtimeURL } from '../runtime/local.js';

export async function localMetrics(req: Request, res: Response) {
  let baseURL: string;
  try { baseURL = runtimeURL('ollama', String(req.query.baseURL || 'http://127.0.0.1:11434')); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  
  // Get system metrics
  const load = os.loadavg();
  const total = os.totalmem();
  const free = os.freemem();
  const rss = process.memoryUsage().rss;
  const cpus = os.cpus()?.length || 0;
  
  // Get Ollama metrics
  let ollama: any = {};
  try {
    // Check running processes
    const psResponse = await fetch(`${baseURL}/api/ps`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const ps = psResponse.ok ? await psResponse.json() : null;
    
    // Check installed models
    const tagsResponse = await fetch(`${baseURL}/api/tags`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const tags = tagsResponse.ok ? await tagsResponse.json() : null;
    
    ollama = { ps, tags, reachable: tagsResponse.ok };
  } catch (error) {
    ollama = { reachable: false, error: (error as Error).message };
  }
  
  res.json({
    host: {
      cpus,
      load1: load[0],
      load5: load[1], 
      load15: load[2],
      total,
      free,
      rss
    },
    ollama
  });
}

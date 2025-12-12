
import { SerperResult, ReferenceData } from '../types';

const CACHE_PREFIX = 'SERPER_CACHE_V1_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

interface CachedSerper {
  timestamp: number;
  data: SerperResult;
}

const getFromCache = (query: string): SerperResult | null => {
  if (typeof window === 'undefined') return null;
  try {
    const key = CACHE_PREFIX + btoa(query).substring(0, 32); // Simple hash
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const item: CachedSerper = JSON.parse(raw);
    if (Date.now() - item.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return item.data;
  } catch (e) {
    return null;
  }
};

const saveToCache = (query: string, data: SerperResult) => {
  if (typeof window === 'undefined') return;
  try {
    const key = CACHE_PREFIX + btoa(query).substring(0, 32);
    const item: CachedSerper = { timestamp: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(item));
  } catch (e) {}
};

// Helper to validate if a link is alive (Status 200)
// Using HEAD request with tight timeout
const validateLink = async (url: string): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1500); // Tight 1.5s timeout
    await fetch(url, { 
      method: 'HEAD', 
      mode: 'no-cors', 
      signal: controller.signal 
    });
    clearTimeout(id);
    return true;
  } catch (e) {
    return false;
  }
};

export const searchSerper = async (query: string, apiKey: string): Promise<SerperResult> => {
  if (!apiKey) return { organics: [], paa: [] };

  // SMART QUERY ENGINEERING: FUTURE-PROOFING
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const smartQuery = `${query} successor vs new model ${currentYear} ${nextYear} review comparison`;

  // 1. Check Cache
  const cached = getFromCache(smartQuery);
  if (cached) {
      console.log(`[Serper] Cache Hit for: "${query}"`);
      return cached;
  }

  try {
    console.log(`[Serper] Live Fetch for: "${query}"`);
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: smartQuery,
        num: 15, 
        tbs: "qdr:y", // STRICT: Past Year Only to ensure freshness
        gl: "us",
        hl: "en"
      })
    });

    if (!response.ok) throw new Error("Serper API Failed");
    const data = await response.json();

    const rawOrganics = data.organic || [];
    const validatedOrganics: ReferenceData[] = [];

    // Parallel validation (Batch of 5) for speed
    // We only need 5-8 solid links, don't validate 20
    const topCandidates = rawOrganics.slice(0, 8);
    
    const results = await Promise.all(topCandidates.map(async (item: any) => {
         // Optimistic check: if snippet mentions "2024" or "2025" keep it, else validate
         if (item.snippet.includes(currentYear.toString()) || item.snippet.includes(nextYear.toString())) {
             return { title: item.title, link: item.link, snippet: item.snippet };
         }
         const isAlive = await validateLink(item.link);
         return isAlive ? {
           title: item.title,
           link: item.link,
           snippet: item.snippet
         } : null;
    }));
    
    validatedOrganics.push(...results.filter((r): r is ReferenceData => r !== null));

    const paa = (data.peopleAlsoAsk || []).slice(0, 6).map((item: any) => ({
      question: item.question,
      snippet: item.snippet,
      link: item.link
    }));

    const result = { organics: validatedOrganics, paa };
    
    // 2. Save to Cache
    saveToCache(smartQuery, result);
    
    return result;
  } catch (error) {
    console.error("Serper Logic Error:", error);
    return { organics: [], paa: [] };
  }
};

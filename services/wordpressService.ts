
import { WPConnection, WPPostHeader, WPPostFull } from '../types';

const getAuthHeader = (conn: WPConnection) => {
  // Safe encoding for special characters in passwords
  const str = `${conn.username}:${conn.appPassword}`;
  return 'Basic ' + btoa(unescape(encodeURIComponent(str)));
};

const cleanUrl = (url: string) => url.replace(/\/$/, '');

// Robust fetch with retry and timeout
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3, backoff = 1000): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout per request
  const fetchOptions = { ...options, signal: controller.signal };

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      
      // If 429 (Too Many Requests) or 5xx (Server Error), we throw to retry
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
            throw new Error(`HTTP ${res.status}`);
        }
        // For 4xx errors (client errors), return immediately (don't retry)
        // 401 = Unauthorized (Bad Password)
        return res;
      }
      return res;
    } catch (error: any) {
      if (i === retries - 1) {
        clearTimeout(timeoutId);
        throw error;
      }
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, backoff * Math.pow(2, i)));
    }
  }
  return new Response(null, { status: 504, statusText: "Gateway Timeout" });
};

// Strict verification of credentials using /users/me
export const verifyConnection = async (conn: WPConnection): Promise<void> => {
  const res = await fetchWithRetry(`${cleanUrl(conn.url)}/wp-json/wp/v2/users/me`, {
    headers: { 'Authorization': getAuthHeader(conn) }
  });
  
  if (!res.ok) {
      if (res.status === 401) throw new Error("401 Unauthorized: Check Username/App Password.");
      if (res.status === 403) throw new Error("403 Forbidden: User does not have permission.");
      if (res.status === 404) throw new Error("404 Not Found: JSON API not enabled on site.");
      throw new Error(`Connection Error: ${res.status} ${res.statusText}`);
  }
};

export const fetchAllPostHeaders = async (conn: WPConnection, onProgress?: (count: number) => void): Promise<WPPostHeader[]> => {
  const allPosts: WPPostHeader[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
        // Fetch 100 items per page (WP API max)
        const res = await fetchWithRetry(`${cleanUrl(conn.url)}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,date,modified,title,link,slug,categories&status=publish`, {
            headers: { 'Authorization': getAuthHeader(conn) }
        });

        if (!res.ok) {
            // If 400 error usually means "page out of bounds", so we stop
            if (res.status === 400) break; 
            throw new Error(`WP Error: ${res.status} ${res.statusText}`);
        }

        const posts = await res.json();
        if (posts.length === 0) {
            hasMore = false;
        } else {
            allPosts.push(...posts);
            if (onProgress) onProgress(allPosts.length);
            page++;
        }
    } catch (e) {
        console.warn(`Fetch loop interrupted at page ${page}:`, e);
        hasMore = false;
    }
  }
  return allPosts;
};

export const fetchRecentPostHeaders = async (conn: WPConnection): Promise<WPPostHeader[]> => {
    const res = await fetchWithRetry(`${cleanUrl(conn.url)}/wp-json/wp/v2/posts?per_page=5&_fields=id,date,modified,title,link,slug,categories&status=publish`, {
        headers: { 'Authorization': getAuthHeader(conn) }
    });

    if (!res.ok) {
        throw new Error(`WP Connection Error: ${res.status} ${res.statusText}`);
    }

    return await res.json();
};

export const fetchPostContent = async (conn: WPConnection, id: number): Promise<WPPostFull> => {
  const baseUrl = cleanUrl(conn.url);
  const authHeaders = { 'Authorization': getAuthHeader(conn) };

  // STRATEGY 1: Authenticated Edit Context (Best Data, includes protected content)
  try {
      const res = await fetchWithRetry(`${baseUrl}/wp-json/wp/v2/posts/${id}?context=edit&_fields=id,content,modified,title,link,slug`, {
        headers: authHeaders
      });
      
      if (res.ok) return await res.json();
      
      // If 4xx, strictly throw to trigger fallback
      if (res.status >= 400 && res.status < 500) {
          throw new Error(`Context Fetch Failed: ${res.status}`);
      }
      // If 5xx, throw as well
      throw new Error(`Server Error: ${res.status}`);
  } catch (e) {
      console.warn(`[WP Service] Strategy 1 (Edit Context) failed for ID ${id}.`, e);
  }

  // STRATEGY 2: Public View (Standard Route)
  // Sometimes 'context=edit' is blocked by security plugins, but public read is open.
  try {
      const resFallback = await fetchWithRetry(`${baseUrl}/wp-json/wp/v2/posts/${id}?_fields=id,content,modified,title,link,slug`, {
          headers: authHeaders 
      });
      
      if (resFallback.ok) return await resFallback.json();
  } catch (e) {
      console.warn(`[WP Service] Strategy 2 (Public Route) failed for ID ${id}.`, e);
  }

  // STRATEGY 3: Ultimate Fallback (Filter Query)
  // Fixes "404 Not Found" on single resources caused by Broken Permalinks or Nginx Rewrite Rules.
  // /wp-json/wp/v2/posts?include=123 ALWAYS works if the list endpoint works (which it does, since we listed posts).
  try {
      console.log(`[WP Service] Engaging Strategy 3 (List Filter) for ID ${id}...`);
      const resList = await fetchWithRetry(`${baseUrl}/wp-json/wp/v2/posts?include=${id}&_fields=id,content,modified,title,link,slug`, {
          headers: authHeaders
      });
      
      if (resList.ok) {
          const data = await resList.json();
          if (Array.isArray(data) && data.length > 0) {
              return data[0];
          }
      }
  } catch (e) {
      console.error(`[WP Service] Strategy 3 (List Filter) failed for ID ${id}.`, e);
  }

  throw new Error(`Could not fetch post content (ID: ${id}). All strategies failed. Check permalinks setting in WordPress.`);
};

export const updatePostRemote = async (conn: WPConnection, id: number, data: any): Promise<void> => {
  const res = await fetchWithRetry(`${cleanUrl(conn.url)}/wp-json/wp/v2/posts/${id}`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(conn),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`WP Update Error: ${res.status} ${res.statusText}`);
};

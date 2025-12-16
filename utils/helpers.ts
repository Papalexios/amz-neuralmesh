
import { PostHealth, WPPostFull, AmazonProduct, ProductDetection, ProductOverride } from '../types';

export const tokenize = (text: string): Set<string> => {
  const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'to', 'for', 'of', 'with', 'by']);
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  return new Set(words);
};

export const calculateRelevance = (tokensA: Set<string>, tokensB: Set<string>): number => {
  let intersection = 0;
  tokensA.forEach(t => { if (tokensB.has(t)) intersection++; });
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

export const stripHtmlPreservingStructure = (html: string): string => {
  let clean = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, "");
  clean = clean.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gm, "");
  clean = clean.replace(/<\/p>|<\/h\d>|<\/div>|<\/li>/gi, "\n");
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  return doc.body.textContent || "";
};

// SOTA Health Parser
export const parseHealth = (post: WPPostFull | null, dateStr: string, siteUrl: string): PostHealth['metrics'] => {
  const diffDays = post ? Math.ceil(Math.abs(new Date().getTime() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)) : 0;

  if (!post) {
    return {
      wordCount: 0, hasSchema: false, hasVerdict: false, brokenMedia: 0, internalLinks: 0, externalLinks: 0, entityDensity: 0, lastUpdatedDayCount: diffDays, informationGainScore: 0
    };
  }

  const doc = new DOMParser().parseFromString(post.content.rendered, 'text/html');
  const text = doc.body.textContent || '';
  const cleanSiteUrl = siteUrl.replace(/\/$/, '');

  const hasSchema = post.content.rendered.includes('application/ld+json');
  const hasVerdict = /verdict|conclusion|summary|pros and cons|bottom line/i.test(text);
  
  const links = Array.from(doc.querySelectorAll('a'));
  const internalLinks = links.filter(a => a.href.includes(cleanSiteUrl) || a.href.startsWith('/')).length;
  const externalLinks = links.filter(a => !a.href.includes(cleanSiteUrl) && !a.href.startsWith('/') && a.href.startsWith('http')).length;

  const words = text.split(/\s+/);
  const capitalized = words.filter(w => /^[A-Z][a-z]+/.test(w)).length;
  const entityDensity = words.length > 0 ? (capitalized / words.length) * 100 : 0;

  return {
    wordCount: words.length,
    hasSchema,
    hasVerdict,
    brokenMedia: 0,
    internalLinks,
    externalLinks, // New Metric
    entityDensity,
    lastUpdatedDayCount: diffDays,
    informationGainScore: entityDensity * 2
  };
};

export const calculateScore = (metrics: PostHealth['metrics']): { seo: number, aeo: number } => {
  let seo = 100;
  let aeo = 100;

  if (metrics.lastUpdatedDayCount > 365) seo -= 20;
  if (metrics.wordCount < 800) seo -= 10;
  if (metrics.internalLinks < 3) seo -= 15;
  if (metrics.externalLinks < 2) seo -= 10; // Penalty for no references
  if (!metrics.hasSchema) seo -= 10;

  if (!metrics.hasVerdict) aeo -= 30;
  if (metrics.entityDensity < 10) aeo -= 20;
  if (metrics.wordCount < 1200) aeo -= 10;
  if (!metrics.hasSchema) aeo -= 25;

  return { seo: Math.max(0, seo), aeo: Math.max(0, aeo) };
};

// --- SOTA Monetization Helpers ---

export const isValidAsin = (text: string): boolean => {
  return /^[B0-9][A-Z0-9]{9}$/.test(text.toUpperCase());
};

export const constructAmazonUrl = (asin: string, tag?: string): string => {
  const cleanAsin = asin.toUpperCase().trim();
  const affiliateTag = tag ? `?tag=${tag}` : '';
  return `https://www.amazon.com/dp/${cleanAsin}${affiliateTag}`;
};

export const generateProductBoxHTML = (
    productName: string, 
    amazonData: AmazonProduct | null | undefined, 
    manualOverride: ProductOverride | undefined,
    affiliateTag: string
): string => {
    const year = new Date().getFullYear() + 1;
    
    // PRIORITY: Manual Override > Amazon API Data > AI Guess
    const name = manualOverride?.title || amazonData?.title || productName;
    const image = manualOverride?.image || amazonData?.imageUrl || 'https://placehold.co/600x400/e2e8f0/1e293b?text=Product+Image';
    const price = manualOverride?.price || amazonData?.price || "Check Price";
    const rating = amazonData?.rating || "9.5";
    const reviewCount = amazonData?.reviewCount || "Hundreds of";

    // LINK CONSTRUCTION
    let url = '#';
    // 1. Manual ASIN
    if (manualOverride?.asin && isValidAsin(manualOverride.asin)) {
         url = `https://www.amazon.com/dp/${manualOverride.asin.trim().toUpperCase()}?tag=${affiliateTag}`;
    } 
    // 2. Detected Amazon Data ASIN
    else if (amazonData?.asin && isValidAsin(amazonData.asin)) {
         url = `https://www.amazon.com/dp/${amazonData.asin}?tag=${affiliateTag}`;
    }
    // 3. Detected URL
    else if (amazonData?.url) {
         url = amazonData.url;
    } 
    // 4. Fallback Search
    else {
         url = `https://www.amazon.com/s?k=${encodeURIComponent(name)}&tag=${affiliateTag}`;
    }

    // Inline CSS for maximum WordPress Compatibility (block themes, classic editor, etc.)
    return `
    <div class='sota-product-card' style='border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff; margin: 40px 0; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); font-family: sans-serif;'>
       <div style='background: #1e293b; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center;'>
          <div style='font-weight: 700; text-transform: uppercase; font-size: 14px; letter-spacing: 0.05em; color: #ffffff;'>Top Choice ${year}</div>
          <div style='background: #22c55e; color: #022c22; padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: 800;'>${rating}/10</div>
       </div>
       <div style='padding: 24px; display: flex; flex-direction: column; gap: 24px;'>
          <div style='display: flex; flex-direction: row; gap: 24px; align-items: flex-start; flex-wrap: wrap;'>
              <div style='flex: 1; min-width: 200px; display: flex; justify-content: center; align-items: center;'>
                 <img src='${image}' alt='${name.replace(/'/g, "")}' style='max-width: 100%; max-height: 250px; width: auto; height: auto; object-fit: contain; mix-blend-mode: multiply;'>
              </div>
              <div style='flex: 1.5; min-width: 280px;'>
                 <h3 style='margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;'>${name}</h3>
                 <ul style='list-style: none; padding: 0; margin: 0 0 20px 0; color: #475569; font-size: 15px; line-height: 1.6;'>
                    ${amazonData?.features ? amazonData.features.slice(0,3).map(f => `<li style='margin-bottom:6px; display: flex; align-items: flex-start;'><span style='color: #22c55e; margin-right: 8px;'>✓</span>${f}</li>`).join('') : `<li><span style='color: #22c55e; margin-right: 8px;'>✓</span>2026 Model Upgrade</li><li><span style='color: #22c55e; margin-right: 8px;'>✓</span>High Performance</li>`}
                 </ul>
                 <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-top: 10px; border-top: 1px solid #f1f5f9;">
                    <span style="font-size: 22px; font-weight: 800; color: #0f172a;">${price}</span>
                    <span style="font-size: 13px; color: #64748b;">${reviewCount} Verified Reviews</span>
                 </div>
                 <a href='${url}' target="_blank" rel="nofollow sponsored" style='display: block; width: 100%; background: #ea580c; background: linear-gradient(to right, #ea580c, #c2410c); color: white; text-align: center; padding: 14px; border-radius: 8px; font-weight: 700; font-size: 16px; text-decoration: none; box-shadow: 0 4px 6px -1px rgba(234, 88, 12, 0.3); transition: transform 0.2s;'>
                    Check Price on Amazon &rarr;
                 </a>
              </div>
          </div>
       </div>
    </div>`;
};

export const renderFinalHtml = (
    template: string, 
    detectedProducts: ProductDetection[], 
    overrides: Record<string, ProductOverride> | undefined,
    affiliateTag?: string
): string => {
    let finalBody = template;
    const tag = affiliateTag || 'tag-20';

    detectedProducts.forEach((prod, idx) => {
        const override = overrides?.[prod.name];
        const boxHtml = generateProductBoxHTML(prod.name, prod.amazonData, override, tag);
        
        const placeholder = `[[PRODUCT_BOX:${idx}]]`;
        
        if (finalBody.includes(placeholder)) {
            finalBody = finalBody.replace(placeholder, boxHtml);
        } else {
            // FAILSAFE: If AI forgot the placeholder, inject it intelligently.
            // Look for the header (H2/H3) that matches the product name or simplified name
            const cleanName = prod.name.split(' ').slice(0, 3).join(' '); // First 3 words
            const headerRegex = new RegExp(`(<h[23][^>]*>.*?${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?<\/h[23]>)`, 'i');
            
            if (headerRegex.test(finalBody)) {
                // Inject AFTER the header
                finalBody = finalBody.replace(headerRegex, `$1\n${boxHtml}`);
            } else {
                // Ultimate Fallback: Append to top of section or body if nothing matches
                // For simplicity in this fail state, prepend to body if it's the first product, else append
                if (idx === 0 && !finalBody.includes('sota-product-card')) {
                    finalBody = boxHtml + finalBody;
                }
            }
        }
    });

    return finalBody;
};

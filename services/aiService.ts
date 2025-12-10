import { GoogleGenAI } from '@google/genai';
import { AIAnalysisResult, SemanticNode, AIConfig, ReferenceData, PAAData, ProductDetection, AmazonProduct } from '../types';
import { searchAmazonProduct } from './amazonService';

interface AIResponseSchema {
  newTitle?: string;
  metaDescription?: string;
  blufSentence?: string;
  sgeSummaryHTML?: string;
  verdictData?: {
    score: number;
    pros: string[];
    cons: string[];
    summary: string;
    targetAudience: string;
  };
  productBoxHTML?: string;
  comparisonTableHTML?: string;
  faqHTML?: string;
  schemaJSON?: string;
  contentWithLinks?: string;
  detectedOldProduct?: string;
  identifiedNewProduct?: string;
  newProductSpecs?: { price: string; rating: number; reviewCount: number };
  commercialIntent?: boolean;
  detectedProducts?: ProductDetection[];
  usedInternalLinks?: string[];
}

export const getEmbedding = async (text: string, apiKey: string): Promise<number[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });
    return result.embeddings?.[0]?.values || [];
  } catch (e) {
    console.warn("Embedding generation failed, falling back to keyword match", e);
    return [];
  }
};

// SOTA LINK FIREWALL (Fuzzy Matching)
const validateAndSanitizeLinks = (html: string, validNodes: SemanticNode[], siteUrl: string): string => {
  const validPaths = new Set<string>();
  
  // Normalizer: strips protocol, domain, trailing slash, query params
  const normalize = (u: string) => {
    try {
        let clean = u.toLowerCase().trim();
        // Remove domain if present
        if (clean.startsWith('http')) {
            const urlObj = new URL(clean);
            clean = urlObj.pathname;
        }
        // Ensure starting slash
        if (!clean.startsWith('/')) clean = '/' + clean;
        // Remove trailing slash
        return clean.replace(/\/$/, '');
    } catch {
        return u.replace(/\/$/, '').toLowerCase();
    }
  };

  validNodes.forEach(n => validPaths.add(normalize(n.url)));

  return html.replace(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi, (match, quote, href, text) => {
    const cleanHref = href.trim();
    const normalizedTarget = normalize(cleanHref);
    
    let isInternalCandidate = false;
    if (cleanHref.startsWith('/') || (siteUrl && cleanHref.includes(siteUrl))) {
        isInternalCandidate = true;
    } else if (!cleanHref.startsWith('http') && !cleanHref.startsWith('#') && !cleanHref.startsWith('mailto')) {
        isInternalCandidate = true;
    }

    if (isInternalCandidate) {
        const isValid = validPaths.has(normalizedTarget);
        if (isValid) {
            // Find the canonical full URL from the node list
            const matchedNode = validNodes.find(n => normalize(n.url) === normalizedTarget);
            const finalUrl = matchedNode ? matchedNode.url : cleanHref;
            return `<a href="${finalUrl}" class="sota-internal-link" title="Read more: ${text.replace(/"/g, '')}">${text}</a>`;
        } else {
            // Strip hallucinated links
            return `<span class="sota-text-highlight" title="Link stripped - not in sitemap">${text}</span>`;
        }
    }
    
    // Auto-tag affiliate links
    if (cleanHref.includes('amazon') || cleanHref.includes('amzn.to')) {
         return `<a href="${cleanHref}" target="_blank" rel="nofollow sponsored" class="sota-affiliate-link">${text}</a>`;
    }

    return match;
  });
};

const forceHtmlStructure = (text: string): string => {
  let clean = text;
  // Remove AI meta-commentary
  clean = clean.replace(/\(\d+\s*words,?\s*total\s*\d+\)/gi, '');
  clean = clean.replace(/\[End of section\]/gi, '');
  clean = clean.replace(/^Here is the .*?:/gim, '');
  clean = clean.replace(/^Bottom Line Up Front:/gim, '');
  clean = clean.replace(/^Quick Verdict:/gim, '');
  
  // Force Markdown to HTML
  clean = clean.replace(/^##\s+(.*$)/gim, '<h2>$1</h2>');
  clean = clean.replace(/^###\s+(.*$)/gim, '<h3>$1</h3>');
  clean = clean.replace(/^####\s+(.*$)/gim, '<h4>$1</h4>');
  clean = clean.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  clean = clean.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  if (!clean.includes('<ul>') && (clean.includes('\n- ') || clean.includes('\n* '))) {
      clean = clean.replace(/(?:^|\n)[-*]\s+(.*)/g, '<li>$1</li>');
      clean = clean.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  }
  return clean.trim();
};

// DIRTY JSON RESCUE ENGINE
// Extracts JSON fields via Regex if JSON.parse fails.
const extractFieldRegex = (text: string, key: string): string => {
    // Look for key: "value", handling escaped quotes
    const regex = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's');
    const match = text.match(regex);
    if (match && match[1]) {
        return match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }
    return "";
};

const extractVerdictRegex = (text: string) => {
    try {
        const scoreMatch = text.match(/"score"\s*:\s*(\d+)/);
        const summaryMatch = text.match(/"summary"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/);
        const prosMatch = text.match(/"pros"\s*:\s*\[(.*?)\]/s);
        const consMatch = text.match(/"cons"\s*:\s*\[(.*?)\]/s);

        const parseList = (str: string) => {
            if (!str) return [];
            return str.split(',').map(s => s.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"'));
        };

        return {
            score: scoreMatch ? parseInt(scoreMatch[1]) : 85,
            summary: summaryMatch ? summaryMatch[1].replace(/\\"/g, '"') : "Verdict analysis available in deep dive below.",
            pros: prosMatch ? parseList(prosMatch[1]) : ["High Performance", "Good Value"],
            cons: consMatch ? parseList(consMatch[1]) : ["Check availability"],
            targetAudience: "Enthusiasts"
        };
    } catch {
        return { score: 0, pros: [], cons: [], summary: "Error extracting verdict.", targetAudience: "General" };
    }
};

const cleanJsonOutput = (text: string): string => {
  let clean = text;
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) clean = codeBlockMatch[1];

  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    clean = clean.substring(start, end + 1);
  }
  
  // Remove comments
  clean = clean.replace(/\/\/.*$/gm, ''); 
  // Remove trailing commas
  clean = clean.replace(/,(\s*[}\]])/g, '$1');
  
  // MOLECULAR SANITIZER: Strip control characters \x00-\x1F
  clean = clean.replace(/[\x00-\x1F]/g, '');

  // Flatten newlines to prevent "Bad control character"
  clean = clean.replace(/\n/g, ' '); 
  clean = clean.replace(/\r/g, '');
  clean = clean.replace(/\t/g, ' ');

  return clean;
};

const parseAIResponse = (text: string | undefined, references: ReferenceData[], topKeywords: string[], validNodes: SemanticNode[], config: AIConfig, amazonProduct?: AmazonProduct): AIAnalysisResult => {
  if (!text) throw new Error("AI returned empty text");

  let parsed: AIResponseSchema | null = null;
  
  // ATTEMPT 1: Standard Parse with SOTA Cleaning
  try {
    const cleanJson = cleanJsonOutput(text);
    parsed = JSON.parse(cleanJson) as AIResponseSchema;
  } catch (e) {
    console.warn("Standard JSON parse failed. Attempting Dirty Rescue...", e);
  }

  // ATTEMPT 2: Dirty Rescue (Regex Extraction)
  if (!parsed) {
      console.log("Engaging Regex Rescue Engine");
      parsed = {
          newTitle: extractFieldRegex(text, "newTitle") || "Updated Guide 2026",
          metaDescription: extractFieldRegex(text, "metaDescription"),
          blufSentence: extractFieldRegex(text, "blufSentence"),
          sgeSummaryHTML: extractFieldRegex(text, "sgeSummaryHTML"),
          productBoxHTML: extractFieldRegex(text, "productBoxHTML"),
          contentWithLinks: extractFieldRegex(text, "contentWithLinks"),
          verdictData: extractVerdictRegex(text)
      };
      
      if (!parsed.contentWithLinks || parsed.contentWithLinks.length < 50) {
          throw new Error(`AI Generation Failed. Output too short or malformed.`);
      }
  }

  // --- SOTA INJECTION: DOM-BASED MANIPULATION ---
  let finalProductBox = parsed.productBoxHTML || "";
  
  if (amazonProduct && finalProductBox) {
      try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(`<div>${finalProductBox}</div>`, 'text/html');
          
          const img = doc.querySelector('[data-sota-type="product-image"]') || doc.querySelector('img.sota-product-image') || doc.querySelector('img');
          if (img) {
              img.setAttribute('src', amazonProduct.imageUrl);
              img.setAttribute('alt', amazonProduct.title);
              img.setAttribute('data-sota-type', 'product-image');
          }

          const titleEl = doc.querySelector('[data-sota-type="product-title"]') || doc.querySelector('h3');
          if (titleEl) {
              titleEl.textContent = amazonProduct.title;
              titleEl.setAttribute('data-sota-type', 'product-title');
          }

          const linkEl = doc.querySelector('[data-sota-type="product-link"]') || doc.querySelector('a.sota-buy-button') || doc.querySelector('a');
          if (linkEl) {
              linkEl.setAttribute('href', amazonProduct.url);
              linkEl.setAttribute('data-sota-type', 'product-link');
              linkEl.innerHTML = `Check Best Price &rarr;`; 
          }
          
          finalProductBox = doc.body.innerHTML;
      } catch (e) {
          console.warn("DOM Injection failed, fallback", e);
          finalProductBox = finalProductBox.replace(/src=["'][^"']*placeholder[^"']*["']/gi, `src='${amazonProduct.imageUrl}'`);
      }
  }

  const structuredContent = forceHtmlStructure(parsed.contentWithLinks || "");
  const sanitizedContent = validateAndSanitizeLinks(structuredContent, validNodes, config.wpUrl || "");

  const referencesHTML = references.length > 0 ? `
    <section class="sota-references" style="margin-top: 60px; padding: 30px; background: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
      <h2 style="font-size: 1.5rem; font-weight: 800; color: #0f172a; margin-bottom: 20px;">Fact Checked Sources</h2>
      <ul style="list-style: none; padding: 0;">
        ${references.slice(0, 5).map(ref => `
          <li style="margin-bottom: 12px;"><a href="${ref.link}" target="_blank" rel="nofollow" style="color: #2563eb; font-weight: 600;">${ref.title}</a></li>
        `).join('')}
      </ul>
    </section>
  ` : '';

  return {
    newTitle: parsed.newTitle || "Updated Guide 2026",
    metaDescription: parsed.metaDescription || "",
    blufSentence: (parsed.blufSentence || "").replace(/^Bottom Line Up Front:\s*/i, ''),
    sgeSummaryHTML: (parsed.sgeSummaryHTML || "").replace(/^Quick Verdict:\s*/i, ''),
    verdictData: parsed.verdictData || { score: 0, pros: [], cons: [], summary: "", targetAudience: "" },
    productBoxHTML: finalProductBox,
    comparisonTableHTML: parsed.comparisonTableHTML || "",
    faqHTML: parsed.faqHTML || "",
    schemaJSON: parsed.schemaJSON || "{}",
    contentWithLinks: sanitizedContent,
    referencesHTML,
    detectedOldProduct: parsed.detectedOldProduct || "Unknown",
    identifiedNewProduct: amazonProduct ? amazonProduct.title : (parsed.identifiedNewProduct || "New Model"),
    newProductSpecs: parsed.newProductSpecs || { price: amazonProduct ? amazonProduct.price : "Check", rating: 0, reviewCount: 0 },
    keywordsUsed: topKeywords,
    commercialIntent: parsed.commercialIntent ?? false,
    detectedProducts: amazonProduct ? [{ name: amazonProduct.title, url: amazonProduct.url, asin: amazonProduct.asin, amazonData: amazonProduct }] : (parsed.detectedProducts || []),
    usedInternalLinks: parsed.usedInternalLinks || []
  };
};

const extractTopKeywords = (refs: ReferenceData[]): string[] => {
  const text = refs.map(r => r.title + " " + r.snippet).join(" ").toLowerCase();
  const words = text.replace(/[^\w\s]/g, '').split(/\s+/);
  const freq: Record<string, number> = {};
  const stopWords = new Set(['the', 'best', 'review', 'guide', 'top', 'with', 'what', 'how', 'check', 'price', 'amazon']);
  words.forEach(w => { if (w.length > 3 && !stopWords.has(w)) freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 40).map(e => e[0]);
};

const callOpenAICompatible = async (url: string, model: string, apiKey: string, system: string, prompt: string) => {
    const TIMEOUT_MS = 900000; // 15 Minutes
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const doFetch = async (useJsonMode: boolean) => {
        const bodyPayload: any = {
            model: model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 8192
        };
        // Some models (DeepSeek/Grok) fail with json_object mode, allow retry without
        if (useJsonMode) bodyPayload.response_format = { type: "json_object" };

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(bodyPayload),
            signal: controller.signal
        });
        
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`${res.status}|${errText}`);
        }
        return res.json();
    };

    try {
        try {
            const data = await doFetch(true);
            clearTimeout(id);
            return data.choices?.[0]?.message?.content || "";
        } catch (e: any) {
            if (e.message.includes('400') || e.message.includes('Provider')) {
                const data = await doFetch(false);
                clearTimeout(id);
                return data.choices?.[0]?.message?.content || "";
            }
            throw e;
        }
    } catch (e: any) {
        clearTimeout(id);
        throw new Error(`Provider Error: ${e.message}`);
    }
};

const callGemini = async (model: string, apiKey: string, system: string, prompt: string) => {
    if (!apiKey) throw new Error("API Key Missing");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: { 
            systemInstruction: system, 
            responseMimeType: "application/json",
            maxOutputTokens: 8192 
        }
    });
    return response.text;
};

// SOTA Entity Extraction for Amazon
const extractCoreEntity = (title: string): string => {
    let text = title;
    if (text.includes('http') || text.includes('/')) {
        try {
            const url = new URL(text.startsWith('http') ? text : `http://${text}`);
            const pathParts = url.pathname.split('/').filter(Boolean);
            text = pathParts.length > 0 ? pathParts[pathParts.length - 1] : title;
            text = text.replace(/-/g, ' '); 
        } catch {
            text = title;
        }
    }
    const stopWords = /\b(review|best|guide|vs|comparison|top|rated|ultimate|complete|ranking|list|for|the|a|an|updates?|20\d\d)\b/gi;
    text = text.replace(stopWords, ' ');
    text = text.replace(/[^\w\s]/g, '');
    return text.replace(/\s+/g, ' ').trim();
};

export const analyzeAndGenerateAssets = async (
  currentTitle: string,
  rawText: string,
  semanticNeighbors: SemanticNode[],
  externalRefs: ReferenceData[],
  paaQuestions: PAAData[],
  config: AIConfig
): Promise<AIAnalysisResult> => {
  
  if (!config.apiKey) throw new Error("Missing API Key");

  const affiliateTag = config.amazonAffiliateTag || 'tag-20';
  const semanticKeywords = extractTopKeywords(externalRefs);
  const targetYear = new Date().getFullYear() + 1;

  // --- STEP 1: AUTONOMOUS RESEARCH ---
  const coreEntity = extractCoreEntity(currentTitle);
  let amazonProduct: AmazonProduct | null = null;
  
  if (coreEntity.length > 2 && config.amazonAffiliateTag) {
      console.log(`[Amazon PA-API] Searching for entity: "${coreEntity}"`);
      amazonProduct = await searchAmazonProduct(coreEntity, config);
  }

  // --- STEP 2: VISUALS ---
  const PRODUCT_BOX_DESIGN = `
    DESIGN INSTRUCTION:
    Generate 'productBoxHTML' using EXACTLY this DOM structure.
    CRITICAL: Use SINGLE QUOTES for HTML attributes (e.g. class='box') to avoid JSON errors.
    
    <div class='sota-product-card' style='font-family: system-ui; border: 1px solid rgba(0,0,0,0.1); border-radius: 20px; overflow: hidden; background: white; margin: 40px 0;'>
       <div style='background: #0f172a; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; color: white;'>
          <div style='font-weight: 800; text-transform: uppercase;'>🏆 TOP PICK ${targetYear}</div>
          <div style='background: #22c55e; color: #022c22; padding: 4px 12px; border-radius: 99px; font-size: 0.75rem; font-weight: 800;'>9.8/10 SCORE</div>
       </div>
       <div style='padding: 30px; display: flex; flex-wrap: wrap; gap: 30px; align-items: center;'>
          <div style='flex: 1; text-align: center;'>
             <img src='placeholder.jpg' alt='Product' class='sota-product-image' data-sota-type='product-image' style='max-width: 100%; height: auto; max-height: 250px; object-fit: contain;'>
          </div>
          <div style='flex: 1.5;'>
             <h3 data-sota-type='product-title' style='margin: 0 0 10px; font-size: 1.8rem; font-weight: 800; color: #0f172a;'>[Product Name]</h3>
             <p style='color: #64748b; font-style: italic; margin-bottom: 20px;'>[One Sentence Hook]</p>
             <a href='https://www.amazon.com/s?k=[Product Name]&tag=${affiliateTag}' class='sota-buy-button' data-sota-type='product-link' style='display: block; width: 100%; background: #2563eb; color: white; text-align: center; padding: 16px; border-radius: 12px; font-weight: 800; text-decoration: none;'>Check Best Price &rarr;</a>
          </div>
       </div>
    </div>
  `;

  // --- STEP 3: MESH INVENTORY ---
  const meshInventory = semanticNeighbors
      .map((n, i) => `[LINK_${i}] URL: ${n.url} | Title: "${n.title}"`)
      .join('\n');

  const refContext = externalRefs.slice(0, 15).map(r => `FACT: ${r.title} - ${r.snippet}`).join('\n');

  const systemPrompt = `
    ROLE: You are the World's Best Conversion Copywriter & AEO Engineer.
    
    CRITICAL MANDATE:
    ${amazonProduct ? `You have been provided VERIFIED DATA for: "${amazonProduct.title}". 
    You MUST write this review about THIS SPECIFIC PRODUCT ("${amazonProduct.title}"). 
    Do NOT hallucinate a different successor. Do NOT write about a "Pixel Watch" if the data says "Samsung". 
    Align the entire content with the provided Amazon Product.` : `Find the logical successor product for ${targetYear}.`}

    STYLE GUIDE (HORMOZI MODE):
    - Short sentences. 
    - High agency ("Do this", not "You could do this"). 
    - No fluff. No "In conclusion". No "Unlock".
    - Grade 5 Reading Level.

    STRUCTURE MANDATE (5-PILLAR):
    1. **Hook (BLUF):** Direct answer. 100 words.
    2. **SOTA Product Box:** (Use template above).
    3. **Comparison Table:** HTML table comparing Old vs New.
    4. **Deep Dive (The Meat):** 
       - MUST be at least 1500 words.
       - Subsections: Performance, Design, Real-World Test, Battery.
       - Use "I" and "We". Proof of expertise.
    5. **Verdict:** Score and Recommendation.

    LINKING MANDATE:
    - You MUST use 8-12 internal links from the Inventory below.
    - Use Rich Anchor Text (e.g. "See our guide on [X]" not "Click here").
    - INVENTORY:
    ${meshInventory}

    ${PRODUCT_BOX_DESIGN}

    OUTPUT JSON SCHEMA (STRICT):
    Return MINIFIED JSON (single line). No newlines in values. Use SINGLE QUOTES for HTML attributes.
    {
      "newTitle": "Viral Title",
      "metaDescription": "Description",
      "blufSentence": "Answer",
      "sgeSummaryHTML": "Summary",
      "productBoxHTML": "HTML (Single Quotes!)",
      "comparisonTableHTML": "HTML",
      "verdictData": { "score": 95, "pros": ["string"], "cons": ["string"], "summary": "string", "targetAudience": "string" },
      "contentWithLinks": "Full HTML Body (1500+ words)",
      "faqHTML": "HTML",
      "detectedOldProduct": "Old",
      "identifiedNewProduct": "New"
    }
  `;

  const userMessage = `
    TOPIC: "${coreEntity}"
    CONTENT: "${rawText.substring(0, 8000)}..."
    COMPETITOR DATA: ${refContext}
    KEYWORDS: ${semanticKeywords.slice(0, 30).join(', ')}
  `;

  let currentModel = config.model;
  const MAX_RETRIES = 3;

  for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        let responseText = "";
        const provider = config.provider;
        
        if (provider === 'gemini') {
            responseText = await callGemini(currentModel, config.apiKey, systemPrompt, userMessage);
        } else {
            const url = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 
                        provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 
                        'https://api.openai.com/v1/chat/completions';
            
            let attemptModel = currentModel;
            if (i > 0 && provider === 'openai') attemptModel = 'gpt-4-turbo'; 

            responseText = await callOpenAICompatible(url, attemptModel, config.apiKey, systemPrompt, userMessage);
        }

        return parseAIResponse(responseText, externalRefs, semanticKeywords, semanticNeighbors, config, amazonProduct || undefined);
      } catch (e: any) {
         console.warn(`Attempt ${i+1} Failed:`, e.message);
         if (e.message.includes('404') || e.message.includes('400')) currentModel = 'gemini-1.5-flash';
         if (i === MAX_RETRIES - 1) throw new Error(`AI Failed: ${e.message}`);
         await new Promise(r => setTimeout(r, 2000)); 
      }
  }
  throw new Error("AI Generation Failed.");
};
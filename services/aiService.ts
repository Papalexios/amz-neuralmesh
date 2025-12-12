
import { GoogleGenAI } from '@google/genai';
import { AIAnalysisResult, SemanticNode, AIConfig, ReferenceData, PAAData, ProductDetection, AmazonProduct, AIStrategy, DraftMode } from '../types';
import { searchAmazonProduct } from './amazonService';

// --- TEMPLATES (Hardcoded for Consistency) ---

const generateProductBoxHTML = (strategy: AIStrategy, amazonProduct: AmazonProduct | null, affiliateTag: string): string => {
    const year = new Date().getFullYear() + 1;
    const name = amazonProduct ? amazonProduct.title : strategy.newProduct;
    const image = amazonProduct ? amazonProduct.imageUrl : 'https://placehold.co/600x400/e2e8f0/1e293b?text=Product+Image';
    const price = amazonProduct ? amazonProduct.price : strategy.specs.price;
    const rating = amazonProduct ? amazonProduct.rating : strategy.specs.rating;
    const url = amazonProduct ? amazonProduct.url : `https://www.amazon.com/s?k=${encodeURIComponent(name)}&tag=${affiliateTag}`;

    return `
    <div class='sota-product-card' style='border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background: white; margin: 40px 0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);'>
       <div style='background: #0f172a; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; color: white;'>
          <div style='font-weight: 800; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.05em;'>🏆 Editor's Choice ${year}</div>
          <div style='background: #22c55e; color: #022c22; padding: 4px 12px; border-radius: 99px; font-size: 0.75rem; font-weight: 800;'>${rating}/10</div>
       </div>
       <div style='padding: 24px; display: flex; flex-direction: column; md:flex-row; gap: 24px; align-items: center;'>
          <div style='flex: 1; text-align: center; width: 100%;'>
             <img src='${image}' alt='${name}' data-sota-type='product-image' style='width: 100%; max-width: 250px; height: auto; object-fit: contain; margin: 0 auto;'>
          </div>
          <div style='flex: 1.5; width: 100%;'>
             <h3 data-sota-type='product-title' style='margin: 0 0 8px; font-size: 1.5rem; font-weight: 800; color: #0f172a; line-height: 1.2;'>${name}</h3>
             <p style='color: #64748b; font-size: 0.95rem; margin-bottom: 20px;'>${strategy.bluf}</p>
             <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                <span style="font-size: 1.25rem; font-weight: 800; color: #0f172a;">${price}</span>
                <span style="font-size: 0.8rem; color: #64748b;">${strategy.specs.reviewCount} Reviews</span>
             </div>
             <a href='${url}' target="_blank" rel="nofollow sponsored" class='sota-buy-button' data-sota-type='product-link' style='display: block; width: 100%; background: #2563eb; color: white; text-align: center; padding: 14px; border-radius: 10px; font-weight: 700; text-decoration: none; transition: background 0.2s;'>Check Best Price on Amazon &rarr;</a>
          </div>
       </div>
    </div>`;
};

// --- TS LOGIC: FAQ GENERATION ---
const generateFaqHtmlAndSchema = (faqs: {q: string, a: string}[]) => {
    if (!faqs || faqs.length === 0) return { html: '', schemaObj: null };

    const html = `
    <div class="sota-faq-section" style="margin-top: 40px;">
        <h2 style="font-size: 1.5rem; font-weight: 800; margin-bottom: 20px;">Frequently Asked Questions</h2>
        ${faqs.map(item => `
        <details style="margin-bottom: 12px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #fff;">
            <summary style="font-weight: 600; cursor: pointer; color: #0f172a;">${item.q}</summary>
            <p style="margin-top: 10px; color: #475569; font-size: 0.95rem; line-height: 1.6;">${item.a}</p>
        </details>
        `).join('')}
    </div>`;

    const schemaObj = {
        "@type": "FAQPage",
        "mainEntity": faqs.map(item => ({
            "@type": "Question",
            "name": item.q,
            "acceptedAnswer": {
                "@type": "Answer",
                "text": item.a
            }
        }))
    };

    return { html, schemaObj };
};

// --- HELPER FUNCTIONS ---

const cleanJsonOutput = (text: string): string => {
  let clean = text;
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) clean = codeBlockMatch[1];
  clean = clean.trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    clean = clean.substring(start, end + 1);
  }
  return clean.replace(/[\x00-\x1F]+/g, ' '); 
};

// --- AI CALLERS ---

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

// --- PIPELINE STEP 1: STRATEGY ---

const generateStrategy = async (
    currentTitle: string,
    rawText: string,
    semanticNeighbors: SemanticNode[],
    externalRefs: ReferenceData[],
    config: AIConfig
): Promise<AIStrategy> => {
    
    const internalLinkInventory = semanticNeighbors.slice(0, 30).map(n => `ID: ${n.id} | Title: ${n.title}`).join('\n');
    const competitorData = externalRefs.slice(0, 8).map(r => `• ${r.title}: ${r.snippet}`).join('\n');
    const isRefresh = config.draftMode === 'refresh';

    const systemPrompt = `
        ROLE: Elite SEO Strategist (Hormozi Style).
        TASK: Create a ${isRefresh ? 'REFRESH' : 'FULL REWRITE'} strategy.
        
        INPUTS:
        - Current Title: "${currentTitle}"
        - Internal Link IDs: Available below.

        RULES:
        1. Identify New 2026 Successor Product.
        2. Select EXACTLY 6-10 Internal Link IDs from inventory.
        3. Define BLUF (Direct Answer, <30 words).
        4. Verdict: Score 0-100, Pros/Cons.
        ${isRefresh ? '5. Focus on WHAT CHANGED. Do not rewrite evergreen history.' : '5. Create full outline for a comprehensive guide.'}

        OUTPUT SCHEMA (JSON):
        {
            "oldProduct": "string",
            "newProduct": "string",
            "primaryKeyword": "string",
            "secondaryKeywords": ["string"],
            "targetAudience": "string",
            "verdict": { "score": 90, "pros": ["a","b"], "cons": ["c","d"], "summary": "string", "targetAudience": "string" },
            "specs": { "price": "$99", "rating": 9.5, "reviewCount": 1000 },
            "internalLinkIds": [123, 456],
            "outline": ["H2: ..."],
            "bluf": "string",
            "commercialIntent": boolean
        }
    `;

    const userPrompt = `
        CONTENT SNAPSHOT: ${rawText.substring(0, 1500)}...
        LINK INVENTORY: ${internalLinkInventory}
        COMPETITORS: ${competitorData}
    `;

    const json = await callGemini(config.model, config.apiKey, systemPrompt, userPrompt);
    return JSON.parse(cleanJsonOutput(json)) as AIStrategy;
};

// --- PIPELINE STEP 2: CONTENT GENERATION ---

const generateContentBlocks = async (
    strategy: AIStrategy,
    config: AIConfig
): Promise<{ 
    sgeSummary: string; 
    bodyHtml: string; 
    faqs: {q: string, a: string}[]; 
    comparisonTableHtml: string; 
}> => {

    const isRefresh = config.draftMode === 'refresh';

    const systemPrompt = `
        ROLE: Direct-Response SEO Copywriter.
        TASK: Write HTML blocks. No Markdown.
        
        STYLE:
        - Grade 6 reading level. Short sentences.
        - NO fluff ("In this article", "Conclusion").
        - Use <h3> for subsections.
        
        LINKING:
        - Insert placeholders [[LINK:${strategy.internalLinkIds[0] || 0}]] naturally.
        - Use at least 4 placeholders.

        ${isRefresh 
            ? 'MODE: REFRESH. Write a "Key Updates 2026" section (300-500 words) and a new Verdict. Do NOT write a full 2000 word article.' 
            : 'MODE: FULL. Write a complete 1500+ word deep dive.'}

        OUTPUT SCHEMA (JSON):
        {
            "sgeSummary": "HTML paragraph (Direct Answer)",
            "bodyHtml": "HTML Body (H2s, H3s, Ps).",
            "faqs": [ {"q": "Question?", "a": "Answer (2 sentences)."} ],
            "comparisonTableHtml": "HTML Table"
        }
    `;

    const userPrompt = `
        STRATEGY:
        - Product: ${strategy.newProduct}
        - BLUF: ${strategy.bluf}
        - Outline: ${strategy.outline.join(', ')}
        - Link IDs: ${strategy.internalLinkIds.join(', ')}

        EXECUTE.
    `;

    const json = await callGemini(config.model, config.apiKey, systemPrompt, userPrompt);
    return JSON.parse(cleanJsonOutput(json));
};

// --- MAIN ORCHESTRATOR ---

export const analyzeAndGenerateAssets = async (
    currentTitle: string,
    rawText: string,
    semanticNeighbors: SemanticNode[],
    externalRefs: ReferenceData[],
    paaQuestions: PAAData[],
    config: AIConfig
): Promise<AIAnalysisResult> => {

    const startTime = Date.now();
    console.log(`[AI Pipeline] Starting Analysis: ${currentTitle} (Mode: ${config.draftMode})`);
    
    // 1. STRATEGY PHASE
    const strategy = await generateStrategy(currentTitle, rawText, semanticNeighbors, externalRefs, config);

    // 2. PA-API ENRICHMENT
    let amazonProduct: AmazonProduct | null = null;
    if (config.amazonAffiliateTag && strategy.newProduct) {
        amazonProduct = await searchAmazonProduct(strategy.newProduct, config);
    }

    // 3. CONTENT PHASE
    const content = await generateContentBlocks(strategy, config);

    // 4. ASSEMBLY (TS LOGIC)
    
    // A. Link Injection (Hardened)
    let finalBody = content.bodyHtml;
    let linkCount = 0;
    const usedIds = new Set<number>();
    
    // Pass 1: Replace Placeholders
    strategy.internalLinkIds.forEach(id => {
        const node = semanticNeighbors.find(n => n.id === id);
        if (node) {
            const placeholderRegex = new RegExp(`\\[\\[LINK:${id}\\]\\]`, 'g');
            if (placeholderRegex.test(finalBody)) {
                finalBody = finalBody.replace(placeholderRegex, `<a href="${node.url}" class="sota-internal-link" title="${node.title}">${node.title}</a>`);
                linkCount++;
                usedIds.add(id);
            }
        }
    });

    // Pass 2: Fallback Injection (If AI forgot placeholders, append them)
    if (linkCount < 3) {
        const missingIds = strategy.internalLinkIds.filter(id => !usedIds.has(id)).slice(0, 3);
        if (missingIds.length > 0) {
            const linksHtml = missingIds
                .map(id => semanticNeighbors.find(n => n.id === id))
                .filter(n => n)
                .map(n => `<li><a href="${n!.url}">${n!.title}</a></li>`)
                .join('');
            
            finalBody += `
                <div class="sota-related-reading" style="background: #f8fafc; padding: 20px; border-radius: 12px; margin-top: 30px;">
                    <h3 style="margin-top:0; font-size: 1.1rem;">Recommended Reading</h3>
                    <ul>${linksHtml}</ul>
                </div>
            `;
            linkCount += missingIds.length;
        }
    }

    // B. Product Box Construction
    const productBox = generateProductBoxHTML(strategy, amazonProduct, config.amazonAffiliateTag || 'tag-20');

    // C. Schema Generation (Strict TS Construction)
    const { html: faqHtml, schemaObj: faqSchema } = generateFaqHtmlAndSchema(content.faqs);

    const articleSchema = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": strategy.newProduct + " Review",
        "description": strategy.bluf,
        "author": { "@type": "Person", "name": "Expert Review Team" },
        "mainEntity": {
            "@type": "Product",
            "name": amazonProduct?.title || strategy.newProduct,
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": amazonProduct?.rating || strategy.specs.rating,
                "reviewCount": strategy.specs.reviewCount
            }
        }
    };

    // Merge Schemas
    const fullSchema: any[] = [articleSchema];
    if (faqSchema) fullSchema.push(faqSchema);

    // 5. VALIDATION
    if (config.draftMode === 'full' && finalBody.length < 2000) {
        console.warn("Draft body shorter than expected for Full Mode.");
    }

    const duration = Date.now() - startTime;
    console.log(`[AI Pipeline] Finished in ${duration}ms. Links: ${linkCount}`);

    return {
        strategy: strategy,
        newTitle: `${strategy.newProduct} Review (${new Date().getFullYear() + 1})`,
        metaDescription: strategy.bluf,
        sgeSummaryHTML: content.sgeSummary,
        productBoxHTML: productBox,
        comparisonTableHTML: content.comparisonTableHtml,
        faqHTML: faqHtml,
        schemaJSON: JSON.stringify(fullSchema),
        contentWithLinks: finalBody,
        referencesHTML: "",
        detectedProducts: amazonProduct ? [{ name: amazonProduct.title, url: amazonProduct.url, asin: amazonProduct.asin, amazonData: amazonProduct }] : [],
        keywordCoverage: {
            used: 0, 
            total: strategy.secondaryKeywords.length,
            missing: []
        }
    };
};

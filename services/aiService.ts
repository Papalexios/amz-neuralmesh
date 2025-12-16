
import { GoogleGenAI } from '@google/genai';
import { AIAnalysisResult, SemanticNode, AIConfig, ReferenceData, PAAData, ProductDetection, AmazonProduct, AIStrategy, DraftMode } from '../types';
import { searchAmazonProduct } from './amazonService';
import { renderFinalHtml } from '../utils/helpers';

// --- HELPER: CLEAN JSON ---
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

// --- UNIVERSAL AI CALLER (Gemini + OpenAI Support) ---
const callAI = async (config: AIConfig, system: string, prompt: string): Promise<string> => {
    if (!config.apiKey) throw new Error("API Key Missing. Please check Settings.");

    // 1. GOOGLE GEMINI
    if (config.provider === 'gemini') {
        try {
            const ai = new GoogleGenAI({ apiKey: config.apiKey });
            const response = await ai.models.generateContent({
                model: config.model || 'gemini-2.5-flash', 
                contents: prompt,
                config: { 
                    systemInstruction: system, 
                    responseMimeType: "application/json",
                    maxOutputTokens: 8192 
                }
            });
            return response.text || "{}";
        } catch (e: any) {
            console.error("Gemini API Error:", e);
            // Handle specific 404
            if (e.message?.includes('404') || e.message?.includes('not found')) {
                throw new Error(`Model '${config.model}' not found. Check your API Key or Model ID in Settings.`);
            }
            throw e;
        }
    }

    // 2. OPENAI (GPT-4 / Turbo)
    if (config.provider === 'openai' || config.provider === 'openrouter') {
        const baseUrl = config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
        const model = config.model || 'gpt-4-turbo-preview';
        
        try {
            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                    ...(config.provider === 'openrouter' && { 'HTTP-Referer': 'https://neuralmesh.app', 'X-Title': 'NeuralMesh' })
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: prompt }
                    ],
                    response_format: { type: "json_object" }
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(`OpenAI Error: ${err.error?.message || res.statusText}`);
            }

            const data = await res.json();
            return data.choices[0]?.message?.content || "{}";
        } catch (e: any) {
            throw new Error(e.message);
        }
    }

    throw new Error(`Provider ${config.provider} not implemented yet.`);
};

// --- STEP 1: MULTI-PRODUCT STRATEGY ---
const generateStrategy = async (
    currentTitle: string,
    rawText: string,
    semanticNeighbors: SemanticNode[],
    externalRefs: ReferenceData[],
    config: AIConfig
): Promise<AIStrategy> => {
    
    const internalLinkInventory = semanticNeighbors.slice(0, 30).map(n => `ID: ${n.id} | Title: ${n.title}`).join('\n');
    const competitorData = externalRefs.slice(0, 8).map(r => `• ${r.title}: ${r.snippet}`).join('\n');
    
    const systemPrompt = `
        ROLE: Elite SEO Strategist.
        TASK: Analyze content and create a Strategy Object.
        
        CRITICAL RULES:
        1. **Product Detection**: Identify the MAIN product (old) and its 2026 Successor.
        2. **Multi-Product**: If this is a "Roundup" (e.g., "Best 5 X"), identify ALL products in the "products" array.
        3. **Linking**: Select EXACTLY 6-10 Internal Link IDs.
        4. **Verdict**: Concise, authoritative.

        OUTPUT SCHEMA (JSON):
        {
            "oldProduct": "string",
            "newProduct": "string (Main Successor)",
            "primaryKeyword": "string",
            "secondaryKeywords": ["string"],
            "targetAudience": "string",
            "verdict": { "score": 90, "pros": ["a","b"], "cons": ["c","d"], "summary": "string", "targetAudience": "string" },
            "specs": { "price": "$99", "rating": 9.5, "reviewCount": 1000 },
            "internalLinkIds": [123, 456],
            "outline": ["H2: ..."],
            "bluf": "string",
            "commercialIntent": boolean,
            "products": [ 
                { "name": "Product Name", "context": "Best for Beginners", "recommended": boolean } 
            ]
        }
    `;

    const userPrompt = `
        CONTENT SNAPSHOT: ${rawText.substring(0, 2000)}...
        TITLE: ${currentTitle}
        LINK INVENTORY: ${internalLinkInventory}
        COMPETITORS: ${competitorData}
    `;

    const json = await callAI(config, systemPrompt, userPrompt);
    return JSON.parse(cleanJsonOutput(json)) as AIStrategy;
};

// --- STEP 2: CONTENT GENERATION ---
const generateContentBlocks = async (
    strategy: AIStrategy,
    config: AIConfig
): Promise<{ 
    sgeSummary: string; 
    bodyHtml: string; 
    faqs: {q: string, a: string}[]; 
    comparisonTableHtml: string; 
}> => {

    const systemPrompt = `
        ROLE: Expert SEO Writer.
        TASK: Write HTML Content Blocks.
        
        INSTRUCTIONS:
        1. **Direct Answer (SGE)**: <200 words, direct, bold entities.
        2. **Body**: HTML (h2, h3, p, ul). No markdown.
        3. **Linking**: Use [[LINK:123]] syntax for internal links.
        4. **Product Placeholders**: YOU MUST PLACE '[[PRODUCT_BOX:Index]]' where a product card should appear.
           - Example: <h2>Nike Pegasus</h2>\n[[PRODUCT_BOX:0]]\n<p>Review text...</p>
           - Index corresponds to the 'products' array order from Strategy.
        
        OUTPUT SCHEMA (JSON):
        {
            "sgeSummary": "HTML",
            "bodyHtml": "HTML (with placeholders)",
            "faqs": [{ "q": "...", "a": "..." }],
            "comparisonTableHtml": "HTML Table or ''"
        }
    `;

    const userPrompt = `
        STRATEGY: ${JSON.stringify(strategy)}
        MODE: ${config.draftMode}
        WRITE NOW.
    `;

    const json = await callAI(config, systemPrompt, userPrompt);
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
    console.log(`[AI Pipeline] Starting Analysis: ${currentTitle} (Provider: ${config.provider}, Model: ${config.model})`);
    
    // 1. STRATEGY
    const strategy = await generateStrategy(currentTitle, rawText, semanticNeighbors, externalRefs, config);

    // 2. PRODUCT INTELLIGENCE (Multi-Product)
    // If strategy has "products" array, map them. If not, fallback to single newProduct.
    const productList = (strategy.products && strategy.products.length > 0) 
        ? strategy.products 
        : [{ name: strategy.newProduct, context: 'Top Pick', recommended: true }];

    const detectedProducts: ProductDetection[] = [];

    // Parallel Amazon Search / Validation
    await Promise.all(productList.map(async (prod, index) => {
        let amazonData: AmazonProduct | null = null;
        if (config.amazonAffiliateTag) {
            amazonData = await searchAmazonProduct(prod.name, config);
        }
        detectedProducts[index] = {
            name: prod.name,
            url: amazonData?.url || '',
            asin: amazonData?.asin,
            amazonData: amazonData || undefined
        };
    }));

    // 3. CONTENT
    const content = await generateContentBlocks(strategy, config);

    // 4. ASSEMBLY & INJECTION
    let finalBodyTemplate = content.bodyHtml;
    
    // A. Link Injection (Performed on Template)
    strategy.internalLinkIds.forEach(id => {
        const node = semanticNeighbors.find(n => n.id === id);
        if (node) {
            const regex = new RegExp(`\\[\\[LINK:${id}\\]\\]`, 'g');
            finalBodyTemplate = finalBodyTemplate.replace(regex, `<a href="${node.url}" class="sota-internal-link" title="${node.title}">${node.title}</a>`);
        }
    });

    // B. Product Box Injection (Initial Render)
    const finalContentWithLinks = renderFinalHtml(finalBodyTemplate, detectedProducts, undefined, config.amazonAffiliateTag);

    const generatedTitle = `${strategy.newProduct} Review (${new Date().getFullYear() + 1})`;

    // C. FAQs & Schema
    const { html: faqHtml, schemaObj: faqSchema } = generateFaqHtmlAndSchema(content.faqs);
    const fullSchema: any[] = [
        {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": generatedTitle,
            "mainEntity": detectedProducts.map(d => ({
                "@type": "Product",
                "name": d.name,
                "url": d.url
            }))
        }
    ];
    if (faqSchema) fullSchema.push(faqSchema);

    console.log(`[AI Pipeline] Finished in ${Date.now() - startTime}ms.`);

    return {
        strategy: strategy,
        newTitle: generatedTitle,
        metaDescription: strategy.bluf,
        sgeSummaryHTML: content.sgeSummary,
        productBoxHTML: "", // Now embedded in contentWithLinks
        comparisonTableHTML: content.comparisonTableHtml,
        faqHTML: faqHtml,
        schemaJSON: JSON.stringify(fullSchema),
        contentTemplate: finalBodyTemplate, // Store the template for re-rendering
        contentWithLinks: finalContentWithLinks,
        referencesHTML: "",
        detectedProducts: detectedProducts,
        keywordCoverage: { used: 0, total: strategy.secondaryKeywords.length, missing: [] }
    };
};

// --- REUSED FAQ GEN ---
const generateFaqHtmlAndSchema = (faqs: {q: string, a: string}[]) => {
    if (!faqs || faqs.length === 0) return { html: '', schemaObj: null };
    const html = `<div class="sota-faq-section" style="margin-top: 40px;"><h2>FAQ</h2>${faqs.map(item => `<details style="margin-bottom:10px;"><summary><strong>${item.q}</strong></summary><p>${item.a}</p></details>`).join('')}</div>`;
    const schemaObj = {
        "@type": "FAQPage",
        "mainEntity": faqs.map(item => ({ "@type": "Question", "name": item.q, "acceptedAnswer": { "@type": "Answer", "text": item.a } }))
    };
    return { html, schemaObj };
};

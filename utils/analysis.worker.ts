
import type { PostHealth, SemanticNode } from '../types';

const STOP_WORDS = new Set(['the', 'and', 'is', 'in', 'it', 'to', 'of', 'for', 'with', 'on', 'at', 'by', 'this', 'that', 'a', 'an']);

const simpleTokenize = (text: string) => {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
};

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'ANALYZE_HEALTH') {
    const { id, content, modified, siteUrl } = payload;
    
    // 1. PERFORMANCE: Regex Analysis
    const wordCount = (content.match(/\b\w+\b/g) || []).length;
    const hasSchema = content.includes('application/ld+json');
    
    // 2. AEO METRICS
    const hasVerdict = /verdict|conclusion|summary|pros and cons|bottom line/i.test(content);
    const hasTable = /<table/i.test(content);
    const hasList = /<ul|<ol/i.test(content);
    
    // 3. LINK METRICS
    // Fast regex for link extraction
    const linkRegex = /href=["'](.*?)["']/g;
    const cleanSite = siteUrl.replace(/\/$/, '');
    
    let internal = 0;
    let external = 0;
    let affiliate = 0;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
        const url = match[1];
        if (url.includes('amazon.com') || url.includes('amzn.to')) affiliate++;
        else if (url.includes(cleanSite) || url.startsWith('/')) internal++;
        else if (url.startsWith('http')) external++;
    }

    // 4. ENTITY DENSITY (Heuristic)
    // Measures capitalized words in mid-sentence (Proper Nouns) as a proxy for Information Gain
    const textBody = content.replace(/<[^>]*>/g, ' ');
    const capsMatches = textBody.match(/ [A-Z][a-z]+/g) || [];
    const entityDensity = wordCount > 0 ? (capsMatches.length / wordCount) * 100 : 0;

    // 5. DECAY CALCULATION
    const diffDays = Math.ceil(Math.abs(Date.now() - new Date(modified).getTime()) / (86400000));
    
    // 6. SCORING ALGORITHM
    let seo = 100;
    let aeo = 100;

    // SEO Penalties
    if (diffDays > 365) seo -= 20;     // Decay
    if (wordCount < 1000) seo -= 15;   // Thin content
    if (internal < 3) seo -= 15;       // Orphaned
    if (external < 2) seo -= 10;       // No citations
    if (!hasSchema) seo -= 10;

    // AEO Penalties (Answer Engine Optimization)
    if (!hasVerdict) aeo -= 20;        // No direct answer
    if (!hasTable) aeo -= 15;          // Structured data missing
    if (!hasList) aeo -= 10;           // Not scannable
    if (entityDensity < 2) aeo -= 15;  // Low information gain (fluff)
    if (affiliate === 0) aeo -= 5;     // (Commercial intent check)

    const finalScore = Math.max(0, seo);
    
    // OPPORTUNITY SCORE (SOTA METRIC)
    // Prioritizes: High Word Count + Low SEO Score = High Potential
    // Logic: It's easier to fix a 2000 word article that decayed than write a new one.
    // Normalized to 0-100 scale roughly
    const opportunityScore = (wordCount > 500) 
        ? Math.min(100, (wordCount / 1500) * (100 - finalScore)) 
        : 0;

    const result: PostHealth = {
      id: id,
      score: finalScore,
      aeoScore: Math.max(0, aeo),
      opportunityScore: Math.round(opportunityScore),
      status: 'idle',
      metrics: {
        wordCount,
        hasSchema,
        hasVerdict,
        brokenMedia: 0,
        internalLinks: internal,
        externalLinks: external,
        entityDensity,
        lastUpdatedDayCount: diffDays,
        informationGainScore: entityDensity * 2 
      }
    };

    self.postMessage({ type: 'HEALTH_RESULT', result });
  }

  if (type === 'BUILD_MESH') {
    const { posts } = payload;
    const nodes = posts.map((p: any) => ({
      id: p.id,
      title: p.title.rendered,
      url: p.link,
      tokens: Array.from(new Set(simpleTokenize(p.title.rendered + " " + p.slug)))
    }));
    self.postMessage({ type: 'MESH_RESULT', nodes });
  }
};


export type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'openrouter';

export interface WPConnection {
  url: string;
  username: string;
  appPassword: string;
}

export interface WPPostHeader {
  id: number;
  date: string;
  modified: string;
  title: { rendered: string };
  link: string;
  slug: string;
  categories?: number[];
}

export interface WPPostFull extends WPPostHeader {
  content: { rendered: string; protected: boolean };
  excerpt: { rendered: string };
  featured_media: number;
}

export interface PostHealth {
  id: number;
  score: number;
  aeoScore: number;
  opportunityScore: number; // SOTA Metric: (WordCount * Decay)
  metrics: {
    wordCount: number;
    hasSchema: boolean;
    hasVerdict: boolean;
    brokenMedia: number;
    internalLinks: number;
    externalLinks: number;
    entityDensity: number;
    lastUpdatedDayCount: number;
    informationGainScore: number;
  };
  status: 'idle' | 'queued' | 'scanning' | 'optimizing' | 'review_pending' | 'published' | 'error';
  log?: string;
  draftHtml?: string;
  aiResult?: AIAnalysisResult;
  productOverrides?: Record<string, string>;
  customImageUrl?: string;
  manualMapping?: ManualMapping;
}

export interface SemanticNode {
  id: number;
  title: string;
  url: string;
  tokens: Set<string>;
  embedding?: number[];
  relevance?: number;
}

export interface VerdictData {
  score: number;
  pros: string[];
  cons: string[];
  summary: string;
  targetAudience: string;
}

export interface ReferenceData {
  title: string;
  link: string;
  snippet: string;
}

export interface PAAData {
  question: string;
  snippet: string;
  link: string;
}

export interface SerperResult {
  organics: ReferenceData[];
  paa: PAAData[];
}

// SOTA Amazon Product Data
export interface AmazonProduct {
  asin: string;
  title: string;
  imageUrl: string;
  price: string;
  url: string;
  features: string[];
  rating?: string;
  reviewCount?: string;
  isPrime?: boolean;
}

export interface ProductDetection {
  name: string;
  url: string;
  asin?: string;
  amazonData?: AmazonProduct; // Real-time data from PA-API
}

export interface AIAnalysisResult {
  newTitle: string;
  metaDescription: string;
  blufSentence: string;
  sgeSummaryHTML: string;
  verdictData: VerdictData;
  productBoxHTML?: string;
  comparisonTableHTML: string;
  faqHTML: string;
  schemaJSON: string;
  contentWithLinks: string;
  referencesHTML: string;
  detectedOldProduct: string;
  identifiedNewProduct: string;
  newProductSpecs: { price: string; rating: number; reviewCount: number };
  keywordsUsed?: string[]; 
  commercialIntent: boolean; 
  detectedProducts: ProductDetection[];
  usedInternalLinks?: string[]; 
  citationMap?: Record<string, string>;
}

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  concurrency?: number;
  serperApiKey?: string;
  wpUrl?: string;
  wpUsername?: string;
  wpAppPassword?: string;
  // Amazon PA-API Credentials
  amazonAffiliateTag?: string;
  amazonAccessKey?: string;
  amazonSecretKey?: string;
  amazonRegion?: string; // e.g., 'us-east-1'
}

export interface ContentUpdateSuggestion {
  oldProductName: string;
  successorProductName: string;
  verdictSummary: string;
  intro: string;
  pros: string[];
  cons: string[];
  comparisonTable: any[];
  faqs: any[];
}

export interface ProcessedItem {
  id: string;
  slug: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  decayScore?: number;
  errorMsg?: string;
  suggestion?: ContentUpdateSuggestion; 
  draftHtml?: string;
  aiResult?: AIAnalysisResult;
  productOverrides?: Record<string, string>;
  customImageUrl?: string;
}

export interface SitemapUrl {
  loc: string;
  lastmod: string;
  slug: string;
}

export interface ManualMapping {
  productName: string;
  asin: string;
}

export interface AnalyzedUrl extends SitemapUrl {
  id: string;
  decayScore: number;
  reasons: string[];
  manualMapping?: ManualMapping;
}

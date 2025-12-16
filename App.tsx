
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WPConnection, WPPostHeader, WPPostFull, PostHealth, SemanticNode, AIConfig, AIAnalysisResult, ProcessedItem, DraftMode } from './types';
import { fetchAllPostHeaders, fetchPostContent, updatePostRemote } from './services/wordpressService';
import { stripHtmlPreservingStructure, tokenize, calculateRelevance, parseHealth, calculateScore, renderFinalHtml } from './utils/helpers';
import { analyzeAndGenerateAssets } from './services/aiService';
import { searchSerper } from './services/serperService';
import ConnectModal from './components/ConnectModal';
import PostList from './components/PostList';
import { ReviewResults } from './components/ReviewResults';
import { SettingsModal } from './components/SettingsModal';
import { Network, BrainCircuit, Settings, DownloadCloud, Square, ArrowLeft, Activity, Zap, Layers } from 'lucide-react';
import { DEFAULT_MODELS } from './constants';
import { LandingPage } from './components/LandingPage';

// ... (Keep existing WORKER_CODE variable unchanged) ...
const WORKER_CODE = `
const tokenize = (text) => {
  const stopWords = new Set(['the', 'and', 'is', 'in', 'it', 'to', 'of', 'for', 'with', 'on', 'at', 'by', 'a', 'an']);
  return new Set(
    text.toLowerCase().replace(/[^\\w\\s]/g, '').split(/\\s+/).filter(w => w.length > 2 && !stopWords.has(w))
  );
};
self.onmessage = (e) => {
  const { type, payload } = e.data;
  
  if (type === 'ANALYZE_HEALTH') {
    const { id, content, modified, siteUrl } = payload;
    
    // Fast Regex Analysis for Performance
    const wordCount = (content.match(/\\b\\w+\\b/g) || []).length;
    const hasSchema = content.includes('application/ld+json');
    const hasVerdict = /verdict|conclusion|summary|pros and cons|bottom line/i.test(content);
    
    // Link Analysis via Regex to avoid DOM overhead in worker
    const linkRegex = /href=["'](.*?)["']/g;
    let match;
    let internal = 0;
    let external = 0;
    const cleanSite = siteUrl.replace(/\\/$/, '');

    while ((match = linkRegex.exec(content)) !== null) {
      const url = match[1];
      if (url.includes(cleanSite) || url.startsWith('/')) {
        internal++;
      } else if (url.startsWith('http')) {
        external++;
      }
    }

    const diffDays = Math.ceil(Math.abs(Date.now() - new Date(modified).getTime()) / (86400000));

    let seo = 100;
    let aeo = 100;
    if (diffDays > 365) seo -= 20;
    if (wordCount < 1000) seo -= 15;
    if (internal < 3) seo -= 15;
    if (!hasSchema) seo -= 10;
    if (!hasVerdict) aeo -= 30;
    if (wordCount < 1500) aeo -= 10;

    const finalScore = Math.max(0, seo);
    
    // OPPORTUNITY SCORE CALCULATION
    const opportunityScore = (wordCount > 500) 
        ? Math.min(100, (wordCount / 1500) * (100 - finalScore)) 
        : 0;

    const result = {
      id,
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
        entityDensity: 0,
        lastUpdatedDayCount: diffDays
      }
    };
    self.postMessage({ type: 'HEALTH_RESULT', result });
  }

  if (type === 'MESH_RESULT') {
    const { posts } = payload;
    const nodes = posts.map((p) => ({
      id: p.id,
      title: p.title.rendered,
      url: p.link,
      tokens: Array.from(tokenize(p.title.rendered + " " + p.slug))
    }));
    self.postMessage({ type: 'MESH_RESULT', nodes });
  }
};
`;

const App: React.FC = () => {
  const [showLanding, setShowLanding] = useState(true);
  const [connection, setConnection] = useState<WPConnection | null>(null);
  const [posts, setPosts] = useState<WPPostHeader[]>([]);
  const [healthData, setHealthData] = useState<Record<number, PostHealth>>({});
  const [queue, setQueue] = useState<number[]>([]);
  const [processing, setProcessing] = useState<number[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [viewMode, setViewMode] = useState<'dashboard' | 'review'>('dashboard');
  const [autoPilot, setAutoPilot] = useState(false); 
  const [draftMode, setDraftMode] = useState<DraftMode>('full'); 
  
  const [aiConfig, setAiConfig] = useState<AIConfig>({
      provider: 'gemini',
      apiKey: '',
      model: DEFAULT_MODELS['gemini'],
      concurrency: 2, // Lowered for stability in multi-step calls
      serperApiKey: ''
  });

  const [semanticNodes, setSemanticNodes] = useState<SemanticNode[]>([]);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    workerRef.current = new Worker(workerUrl);
    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'MESH_RESULT') {
        setSemanticNodes(e.data.nodes);
        setLoadingMsg('');
      } else if (e.data.type === 'HEALTH_RESULT') {
        const result = e.data.result;
        setHealthData(prev => ({ ...prev, [result.id]: { ...prev[result.id], ...result, status: 'idle' } }));
      }
    };
    return () => { workerRef.current?.terminate(); URL.revokeObjectURL(workerUrl); };
  }, []);

  const processQueue = useCallback(async () => {
    const maxConcurrency = aiConfig.concurrency || 2;
    if (!connection || queue.length === 0 || processing.length >= maxConcurrency) return;

    const slots = maxConcurrency - processing.length;
    const batch = queue.slice(0, slots);
    
    setQueue(prev => prev.slice(batch.length));
    setProcessing(prev => [...prev, ...batch]);

    batch.forEach(async (id) => {
        const safetyTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout (15min Exceeded)")), 900000));

        const task = async () => {
            try {
                setHealthData(prev => ({ ...prev, [id]: { ...prev[id], status: 'scanning' } }));
                const post = await fetchPostContent(connection, id);
                const cleanText = stripHtmlPreservingStructure(post.content.rendered);
                const targetTokens = tokenize(post.title.rendered);
                
                // --- MESH RETRIEVAL ---
                let meshNeighbors: SemanticNode[] = semanticNodes
                    .filter(n => n.id !== id)
                    .map(node => ({ ...node, relevance: calculateRelevance(targetTokens, node.tokens) }))
                    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
                    .slice(0, 50);

                let serperData = { organics: [], paa: [] };
                if (aiConfig.serperApiKey) {
                    await new Promise(r => setTimeout(r, 1000));
                    serperData = await searchSerper(post.title.rendered, aiConfig.serperApiKey);
                }

                setHealthData(prev => ({ ...prev, [id]: { ...prev[id], status: 'optimizing' } }));

                const assets = await analyzeAndGenerateAssets(
                    post.title.rendered, 
                    cleanText, 
                    meshNeighbors, 
                    serperData.organics, 
                    serperData.paa, 
                    { ...aiConfig, draftMode }
                );

                setHealthData(prev => ({ ...prev, [id]: { ...prev[id], status: 'review_pending', draftHtml: assets.contentWithLinks, aiResult: assets, productOverrides: {} } }));
            } catch (e: any) {
                console.error(e);
                setHealthData(prev => ({ ...prev, [id]: { ...prev[id], status: 'error', log: e.message } }));
            } finally {
                setProcessing(prev => prev.filter(x => x !== id));
            }
        };

        Promise.race([task(), safetyTimeout]).catch(err => {
             setHealthData(prev => ({ ...prev, [id]: { ...prev[id], status: 'error', log: (err as Error).message } }));
             setProcessing(prev => prev.filter(x => x !== id));
        });
    });
  }, [connection, queue, processing, semanticNodes, aiConfig, draftMode]);

  useEffect(() => { processQueue(); }, [processQueue]);

  // --- REAL-TIME RENDERER ON UPDATE ---
  const handleUpdateItem = (id: string, updates: Partial<ProcessedItem>) => {
      setHealthData(prev => {
          const numId = parseInt(id);
          if (!prev[numId]) return prev;

          const compatibleUpdates: Partial<PostHealth> = {};
          if (updates.productOverrides) compatibleUpdates.productOverrides = updates.productOverrides;
          if (updates.draftHtml) compatibleUpdates.draftHtml = updates.draftHtml;
          if (updates.customImageUrl) compatibleUpdates.customImageUrl = updates.customImageUrl;
          if (updates.manualMapping) compatibleUpdates.manualMapping = updates.manualMapping;
          
          // HOT RELOAD: If overrides changed, re-render from template immediately
          const currentItem = prev[numId];
          const template = currentItem.aiResult?.contentTemplate;
          if (updates.productOverrides && template && currentItem.aiResult) {
               // Merge existing overrides with new updates
               const newOverrides = updates.productOverrides;
               const newHtml = renderFinalHtml(template, currentItem.aiResult.detectedProducts, newOverrides, aiConfig.amazonAffiliateTag);
               compatibleUpdates.draftHtml = newHtml;
          }

          return { ...prev, [numId]: { ...prev[numId], ...compatibleUpdates } };
      });
  };

  const handlePublish = async (id: string, content: string) => {
      if (!connection) return;
      try {
          const numId = parseInt(id);
          // Note: Content passed here is the `draftHtml` which is already fully rendered by handleUpdateItem
          // or initial generation. We trust it is WYSIWYG.
          
          await updatePostRemote(connection, numId, { content: content, date: new Date().toISOString() });
          setHealthData(prev => ({ ...prev, [numId]: { ...prev[numId], status: 'published' } }));
      } catch (e: any) {
          throw new Error(e.message);
      }
  };

  const handleConnect = async (conn: WPConnection) => {
    setConnection(conn);
    setAiConfig(prev => ({ ...prev, wpUrl: conn.url, wpUsername: conn.username, wpAppPassword: conn.appPassword }));
    setLoadingMsg('Indexing...');
    try {
      const headers = await fetchAllPostHeaders(conn, (count) => setLoadingMsg(`Indexed ${count} Posts...`));
      setPosts(headers);
      const initialH: Record<number, PostHealth> = {};
      headers.forEach(p => {
        const metrics = parseHealth(null, p.modified, conn.url);
        const scores = calculateScore(metrics);
        initialH[p.id] = { id: p.id, score: scores.seo, aeoScore: scores.aeo, opportunityScore: 0, metrics, status: 'idle' };
      });
      setHealthData(initialH);
      setLoadingMsg('Building Mesh...');
      workerRef.current?.postMessage({ type: 'BUILD_MESH', payload: { posts: headers } });
    } catch (e: any) {
        alert("Connection Failed: " + e.message);
        setLoadingMsg('');
    }
  };

  const startBatch = (ids: number[] = []) => {
    if (!aiConfig.apiKey) {
        alert("Please configure API Key.");
        setIsSettingsOpen(true);
        return;
    }
    const validIds = ids.filter(id => healthData[id]);
    setQueue(prev => [...prev, ...validIds]);
  };

  const reviewItems: ProcessedItem[] = (Object.values(healthData) as PostHealth[])
    .filter(h => h.status === 'review_pending' || h.status === 'published')
    .map(h => {
        const p = posts.find(post => post.id === h.id);
        return {
            id: h.id.toString(),
            slug: p?.slug || 'unknown',
            status: h.status === 'published' ? 'completed' : 'completed',
            draftHtml: h.draftHtml, 
            aiResult: h.aiResult,   
            productOverrides: h.productOverrides,
            manualMapping: h.manualMapping,
        };
    });

  if (showLanding) return <LandingPage onEnterApp={() => setShowLanding(false)} />;
  if (!connection) return <ConnectModal onConnect={handleConnect} />;

  // FIXED: Changed min-h-screen to h-screen overflow-hidden to ensure internal scrollbars work
  return (
    <div className="h-screen overflow-hidden bg-[#020617] text-slate-200 font-sans selection:bg-emerald-500/30 flex flex-col">
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} config={aiConfig} onSave={setAiConfig} />
      
      {/* HEADER */}
      <header className="border-b border-white/5 bg-slate-950/50 backdrop-blur-md shrink-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
             {viewMode === 'review' && <button onClick={() => setViewMode('dashboard')} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700"><ArrowLeft size={18} /></button>}
             <div className="flex items-center gap-3">
                 <div className="h-9 w-9 bg-emerald-600 rounded-lg flex items-center justify-center text-white shadow shadow-emerald-500/30"><BrainCircuit size={20} /></div>
                 <div><h1 className="font-bold text-lg text-white leading-none">Neural<span className="text-emerald-400">Mesh</span></h1><p className="text-[9px] text-slate-500 font-mono uppercase">V2.0 Autonomous</p></div>
             </div>
          </div>
          
          <div className="flex items-center gap-6">
             {/* DRAFT MODE TOGGLE */}
             <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
                <button onClick={() => setDraftMode('full')} className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center transition-all ${draftMode === 'full' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    <Layers size={14} className="mr-2"/> Full Rewrite
                </button>
                <button onClick={() => setDraftMode('refresh')} className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center transition-all ${draftMode === 'refresh' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    <Zap size={14} className="mr-2"/> Fast Refresh
                </button>
             </div>

             {queue.length > 0 && <div className="text-xs font-bold text-indigo-400 animate-pulse flex items-center"><Activity size={14} className="mr-2"/> Processing {queue.length} items...</div>}
             
             <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                 <button onClick={() => setViewMode('dashboard')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'dashboard' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>Dashboard</button>
                 <button onClick={() => setViewMode('review')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'review' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
                    Reviews {reviewItems.length > 0 && <span className="ml-1 bg-white text-emerald-600 px-1 rounded-full text-[9px]">{reviewItems.length}</span>}
                 </button>
             </div>
             <button onClick={() => setIsSettingsOpen(true)} className="text-slate-400 hover:text-white"><Settings size={20} /></button>
          </div>
        </div>
      </header>

      {/* MAIN */}
      {/* FIXED: Added overflow-hidden to main to constrain children */}
      <main className="max-w-[1600px] mx-auto px-6 py-8 flex-1 w-full flex flex-col overflow-hidden">
        {viewMode === 'dashboard' ? (
            <div className="flex-1 flex flex-col overflow-hidden">
                <PostList posts={posts} healthData={healthData} onOptimize={startBatch} onScan={() => {}} isProcessing={queue.length > 0} onReview={() => setViewMode('review')} />
            </div>
        ) : (
            <ReviewResults items={reviewItems} config={aiConfig} onOpenSettings={() => setIsSettingsOpen(true)} onUpdateItem={handleUpdateItem} customPublishHandler={async (item) => { const draft = healthData[parseInt(item.id)]?.draftHtml; if (draft) await handlePublish(item.id, draft); }} />
        )}
      </main>
    </div>
  );
};
export default App;

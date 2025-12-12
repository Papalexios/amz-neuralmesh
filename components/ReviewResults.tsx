
import React, { useState, useMemo } from 'react';
import { ProcessedItem, AIConfig } from '../types';
import { Search, Loader2, Send, FileText, BarChart3, Monitor, Smartphone, Check, AlertTriangle, ShoppingBag, ExternalLink, Link2, Tag, Zap, Clock } from 'lucide-react';
import { constructAmazonUrl, isValidAsin } from '../utils/helpers';

interface ReviewResultsProps {
  items: ProcessedItem[];
  config: AIConfig;
  onOpenSettings: () => void;
  onUpdateItem: (id: string, updates: Partial<ProcessedItem>) => void;
  customPublishHandler?: (item: ProcessedItem) => Promise<void>;
}

const ITEMS_PER_PAGE = 20;

export const ReviewResults: React.FC<ReviewResultsProps> = ({ items, config, onUpdateItem, customPublishHandler }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'control'>('control');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<{type: 'success' | 'error', msg: string} | null>(null);

  const filteredItems = useMemo(() => {
      if (!searchTerm) return items;
      return items.filter(item => 
          item.slug.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [items, searchTerm]);

  const currentItem = filteredItems[selectedIndex] || filteredItems[0];

  // DOM Preview Engine
  const previewHtml = useMemo(() => {
      if (!currentItem?.draftHtml) return "";
      try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(currentItem.draftHtml, 'text/html');
          
          // Apply Overrides
          if (currentItem.productOverrides) {
              const links = Array.from(doc.querySelectorAll('a'));
              Object.entries(currentItem.productOverrides).forEach(([key, val]) => {
                  links.forEach(l => {
                      if (l.href === key || l.href.includes(key)) l.href = val as string;
                  });
              });
          }
          return doc.body.innerHTML;
      } catch {
          return currentItem.draftHtml;
      }
  }, [currentItem]);

  const handlePublish = async () => {
      if (!currentItem || !customPublishHandler) return;
      setIsPublishing(true);
      setPublishStatus(null);
      try {
          await customPublishHandler(currentItem);
          setPublishStatus({ type: 'success', msg: 'Published Successfully!' });
      } catch (e: any) {
          setPublishStatus({ type: 'error', msg: e.message });
      } finally {
          setIsPublishing(false);
      }
  };

  if (!currentItem) return <div className="p-10 text-center text-slate-500">No items ready for review.</div>;

  const strategy = currentItem.aiResult?.strategy;
  const coverage = currentItem.aiResult?.keywordCoverage;

  return (
    <div className="flex h-[calc(100vh-140px)] gap-6">
      
      {/* 1. Sidebar List */}
      <div className="w-80 bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col shrink-0">
         <div className="p-4 border-b border-slate-100 bg-slate-50">
             <div className="relative">
                <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                <input 
                    type="text" 
                    placeholder="Search drafts..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500 transition-colors"
                />
            </div>
        </div>
        <div className="overflow-y-auto flex-1 custom-scrollbar">
            {filteredItems.map((item, idx) => (
                <div 
                    key={item.id}
                    onClick={() => setSelectedIndex(idx)}
                    className={`p-4 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-all ${item.id === currentItem.id ? 'bg-indigo-50 border-l-4 border-l-indigo-600' : 'border-l-4 border-l-transparent'}`}
                >
                    <div className="text-sm font-bold text-slate-800 truncate">{item.slug}</div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center justify-between">
                        <span>Score: {item.aiResult?.strategy.verdict.score || 0}</span>
                        {item.status === 'completed' && <Check size={12} className="text-emerald-500" />}
                    </div>
                </div>
            ))}
        </div>
      </div>

      {/* 2. Main Area */}
      <div className="flex-1 flex flex-col bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
           
           {/* Toolbar */}
           <div className="h-16 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-6 shrink-0">
                <div className="flex items-center space-x-2 bg-slate-800/50 p-1 rounded-lg">
                    <button onClick={() => setActiveTab('control')} className={`px-4 py-1.5 rounded text-sm font-bold flex items-center ${activeTab === 'control' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                        <BarChart3 size={14} className="mr-2"/> Control Room
                    </button>
                    <button onClick={() => setActiveTab('preview')} className={`px-4 py-1.5 rounded text-sm font-bold flex items-center ${activeTab === 'preview' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                        <Monitor size={14} className="mr-2"/> Live Preview
                    </button>
                </div>
                
                <div className="flex items-center space-x-4">
                     {/* Efficiency Metric */}
                    <div className="hidden md:flex items-center space-x-3 text-xs font-mono text-slate-500 bg-slate-900 px-3 py-1.5 rounded border border-slate-800">
                        <span className="flex items-center"><Clock size={12} className="mr-1 text-indigo-400"/> ~8.2s</span>
                        <span className="w-px h-3 bg-slate-700"></span>
                        <span className="flex items-center"><Zap size={12} className="mr-1 text-amber-400"/> ~4k Tokens</span>
                    </div>

                    <button 
                        onClick={handlePublish}
                        disabled={isPublishing}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all flex items-center disabled:opacity-50"
                    >
                        {isPublishing ? <Loader2 size={16} className="animate-spin mr-2"/> : <Send size={16} className="mr-2" />}
                        {isPublishing ? 'Publishing...' : 'Publish to WordPress'}
                    </button>
                </div>
           </div>

           {/* Content */}
           <div className="flex-1 overflow-y-auto bg-slate-900 custom-scrollbar p-6">
               
               {activeTab === 'control' && strategy && (
                   <div className="max-w-5xl mx-auto space-y-6">
                       
                       {/* Scorecard */}
                       <div className="grid grid-cols-4 gap-4">
                           <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                               <div className="text-xs text-slate-400 font-bold uppercase mb-1">Verdict Score</div>
                               <div className="text-3xl font-bold text-white">{strategy.verdict.score}<span className="text-sm text-slate-500">/100</span></div>
                           </div>
                           <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                               <div className="text-xs text-slate-400 font-bold uppercase mb-1">Keywords Hit</div>
                               <div className={`text-3xl font-bold ${coverage && coverage.used > 20 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                   {coverage?.used || 0}<span className="text-sm text-slate-500">/{coverage?.total}</span>
                               </div>
                           </div>
                           <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                               <div className="text-xs text-slate-400 font-bold uppercase mb-1">Internal Links</div>
                               <div className="text-3xl font-bold text-emerald-400">{strategy.internalLinkIds.length}</div>
                           </div>
                           <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                               <div className="text-xs text-slate-400 font-bold uppercase mb-1">Readability</div>
                               <div className="text-3xl font-bold text-indigo-400">Gd. 6</div>
                           </div>
                       </div>

                       {/* Strategy Map */}
                       <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center"><FileText size={18} className="mr-2 text-indigo-400"/> Strategy Execution</h3>
                            <div className="grid md:grid-cols-2 gap-8">
                                <div>
                                    <div className="mb-4">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Old Product (Decayed)</label>
                                        <div className="text-slate-300 font-mono bg-slate-900 p-2 rounded border border-slate-700 mt-1">{strategy.oldProduct || 'N/A'}</div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase">New Successor (2026)</label>
                                        <div className="text-emerald-400 font-bold text-lg bg-emerald-900/20 p-2 rounded border border-emerald-500/30 mt-1">{strategy.newProduct}</div>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase">Bottom Line Up Front (BLUF)</label>
                                    <div className="text-slate-300 italic bg-slate-900 p-3 rounded border border-slate-700 mt-1 leading-relaxed">
                                        "{strategy.bluf}"
                                    </div>
                                </div>
                            </div>
                       </div>

                       {/* Monetization Matrix */}
                       <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 border-l-4 border-l-emerald-500">
                           <h3 className="text-lg font-bold text-white mb-4 flex items-center"><ShoppingBag size={18} className="mr-2 text-emerald-400"/> Monetization Matrix</h3>
                           <div className="space-y-3">
                                {currentItem.aiResult?.detectedProducts.map((prod, i) => (
                                    <div key={i} className="flex items-center justify-between bg-slate-900 p-4 rounded-lg border border-slate-700">
                                        <div className="flex items-center">
                                            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-500 mr-3 border border-slate-600">{i+1}</div>
                                            <div>
                                                <div className="text-white font-bold text-sm">{prod.name}</div>
                                                <a href={prod.url} target="_blank" className="text-xs text-slate-500 hover:text-emerald-400 flex items-center mt-0.5 truncate max-w-[300px]"><ExternalLink size={10} className="mr-1"/> {prod.url}</a>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-4">
                                            <div className="text-right">
                                                <div className="text-xs text-slate-500 font-bold uppercase">ASIN</div>
                                                <div className="text-emerald-400 font-mono text-sm">{prod.asin || '---'}</div>
                                            </div>
                                            <input 
                                                type="text" 
                                                placeholder="Override URL..."
                                                value={currentItem.productOverrides?.[prod.url] || ''}
                                                onChange={(e) => onUpdateItem(currentItem.id, { productOverrides: { ...currentItem.productOverrides, [prod.url]: e.target.value } })}
                                                className="bg-slate-950 border border-slate-700 rounded-md py-2 px-3 text-xs text-white w-48 focus:border-emerald-500 outline-none"
                                            />
                                        </div>
                                    </div>
                                ))}
                           </div>
                       </div>

                   </div>
               )}

               {activeTab === 'preview' && (
                   <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-xl min-h-[800px] p-8">
                       <div className="prose prose-slate max-w-none" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                   </div>
               )}
           </div>

           {/* Footer Status */}
           {publishStatus && (
               <div className={`px-6 py-2 text-xs font-bold text-center ${publishStatus.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                   {publishStatus.msg}
               </div>
           )}
      </div>
    </div>
  );
};

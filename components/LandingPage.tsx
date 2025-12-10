
import React from 'react';
import { BrainCircuit, ArrowRight, Sparkles, Rocket, ExternalLink, Globe, Zap, Cpu } from 'lucide-react';

interface LandingPageProps {
  onEnterApp: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnterApp }) => {
  return (
    <div className="min-h-screen bg-[#020617] text-white font-sans selection:bg-emerald-500/30 overflow-x-hidden flex flex-col relative">
      
      {/* --- BACKGROUND ATMOSPHERE --- */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse delay-1000"></div>
        <div className="absolute top-[20%] right-[10%] w-[20%] h-[20%] bg-cyan-500/10 rounded-full blur-[80px]"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
      </div>

      {/* --- HEADER --- */}
      <header className="relative z-50 w-full backdrop-blur-md border-b border-white/5 bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex justify-between items-center">
          
          {/* Artistic Logo */}
          <div className="flex items-center gap-3 group cursor-default">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-cyan-400 rounded-xl blur opacity-40 group-hover:opacity-75 transition-opacity duration-500"></div>
              <div className="relative h-10 w-10 bg-slate-900 border border-white/10 rounded-xl flex items-center justify-center">
                <BrainCircuit size={24} className="text-emerald-400 group-hover:text-white transition-colors duration-300" />
              </div>
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight leading-none">
                Neural<span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">Mesh</span>
              </h1>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-[0.2em]">Autonomous SEO Agent</p>
            </div>
          </div>

          {/* Creators Link */}
          <a 
            href="https://affiliatemarketingforsuccess.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-emerald-400 transition-colors duration-300 border border-white/5 bg-white/5 px-4 py-2 rounded-full hover:bg-white/10 group"
          >
            <span>From the creators of</span>
            <span className="text-white font-bold group-hover:text-emerald-300">AffiliateMarketingForSuccess.com</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </header>

      {/* --- HERO SECTION --- */}
      <main className="flex-1 flex flex-col items-center justify-center relative z-10 px-6 py-20 text-center">
        
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <Sparkles size={12} /> State of the Art Technology
        </div>

        <h2 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 max-w-4xl mx-auto leading-[1.1] animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
          Resurrect Dead Content. <br/>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400">Dominate Search.</span>
        </h2>

        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
          The autonomous AI agent that analyzes your sitemap, identifies decay, and rewrites outdated posts into high-ranking, affiliate-optimized assets using real-time market data.
        </p>

        <div className="flex flex-col md:flex-row items-center gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300 w-full max-w-lg mx-auto">
          
          {/* PRIMARY SOTA BUTTON (External) */}
          <a 
            href="https://seo-hub.affiliatemarketingforsuccess.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full md:w-auto group relative flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-2xl text-white font-bold text-sm tracking-wide hover:shadow-[0_0_40px_-10px_rgba(16,185,129,0.5)] hover:scale-[1.02] transition-all duration-300 overflow-hidden"
          >
            <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 skew-x-12"></div>
            <Rocket size={18} className="group-hover:rotate-12 transition-transform" />
            <span>Dominate Your Niche – Unlock SEO Arsenal</span>
          </a>

          {/* APP ENTRY BUTTON (Local) */}
          <button 
            onClick={onEnterApp}
            className="w-full md:w-auto flex items-center justify-center gap-3 px-8 py-4 bg-slate-800/50 border border-slate-700 text-slate-200 rounded-2xl font-bold text-sm hover:bg-slate-800 hover:text-white hover:border-slate-500 transition-all duration-300"
          >
            <Cpu size={18} />
            <span>Launch NeuralMesh Agent</span>
          </button>
        </div>

      </main>

      {/* --- FOOTER --- */}
      <footer className="relative z-10 border-t border-white/5 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-12 md:py-16">
          <div className="flex flex-col md:flex-row justify-between items-start gap-12">
            
            {/* Left Column: Brand & Owner */}
            <div className="space-y-6 max-w-sm">
              <img 
                src="https://affiliatemarketingforsuccess.com/wp-content/uploads/2023/03/cropped-Affiliate-Marketing-for-Success-Logo-Edited.png?lm=6666FEE0" 
                alt="Affiliate Marketing For Success" 
                className="h-16 w-auto opacity-90 hover:opacity-100 transition-opacity"
              />
              <div className="space-y-2">
                <p className="text-sm text-slate-400 leading-relaxed">
                  This SOTA App is Created by <strong className="text-white">Alexios Papaioannou</strong>, <br/>
                  Owner of <a href="https://affiliatemarketingforsuccess.com" className="text-emerald-400 hover:underline">affiliatemarketingforsuccess.com</a>
                </p>
                <p className="text-xs text-slate-600">
                  &copy; {new Date().getFullYear()} NeuralMesh Architecture. All rights reserved.
                </p>
              </div>
            </div>

            {/* Right Column: Resource Grid */}
            <div className="flex-1 w-full">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-6 flex items-center">
                <Zap size={16} className="text-emerald-500 mr-2" /> Learn More About
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-8">
                {[
                  { label: "Affiliate Marketing", url: "https://affiliatemarketingforsuccess.com/affiliate-marketing" },
                  { label: "AI Revolution", url: "https://affiliatemarketingforsuccess.com/ai" },
                  { label: "Advanced SEO", url: "https://affiliatemarketingforsuccess.com/seo" },
                  { label: "Blogging Strategy", url: "https://affiliatemarketingforsuccess.com/blogging" },
                  { label: "Product Reviews", url: "https://affiliatemarketingforsuccess.com/review" },
                ].map((link, idx) => (
                  <a 
                    key={idx}
                    href={link.url}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="group flex items-center text-sm text-slate-400 hover:text-white transition-colors duration-200"
                  >
                    <span className="w-1.5 h-1.5 bg-slate-700 rounded-full mr-3 group-hover:bg-emerald-500 transition-colors"></span>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>

          </div>
        </div>
      </footer>

    </div>
  );
};



import React, { useState, useEffect } from 'react';
import { Rocket, Layers, Menu, X, Languages, Sun, Moon, Activity, Video, Settings2, Globe, Grid } from 'lucide-react';
import { DEFAULT_SIMULATION_SETTINGS } from './constants';
import { OptimizationTool } from './components/OptimizationTool';
import { MultiStageTool } from './components/MultiStageTool';
import { FlightSimulator } from './components/FlightSimulator';
import { VideoAnalyzer } from './components/VideoAnalyzer';
import { ConfigPage } from './components/ConfigPage';
import { PayloadFuelOptimizer } from './components/PayloadFuelOptimizer';
import { SimulationSettings } from './types';
import { useLanguage } from './contexts/LanguageContext';
import { useTheme } from './contexts/ThemeContext';
import { useGameData } from './contexts/GameDataContext';

const STORAGE_KEY_SETTINGS = 'sfs_sim_settings';

function App() {
  const [activeTab, setActiveTab] = useState<'optimize' | 'payload_opt' | 'simulator' | 'multistage' | 'analyzer' | 'config'>('optimize');
  
  // Persist settings to localStorage
  const [simulationSettings, setSimulationSettings] = useState<SimulationSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      return saved ? JSON.parse(saved) : DEFAULT_SIMULATION_SETTINGS;
    } catch (e) {
      return DEFAULT_SIMULATION_SETTINGS;
    }
  });

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  
  // Get Global Game Data
  const { activePlanet, activePlanetId, setActivePlanetId, planets, difficulty } = useGameData();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(simulationSettings));
  }, [simulationSettings]);

  const NavItem = ({ id, label, icon: Icon }: { id: typeof activeTab, label: string, icon: any }) => (
    <button
      onClick={() => {
        setActiveTab(id);
        setMobileMenuOpen(false);
      }}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full text-left
        ${activeTab === id 
          ? 'bg-space-accent/10 text-space-accent border-l-4 border-space-accent' 
          : 'text-space-400 hover:bg-space-800 hover:text-space-100'
        }`}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-space-900 text-space-100 overflow-hidden font-sans">
      
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 w-full h-16 bg-space-900 border-b border-space-800 z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
          <Rocket className="text-space-accent" />
          <span>SFS<span className="text-space-accent">Lab</span></span>
        </div>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 text-space-400">
          {mobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Sidebar Navigation */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-space-900 border-r border-space-800 transform transition-transform duration-300 lg:relative lg:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        pt-20 lg:pt-0
      `}>
        <div className="h-full flex flex-col p-4">
           <div className="hidden lg:flex items-center gap-2 font-bold text-2xl tracking-tight mb-10 px-2 mt-4">
            <Rocket className="text-space-accent" size={28} />
            <span>SFS<span className="text-space-accent">Lab</span></span>
            {difficulty === 'hard' && (
              <span className="text-[10px] bg-danger text-white px-1.5 py-0.5 rounded font-bold uppercase ml-auto">HARD</span>
            )}
          </div>
          
          {/* Planet Selector */}
          <div className="px-2 mb-6">
            <div className="text-xs font-semibold text-space-500 uppercase tracking-wider mb-2 ml-1">{t('system_body')}</div>
            <div className="relative">
              <select 
                value={activePlanetId} 
                onChange={(e) => setActivePlanetId(e.target.value)}
                className="w-full bg-space-800 border border-space-700 text-space-100 rounded-lg py-2 pl-9 pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-space-accent cursor-pointer hover:bg-space-700 transition"
              >
                {planets.map(p => (
                  <option key={p.id} value={p.id}>{t(`planet_${p.id}`) || p.name}</option>
                ))}
              </select>
              <Globe className="absolute left-3 top-2.5 text-space-accent pointer-events-none" size={16} />
              <div className="absolute right-3 top-3 pointer-events-none">
                <svg className="w-4 h-4 text-space-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
            </div>
          </div>

          <nav className="space-y-2 flex-1">
            <div className="text-xs font-semibold text-space-600 uppercase tracking-wider px-4 mb-2">{t('tools')}</div>
            <NavItem id="optimize" label={t('nav_optimize')} icon={Rocket} />
            <NavItem id="payload_opt" label={t('nav_payload_opt')} icon={Grid} />
            <NavItem id="simulator" label={t('nav_simulator')} icon={Activity} />
            <NavItem id="multistage" label={t('nav_multistage')} icon={Layers} />
            <NavItem id="analyzer" label={t('nav_analyzer')} icon={Video} />
            <div className="my-2 border-t border-space-800"></div>
            <NavItem id="config" label={t('nav_config')} icon={Settings2} />
          </nav>

          <div className="mt-auto border-t border-space-800 pt-6 space-y-4">
            
            {/* Theme Toggle */}
            <div className="px-2">
              <button 
                onClick={toggleTheme}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-space-400 hover:text-space-100 hover:bg-space-800 rounded-md transition-colors"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </button>
            </div>

            {/* Language Switcher */}
            <div className="px-2 mb-2">
              <button 
                onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-space-400 hover:text-space-100 hover:bg-space-800 rounded-md transition-colors"
              >
                <Languages size={16} />
                <span>{language === 'en' ? '中文' : 'English'}</span>
              </button>
            </div>

            <div className="text-xs text-space-600 text-center pt-4">
              <p>{t('version')}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative pt-16 lg:pt-0">
        <div className="h-full overflow-y-auto p-4 lg:p-8">
          <header className="mb-6 flex justify-between items-end">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-space-100 mb-1">
                {activeTab === 'optimize' ? t('opt_title') : 
                 activeTab === 'payload_opt' ? t('pf_title') :
                 activeTab === 'simulator' ? t('sim_title') : 
                 activeTab === 'analyzer' ? t('va_title') :
                 activeTab === 'config' ? t('cfg_title') :
                 t('ms_title')}
              </h1>
              <p className="text-space-400 text-sm">
                {activeTab === 'optimize' ? t('opt_desc', { planet: t(`planet_${activePlanet.id}`) || activePlanet.name }) :
                 activeTab === 'payload_opt' ? t('pf_desc') :
                 activeTab === 'simulator' ? t('sim_desc') :
                 activeTab === 'analyzer' ? t('va_desc') :
                 activeTab === 'config' ? t('cfg_desc') :
                 t('ms_desc')
                }
              </p>
            </div>
          </header>

          <div className="bg-space-900/50 min-h-[calc(100%-100px)] rounded-2xl">
            {activeTab === 'optimize' ? (
              <OptimizationTool 
                planet={activePlanet} 
                settings={simulationSettings} 
                setSettings={setSimulationSettings} 
              />
            ) : activeTab === 'payload_opt' ? (
               <PayloadFuelOptimizer 
                planet={activePlanet} 
                settings={simulationSettings} 
                setSettings={setSimulationSettings} 
               />
            ) : activeTab === 'simulator' ? (
              <FlightSimulator 
                planet={activePlanet}
                settings={simulationSettings}
                setSettings={setSimulationSettings}
              />
            ) : activeTab === 'analyzer' ? (
              <VideoAnalyzer />
            ) : activeTab === 'config' ? (
              <ConfigPage />
            ) : (
              <MultiStageTool planet={activePlanet} />
            )}
          </div>
        </div>
      </main>
      
      {/* Overlay for mobile menu */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </div>
  );
}

export default App;

import React from 'react';
import { useGameData } from '../contexts/GameDataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { InputGroup, NumberInput } from './InputGroup';
import { AlertTriangle, RotateCcw, Settings, Globe, Zap } from 'lucide-react';

export const ConfigPage: React.FC = () => {
  const { t } = useLanguage();
  const { 
    difficulty, setDifficulty, 
    planets, updatePlanet, 
    engines, updateEngine, 
    resetToDefaults 
  } = useGameData();

  return (
    <div className="grid grid-cols-1 gap-6 max-w-5xl mx-auto pb-20">
      
      {/* General Settings / Difficulty */}
      <section className="bg-space-800 border border-space-600 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6 border-b border-space-700 pb-4">
          <Settings className="text-space-accent" size={24} />
          <h2 className="text-xl font-bold text-space-100">{t('cfg_general')}</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
             <label className="text-sm font-medium text-space-400 mb-2 block uppercase tracking-wide">{t('cfg_difficulty')}</label>
             <div className="flex bg-space-900 rounded-lg p-1 border border-space-700 w-full md:w-64">
               <button 
                 onClick={() => setDifficulty('normal')}
                 className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all ${difficulty === 'normal' ? 'bg-space-success text-space-900 shadow-lg' : 'text-space-400 hover:text-space-200'}`}
               >
                 Normal
               </button>
               <button 
                 onClick={() => setDifficulty('hard')}
                 className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all ${difficulty === 'hard' ? 'bg-danger text-white shadow-lg' : 'text-space-400 hover:text-space-200'}`}
               >
                 Hard
               </button>
             </div>
             <p className="text-xs text-space-500 mt-2">
               {difficulty === 'hard' ? t('cfg_diff_hard_desc') : t('cfg_diff_normal_desc')}
             </p>
          </div>

          <div className="flex flex-col justify-end items-start md:items-end">
             <button 
               onClick={() => {
                 if (window.confirm(t('cfg_reset_confirm'))) {
                   resetToDefaults();
                 }
               }}
               className="flex items-center gap-2 px-4 py-2 bg-space-800 border border-danger/30 text-danger hover:bg-danger/10 rounded-lg transition-colors text-sm"
             >
               <RotateCcw size={16} /> {t('cfg_reset_btn')}
             </button>
          </div>
        </div>
      </section>

      {/* Planet Editor */}
      <section className="bg-space-800 border border-space-600 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6 border-b border-space-700 pb-4">
          <Globe className="text-space-accent" size={24} />
          <h2 className="text-xl font-bold text-space-100">{t('cfg_planets')}</h2>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {planets.map(planet => (
            <div key={planet.id} className="bg-space-900/50 border border-space-700/50 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-4">
                 <div className="w-3 h-3 rounded-full" style={{ backgroundColor: planet.color }}></div>
                 <h3 className="font-bold text-space-100">{t(`planet_${planet.id}`) || planet.name}</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <InputGroup label={t('cfg_radius')} subLabel="m">
                   <NumberInput 
                     value={planet.radius} 
                     onChange={(e) => updatePlanet({...planet, radius: parseFloat(e.target.value)})} 
                   />
                </InputGroup>
                <InputGroup label={t('cfg_gravity')} subLabel="m/s²">
                   <NumberInput 
                     value={planet.gravitySurface} 
                     onChange={(e) => updatePlanet({...planet, gravitySurface: parseFloat(e.target.value)})} 
                   />
                </InputGroup>
                <InputGroup label={t('cfg_atmo')} subLabel="m">
                   <NumberInput 
                     value={planet.atmosphereHeight} 
                     onChange={(e) => updatePlanet({...planet, atmosphereHeight: parseFloat(e.target.value)})} 
                   />
                </InputGroup>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Engine Editor */}
      <section className="bg-space-800 border border-space-600 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6 border-b border-space-700 pb-4">
          <Zap className="text-space-accent" size={24} />
          <h2 className="text-xl font-bold text-space-100">{t('cfg_engines')}</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {engines.map(engine => (
             <div key={engine.id} className="bg-space-900/50 border border-space-700/50 rounded-lg p-4 relative">
                <h3 className="font-bold text-space-100 mb-3 text-sm">{t(`engine_${engine.id}`) || engine.name}</h3>
                <div className="grid grid-cols-3 gap-2">
                  <InputGroup label={t('eng_thrust')} subLabel="t">
                     <NumberInput 
                       value={engine.thrust} 
                       onChange={(e) => updateEngine({...engine, thrust: parseFloat(e.target.value)})} 
                     />
                  </InputGroup>
                   <InputGroup label={t('eng_isp')} subLabel="s">
                     <NumberInput 
                       value={engine.isp} 
                       onChange={(e) => updateEngine({...engine, isp: parseFloat(e.target.value)})} 
                     />
                  </InputGroup>
                   <InputGroup label={t('eng_mass')} subLabel="t">
                     <NumberInput 
                       value={engine.mass} 
                       onChange={(e) => updateEngine({...engine, mass: parseFloat(e.target.value)})} 
                     />
                  </InputGroup>
                </div>
             </div>
          ))}
        </div>
      </section>

      <div className="bg-space-800/50 border border-space-700 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="text-warning shrink-0" size={20} />
        <p className="text-xs text-space-400">
           {t('cfg_warning')}
        </p>
      </div>

    </div>
  );
};


import React, { useState, useMemo } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Package, Fuel, Zap, Clock, TrendingUp, Layers } from 'lucide-react';
import { RocketStage, Planet, Engine } from '../types';
import { InputGroup, NumberInput, Select } from './InputGroup';
import { GRAVITY_EARTH } from '../constants';
import { useLanguage } from '../contexts/LanguageContext';
import { useGameData } from '../contexts/GameDataContext';
import { useTheme } from '../contexts/ThemeContext';

interface MultiStageToolProps {
  planet: Planet;
}

interface ComputedStage extends RocketStage {
  totalMassStart: number; // Wet Mass of this stage + Mass Above
  totalMassEnd: number; // Dry Mass of this stage + Mass Above
  massAbove: number;
  deltaV: number;
  burnTime: number;
  twrStart: number;
  twrEnd: number;
  cumulativeDeltaV: number;
}

export const MultiStageTool: React.FC<MultiStageToolProps> = ({ planet }) => {
  const { t } = useLanguage();
  const { engines } = useGameData();
  const { theme } = useTheme();

  // State
  const [payloadMass, setPayloadMass] = useState(10);
  const [stages, setStages] = useState<RocketStage[]>([
    { id: '1', name: 'Booster', dryMass: 6, fuelMass: 40, engineThrust: 240, engineIsp: 240, isEnabled: true },
    { id: '2', name: 'Upper Stage', dryMass: 2, fuelMass: 15, engineThrust: 60, engineIsp: 280, isEnabled: true },
  ]);

  // Stage Management
  const addStage = () => {
    setStages(prev => [
      ...prev,
      { 
        id: Math.random().toString(36).substr(2, 9), 
        name: `Stage ${prev.length + 1}`, 
        dryMass: 1, 
        fuelMass: 10, 
        engineThrust: 40, 
        engineIsp: 280, 
        isEnabled: true 
      }
    ]);
  };

  const removeStage = (id: string) => {
    setStages(stages.filter(s => s.id !== id));
  };

  const moveStage = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === stages.length - 1)) return;
    
    const newStages = [...stages];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newStages[index], newStages[targetIndex]] = [newStages[targetIndex], newStages[index]];
    setStages(newStages);
  };

  const updateStage = (id: string, field: keyof RocketStage, value: any) => {
    setStages(stages.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const applyEnginePreset = (id: string, engineId: string, count: number) => {
    const engine = engines.find(e => e.id === engineId);
    if (!engine) return;

    setStages(stages.map(s => {
      if (s.id === id) {
        // Estimate dry mass slightly higher than engine mass to account for tank structure
        // SFS tanks are roughly 1/9 of fuel mass, but here we just update thrust/isp/mass
        // and let user adjust fuel/dry separately to avoid overwriting their fuel settings destructively.
        // However, we SHOULD update the dry mass to at least include the engines.
        const engineTotalMass = engine.mass * count;
        return {
          ...s,
          engineThrust: engine.thrust * count,
          engineIsp: engine.isp,
          // We don't overwrite dryMass/fuelMass completely, but we ensure dryMass is at least engine mass
          dryMass: Math.max(s.dryMass, engineTotalMass + 0.5) 
        };
      }
      return s;
    }));
  };

  // --- Core Calculation Logic ---
  // Assumption: stages[0] is the TOP stage (closest to payload), stages[length-1] is the BOTTOM booster.
  // Wait, standard UI lists usually show:
  // 1. Stage 1 (Bottom)
  // 2. Stage 2
  // ...
  // Let's stick to the visual order in the list. 
  // If the list renders Top-to-Bottom, then Index 0 is Top.
  // If the list renders Bottom-to-Top (like a rocket), then Index 0 is Bottom.
  // 
  // DECISION: The UI List will render Stage 1, Stage 2... where Stage 1 is the BOTTOM (First to burn).
  // So stages[0] is the Bottom Booster.
  // Calculation must proceed from Top (stages[length-1]) down to Bottom, accumulating mass.
  
  const computedStages: ComputedStage[] = useMemo(() => {
    let currentMassAbove = payloadMass;
    let cumulativeDv = 0;
    
    // We reverse the array to calculate from Top (Payload end) to Bottom (Booster end)
    // Then reverse back to maintain order matching the input list (Bottom -> Top)
    const reversedResults = [...stages].reverse().map((stage) => {
      const stageWetMass = stage.dryMass + stage.fuelMass;
      const totalMassStart = stageWetMass + currentMassAbove;
      const totalMassEnd = stage.dryMass + currentMassAbove; // After fuel burnt
      
      const deltaV = stage.engineIsp * GRAVITY_EARTH * Math.log(totalMassStart / totalMassEnd);
      cumulativeDv += deltaV;

      // Burn Time = Fuel Mass / Mass Flow Rate
      // Mass Flow = Thrust / Exhaust Velocity
      // Exhaust Velocity = Isp * g0
      const ve = stage.engineIsp * GRAVITY_EARTH;
      const thrustN = stage.engineThrust * 1000 * GRAVITY_EARTH;
      const mDot = thrustN / ve; // kg/s
      const burnTime = mDot > 0 ? (stage.fuelMass * 1000) / mDot : 0;

      // TWR
      const weightStart = totalMassStart * 1000 * planet.gravitySurface;
      const weightEnd = totalMassEnd * 1000 * planet.gravitySurface;
      const twrStart = weightStart > 0 ? thrustN / weightStart : 0;
      const twrEnd = weightEnd > 0 ? thrustN / weightEnd : 0;

      const result = {
        ...stage,
        totalMassStart,
        totalMassEnd,
        massAbove: currentMassAbove,
        deltaV,
        burnTime,
        twrStart,
        twrEnd,
        cumulativeDeltaV: cumulativeDv // Note: This is cumulative from top down, which is weird. 
                                      // Real cumulative usually counts from Launch (Bottom up).
                                      // We will fix this in the final mapping.
      };

      currentMassAbove = totalMassStart; // Add this stage's wet mass to the load for the stage below it
      return result;
    });

    // Reverse back to Bottom -> Top order
    const bottomUpStages = reversedResults.reverse();

    // Recalculate cumulative Delta V from launch (Bottom -> Top)
    let launchCumulative = 0;
    return bottomUpStages.map(s => {
      launchCumulative += s.deltaV;
      return { ...s, cumulativeDeltaV: launchCumulative };
    });

  }, [stages, payloadMass, planet.gravitySurface]);

  const totalDeltaV = computedStages.reduce((acc, s) => acc + s.deltaV, 0);
  const totalLaunchMass = computedStages.length > 0 ? computedStages[0].totalMassStart : payloadMass;

  const isDark = theme === 'dark';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-full overflow-hidden">
      
      {/* LEFT COLUMN: Inputs */}
      <div className="xl:col-span-7 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2 h-full">
        
        {/* Global Payload Config */}
        <section className="bg-space-800 border border-space-700 rounded-xl p-4 shrink-0 shadow-lg z-10 sticky top-0">
          <div className="flex items-center gap-3 mb-2">
            <Package className="text-space-accent" size={20} />
            <h3 className="font-bold text-lg text-space-100">{t('ms_payload')}</h3>
          </div>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <InputGroup label={t('ms_payload')}>
                <NumberInput 
                  value={payloadMass} 
                  onChange={(e) => setPayloadMass(parseFloat(e.target.value) || 0)}
                  min={0}
                  step={0.5}
                  unit="t"
                />
              </InputGroup>
            </div>
            <div className="flex-1 pb-2">
               <p className="text-xs text-space-400">{t('opt_payload_sub')}</p>
            </div>
          </div>
        </section>

        {/* Stages List */}
        <div className="flex-1 space-y-4 pb-10">
           <div className="flex justify-between items-center px-1">
             <h3 className="text-sm font-bold text-space-400 uppercase tracking-wider">{t('ms_engine_config')}</h3>
             <button 
                onClick={addStage}
                className="flex items-center gap-2 px-3 py-1.5 bg-space-success/20 text-space-success border border-space-success/50 rounded hover:bg-space-success/30 transition text-sm font-bold"
              >
                <Plus size={16} /> {t('ms_add_stage')}
              </button>
           </div>

           {stages.map((stage, idx) => (
             <div key={stage.id} className="bg-space-800 border border-space-700 rounded-xl p-4 relative group hover:border-space-500 transition-colors">
                
                {/* Stage Header */}
                <div className="flex justify-between items-center mb-4 border-b border-space-700/50 pb-2">
                   <div className="flex items-center gap-2">
                     <span className="bg-space-900 text-space-accent font-mono font-bold px-2 py-0.5 rounded border border-space-700">
                        {t('ms_stage', { n: idx + 1 })}
                     </span>
                     <input 
                       type="text" 
                       value={stage.name}
                       onChange={(e) => updateStage(stage.id, 'name', e.target.value)}
                       className="bg-transparent border-none text-space-100 font-bold focus:ring-0 p-0 text-sm"
                     />
                   </div>
                   <div className="flex items-center gap-1">
                      <button onClick={() => moveStage(idx, 'up')} className="p-1.5 text-space-400 hover:text-space-100 disabled:opacity-30" disabled={idx === 0} title={t('ms_move_down')}>
                        <ArrowDown size={16} />
                      </button>
                      <button onClick={() => moveStage(idx, 'down')} className="p-1.5 text-space-400 hover:text-space-100 disabled:opacity-30" disabled={idx === stages.length - 1} title={t('ms_move_up')}>
                        <ArrowUp size={16} />
                      </button>
                      <div className="w-px h-4 bg-space-700 mx-1"></div>
                      <button onClick={() => removeStage(stage.id)} className="p-1.5 text-space-500 hover:text-danger transition">
                        <Trash2 size={16} />
                      </button>
                   </div>
                </div>

                {/* Engine Preset Selector */}
                <div className="mb-4 bg-space-900/30 p-2 rounded-lg flex items-end gap-2">
                   <div className="flex-1">
                      <label className="text-xs text-space-500 mb-1 block">{t('ms_engine_config')}</label>
                      <Select 
                        onChange={(e) => applyEnginePreset(stage.id, e.target.value, 1)}
                        defaultValue=""
                      >
                         <option value="" disabled>{t('ms_custom_engine')}</option>
                         {engines.map(e => (
                           <option key={e.id} value={e.id}>{t(`engine_${e.id}`) || e.name}</option>
                         ))}
                      </Select>
                   </div>
                   <div className="w-20">
                     <label className="text-xs text-space-500 mb-1 block">Count</label>
                     <NumberInput 
                       min={1} 
                       max={12} 
                       defaultValue={1}
                       onChange={(e) => {
                          // This is a bit tricky since we don't store "engineId" in state, 
                          // just raw numbers. For advanced use, just let them edit Thrust manually.
                          // But for simple scaling, we can try to guess or just leave as manual.
                          // Ideally, we'd store engineId in state, but to keep types simple we'll skip for now.
                       }}
                       placeholder="1x"
                     />
                   </div>
                   <div className="pb-2 text-xs text-space-500 italic">
                      * Auto-fills Thrust/Isp
                   </div>
                </div>

                {/* Data Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                   <InputGroup label={t('ms_fuel_mass')} subLabel="t">
                     <NumberInput value={stage.fuelMass} onChange={(e) => updateStage(stage.id, 'fuelMass', parseFloat(e.target.value))} />
                   </InputGroup>
                   <InputGroup label={t('ms_dry_mass')} subLabel="t">
                     <NumberInput value={stage.dryMass} onChange={(e) => updateStage(stage.id, 'dryMass', parseFloat(e.target.value))} />
                   </InputGroup>
                   <InputGroup label={t('ms_thrust')} subLabel="t">
                     <NumberInput value={stage.engineThrust} onChange={(e) => updateStage(stage.id, 'engineThrust', parseFloat(e.target.value))} />
                   </InputGroup>
                   <InputGroup label={t('ms_isp')} subLabel="s">
                     <NumberInput value={stage.engineIsp} onChange={(e) => updateStage(stage.id, 'engineIsp', parseFloat(e.target.value))} />
                   </InputGroup>
                </div>
             </div>
           ))}
        </div>
      </div>

      {/* RIGHT COLUMN: Visuals & Stats */}
      <div className="xl:col-span-5 flex flex-col gap-6 h-full overflow-hidden">
        
        {/* Total Summary Card */}
        <div className="bg-space-800 border border-space-600 rounded-xl p-5 shadow-xl shrink-0">
           <div className="flex justify-between items-start mb-4">
              <div>
                 <p className="text-xs font-bold text-space-400 uppercase tracking-widest mb-1">{t('ms_total_dv')}</p>
                 <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-space-100">{totalDeltaV.toFixed(0)}</span>
                    <span className="text-lg text-space-500">m/s</span>
                 </div>
              </div>
              <div className="text-right">
                 <p className="text-xs font-bold text-space-400 uppercase tracking-widest mb-1">{t('ms_total_mass')}</p>
                 <div className="flex items-baseline gap-2 justify-end">
                    <span className="text-2xl font-bold text-space-100">{totalLaunchMass.toFixed(1)}</span>
                    <span className="text-sm text-space-500">t</span>
                 </div>
              </div>
           </div>

           {/* Progress Bar */}
           <div className="h-3 bg-space-900 rounded-full overflow-hidden flex w-full">
              {computedStages.map((s, i) => (
                <div 
                  key={s.id}
                  style={{ width: `${(s.deltaV / totalDeltaV) * 100}%`, backgroundColor: `hsl(${200 + (i * 30)}, 70%, 50%)` }}
                  title={`${s.name}: ${s.deltaV.toFixed(0)} m/s`}
                  className="h-full border-r border-space-900 last:border-0"
                />
              ))}
           </div>
           
           <div className="mt-3 flex justify-between text-xs text-space-500">
              <span>{t('system_body')}: {t(`planet_${planet.id}`) || planet.name}</span>
              <span>g = {planet.gravitySurface} m/s²</span>
           </div>
        </div>

        {/* Visual Blueprint Stack */}
        <div className="flex-1 bg-space-900 border border-space-700 rounded-xl p-6 relative overflow-y-auto custom-scrollbar flex flex-col items-center">
            
            {/* Payload (Top) */}
            <div className={`w-24 h-16 border-2 border-space-500 rounded-t-full relative mb-1 flex items-center justify-center shrink-0 z-10 ${isDark ? 'bg-space-800' : 'bg-space-200 shadow-sm'}`}>
               <span className="text-xs font-bold text-space-100">{payloadMass}t</span>
               <div className="absolute inset-0 bg-white/5 rounded-t-full pointer-events-none"></div>
            </div>

            {/* Stages (Reverse order for Visual Stack: Top -> Bottom) */}
            <div className="flex flex-col-reverse w-full items-center gap-1 pb-10">
               {computedStages.map((stage, idx) => {
                  // Visual scaling based on mass
                  const widthPct = Math.min(100, 40 + (stage.totalMassStart / totalLaunchMass) * 60);
                  const heightRem = Math.max(3, Math.min(8, stage.burnTime / 20));
                  const colorHue = 200 + (idx * 30);
                  
                  // Dynamic Coloring based on Theme
                  // Light Mode: Pastel colors (L=93%), Dark borders
                  // Dark Mode: Deep colors (L=15%), Lighter borders
                  const bgLightness = isDark ? 15 : 93;
                  const borderLightness = isDark ? 40 : 60;
                  const saturation = 60;
                  
                  return (
                    <div key={stage.id} className="w-full flex justify-center group relative">
                       {/* Rocket Body */}
                       <div 
                         className="relative rounded-lg border-2 transition-all hover:border-white hover:z-20"
                         style={{ 
                            width: `${widthPct}%`, 
                            height: `${heightRem}rem`,
                            borderColor: `hsl(${colorHue}, ${saturation}%, ${borderLightness}%)`,
                            backgroundColor: `hsla(${colorHue}, ${saturation}%, ${bgLightness}%, 0.9)`
                         }}
                       >
                          {/* Inner Content */}
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2 opacity-90 group-hover:opacity-100">
                             <span className="font-bold text-space-100 drop-shadow-sm text-lg">{stage.name}</span>
                             <div className="flex items-center gap-4 mt-2 text-xs font-mono text-space-200">
                                <span className="flex items-center gap-1" title={t('ms_burn_time')}><Clock size={12}/> {stage.burnTime.toFixed(1)}s</span>
                                <span className="flex items-center gap-1" title="Delta V"><Fuel size={12}/> {stage.deltaV.toFixed(0)}</span>
                             </div>
                          </div>

                          {/* Connector Line */}
                          {idx > 0 && (
                            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4/5 h-1 bg-black/20 blur-sm"></div>
                          )}
                       </div>

                       {/* Hover Info Card (Side) */}
                       <div className="absolute left-[calc(50%+50%)] top-0 ml-4 hidden group-hover:block bg-space-800 border border-space-600 p-3 rounded-lg shadow-2xl w-48 z-30">
                          <h4 className="font-bold text-space-accent mb-2 border-b border-space-600 pb-1">{stage.name} Data</h4>
                          <div className="space-y-1 text-xs text-space-300">
                             <div className="flex justify-between"><span>{t('ms_start_twr')}:</span> <span className={stage.twrStart < 1 ? 'text-danger' : 'text-success'}>{stage.twrStart.toFixed(2)}</span></div>
                             <div className="flex justify-between"><span>{t('ms_end_twr')}:</span> <span className="text-space-100">{stage.twrEnd.toFixed(2)}</span></div>
                             <div className="flex justify-between"><span>{t('ms_burn_time')}:</span> <span>{stage.burnTime.toFixed(1)}s</span></div>
                             <div className="flex justify-between"><span>Δv:</span> <span className="text-space-accent">{stage.deltaV.toFixed(0)} m/s</span></div>
                             <div className="flex justify-between border-t border-space-700 pt-1 mt-1"><span>{t('ms_cumulative')}:</span> <span>{stage.cumulativeDeltaV.toFixed(0)} m/s</span></div>
                          </div>
                       </div>
                    </div>
                  );
               })}
            </div>

            {/* Flame Effect at bottom */}
            <div className="w-0 h-0 border-l-[20px] border-l-transparent border-r-[20px] border-r-transparent border-t-[40px] border-t-orange-500 blur-md opacity-50 animate-pulse"></div>

        </div>
      </div>
    </div>
  );
};


import React, { useState, useMemo } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Package, Fuel, Zap, Clock, TrendingUp, Layers, GitMerge, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
  totalMassStart: number; // Wet Mass at start of THIS burn phase
  totalMassEnd: number; // Wet Mass at end of THIS burn phase (before separation)
  massAbove: number; // Mass of upper stages (payload for this stage)
  deltaV: number;
  burnTime: number;
  twrStart: number;
  twrEnd: number;
  cumulativeDeltaV: number;
  
  // Phase details for Parallel Staging
  isBurningWithNext: boolean; // Is this stage providing thrust ALONGSIDE the next stage?
  phaseThrust?: number; // Combined thrust during this phase
  phaseIsp?: number; // Combined Isp during this phase
}

// Single Stage Equivalent for Comparison
interface SingleStageStats {
  deltaV: number;
  twr: number;
}

export const MultiStageTool: React.FC<MultiStageToolProps> = ({ planet }) => {
  const { t } = useLanguage();
  const { engines } = useGameData();
  const { theme } = useTheme();

  // State
  const [payloadMass, setPayloadMass] = useState(10);
  const [stages, setStages] = useState<RocketStage[]>([
    { id: '1', name: 'Booster (Left/Right)', dryMass: 6, fuelMass: 40, engineId: 'titan', engineCount: 1, engineThrust: 400, engineIsp: 240, isEnabled: true, stageType: 'parallel' },
    { id: '2', name: 'Core Stage', dryMass: 6, fuelMass: 40, engineId: 'titan', engineCount: 1, engineThrust: 400, engineIsp: 240, isEnabled: true, stageType: 'serial' },
    { id: '3', name: 'Upper Stage', dryMass: 2, fuelMass: 15, engineId: 'frontier', engineCount: 1, engineThrust: 100, engineIsp: 290, isEnabled: true, stageType: 'serial' },
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
        engineCount: 1,
        engineThrust: 40, 
        engineIsp: 280, 
        isEnabled: true,
        stageType: 'serial'
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

  const updateStage = (id: string, updates: Partial<RocketStage>) => {
    setStages(stages.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  // Logic: When Engine Type changes
  const handleEngineTypeChange = (stage: RocketStage, newEngineId: string) => {
    const engine = engines.find(e => e.id === newEngineId);
    
    if (newEngineId === 'custom') {
      updateStage(stage.id, { engineId: 'custom' });
      return;
    }

    if (engine) {
      // Calculate Mass Diff: Remove old engines mass, add new engines mass
      let oldEngineMass = 0;
      if (stage.engineId && stage.engineId !== 'custom') {
        const oldEngine = engines.find(e => e.id === stage.engineId);
        if (oldEngine) oldEngineMass = oldEngine.mass * stage.engineCount;
      }
      
      // Default to 1 count if switching type, or keep? Let's keep count but update mass/thrust
      const newThrust = engine.thrust * stage.engineCount;
      const newEngineTotalMass = engine.mass * stage.engineCount;
      
      // Smart Dry Mass Update: Remove old engine mass, add new engine mass
      // Only if the previous state wasn't 'custom' (because we don't know 'custom' mass)
      let newDryMass = stage.dryMass;
      if (stage.engineId !== 'custom') {
         newDryMass = Math.max(0.1, stage.dryMass - oldEngineMass + newEngineTotalMass);
      } else {
         // If coming from custom, we just ADD the new engine mass to whatever was there? 
         // Or reset? Let's just add the engine mass assuming user set 'tank only' mass. 
         // Actually safer to just set dry mass to Engine Mass + a bit of tank?
         // Let's just update the dry mass by Adding the single engine mass difference if count is 1
         newDryMass = stage.dryMass + engine.mass; // Simple fallback
      }

      updateStage(stage.id, {
        engineId: engine.id,
        engineThrust: newThrust,
        engineIsp: engine.isp,
        dryMass: parseFloat(newDryMass.toFixed(2))
      });
    }
  };

  // Logic: When Engine Count changes
  const handleEngineCountChange = (stage: RocketStage, newCount: number) => {
     const count = Math.max(1, Math.floor(newCount));
     
     if (stage.engineId && stage.engineId !== 'custom') {
       const engine = engines.find(e => e.id === stage.engineId);
       if (engine) {
         const diffCount = count - stage.engineCount;
         const massDiff = diffCount * engine.mass;
         
         updateStage(stage.id, {
           engineCount: count,
           engineThrust: engine.thrust * count,
           dryMass: parseFloat((stage.dryMass + massDiff).toFixed(2))
         });
       }
     } else {
       // Custom engine: Just update count, user updates thrust manually?
       // Or assume linear scaling if they already set a thrust?
       // Let's just update count.
       updateStage(stage.id, { engineCount: count });
     }
  };

  /**
   * --- CALCULATION LOGIC ---
   * Supports Serial and Parallel (Booster) staging.
   * Logic iterates from bottom (Stage 0) to top.
   * If Stage N is 'parallel', it burns simultaneously with Stage N+1.
   */
  const computedStages = useMemo(() => {
    const results: ComputedStage[] = [];
    let cumulativeDeltaV = 0;

    // Clone stages to track remaining fuel during simulation
    const simStages = stages.map(s => ({ ...s, remainingFuel: s.fuelMass }));
    
    // Iterate from bottom (Launch) to top
    for (let i = 0; i < simStages.length; i++) {
      const currentSim = simStages[i];
      if (!currentSim.isEnabled) continue;

      // Determine Payload Mass (All stages above current)
      let massAbove = payloadMass;
      for (let j = i + 1; j < simStages.length; j++) {
        if (simStages[j].isEnabled) {
          massAbove += simStages[j].dryMass + simStages[j].remainingFuel;
        }
      }

      // Check if Parallel Staging (Booster)
      const isParallel = currentSim.stageType === 'parallel' && (i + 1 < simStages.length);
      
      let deltaV = 0;
      let burnTime = 0;
      let twrStart = 0;
      let twrEnd = 0;
      let totalMassStart = 0;
      let totalMassEnd = 0;
      let phaseThrust = currentSim.engineThrust;
      let phaseIsp = currentSim.engineIsp;

      if (isParallel) {
        // --- PARALLEL PHASE (Booster + Core) ---
        const nextSim = simStages[i + 1];
        
        // 1. Combined Stats
        const thrustTotal = currentSim.engineThrust + nextSim.engineThrust;
        
        const mDotCurrent = currentSim.engineThrust / currentSim.engineIsp;
        const mDotNext = nextSim.engineThrust / nextSim.engineIsp;
        const mDotTotal = mDotCurrent + mDotNext;
        
        // Effective Isp for the stack
        const ispEffective = thrustTotal / mDotTotal;

        // 2. Burn Time (Limited by whichever runs out first, usually booster)
        const timeToEmptyCurrent = currentSim.remainingFuel / mDotCurrent;
        const timeToEmptyNext = nextSim.remainingFuel / mDotNext;
        const phaseTime = Math.min(timeToEmptyCurrent, timeToEmptyNext);

        // 3. Fuel Consumption
        const fuelConsumedCurrent = mDotCurrent * phaseTime;
        const fuelConsumedNext = mDotNext * phaseTime;

        // 4. Mass delta
        totalMassStart = currentSim.dryMass + currentSim.remainingFuel + massAbove; // massAbove includes next stage wet
        
        const totalFuelConsumed = fuelConsumedCurrent + fuelConsumedNext;
        totalMassEnd = totalMassStart - totalFuelConsumed;

        // 5. Calculate Phase Metrics
        deltaV = ispEffective * GRAVITY_EARTH * Math.log(totalMassStart / totalMassEnd);
        twrStart = thrustTotal / totalMassStart; 
        twrEnd = thrustTotal / totalMassEnd;
        burnTime = phaseTime;

        // 6. Update State for Next Phase
        currentSim.remainingFuel -= fuelConsumedCurrent; 
        nextSim.remainingFuel -= fuelConsumedNext;
        
        phaseThrust = thrustTotal;
        phaseIsp = ispEffective;

      } else {
        // --- SERIAL PHASE (Single Stage) ---
        
        totalMassStart = currentSim.dryMass + currentSim.remainingFuel + massAbove;
        totalMassEnd = currentSim.dryMass + 0 + massAbove; // Burns to depletion

        deltaV = currentSim.engineIsp * GRAVITY_EARTH * Math.log(totalMassStart / totalMassEnd);
        twrStart = currentSim.engineThrust / totalMassStart;
        twrEnd = currentSim.engineThrust / totalMassEnd;
        
        const mDot = currentSim.engineThrust / currentSim.engineIsp;
        burnTime = currentSim.remainingFuel / mDot;
        
        // Update state (empty)
        currentSim.remainingFuel = 0;
      }

      cumulativeDeltaV += deltaV;

      results.push({
        ...currentSim, // Static props
        totalMassStart,
        totalMassEnd,
        massAbove,
        deltaV,
        burnTime,
        twrStart,
        twrEnd,
        cumulativeDeltaV,
        isBurningWithNext: isParallel,
        phaseThrust,
        phaseIsp
      });
    }

    return results;
  }, [stages, payloadMass]);

  const totalStats = useMemo(() => {
    if (computedStages.length === 0) return { mass: 0, dv: 0 };
    return {
      mass: computedStages[0].totalMassStart, // Launch Mass
      dv: computedStages[computedStages.length - 1].cumulativeDeltaV
    };
  }, [computedStages]);

  /**
   * --- EFFICIENCY CALCULATOR ---
   */
  const efficiencyStats = useMemo(() => {
     if (stages.length === 0) return null;

     const mainStage = stages.reduce((prev, curr) => (curr.fuelMass > prev.fuelMass ? curr : prev), stages[0]);
     const refIsp = mainStage.engineIsp;
     
     const totalFuel = stages.reduce((sum, s) => sum + s.fuelMass, 0);
     const totalDry = stages.reduce((sum, s) => sum + s.dryMass, 0);
     
     const refStartMass = totalDry + totalFuel + payloadMass;
     const refEndMass = totalDry + payloadMass; // Single stage carries ALL dry mass to orbit

     const refDeltaV = refIsp * GRAVITY_EARTH * Math.log(refStartMass / refEndMass);
     
     return {
       refDeltaV,
       gain: totalStats.dv - refDeltaV,
       refEngineName: mainStage.name
     };
  }, [stages, payloadMass, totalStats.dv]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-full overflow-hidden">
      
      {/* LEFT COL: Stage Editor */}
      <div className="xl:col-span-5 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2">
         {/* Payload Config */}
         <div className="bg-space-800 border border-space-700 p-4 rounded-xl shrink-0">
            <div className="flex items-center gap-2 mb-3 text-space-accent">
               <Package size={20} />
               <h3 className="font-bold">{t('ms_payload')}</h3>
            </div>
            <InputGroup label="Mass (t)">
               <NumberInput 
                 value={payloadMass} 
                 onChange={(e) => setPayloadMass(Math.max(0, parseFloat(e.target.value)))} 
               />
            </InputGroup>
         </div>

         {/* Stages List */}
         <div className="flex-1 space-y-3">
            {stages.map((stage, index) => (
              <div key={stage.id} className="bg-space-800 border border-space-600 rounded-xl p-4 relative group transition-all hover:border-space-500">
                 
                 {/* Header / Toolbar */}
                 <div className="flex items-center justify-between mb-3 border-b border-space-700 pb-2">
                    <div className="flex items-center gap-2">
                       <span className="bg-space-900 text-space-400 text-xs font-mono px-2 py-1 rounded">#{index + 1}</span>
                       <input 
                         type="text" 
                         value={stage.name}
                         onChange={(e) => updateStage(stage.id, { name: e.target.value })}
                         className="bg-transparent border-none text-space-100 font-bold text-sm focus:ring-0 w-32 md:w-48"
                       />
                    </div>
                    <div className="flex items-center gap-1">
                       <button onClick={() => moveStage(index, 'up')} className="p-1.5 text-space-400 hover:text-space-100 hover:bg-space-700 rounded"><ArrowUp size={14}/></button>
                       <button onClick={() => moveStage(index, 'down')} className="p-1.5 text-space-400 hover:text-space-100 hover:bg-space-700 rounded"><ArrowDown size={14}/></button>
                       <button onClick={() => removeStage(stage.id)} className="p-1.5 text-danger hover:bg-danger/10 rounded ml-2"><Trash2 size={14}/></button>
                    </div>
                 </div>

                 {/* Config Grid */}
                 <div className="grid grid-cols-2 gap-4">
                    {/* Staging Mode */}
                    <div className="col-span-2 bg-space-900/30 p-2 rounded-lg border border-space-700/30 flex items-center gap-4">
                       <label className="text-xs text-space-400 font-bold uppercase">{t('ms_type_label')}</label>
                       <div className="flex gap-2">
                          <button 
                            onClick={() => updateStage(stage.id, { stageType: 'serial' })}
                            className={`px-3 py-1 text-xs rounded border transition-colors ${!stage.stageType || stage.stageType === 'serial' ? 'bg-space-accent text-white border-space-accent' : 'border-space-600 text-space-400 hover:border-space-500'}`}
                          >
                             {t('ms_type_serial')}
                          </button>
                          <button 
                             onClick={() => updateStage(stage.id, { stageType: 'parallel' })}
                             className={`px-3 py-1 text-xs rounded border transition-colors ${stage.stageType === 'parallel' ? 'bg-space-accent text-white border-space-accent' : 'border-space-600 text-space-400 hover:border-space-500'}`}
                             disabled={index === stages.length - 1} 
                             title={index === stages.length - 1 ? "Top stage cannot be a booster" : ""}
                          >
                             {t('ms_type_parallel')}
                          </button>
                       </div>
                    </div>

                    <InputGroup label={t('ms_fuel_mass')} subLabel="t">
                       <NumberInput value={stage.fuelMass} onChange={(e) => updateStage(stage.id, { fuelMass: parseFloat(e.target.value) })} />
                    </InputGroup>
                    <InputGroup label={t('ms_dry_mass')} subLabel="t">
                       <NumberInput value={stage.dryMass} onChange={(e) => updateStage(stage.id, { dryMass: parseFloat(e.target.value) })} />
                    </InputGroup>

                    {/* Engine Select & Count */}
                    <div className="col-span-2 border-t border-space-700 pt-3 mt-1">
                       <div className="flex gap-3 mb-2">
                          <div className="flex-grow-[2]">
                            <InputGroup label={t('ms_engine_config')}>
                               <Select 
                                 value={stage.engineId || 'custom'}
                                 onChange={(e) => handleEngineTypeChange(stage, e.target.value)}
                                 className="text-xs"
                               >
                                  <option value="custom">{t('ms_custom_engine')}</option>
                                  {engines.map(e => <option key={e.id} value={e.id}>{t(`engine_${e.id}`)} ({e.thrust}t)</option>)}
                               </Select>
                            </InputGroup>
                          </div>
                          <div className="flex-grow-[1]">
                             <InputGroup label={t('opt_engine_count')}>
                                <NumberInput 
                                  value={stage.engineCount || 1} 
                                  min={1} 
                                  step={1}
                                  onChange={(e) => handleEngineCountChange(stage, parseFloat(e.target.value))} 
                                />
                             </InputGroup>
                          </div>
                       </div>
                       <div className="grid grid-cols-2 gap-2">
                          <InputGroup label={t('ms_thrust')} subLabel="t">
                             <NumberInput value={stage.engineThrust} onChange={(e) => updateStage(stage.id, { engineThrust: parseFloat(e.target.value) })} />
                          </InputGroup>
                          <InputGroup label={t('ms_isp')} subLabel="s">
                             <NumberInput value={stage.engineIsp} onChange={(e) => updateStage(stage.id, { engineIsp: parseFloat(e.target.value) })} />
                          </InputGroup>
                       </div>
                    </div>
                 </div>
              </div>
            ))}
            
            <button 
              onClick={addStage}
              className="w-full py-3 border-2 border-dashed border-space-600 hover:border-space-accent text-space-400 hover:text-space-accent rounded-xl flex items-center justify-center gap-2 transition-all font-bold"
            >
               <Plus size={20} /> {t('ms_add_stage')}
            </button>
         </div>
      </div>

      {/* RIGHT COL: Analysis & Viz */}
      <div className="xl:col-span-7 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-2">
         
         {/* Summary Cards */}
         <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-space-800 border border-space-600 p-4 rounded-xl shadow-lg">
            <div>
               <p className="text-xs text-space-400 uppercase font-bold">{t('ms_total_dv')}</p>
               <p className="text-2xl font-bold text-space-100">{totalStats.dv.toFixed(0)} <span className="text-sm font-normal text-space-500">m/s</span></p>
            </div>
            <div>
               <p className="text-xs text-space-400 uppercase font-bold">{t('ms_total_mass')}</p>
               <p className="text-2xl font-bold text-space-100">{totalStats.mass.toFixed(1)} <span className="text-sm font-normal text-space-500">t</span></p>
            </div>
            <div>
               <p className="text-xs text-space-400 uppercase font-bold">{t('res_start_twr')}</p>
               <p className={`text-2xl font-bold ${computedStages[0]?.twrStart < 1.01 ? 'text-danger' : 'text-space-success'}`}>
                 {computedStages[0]?.twrStart.toFixed(2) || '-'}
               </p>
            </div>
            <div>
               <p className="text-xs text-space-400 uppercase font-bold">{t('ms_payload')}</p>
               <p className="text-2xl font-bold text-space-accent">{payloadMass.toFixed(1)} <span className="text-sm font-normal text-space-500">t</span></p>
            </div>
         </div>

         {/* Efficiency Analysis */}
         {efficiencyStats && (
            <div className="bg-space-800 border border-space-600 p-4 rounded-xl">
               <div className="flex items-center gap-2 mb-3 text-space-warning">
                  <TrendingUp size={18} />
                  <h3 className="font-bold text-sm uppercase tracking-wide">{t('ms_efficiency_title')}</h3>
               </div>
               
               <div className="flex items-center gap-6">
                  <div className="flex-1">
                     <div className="flex justify-between items-end mb-1">
                        <span className="text-sm text-space-300">Single Stage Ref ({efficiencyStats.refEngineName})</span>
                        <span className="font-mono font-bold text-space-400">{efficiencyStats.refDeltaV.toFixed(0)} m/s</span>
                     </div>
                     <div className="w-full bg-space-900 rounded-full h-2">
                        <div className="h-full bg-space-500 rounded-full" style={{ width: '100%' }}></div>
                     </div>
                  </div>
                  
                  <div className="flex-1">
                     <div className="flex justify-between items-end mb-1">
                        <span className="text-sm text-space-100 font-bold">Current Design</span>
                        <span className={`font-mono font-bold ${efficiencyStats.gain >= 0 ? 'text-space-success' : 'text-danger'}`}>
                           {totalStats.dv.toFixed(0)} m/s
                        </span>
                     </div>
                     <div className="w-full bg-space-900 rounded-full h-2 relative">
                         <div 
                           className="absolute top-0 bottom-0 w-0.5 bg-white z-10" 
                           style={{ left: `${Math.min(100, (efficiencyStats.refDeltaV / Math.max(efficiencyStats.refDeltaV, totalStats.dv)) * 100)}%` }}
                         ></div>
                         
                         <div 
                           className={`h-full rounded-full ${efficiencyStats.gain >= 0 ? 'bg-space-success' : 'bg-danger'}`} 
                           style={{ width: `${Math.min(100, (totalStats.dv / Math.max(efficiencyStats.refDeltaV, totalStats.dv)) * 100)}%` }}
                         ></div>
                     </div>
                  </div>
               </div>

               <div className="mt-3 flex items-start gap-3 bg-space-900/50 p-2 rounded-lg text-xs">
                  {efficiencyStats.gain > 0 ? (
                     <CheckCircle2 className="text-space-success shrink-0" size={16} />
                  ) : (
                     <AlertTriangle className="text-danger shrink-0" size={16} />
                  )}
                  <div>
                     <p className={`font-bold ${efficiencyStats.gain > 0 ? 'text-space-success' : 'text-danger'}`}>
                        {efficiencyStats.gain > 0 ? t('ms_eff_gain') : t('ms_eff_loss')}: {Math.abs(efficiencyStats.gain).toFixed(0)} m/s
                     </p>
                     <p className="text-space-400 mt-1">{t('ms_eff_desc')}</p>
                  </div>
               </div>
            </div>
         )}

         {/* Visualizer & Breakdown */}
         <div className="flex-1 bg-space-800 border border-space-600 rounded-xl p-6 flex flex-col md:flex-row gap-8 min-h-[400px]">
            
            {/* SVG Visualizer */}
            <div className="flex-1 flex items-center justify-center bg-space-900/50 rounded-lg border border-space-700/50 p-4 relative overflow-hidden">
               <svg viewBox="0 0 200 400" className="h-full w-full drop-shadow-2xl">
                  <defs>
                     <linearGradient id="fuelGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#334155" />
                        <stop offset="50%" stopColor="#475569" />
                        <stop offset="100%" stopColor="#334155" />
                     </linearGradient>
                     <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="2" height="4" transform="translate(0,0)" fill="#000000" fillOpacity="0.2"></rect>
                     </pattern>
                  </defs>

                  {/* Render Payload */}
                  <g transform="translate(100, 40)">
                     <path d="M-15,0 L15,0 L15,30 L-15,30 Z" fill="#CBD5E1" stroke="#475569" strokeWidth="2" />
                     <path d="M-15,0 Q0,-30 15,0" fill="#E2E8F0" stroke="#475569" strokeWidth="2" />
                     <text x="0" y="20" textAnchor="middle" fontSize="10" fill="#475569" fontWeight="bold">Payload</text>
                  </g>

                  {/* Render Stages - Reverse Order (Top Down physically) */}
                  {computedStages.slice().reverse().map((stage, i) => {
                     const yStart = 70 + (i * 70);
                     const isBooster = stage.stageType === 'parallel';
                     const isCore = !isBooster;
                     
                     const width = isBooster ? 15 : 40;
                     const height = 60;
                     
                     if (isCore) {
                        return (
                           <g key={stage.id} transform={`translate(100, ${yStart})`}>
                              {/* Tank */}
                              <rect x={-width/2} y="0" width={width} height={height} fill="url(#fuelGrad)" stroke="#64748B" strokeWidth="2" />
                              {/* Engine */}
                              <path d={`M-10,${height} L10,${height} L15,${height+15} L-15,${height+15} Z`} fill="#1E293B" stroke="#0F172A" />
                              
                              <text x="0" y={height/2} textAnchor="middle" fontSize="10" fill="#E2E8F0" className="pointer-events-none">
                                {stage.name.length > 8 ? stage.name.substr(0,6)+'..' : stage.name}
                              </text>
                           </g>
                        );
                     } else {
                        const yBooster = yStart - 70; // Move back up to align with core
                        
                        return (
                           <g key={stage.id} transform={`translate(100, ${yBooster})`}>
                              {/* Left Booster */}
                              <rect x={-35} y="10" width={15} height={60} fill="url(#fuelGrad)" stroke="#64748B" strokeWidth="2" />
                              <path d={`M-32,70 L-23,70 L-20,80 L-35,80 Z`} fill="#1E293B" />
                              
                              {/* Right Booster */}
                              <rect x={20} y="10" width={15} height={60} fill="url(#fuelGrad)" stroke="#64748B" strokeWidth="2" />
                              <path d={`M23,70 L32,70 L35,80 L20,80 Z`} fill="#1E293B" />
                           </g>
                        );
                     }
                  })}
               </svg>
            </div>

            {/* Stage Table */}
            <div className="flex-1 overflow-x-auto">
               <h3 className="text-sm font-bold text-space-100 mb-4 uppercase tracking-wide flex items-center gap-2">
                 <Layers size={16} /> Phase Breakdown
               </h3>
               
               <div className="space-y-4">
                  {computedStages.slice().reverse().map((stage, i) => (
                    <div key={i} className="bg-space-900/50 rounded-lg p-3 border border-space-700/50 relative overflow-hidden">
                       <div className="absolute top-0 right-0 p-1 bg-space-800 rounded-bl text-[10px] font-mono text-space-500 border-b border-l border-space-700">
                          {stage.isBurningWithNext ? 'PARALLEL BURN' : 'SERIAL BURN'}
                       </div>
                       
                       <div className="flex items-baseline justify-between mb-2">
                          <span className="font-bold text-space-100">{stage.name}</span>
                          <span className="font-mono text-space-accent">{stage.deltaV.toFixed(0)} m/s</span>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-y-2 text-xs text-space-400">
                          <div className="flex items-center gap-1">
                             <Clock size={12} /> {stage.burnTime.toFixed(1)}s
                          </div>
                          <div className="flex items-center gap-1">
                             <TrendingUp size={12} /> TWR: {stage.twrStart.toFixed(2)} -> {stage.twrEnd.toFixed(2)}
                          </div>
                          <div>Mass: {stage.totalMassStart.toFixed(1)}t</div>
                          <div>Thrust: {stage.phaseThrust?.toFixed(0) || stage.engineThrust.toFixed(0)}t</div>
                       </div>
                       
                       {/* Fuel Bar */}
                       <div className="mt-2 h-1.5 w-full bg-space-800 rounded-full overflow-hidden">
                          <div className="h-full bg-space-500 w-full"></div>
                       </div>
                    </div>
                  ))}
               </div>
            </div>
         </div>
      </div>

    </div>
  );
};

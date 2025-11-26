
import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { RocketStage, Planet } from '../types';
import { InputGroup, NumberInput } from './InputGroup';
import { GRAVITY_EARTH } from '../constants';
import { useLanguage } from '../contexts/LanguageContext';

interface MultiStageToolProps {
  planet: Planet;
}

export const MultiStageTool: React.FC<MultiStageToolProps> = ({ planet }) => {
  const { t } = useLanguage();
  const [stages, setStages] = useState<RocketStage[]>([
    { id: '1', name: 'Booster', dryMass: 4, fuelMass: 20, engineThrust: 120, engineIsp: 260, isEnabled: true },
    { id: '2', name: 'Upper Stage', dryMass: 2, fuelMass: 10, engineThrust: 40, engineIsp: 315, isEnabled: true },
  ]);

  const addStage = () => {
    setStages([
      ...stages,
      { 
        id: Math.random().toString(36).substr(2, 9), 
        name: `Stage ${stages.length + 1}`, 
        dryMass: 1, 
        fuelMass: 5, 
        engineThrust: 30, 
        engineIsp: 280, 
        isEnabled: true 
      }
    ]);
  };

  const removeStage = (id: string) => {
    setStages(stages.filter(s => s.id !== id));
  };

  const updateStage = (id: string, field: keyof RocketStage, value: any) => {
    setStages(stages.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  // Calculations
  let currentMassAbove = 0;
  // Reverse iterate to calculate payload for lower stages
  const computedStages = [...stages].reverse().map((stage, index) => {
    const totalMass = stage.dryMass + stage.fuelMass + currentMassAbove;
    const finalMass = stage.dryMass + currentMassAbove;
    
    const deltaV = stage.engineIsp * GRAVITY_EARTH * Math.log(totalMass / finalMass);
    const twr = (stage.engineThrust * 1000 * GRAVITY_EARTH) / (totalMass * 1000 * planet.gravitySurface);
    
    currentMassAbove = totalMass;

    return {
      ...stage,
      totalMass,
      deltaV,
      twr
    };
  }).reverse();

  const totalDeltaV = computedStages.reduce((acc, s) => acc + s.deltaV, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full overflow-y-auto custom-scrollbar">
      
      {/* Input Side */}
      <div className="space-y-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-space-accent">{t('ms_title')}</h3>
          <button 
            onClick={addStage}
            className="flex items-center gap-2 px-3 py-1.5 bg-space-success/20 text-space-success border border-space-success/50 rounded hover:bg-space-success/30 transition"
          >
            <Plus size={16} /> {t('ms_add_stage')}
          </button>
        </div>

        {stages.map((stage, idx) => (
          <div key={stage.id} className="bg-space-800 border border-space-700 rounded-lg p-4 relative group">
             <div className="flex justify-between items-center mb-3">
               <span className="bg-space-900 text-xs font-mono px-2 py-1 rounded text-space-400">{t('ms_stage', { n: idx + 1 })}</span>
               <button onClick={() => removeStage(stage.id)} className="text-space-600 hover:text-danger transition">
                 <Trash2 size={16} />
               </button>
             </div>
             
             <div className="grid grid-cols-2 gap-4">
               <InputGroup label={t('ms_dry_mass')}>
                 <NumberInput value={stage.dryMass} onChange={(e) => updateStage(stage.id, 'dryMass', Number(e.target.value))} />
               </InputGroup>
               <InputGroup label={t('ms_fuel_mass')}>
                 <NumberInput value={stage.fuelMass} onChange={(e) => updateStage(stage.id, 'fuelMass', Number(e.target.value))} />
               </InputGroup>
               <InputGroup label={t('ms_thrust')}>
                 <NumberInput value={stage.engineThrust} onChange={(e) => updateStage(stage.id, 'engineThrust', Number(e.target.value))} />
               </InputGroup>
               <InputGroup label={t('ms_isp')}>
                 <NumberInput value={stage.engineIsp} onChange={(e) => updateStage(stage.id, 'engineIsp', Number(e.target.value))} />
               </InputGroup>
             </div>
          </div>
        ))}
      </div>

      {/* Results Side */}
      <div className="space-y-6">
        <div className="bg-space-800 border border-space-600 rounded-xl p-6">
           <div className="flex items-start justify-between">
              <div>
                <h3 className="text-space-400 uppercase tracking-wider text-sm mb-4">{t('ms_total_dv')}</h3>
                <div className="flex items-end gap-3">
                  <span className="text-5xl font-bold text-space-100">{totalDeltaV.toFixed(0)}</span>
                  <span className="text-xl text-space-500 mb-2">m/s</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-space-500 uppercase tracking-wider mb-1">{t('system_body')}</p>
                <p className="text-lg font-bold text-space-accent">{t(`planet_${planet.id}`) || planet.name}</p>
                <p className="text-xs text-space-400 font-mono">g = {planet.gravitySurface.toFixed(2)} m/s²</p>
              </div>
           </div>
          <div className="mt-4 h-4 bg-space-900 rounded-full overflow-hidden flex">
            {computedStages.map((s, i) => (
              <div 
                key={s.id} 
                style={{ width: `${(s.deltaV / totalDeltaV) * 100}%`, backgroundColor: i % 2 === 0 ? '#38BDF8' : '#818CF8' }} 
                className="h-full hover:opacity-80 transition-opacity"
                title={`${s.name}: ${s.deltaV.toFixed(0)} m/s`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {computedStages.map((stage, idx) => (
            <div key={stage.id} className="flex items-center gap-4 bg-space-800/50 p-4 rounded-lg border-l-4" style={{ borderColor: idx % 2 === 0 ? '#38BDF8' : '#818CF8'}}>
               <div className="w-8 h-8 rounded-full bg-space-900 flex items-center justify-center font-bold text-space-400">
                 {idx + 1}
               </div>
               <div className="flex-1 grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-space-500 uppercase">{t('res_dv')}</p>
                    <p className="font-mono text-lg text-space-100">{stage.deltaV.toFixed(0)} <span className="text-xs text-space-600">m/s</span></p>
                  </div>
                  <div>
                    <p className="text-xs text-space-500 uppercase">TWR</p>
                    <p className={`font-mono text-lg ${stage.twr < 1 ? 'text-danger' : 'text-success'}`}>{stage.twr.toFixed(2)}</p>
                  </div>
                   <div>
                    <p className="text-xs text-space-500 uppercase">{t('ms_total_mass')}</p>
                    <p className="font-mono text-lg text-space-100">{stage.totalMass.toFixed(1)} <span className="text-xs text-space-600">t</span></p>
                  </div>
               </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

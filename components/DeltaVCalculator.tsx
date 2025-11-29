
import React, { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useGameData } from '../contexts/GameDataContext';
import { BodyId, LocationType, calculateRoute, TravelStep, BASE_BODIES } from '../services/deltav';
import { InputGroup, Select, NumberInput } from './InputGroup';
import { ArrowRight, Plane, Rocket, Flag, Orbit, Wind, Map, AlertTriangle, ArrowUpCircle, ArrowDownCircle, RefreshCw } from 'lucide-react';

const BODIES: BodyId[] = [
  'mercury', 'venus', 'earth', 'moon', 'mars', 'phobos', 'deimos', 
  'jupiter', 'io', 'europa', 'ganymede', 'callisto'
];
const LOCATIONS: LocationType[] = ['surface', 'orbit'];

interface LocationState {
  body: BodyId;
  type: LocationType;
  orbitHeight: number;
}

const LocationSelector = ({ 
  label, 
  color, 
  value, 
  onChange, 
  difficulty 
}: { 
  label: string; 
  color: string;
  value: LocationState; 
  onChange: (val: LocationState) => void;
  difficulty: 'normal' | 'hard';
}) => {
  const { t } = useLanguage();
  
  // Calculate defaults based on current body and difficulty
  const defaults = useMemo(() => {
    const base = BASE_BODIES[value.body];
    const mult = difficulty === 'hard' ? 2 : 1;
    return {
      low: base.orbitHeight * mult,
      high: base.highOrbitHeight * mult
    };
  }, [value.body, difficulty]);

  return (
    <div className="space-y-3 p-4 bg-space-900/30 rounded-lg border border-space-700/30">
      <label className="text-xs font-bold text-space-400 uppercase tracking-wide flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${color}`}></div> {label}
      </label>
      
      <div className="grid grid-cols-2 gap-2">
        <Select 
          value={value.body} 
          onChange={(e) => {
            const newBody = e.target.value as BodyId;
            // Update Body AND reset orbit height defaults for new body
            const base = BASE_BODIES[newBody];
            const mult = difficulty === 'hard' ? 2 : 1;
            onChange({ ...value, body: newBody, orbitHeight: base.orbitHeight * mult });
          }}
        >
          {BODIES.map(b => (
            <option key={b} value={b}>{t(`planet_${b}`)}</option>
          ))}
        </Select>
        <Select value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value as LocationType })}>
          {LOCATIONS.map(l => (
            <option key={l} value={l}>{t(`dv_${l}`)}</option>
          ))}
        </Select>
      </div>

      {/* Orbit Height Controls */}
      {value.type === 'orbit' && (
        <div className="pt-2 animate-in slide-in-from-top-2 duration-200">
           <InputGroup label={t('dv_orbit_height')}>
              <div className="flex gap-2">
                 <div className="flex-1">
                    <NumberInput 
                      value={value.orbitHeight} 
                      onChange={(e) => onChange({...value, orbitHeight: parseFloat(e.target.value) || 0})}
                      placeholder="km"
                    />
                 </div>
                 <button 
                   onClick={() => onChange({...value, orbitHeight: defaults.low})}
                   className="px-2 py-1 text-xs bg-space-700 hover:bg-space-600 rounded border border-space-600 text-space-300 transition-colors"
                   title={`${t('dv_preset_low')}: ${defaults.low}km`}
                 >
                   {t('dv_preset_low')}
                 </button>
                 <button 
                   onClick={() => onChange({...value, orbitHeight: defaults.high})}
                   className="px-2 py-1 text-xs bg-space-700 hover:bg-space-600 rounded border border-space-600 text-space-300 transition-colors"
                   title={`${t('dv_preset_high')}: ${defaults.high}km`}
                 >
                   {t('dv_preset_high')}
                 </button>
              </div>
           </InputGroup>
        </div>
      )}
    </div>
  );
};

export const DeltaVCalculator: React.FC = () => {
  const { t } = useLanguage();
  const { difficulty } = useGameData();

  const [origin, setOrigin] = useState<LocationState>({ body: 'earth', type: 'surface', orbitHeight: 30 });
  const [dest, setDest] = useState<LocationState>({ body: 'moon', type: 'surface', orbitHeight: 15 });

  // Sync defaults when difficulty changes
  useEffect(() => {
     const mult = difficulty === 'hard' ? 2 : 1;
     setOrigin(prev => ({ ...prev, orbitHeight: BASE_BODIES[prev.body].orbitHeight * mult }));
     setDest(prev => ({ ...prev, orbitHeight: BASE_BODIES[prev.body].orbitHeight * mult }));
  }, [difficulty]);

  const route = useMemo(() => {
    return calculateRoute(
      { bodyId: origin.body, type: origin.type, orbitHeight: origin.orbitHeight },
      { bodyId: dest.body, type: dest.type, orbitHeight: dest.orbitHeight },
      difficulty
    );
  }, [origin, dest, difficulty]);

  const totalDeltaV = route.reduce((acc, step) => acc + step.deltaV, 0);

  const StepIcon = ({ type }: { type: TravelStep['type'] }) => {
    switch (type) {
      case 'ascent': return <Rocket size={20} className="text-space-accent" />;
      case 'transfer': return <Map size={20} className="text-space-warning" />;
      case 'capture': return <Orbit size={20} className="text-space-success" />;
      case 'landing': return <Flag size={20} className="text-space-danger" />;
      case 'change': return <ArrowUpCircle size={20} className="text-indigo-400" />;
      case 'circularize': return <RefreshCw size={20} className="text-emerald-400" />;
      default: return <ArrowRight size={20} />;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full overflow-hidden">
      
      {/* Controls */}
      <div className="lg:col-span-4 space-y-6 overflow-y-auto custom-scrollbar pr-1">
        <section className="bg-space-800 border border-space-700 rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-2 mb-6 text-space-accent">
             <Map size={24} />
             <h3 className="font-bold text-lg">{t('dv_title')}</h3>
             {difficulty === 'hard' && (
                <span className="ml-auto text-[10px] bg-danger text-white px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                  Hard Mode
                </span>
             )}
          </div>

          <div className="space-y-4">
            <LocationSelector 
              label={t('dv_origin')} 
              color="bg-space-accent" 
              value={origin} 
              onChange={setOrigin} 
              difficulty={difficulty}
            />

            <div className="flex justify-center text-space-600 -my-2 relative z-10">
               <div className="bg-space-800 rounded-full p-1 border border-space-700">
                  <ArrowRight size={16} className="rotate-90 lg:rotate-0"/>
               </div>
            </div>

            <LocationSelector 
              label={t('dv_destination')} 
              color="bg-space-danger" 
              value={dest} 
              onChange={setDest} 
              difficulty={difficulty}
            />
          </div>
        </section>

        {/* Total Card */}
        <section className="bg-space-800 border border-space-700 rounded-xl p-6 shadow-lg flex flex-col items-center justify-center text-center">
            <h4 className="text-xs font-bold text-space-400 uppercase tracking-wide mb-2">{t('dv_total')}</h4>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold text-space-100">{totalDeltaV.toFixed(0)}</span>
              <span className="text-xl text-space-500">m/s</span>
            </div>
            {difficulty === 'hard' && (
               <div className="mt-3 flex items-center gap-2 text-xs text-warning bg-warning/10 px-3 py-1 rounded-full border border-warning/20">
                 <AlertTriangle size={12} />
                 <span>2x System Scale</span>
               </div>
            )}
            <p className="text-xs text-space-500 mt-2">{t('dv_note')}</p>
        </section>
      </div>

      {/* Itinerary */}
      <div className="lg:col-span-8 overflow-y-auto custom-scrollbar">
         {route.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-space-500 bg-space-800/50 rounded-xl border border-space-700 border-dashed p-8">
               <Map size={48} className="mb-4 opacity-50" />
               <p>{t('res_empty')}</p>
            </div>
         ) : (
            <div className="space-y-4">
               {route.map((step, idx) => (
                 <div key={idx} className="bg-space-800 border border-space-600 rounded-xl p-5 flex items-center gap-5 shadow-sm hover:border-space-500 transition-colors group">
                    <div className="w-12 h-12 rounded-full bg-space-900 flex items-center justify-center shrink-0 border border-space-700 group-hover:border-space-500 transition-colors">
                       <StepIcon type={step.type} />
                    </div>
                    
                    <div className="flex-1">
                       <div className="flex justify-between items-start mb-1">
                          <h4 className="font-bold text-space-100 text-lg">{t(step.descriptionKey)}</h4>
                          <div className="text-right">
                             <div className="font-mono font-bold text-xl text-space-accent">
                               {step.deltaV === 0 ? t('dv_free') : `${step.deltaV.toFixed(0)} m/s`}
                             </div>
                          </div>
                       </div>
                       
                       <div className="flex items-center gap-2 text-sm text-space-400">
                          <span className="bg-space-900 px-2 py-0.5 rounded text-xs border border-space-700/50 uppercase tracking-wider">
                            {t(`planet_${step.from.bodyId}`)}
                          </span>
                          <ArrowRight size={14} />
                          <span className="bg-space-900 px-2 py-0.5 rounded text-xs border border-space-700/50 uppercase tracking-wider">
                            {t(`planet_${step.to.bodyId}`)}
                          </span>
                       </div>

                       {step.details && (
                         <div className="mt-3 flex flex-wrap gap-3">
                            {step.details.orbitHeight !== undefined && (
                              <span className="inline-flex items-center gap-1 text-xs text-space-300 bg-space-700/30 px-2 py-1 rounded">
                                 <Orbit size={12} /> {t('dv_orbit_alt', { alt: step.details.orbitHeight })}
                              </span>
                            )}
                         </div>
                       )}
                    </div>
                 </div>
               ))}
            </div>
         )}
      </div>

    </div>
  );
};

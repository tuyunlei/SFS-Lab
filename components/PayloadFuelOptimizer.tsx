


import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, Zap, Gauge, Scale, Play, RefreshCw, Info, Maximize, Target } from 'lucide-react';
import { RocketParams, SimulationSettings, Planet } from '../types';
import { simulateLaunch } from '../services/physics';
import { InputGroup, NumberInput, Select, Slider } from './InputGroup';
import { useLanguage } from '../contexts/LanguageContext';
import { useGameData } from '../contexts/GameDataContext';

interface Props {
  planet: Planet;
  settings: SimulationSettings;
  setSettings: (s: SimulationSettings) => void;
}

interface DataPoint {
  payload: number;
  fuel: number;
  height: number;
  deltaV: number;
}

const STORAGE_KEY_PF_PARAMS = 'sfs_pf_params_v2';

const formatNumber = (num: number, decimals = 2) => num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

// Helper to map a value to a color on a heat gradient
const getValueColor = (value: number, min: number, max: number, target: 'maxHeight' | 'deltaV'): string => {
  if (max === min) return target === 'maxHeight' ? 'hsl(200, 100%, 50%)' : 'hsl(270, 100%, 50%)'; 
  
  let ratio = (value - min) / (max - min);
  ratio = Math.max(0, Math.min(1, ratio));
  
  if (target === 'maxHeight') {
    // Blue(240) -> Cyan(180) -> Green(120) -> Yellow(60) -> Red(0)
    const hue = (1 - ratio) * 240;
    return `hsl(${hue}, 80%, 50%)`;
  } else {
    // Dark Blue (240) -> Purple (270) -> Pink (300) -> Light Red (360)
    // Map ratio 0->1 to Hue 240->360
    const hue = 240 + (ratio * 120);
    return `hsl(${hue}, 80%, 60%)`;
  }
};

// Helper to generate all ticks for grid alignment
const generateAllSteps = (min: number, max: number, step: number) => {
  if (step <= 0 || min > max) return [min];
  const ticks: number[] = [];
  // Use a small epsilon to handle floating point issues
  for (let val = min; val <= max + 0.0001; val += step) {
    ticks.push(parseFloat(val.toFixed(2)));
  }
  return ticks;
};

export const PayloadFuelOptimizer: React.FC<Props> = ({ planet, settings, setSettings }) => {
  const { t } = useLanguage();
  const { engines } = useGameData();

  // State
  const [params, setParams] = useState<RocketParams & {
    minPayload: number;
    maxPayload: number;
    stepPayload: number;
  }>(() => {
    try {
      const savedJson = localStorage.getItem(STORAGE_KEY_PF_PARAMS);
      if (savedJson) return JSON.parse(savedJson);
    } catch (e) {}
    return {
      engineCount: 1,
      engine: engines[0], 
      payloadMass: 10, 
      totalTankMass: 30, // Unused in matrix logic but required by type
      tankDryWetRatio: 0.1,
      minTotalTankMass: 10,
      maxTotalTankMass: 100,
      stepTotalTankMass: 5,
      minPayload: 5,
      maxPayload: 50,
      stepPayload: 5,
      // Default dummy values for new required fields if using intersection type
      minPayloadMass: 5,
      maxPayloadMass: 50,
      stepPayloadMass: 5,
    };
  });

  const [data, setData] = useState<DataPoint[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<DataPoint | null>(null);

  // Sync engines
  useEffect(() => {
     const currentEngine = engines.find(e => e.id === params.engine.id);
     if (currentEngine) {
        setParams(p => ({ ...p, engine: currentEngine }));
     } else if (engines.length > 0) {
        setParams(p => ({ ...p, engine: engines[0] }));
     }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engines]);

  // Persist
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PF_PARAMS, JSON.stringify(params));
  }, [params]);

  // Canvas Refs & Sizing
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Resize Observer to handle dynamic container size (removes whitespace issues)
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
           setContainerSize({ width, height });
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const calculateMatrix = () => {
    setIsCalculating(true);
    setTimeout(() => {
      const results: DataPoint[] = [];
      const sweepSettings = { ...settings, timeStep: Math.max(settings.timeStep, 0.2) };

      const stepP = Math.max(0.1, params.stepPayload);
      const stepF = Math.max(0.1, params.stepTotalTankMass);

      for (let p = params.minPayload; p <= params.maxPayload; p += stepP) {
        for (let f = params.minTotalTankMass; f <= params.maxTotalTankMass; f += stepF) {
          const iterationParams: RocketParams = {
            ...params,
            payloadMass: p // Used as default payload for sim
          };
          
          // Pass f as tank mass, p as payloadOverride (redundant but explicit)
          const res = simulateLaunch(f, iterationParams, planet, sweepSettings, 0, p);
          results.push({
            payload: parseFloat(p.toFixed(2)),
            fuel: parseFloat(f.toFixed(2)),
            height: res.maxHeight / 1000, // KM
            deltaV: res.deltaV // m/s
          });
        }
      }
      setData(results);
      setIsCalculating(false);
    }, 50);
  };

  // Find Stats based on current optimization Target
  const stats = useMemo(() => {
    if (data.length === 0) return { min: 0, max: 0, best: null };
    let minVal = Infinity;
    let maxVal = -Infinity;
    let best = data[0];

    data.forEach(d => {
      const val = settings.optimizationTarget === 'maxHeight' ? d.height : d.deltaV;
      if (val < minVal) minVal = val;
      if (val > maxVal) {
        maxVal = val;
        best = d;
      }
    });
    return { min: minVal, max: maxVal, best };
  }, [data, settings.optimizationTarget]);

  // Draw Heatmap
  useEffect(() => {
    const canvas = canvasRef.current;
    const { width, height } = containerSize;

    if (!canvas || width === 0 || height === 0) return;

    // Use Device Pixel Ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    // Style size must match container size
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    
    // Clear
    ctx.clearRect(0, 0, width, height);

    if (data.length === 0) return;

    // Calc Ranges
    const pRange = params.maxPayload - params.minPayload;
    const fRange = params.maxTotalTankMass - params.minTotalTankMass;
    
    // Draw Cells
    // We add +1 to cell dimensions to prevent sub-pixel gaps
    const cellW = (width / (pRange / params.stepPayload + 1)) + 0.5; 
    const cellH = (height / (fRange / params.stepTotalTankMass + 1)) + 0.5;

    data.forEach(pt => {
      // Map Payload to X
      const x = ((pt.payload - params.minPayload) / pRange) * (width - cellW);
      // Map Fuel to Y (Invert Y so low fuel is bottom)
      const y = height - (((pt.fuel - params.minTotalTankMass) / fRange) * (height - cellH)) - cellH;

      const val = settings.optimizationTarget === 'maxHeight' ? pt.height : pt.deltaV;
      ctx.fillStyle = getValueColor(val, stats.min, stats.max, settings.optimizationTarget);
      
      // Use Math.floor/ceil to snap to pixels for crisp edges
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cellW), Math.ceil(cellH));
    });

    // Draw Best Point Marker
    if (stats.best) {
      const best = stats.best;
      const bx = ((best.payload - params.minPayload) / pRange) * (width - cellW) + cellW/2;
      const by = height - (((best.fuel - params.minTotalTankMass) / fRange) * (height - cellH)) - cellH + cellH/2;

      // Outer glow
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fill();

      // Ring
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Center
      ctx.beginPath();
      ctx.arc(bx, by, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();
    }

  }, [data, containerSize, params, stats, settings.optimizationTarget]);

  // Handle Mouse Hover
  const handleMouseMove = (e: React.MouseEvent) => {
    if (data.length === 0 || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    // Inverse Map coords to Data
    const pRange = params.maxPayload - params.minPayload;
    const fRange = params.maxTotalTankMass - params.minTotalTankMass;
    
    // Mouse pct
    const xPct = Math.max(0, Math.min(1, x / width));
    const yPct = Math.max(0, Math.min(1, (height - y) / height)); // Invert Y

    const targetP = params.minPayload + (xPct * pRange);
    const targetF = params.minTotalTankMass + (yPct * fRange);

    let nearest = null;
    let minDist = Infinity;

    // Simple nearest neighbor search
    for (const pt of data) {
       // Normalize distance components roughly
       const dp = Math.abs(pt.payload - targetP);
       const df = Math.abs(pt.fuel - targetF);
       const dist = dp + df; // Manhattan distance is fine here
       if (dist < minDist) {
         minDist = dist;
         nearest = pt;
       }
    }
    
    setHoverInfo(nearest || null);
  };

  const handleMouseLeave = () => setHoverInfo(null);

  // Generate ticks for display (1 tick per grid)
  const xTicks = useMemo(() => 
    generateAllSteps(params.minPayload, params.maxPayload, params.stepPayload), 
  [params.minPayload, params.maxPayload, params.stepPayload]);
  
  const yTicks = useMemo(() => 
    generateAllSteps(params.minTotalTankMass, params.maxTotalTankMass, params.stepTotalTankMass).reverse(), 
  [params.minTotalTankMass, params.maxTotalTankMass, params.stepTotalTankMass]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:h-full relative">
      
      {/* Sidebar Controls */}
      <div className="lg:col-span-4 xl:col-span-3 space-y-6 lg:overflow-y-auto pr-2 custom-scrollbar lg:max-h-[calc(100vh-100px)]">
        
        {/* Rocket Configuration */}
        <section className="bg-space-800/50 border border-space-700 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2 text-space-accent mb-2">
            <Settings size={18} />
            <h3 className="font-semibold uppercase tracking-wider text-sm">{t('opt_config_rocket')}</h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <InputGroup label={t('opt_engine_model')}>
                <Select 
                  value={params.engine.id} 
                  onChange={(e) => {
                    const eng = engines.find(eng => eng.id === e.target.value) || engines[0];
                    setParams({ ...params, engine: eng });
                  }}
                >
                  {engines.map(e => (
                    <option key={e.id} value={e.id}>{t(`engine_${e.id}`) || e.name}</option>
                  ))}
                </Select>
              </InputGroup>
              
              <div className="mt-2 grid grid-cols-3 gap-2 p-2 bg-space-900/50 rounded-md border border-space-700/50">
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-1 text-[10px] text-space-400 uppercase tracking-wide">
                    <Zap size={10} /> {t('eng_thrust')}
                  </div>
                  <div className="text-space-100 font-mono text-sm">{params.engine.thrust}t</div>
                </div>
                <div className="flex flex-col items-center border-l border-space-700/50">
                   <div className="flex items-center gap-1 text-[10px] text-space-400 uppercase tracking-wide">
                    <Gauge size={10} /> {t('eng_isp')}
                  </div>
                  <div className="text-space-100 font-mono text-sm">{params.engine.isp}s</div>
                </div>
                <div className="flex flex-col items-center border-l border-space-700/50">
                   <div className="flex items-center gap-1 text-[10px] text-space-400 uppercase tracking-wide">
                    <Scale size={10} /> {t('eng_mass')}
                  </div>
                  <div className="text-space-100 font-mono text-sm">{params.engine.mass}t</div>
                </div>
              </div>
            </div>

            <InputGroup label={t('opt_engine_count')}>
              <NumberInput 
                min={1} 
                max={20} 
                value={params.engineCount} 
                onChange={(e) => setParams({...params, engineCount: Number(e.target.value)})} 
              />
            </InputGroup>
             <InputGroup label={t('opt_tank_ratio')} subLabel={t('opt_tank_ratio_sub')}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-space-300">{(params.tankDryWetRatio * 100).toFixed(0)}%</span>
                  <Slider 
                    min={0.05} max={0.3} step={0.01} 
                    value={params.tankDryWetRatio} 
                    onChange={(e) => setParams({...params, tankDryWetRatio: Number(e.target.value)})} 
                  />
                </div>
              </InputGroup>
          </div>
        </section>

        {/* Sweep Settings */}
        <section className="bg-space-800/50 border border-space-700 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2 text-space-success mb-2">
            <RefreshCw size={18} />
            <h3 className="font-semibold uppercase tracking-wider text-sm">{t('opt_config_sweep')}</h3>
          </div>
          
          {/* Payload Sweep */}
          <div className="space-y-3 pb-3 border-b border-space-700/50">
            <h4 className="text-xs font-bold text-space-400 uppercase">{t('pf_config_payload_sweep')}</h4>
            <div className="grid grid-cols-2 gap-3">
                <InputGroup label={t('pf_min_payload')} subLabel="t">
                  <NumberInput 
                    value={params.minPayload} 
                    onChange={(e) => setParams({...params, minPayload: Number(e.target.value)})} 
                  />
                </InputGroup>
                <InputGroup label={t('pf_max_payload')} subLabel="t">
                  <NumberInput 
                    value={params.maxPayload} 
                    onChange={(e) => setParams({...params, maxPayload: Number(e.target.value)})} 
                  />
                </InputGroup>
            </div>
             <InputGroup label={t('opt_step_size')} subLabel="t">
               <NumberInput 
                  value={params.stepPayload} 
                  onChange={(e) => setParams({...params, stepPayload: Number(e.target.value)})} 
                />
            </InputGroup>
          </div>

           {/* Fuel Sweep */}
           <div className="space-y-3">
             <h4 className="text-xs font-bold text-space-400 uppercase">{t('opt_config_sweep')} (Fuel)</h4>
             <div className="grid grid-cols-2 gap-3">
                <InputGroup label={t('opt_min_mass')} subLabel="t">
                  <NumberInput 
                    value={params.minTotalTankMass} 
                    onChange={(e) => setParams({...params, minTotalTankMass: Number(e.target.value)})} 
                  />
                </InputGroup>
                <InputGroup label={t('opt_max_mass')} subLabel="t">
                  <NumberInput 
                    value={params.maxTotalTankMass} 
                    onChange={(e) => setParams({...params, maxTotalTankMass: Number(e.target.value)})} 
                  />
                </InputGroup>
             </div>
              <InputGroup label={t('opt_step_size')} subLabel="t">
               <NumberInput 
                  value={params.stepTotalTankMass} 
                  onChange={(e) => setParams({...params, stepTotalTankMass: Number(e.target.value)})} 
                />
            </InputGroup>
           </div>
        </section>

         {/* Physics */}
         <section className="bg-space-800/50 border border-space-700 rounded-lg p-4">
             <div className="flex items-center gap-2 text-space-warning mb-2">
              <Info size={18} />
              <h3 className="font-semibold uppercase tracking-wider text-sm">{t('opt_config_physics')}</h3>
            </div>
             <InputGroup label={t('opt_target_label')}>
                 <Select 
                   value={settings.optimizationTarget}
                   onChange={(e) => setSettings({...settings, optimizationTarget: e.target.value as 'maxHeight' | 'deltaV'})}
                 >
                   <option value="maxHeight">{t('opt_target_height')}</option>
                   <option value="deltaV">{t('opt_target_dv')}</option>
                 </Select>
            </InputGroup>
            <div className="h-px bg-space-700/50 my-1"></div>
            <label className="flex items-center gap-2 text-sm text-space-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={settings.gravityModel === 'variable'} 
                onChange={(e) => setSettings({...settings, gravityModel: e.target.checked ? 'variable' : 'constant'})}
                className="w-4 h-4 rounded bg-space-900 border-space-600 text-space-accent focus:ring-offset-space-800"
              />
              {t('opt_var_gravity')}
            </label>
            <label className="flex items-center gap-2 text-sm text-space-300 cursor-pointer mt-2">
              <input 
                type="checkbox" 
                checked={settings.enableDrag} 
                onChange={(e) => setSettings({...settings, enableDrag: e.target.checked})}
                className="w-4 h-4 rounded bg-space-900 border-space-600 text-space-accent focus:ring-offset-space-800"
              />
              {t('opt_drag')}
            </label>
         </section>
         
         <button 
          onClick={calculateMatrix}
          disabled={isCalculating}
          className="w-full flex items-center justify-center gap-2 py-3 bg-space-accent hover:bg-space-accent/90 text-white rounded-lg font-bold shadow-lg shadow-space-accent/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCalculating ? (
            <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <Play size={20} fill="currentColor" />
          )}
          {t('sim_run')}
        </button>

      </div>

      {/* Main Display */}
      <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-6">
         
         {/* Stats Card */}
         <div className="bg-space-800 border border-space-600 rounded-xl p-4 shadow-xl">
            {stats.best ? (
              <div className="flex items-start gap-4">
                 <div className="p-3 bg-space-900/50 rounded-lg border-l-4 border-space-success">
                     <Maximize size={24} className="text-space-success mb-1" />
                     <p className="text-xs text-space-400 uppercase tracking-wide">{t('pf_global_max')}</p>
                 </div>
                 <div>
                    <p className="text-2xl font-bold text-space-100">
                      {t('pf_max_coord', { 
                        value: settings.optimizationTarget === 'maxHeight' 
                               ? `${formatNumber(stats.best.height, 2)}km`
                               : `${formatNumber(stats.best.deltaV, 0)}m/s`,
                        payload: stats.best.payload, 
                        fuel: stats.best.fuel 
                      })}
                    </p>
                    <p className="text-sm text-space-400 mt-1">
                      {settings.optimizationTarget === 'maxHeight'
                         ? `Range: ${formatNumber(stats.min, 1)}km - ${formatNumber(stats.max, 1)}km`
                         : `Range: ${formatNumber(stats.min, 0)}m/s - ${formatNumber(stats.max, 0)}m/s`
                      }
                    </p>
                 </div>
              </div>
            ) : (
              <div className="text-space-400 text-center py-4">{t('res_empty')}</div>
            )}
         </div>

         {/* Heatmap Area */}
         <div className="flex-1 bg-space-800 border border-space-600 rounded-xl p-6 relative flex flex-col h-[600px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-medium text-space-400 flex items-center gap-2">
                 <Target size={14} />
                 {t('pf_heatmap_title')}
                 <span className="text-space-accent bg-space-900 px-2 py-0.5 rounded text-xs border border-space-700">
                    {settings.optimizationTarget === 'maxHeight' ? t('opt_target_height') : t('opt_target_dv')}
                 </span>
              </h3>
              
              {/* Legend */}
              <div className="flex items-center gap-2 text-xs text-space-400">
                <span>{t('pf_legend_low')}</span>
                <div 
                   className="w-32 h-3 rounded-full" 
                   style={{ 
                     background: settings.optimizationTarget === 'maxHeight' 
                       ? 'linear-gradient(to right, hsl(240, 80%, 50%), hsl(180, 80%, 50%), hsl(120, 80%, 50%), hsl(60, 80%, 50%), hsl(0, 80%, 50%))'
                       : 'linear-gradient(to right, hsl(240, 80%, 60%), hsl(270, 80%, 60%), hsl(300, 80%, 60%), hsl(360, 80%, 60%))'
                   }}
                ></div>
                <span>{t('pf_legend_high')}</span>
              </div>
            </div>

            {/* Chart Grid - Main Layout */}
            <div className="flex-1 grid grid-cols-[70px_1fr] grid-rows-[1fr_30px] gap-1 min-h-0"> 
               
               {/* Y Axis Ticks (Fuel) */}
               <div className="relative w-full h-full border-r border-space-700/50">
                 {yTicks.map((val, i) => {
                    const count = yTicks.length;
                    // Auto-decimate if too many ticks (LOD)
                    const stride = Math.ceil(count / 20);
                    if (i % stride !== 0) return null;

                    return (
                      <div 
                        key={val} 
                        className="absolute right-0 w-full flex items-center justify-end gap-2 pr-3"
                        style={{ top: `${((i + 0.5) / count) * 100}%`, transform: 'translateY(-50%)' }}
                      >
                        <span className="text-[10px] text-space-300 font-mono bg-space-900/80 px-1 rounded">{val}</span>
                        <div className="w-1.5 h-px bg-space-600"></div>
                      </div>
                    );
                 })}
               </div>

               {/* Canvas Container */}
               <div ref={containerRef} className="relative bg-space-900 rounded border border-space-700 overflow-hidden cursor-crosshair">
                  {data.length === 0 && !isCalculating && (
                    <div className="absolute inset-0 flex items-center justify-center text-space-600">
                      {t('res_sim_empty')}
                    </div>
                  )}
                  {isCalculating && (
                     <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 backdrop-blur-sm">
                       <div className="animate-spin h-8 w-8 border-4 border-space-accent border-t-transparent rounded-full" />
                     </div>
                  )}
                  
                  <canvas 
                    ref={canvasRef} 
                    className="block w-full h-full"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                  />
                  
                  {/* Hover Tooltip */}
                  {hoverInfo && (
                     <div className="absolute bottom-4 right-4 bg-gray-900 border border-slate-600 p-3 rounded-lg shadow-xl pointer-events-none z-20">
                        <p className="text-sm font-bold text-white font-mono whitespace-nowrap">
                           {t('pf_hover_info', { 
                             p: hoverInfo.payload, 
                             f: hoverInfo.fuel, 
                             v: settings.optimizationTarget === 'maxHeight' 
                                ? `${hoverInfo.height.toFixed(2)}km`
                                : `${hoverInfo.deltaV.toFixed(0)}m/s`
                           })}
                        </p>
                     </div>
                  )}
               </div>

               {/* Corner Spacer */}
               <div></div>

               {/* X Axis Ticks (Payload) */}
               <div className="relative w-full h-full border-t border-space-700/50">
                 {xTicks.map((val, i) => {
                    const count = xTicks.length;
                    const stride = Math.ceil(count / 15);
                    if (i % stride !== 0) return null;

                    return (
                      <div 
                        key={val} 
                        className="absolute top-0 flex flex-col items-center pt-2"
                        style={{ left: `${((i + 0.5) / count) * 100}%`, transform: 'translateX(-50%)' }}
                      >
                         <div className="w-px h-1.5 bg-space-600 mb-1"></div>
                         <span className="text-[10px] text-space-300 font-mono bg-space-900/80 px-1 rounded">{val}</span>
                      </div>
                    );
                 })}
               </div>
            </div>

            {/* Axis Titles */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 text-xs text-space-500 font-bold pointer-events-none origin-center transform -translate-y-6">
               {t('pf_axis_y')}
            </div>
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-space-500 font-bold pointer-events-none">
               {t('pf_axis_x')}
            </div>
         </div>
      </div>
    </div>
  );
};
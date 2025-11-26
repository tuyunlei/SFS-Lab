
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot, Area, ComposedChart, ReferenceLine
} from 'recharts';
import { Settings, RefreshCw, Info, FileText, X, Zap, Gauge, Scale } from 'lucide-react';
import { RocketParams, SimulationSettings, SimulationResult, Planet, TelemetryPoint } from '../types';
import { runOptimization, simulateLaunch } from '../services/physics';
import { InputGroup, NumberInput, Select, Slider } from './InputGroup';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGameData } from '../contexts/GameDataContext';

interface OptimizationToolProps {
  planet: Planet;
  settings: SimulationSettings;
  setSettings: (s: SimulationSettings) => void;
}

const formatNumber = (num: number, decimals = 1) => num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const formatKm = (m: number) => m >= 1000 ? `${formatNumber(m/1000, 2)} km` : `${formatNumber(m, 0)} m`;

const STORAGE_KEY_PARAMS = 'sfs_opt_params';
const ROW_HEIGHT = 40; // px

export const OptimizationTool: React.FC<OptimizationToolProps> = ({ planet, settings, setSettings }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { engines } = useGameData();
  
  // Initialize state from localStorage or defaults
  const [params, setParams] = useState<RocketParams>(() => {
    try {
      const savedJson = localStorage.getItem(STORAGE_KEY_PARAMS);
      if (savedJson) {
        const saved = JSON.parse(savedJson);
        // Ensure the engine object is valid and matches current engine list if possible
        // But since engine data can be custom, we just check if it has ID.
        // We do NOT overwrite it with list data immediately to respect saved state unless ID matches.
        if (saved.engine && saved.engine.id) {
           // We'll update the engine object reference in the effect below to keep it in sync with global configs
        }
        return saved;
      }
    } catch (e) {
      // Fallback if parse fails
    }
    return {
      engineCount: 1,
      engine: engines[0], 
      payloadMass: 10,
      tankDryWetRatio: 0.1, // 10% dry, 90% fuel
      minTotalTankMass: 5,
      maxTotalTankMass: 100,
      stepTotalTankMass: 2,
    };
  });

  // Sync selected engine with global engines list in case config changed
  useEffect(() => {
     const currentEngine = engines.find(e => e.id === params.engine.id);
     if (currentEngine && (currentEngine.thrust !== params.engine.thrust || currentEngine.isp !== params.engine.isp || currentEngine.mass !== params.engine.mass)) {
        setParams(p => ({ ...p, engine: currentEngine }));
     }
     // If current engine ID doesn't exist anymore (removed?), default to first
     if (!currentEngine && engines.length > 0) {
        setParams(p => ({ ...p, engine: engines[0] }));
     }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engines]);

  const [results, setResults] = useState<SimulationResult[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  
  // Interaction State
  const [selectedTankMass, setSelectedTankMass] = useState<number | null>(null);
  
  // Log Modal State
  const [showLog, setShowLog] = useState(false);
  const [logData, setLogData] = useState<TelemetryPoint[]>([]);

  // Virtual Scroll State
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(500);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Persist params whenever they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PARAMS, JSON.stringify(params));
  }, [params]);

  // Run simulation
  const handleCalculate = () => {
    setIsCalculating(true);
    // Reset selection when recalculating to avoid stale data pointers
    setSelectedTankMass(null);
    
    setTimeout(() => {
      const data = runOptimization(params, planet, settings);
      setResults(data);
      setIsCalculating(false);
    }, 50);
  };

  const bestResult = useMemo(() => {
    if (results.length === 0) return null;
    return results.reduce((prev, current) => (current.maxHeight > prev.maxHeight ? current : prev));
  }, [results]);

  // Determine which result to display in summary card (Selected > Best > Null)
  const displayedResult = useMemo(() => {
    if (selectedTankMass !== null) {
      const found = results.find(r => r.tankMass === selectedTankMass);
      if (found) return found;
    }
    return bestResult;
  }, [selectedTankMass, results, bestResult]);

  const handleShowLog = () => {
    if (!displayedResult) return;
    
    // Run a single high-precision simulation for the displayed result
    const result = simulateLaunch(displayedResult.tankMass, params, planet, settings, 1.0);
    
    if (result.telemetry) {
      setLogData(result.telemetry);
      setShowLog(true);
      setScrollTop(0);
    }
  };

  // Virtualization Logic for Log Modal
  useEffect(() => {
    if (showLog && tableContainerRef.current) {
      setContainerHeight(tableContainerRef.current.clientHeight);
      
      const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
           setContainerHeight(entry.contentRect.height);
        }
      });
      
      resizeObserver.observe(tableContainerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [showLog]);

  const virtualTableData = useMemo(() => {
    const totalRows = logData.length;
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT));
    // Render enough rows to fill container + buffer
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT);
    const endIndex = Math.min(totalRows, startIndex + visibleCount + 5); 
    
    const visibleData = logData.slice(startIndex, endIndex);
    const paddingTop = startIndex * ROW_HEIGHT;
    const paddingBottom = (totalRows - endIndex) * ROW_HEIGHT;

    return { visibleData, paddingTop, paddingBottom, startIndex };
  }, [logData, scrollTop, containerHeight]);

  // Auto-calculate on simple changes
  useEffect(() => {
    const timer = setTimeout(() => {
      handleCalculate();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, planet, settings.gravityModel, settings.enableDrag, settings.timeStep]);

  const chartData = useMemo(() => {
    return results.map(r => ({
      ...r,
      maxHeightKm: r.maxHeight / 1000,
      twr: r.twrStart,
    }));
  }, [results]);

  const onChartClick = (data: any) => {
    if (data && data.activePayload && data.activePayload.length > 0) {
      const point = data.activePayload[0].payload;
      setSelectedTankMass(point.tankMass);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:h-full relative">
      <style>{`
         .recharts-wrapper,
         .recharts-surface,
         .recharts-cartesian-grid,
         .recharts-layer,
         .recharts-wrapper :focus {
           outline: none !important;
         }
       `}</style>
      
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
              
              {/* Engine Specs Card */}
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
          </div>

          <InputGroup label={t('opt_payload')} subLabel={t('opt_payload_sub')} error={params.payloadMass < 0 ? t('err_neg') : undefined}>
            <NumberInput 
              unit="t" 
              step={0.1} 
              value={params.payloadMass} 
              onChange={(e) => setParams({...params, payloadMass: Number(e.target.value)})} 
            />
          </InputGroup>

          <InputGroup label={t('opt_tank_ratio')} subLabel={t('opt_tank_ratio_sub')}>
            <div className="flex items-center gap-3">
              <Slider 
                min={0.05} max={0.3} step={0.01} 
                value={params.tankDryWetRatio} 
                onChange={(e) => setParams({...params, tankDryWetRatio: Number(e.target.value)})} 
              />
              <span className="text-sm font-mono text-space-400 w-12">{(params.tankDryWetRatio * 100).toFixed(0)}%</span>
            </div>
          </InputGroup>
        </section>

        {/* Sweep Settings */}
        <section className="bg-space-800/50 border border-space-700 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2 text-space-success mb-2">
            <RefreshCw size={18} />
            <h3 className="font-semibold uppercase tracking-wider text-sm">{t('opt_config_sweep')}</h3>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <InputGroup label={t('opt_min_mass')} subLabel={t('opt_min_mass_sub')}>
              <NumberInput 
                unit="t" 
                value={params.minTotalTankMass} 
                onChange={(e) => setParams({...params, minTotalTankMass: Number(e.target.value)})} 
              />
            </InputGroup>
            <InputGroup label={t('opt_max_mass')} subLabel={t('opt_max_mass_sub')}>
              <NumberInput 
                unit="t" 
                value={params.maxTotalTankMass} 
                onChange={(e) => setParams({...params, maxTotalTankMass: Number(e.target.value)})} 
              />
            </InputGroup>
          </div>
          <InputGroup label={t('opt_step_size')} subLabel={t('opt_step_size_sub')}>
             <NumberInput 
                unit="t" 
                step={0.1}
                value={params.stepTotalTankMass} 
                onChange={(e) => setParams({...params, stepTotalTankMass: Number(e.target.value)})} 
              />
          </InputGroup>
        </section>

        {/* Simulation Settings */}
        <section className="bg-space-800/50 border border-space-700 rounded-lg p-4 space-y-4">
           <div className="flex items-center gap-2 text-space-warning mb-2">
            <Info size={18} />
            <h3 className="font-semibold uppercase tracking-wider text-sm">{t('opt_config_physics')}</h3>
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm text-space-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={settings.gravityModel === 'variable'} 
                onChange={(e) => setSettings({...settings, gravityModel: e.target.checked ? 'variable' : 'constant'})}
                className="w-4 h-4 rounded bg-space-900 border-space-600 text-space-accent focus:ring-offset-space-800"
              />
              {t('opt_var_gravity')}
            </label>
            <label className="flex items-center gap-2 text-sm text-space-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={settings.enableDrag} 
                onChange={(e) => setSettings({...settings, enableDrag: e.target.checked})}
                className="w-4 h-4 rounded bg-space-900 border-space-600 text-space-accent focus:ring-offset-space-800"
              />
              {t('opt_drag')}
            </label>
            <InputGroup label={t('opt_time_step')} subLabel={t('opt_time_step_sub')}>
               <NumberInput 
                  step={0.01}
                  min={0.01}
                  max={1.0}
                  value={settings.timeStep} 
                  onChange={(e) => setSettings({...settings, timeStep: Number(e.target.value)})} 
                />
            </InputGroup>
          </div>
        </section>
      </div>

      {/* Main Chart Area */}
      <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-6">
        
        {/* Results Summary Card */}
        {displayedResult ? (
          <div className="bg-space-800 border border-space-600 rounded-xl p-4 shadow-xl">
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="p-3 bg-space-900/50 rounded-lg border-l-4 border-space-success">
                    <p className="text-xs text-space-400 uppercase tracking-wide">{t('res_peak_alt')}</p>
                    <p className="text-xl md:text-2xl font-bold text-space-100">{formatKm(displayedResult.maxHeight)}</p>
                    <p className="text-xs text-space-500">
                      {selectedTankMass !== null ? t('res_sel_outcome') : t('res_opt_outcome')}
                    </p>
                </div>
                <div className="p-3 bg-space-900/50 rounded-lg border-l-4 border-space-accent">
                    <p className="text-xs text-space-400 uppercase tracking-wide">{t('res_opt_fuel')}</p>
                    <p className="text-xl md:text-2xl font-bold text-space-100">{formatNumber(displayedResult.tankMass, 1)} <span className="text-sm font-normal text-space-400">t</span></p>
                    <p className="text-xs text-space-500">{t('res_tank_fuel')}</p>
                </div>
                  <div className="p-3 bg-space-900/50 rounded-lg border-l-4 border-space-warning">
                    <p className="text-xs text-space-400 uppercase tracking-wide">{t('res_start_twr')}</p>
                    <p className={`text-xl md:text-2xl font-bold ${displayedResult.twrStart < 1.01 ? 'text-danger' : 'text-space-100'}`}>{formatNumber(displayedResult.twrStart, 2)}</p>
                    <p className="text-xs text-space-500">{t('res_surf_tw')}</p>
                </div>
                <div className="p-3 bg-space-900/50 rounded-lg border-l-4 border-indigo-500">
                    <p className="text-xs text-space-400 uppercase tracking-wide">{t('res_dv')}</p>
                    <p className="text-xl md:text-2xl font-bold text-space-100">{formatNumber(displayedResult.deltaV, 0)} <span className="text-sm font-normal text-space-400">m/s</span></p>
                    <p className="text-xs text-space-500">{t('res_theo_max')}</p>
                </div>
             </div>
             
             {/* Log Button */}
             <div className="flex justify-center border-t border-space-700 pt-3">
               <button 
                onClick={handleShowLog}
                className="flex items-center gap-2 px-4 py-2 bg-space-700 hover:bg-space-600 text-space-200 rounded-md text-sm transition-colors"
               >
                 <FileText size={16} /> {t('res_view_log')}
               </button>
             </div>
          </div>
        ) : (
          <div className="bg-space-800 border border-space-600 rounded-xl p-8 text-center text-space-400">
            {t('res_empty')}
          </div>
        )}

        {/* Chart */}
        <div className="flex-1 bg-space-800 border border-space-600 rounded-xl p-4 min-h-[400px] relative">
           <h3 className="text-sm font-medium text-space-400 mb-4 absolute top-4 left-4 z-10">{t('chart_title')}</h3>
           <ResponsiveContainer width="100%" height="100%">
             <ComposedChart 
                data={chartData} 
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                onClick={onChartClick}
              >
                <defs>
                  <linearGradient id="colorHeight" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34D399" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#34D399" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#2E3652' : '#E2E8F0'} vertical={false} />
                <XAxis 
                  dataKey="tankMass" 
                  stroke="#94A3B8" 
                  fontSize={12}
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  label={{ value: t('chart_x'), position: 'insideBottom', offset: -10, fill: '#64748B' }}
                />
                <YAxis 
                  yAxisId="left" 
                  stroke="#94A3B8" 
                  fontSize={12}
                  tickFormatter={(val) => (val).toFixed(0)}
                  label={{ value: t('chart_y'), angle: -90, position: 'insideLeft', fill: '#64748B' }}
                />
                 <YAxis 
                  yAxisId="right" 
                  orientation="right"
                  stroke="#60A5FA" 
                  fontSize={12}
                  domain={[0, 'auto']}
                  hide={window.innerWidth < 768}
                  label={{ value: t('chart_y_right'), angle: 90, position: 'insideRight', fill: '#60A5FA' }}
                />
                <Tooltip 
                  cursor={{ stroke: '#4B5578', strokeWidth: 1 }}
                  contentStyle={{ 
                    backgroundColor: 'var(--color-space-800)', 
                    borderColor: 'var(--color-space-600)', 
                    borderRadius: '8px',
                    color: 'var(--color-space-100)',
                    outline: 'none'
                  }}
                  itemStyle={{ color: 'var(--color-space-100)' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'maxHeightKm') return [`${value.toFixed(2)} km`, t('res_peak_alt')];
                    if (name === 'twr') return [value.toFixed(2), t('res_start_twr')];
                    if (name === 'totalMassStart') return [value.toFixed(1), t('ms_total_mass')];
                    return [value, name];
                  }}
                  labelFormatter={(label) => `${t('res_tank_fuel')}: ${label} t`}
                />
                <Area 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="maxHeightKm" 
                  stroke="#34D399" 
                  fillOpacity={1} 
                  fill="url(#colorHeight)" 
                  strokeWidth={3}
                  activeDot={{ r: 6, fill: '#34D399', stroke: '#fff' }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="twr"
                  stroke="#60A5FA"
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="4 4"
                />
                
                {/* Highlight Best Result */}
                {bestResult && (
                  <ReferenceDot 
                    yAxisId="left" 
                    x={bestResult.tankMass}
                    y={bestResult.maxHeight / 1000} 
                    r={6} 
                    fill="#F87171" 
                    stroke="#fff"
                  />
                )}
                
                {/* Highlight Selected Result */}
                {selectedTankMass !== null && (
                   <ReferenceLine x={selectedTankMass} stroke="#38BDF8" strokeDasharray="3 3" />
                )}
             </ComposedChart>
           </ResponsiveContainer>
        </div>

        <div className="text-xs text-center text-space-500">
           {t('chart_note', { gravity: settings.gravityModel === 'variable' ? t('gravity_var') : t('gravity_const'), step: settings.timeStep })}
        </div>
      </div>

      {/* Telemetry Log Modal */}
      {showLog && displayedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-space-800 border border-space-600 rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-space-700">
              <div>
                  <h3 className="text-xl font-bold text-space-100 flex items-center gap-2">
                    <FileText size={20} className="text-space-accent" />
                    {t('log_title_dynamic', { mass: displayedResult.tankMass.toFixed(1) || '0' })}
                  </h3>
                  <p className="text-xs text-space-400 mt-1 ml-7">
                    {t('log_config_summary', { 
                        total: displayedResult.totalMassStart.toFixed(2) || '0', 
                        dry: displayedResult.dryMass.toFixed(2) || '0',
                        engineCount: params.engineCount,
                        engine: t(`engine_${params.engine.id}`) || params.engine.name
                    })}
                  </p>
              </div>
              <button onClick={() => setShowLog(false)} className="text-space-400 hover:text-space-100">
                <X size={24} />
              </button>
            </div>
            
            <div 
              ref={tableContainerRef}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              className="flex-1 overflow-auto p-4 custom-scrollbar"
            >
              <table className="w-full text-sm text-left text-space-300 relative">
                <thead className="text-xs text-space-400 uppercase bg-space-900 sticky top-0 z-10 shadow-md h-[40px]">
                  <tr>
                    <th className="px-4 py-3 bg-space-900">{t('log_time')}</th>
                    <th className="px-4 py-3 bg-space-900">{t('log_height')}</th>
                    <th className="px-4 py-3 bg-space-900">{t('log_velocity')}</th>
                    <th className="px-4 py-3 bg-space-900">{t('log_gravity')}</th>
                    <th className="px-4 py-3 bg-space-900">{t('log_fuel_consumed')}</th>
                    <th className="px-4 py-3 bg-space-900">{t('log_fuel_pct')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-space-700">
                  {virtualTableData.paddingTop > 0 && (
                     <tr style={{ height: `${virtualTableData.paddingTop}px` }}>
                       <td colSpan={6} style={{ padding: 0, border: 0 }} />
                     </tr>
                  )}
                  {virtualTableData.visibleData.map((row, i) => (
                    <tr key={virtualTableData.startIndex + i} className="hover:bg-space-700/50 h-[40px]">
                      <td className="px-4 py-2 font-mono text-space-accent">{row.time.toFixed(1)}</td>
                      <td className="px-4 py-2 font-mono">{row.height.toFixed(2)}</td>
                      <td className="px-4 py-2 font-mono">{row.velocity.toFixed(2)}</td>
                      <td className="px-4 py-2 font-mono text-space-500">{row.gravity.toFixed(2)}</td>
                      <td className="px-4 py-2 font-mono text-space-300">{row.fuelConsumed.toFixed(2)}</td>
                      <td className="px-4 py-2 font-mono text-space-400">
                         <div className="flex items-center gap-2">
                           <div className="w-16 h-1.5 bg-space-900 rounded-full overflow-hidden">
                             <div className="h-full bg-space-warning" style={{ width: `${row.fuelPercent}%` }}></div>
                           </div>
                           {row.fuelPercent.toFixed(2)}%
                         </div>
                      </td>
                    </tr>
                  ))}
                  {virtualTableData.paddingBottom > 0 && (
                     <tr style={{ height: `${virtualTableData.paddingBottom}px` }}>
                       <td colSpan={6} style={{ padding: 0, border: 0 }} />
                     </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-space-700 text-right">
              <button 
                onClick={() => setShowLog(false)}
                className="px-4 py-2 bg-space-700 hover:bg-space-600 text-white rounded-md transition-colors"
              >
                {t('log_close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

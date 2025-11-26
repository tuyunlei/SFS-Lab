


import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, ComposedChart, Legend 
} from 'recharts';
import { Settings, Zap, Gauge, Scale, Play, Table as TableIcon, Activity } from 'lucide-react';
import { RocketParams, SimulationSettings, SimulationResult, Planet } from '../types';
import { simulateLaunch } from '../services/physics';
import { InputGroup, NumberInput, Select, Slider } from './InputGroup';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGameData } from '../contexts/GameDataContext';

interface FlightSimulatorProps {
  planet: Planet;
  settings: SimulationSettings;
  setSettings: (s: SimulationSettings) => void;
}

const formatNumber = (num: number, decimals = 2) => num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const STORAGE_KEY_SIM_PARAMS = 'sfs_sim_params_v2';

// Constants for virtual scrolling
const ROW_HEIGHT = 40; // px
const HEADER_HEIGHT = 45; // px (approx)

export const FlightSimulator: React.FC<FlightSimulatorProps> = ({ planet, settings, setSettings }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { engines } = useGameData();
  
  // Local Settings
  const [logInterval, setLogInterval] = useState(0.5);

  // Initialize state from localStorage or defaults
  const [params, setParams] = useState<RocketParams>(() => {
    try {
      const savedJson = localStorage.getItem(STORAGE_KEY_SIM_PARAMS);
      if (savedJson) {
        const saved = JSON.parse(savedJson);
        if (saved.engine && saved.engine.id) {
            // Updated via effect
        }
        // Migration
        if (saved.totalTankMass === undefined) saved.totalTankMass = 30;
        
        return saved;
      }
    } catch (e) {}
    return {
      engineCount: 1,
      engine: engines[0], 
      payloadMass: 10,
      totalTankMass: 30, // Default fixed tank mass
      tankDryWetRatio: 0.1,
      minTotalTankMass: 30, // Legacy/Unused
      maxTotalTankMass: 100, // Legacy/Unused
      stepTotalTankMass: 2, // Legacy/Unused
      minPayloadMass: 1, // Legacy/Unused
      maxPayloadMass: 20, // Legacy/Unused
      stepPayloadMass: 1, // Legacy/Unused
    };
  });

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

  const [result, setResult] = useState<SimulationResult | null>(null);
  const [activeView, setActiveView] = useState<'charts' | 'table'>('charts');
  const [activeChart, setActiveChart] = useState<'profile' | 'forces' | 'mass'>('profile');

  // Virtual Scroll State
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Persist params
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SIM_PARAMS, JSON.stringify(params));
  }, [params]);

  const handleSimulate = () => {
    // Use totalTankMass as the "Target Tank Mass" input for this tool
    const res = simulateLaunch(params.totalTankMass, params, planet, settings, logInterval);
    setResult(res);
    // Reset scroll on new simulation
    setScrollTop(0);
  };

  const chartData = useMemo(() => {
    if (!result || !result.telemetry) return [];
    return result.telemetry.map(pt => ({
      ...pt,
      heightKm: pt.height / 1000,
      thrustKn: pt.thrust,
      dragKn: pt.drag,
    }));
  }, [result]);

  // PERFORMANCE OPTIMIZATION: Downsample data for charts
  const sampledChartData = useMemo(() => {
    const maxPoints = 500;
    if (chartData.length <= maxPoints) return chartData;
    
    const step = Math.ceil(chartData.length / maxPoints);
    return chartData.filter((_, index) => index % step === 0);
  }, [chartData]);

  // Virtualization Logic
  useEffect(() => {
    if (activeView === 'table' && tableContainerRef.current) {
      setContainerHeight(tableContainerRef.current.clientHeight);
      
      const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
           // Only update height if visible (height > 0)
           if (entry.contentRect.height > 0) {
             setContainerHeight(entry.contentRect.height);
           }
        }
      });
      
      resizeObserver.observe(tableContainerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [activeView]);

  const virtualTableData = useMemo(() => {
    const totalRows = chartData.length;
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT));
    // Render enough rows to fill container + buffer
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT);
    const endIndex = Math.min(totalRows, startIndex + visibleCount + 5); 
    
    const visibleData = chartData.slice(startIndex, endIndex);
    const paddingTop = startIndex * ROW_HEIGHT;
    const paddingBottom = (totalRows - endIndex) * ROW_HEIGHT;

    return { visibleData, paddingTop, paddingBottom, startIndex };
  }, [chartData, scrollTop, containerHeight]);

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

          <InputGroup label={t('opt_payload')} subLabel={t('opt_payload_sub')}>
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

        {/* Fuel & Log Settings */}
        <section className="bg-space-800/50 border border-space-700 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2 text-space-success mb-2">
            <Activity size={18} />
            <h3 className="font-semibold uppercase tracking-wider text-sm">{t('sim_config_fuel')}</h3>
          </div>
          
          <InputGroup label={t('sim_tank_mass')}>
              <NumberInput 
                unit="t" 
                value={params.totalTankMass} 
                onChange={(e) => setParams({...params, totalTankMass: Number(e.target.value)})} 
              />
          </InputGroup>

           <div className="pt-2 border-t border-space-700/50"></div>
           
           <h3 className="font-semibold uppercase tracking-wider text-sm text-space-warning mb-2">{t('sim_log_settings')}</h3>
           <div className="grid grid-cols-2 gap-4">
              <InputGroup label={t('sim_log_interval')} subLabel={t('sim_log_interval_sub')}>
                <NumberInput 
                    step={0.1}
                    min={0.1}
                    value={logInterval} 
                    onChange={(e) => setLogInterval(Number(e.target.value))} 
                  />
              </InputGroup>
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
           
           <div className="flex flex-col gap-2 pt-2">
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
            <label className="flex items-center gap-2 text-sm text-space-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={settings.enableDrag} 
                onChange={(e) => setSettings({...settings, enableDrag: e.target.checked})}
                className="w-4 h-4 rounded bg-space-900 border-space-600 text-space-accent focus:ring-offset-space-800"
              />
              {t('opt_drag')}
            </label>
          </div>
        </section>

        <button 
          onClick={handleSimulate}
          className="w-full flex items-center justify-center gap-2 py-3 bg-space-accent hover:bg-space-accent/90 text-white rounded-lg font-bold shadow-lg shadow-space-accent/20 transition-all active:scale-95"
        >
          <Play size={20} fill="currentColor" />
          {t('sim_run')}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-6 h-full overflow-hidden">
        
        {result ? (
          <>
             {/* Summary Cards */}
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-space-800 border border-space-600 rounded-xl p-4 shadow-xl shrink-0">
                {/* Dynamic 1st Card: Shows Altitude OR Delta V based on setting */}
                <div className={`p-3 bg-space-900/50 rounded-lg border-l-4 ${settings.optimizationTarget === 'maxHeight' ? 'border-space-success' : 'border-indigo-500'}`}>
                    <p className="text-xs text-space-400 uppercase tracking-wide">
                        {settings.optimizationTarget === 'maxHeight' ? t('res_peak_alt') : t('res_dv')}
                    </p>
                    <p className="text-xl md:text-2xl font-bold text-space-100">
                        {settings.optimizationTarget === 'maxHeight' 
                           ? <>{(result.maxHeight/1000).toFixed(2)} <span className="text-sm font-normal text-space-400">km</span></>
                           : <>{result.deltaV.toFixed(0)} <span className="text-sm font-normal text-space-400">m/s</span></>
                        }
                    </p>
                </div>

                <div className="p-3 bg-space-900/50 rounded-lg border-l-4 border-space-accent">
                    <p className="text-xs text-space-400 uppercase tracking-wide">{t('res_max_vel')}</p>
                    <p className="text-xl md:text-2xl font-bold text-space-100">{result.maxVelocity.toFixed(0)} <span className="text-sm font-normal text-space-400">m/s</span></p>
                </div>
                <div className="p-3 bg-space-900/50 rounded-lg border-l-4 border-space-warning">
                    <p className="text-xs text-space-400 uppercase tracking-wide">{t('res_start_twr')}</p>
                    <p className={`text-xl md:text-2xl font-bold ${result.twrStart < 1.01 ? 'text-danger' : 'text-space-100'}`}>{formatNumber(result.twrStart, 2)}</p>
                </div>
                
                {/* Dynamic 4th Card: Shows the other metric */}
                <div className={`p-3 bg-space-900/50 rounded-lg border-l-4 ${settings.optimizationTarget === 'maxHeight' ? 'border-indigo-500' : 'border-space-success'}`}>
                    <p className="text-xs text-space-400 uppercase tracking-wide">
                        {settings.optimizationTarget === 'maxHeight' ? t('res_dv') : t('res_peak_alt')}
                    </p>
                    <p className="text-xl md:text-2xl font-bold text-space-100">
                        {settings.optimizationTarget === 'maxHeight'
                            ? <>{result.deltaV.toFixed(0)} <span className="text-sm font-normal text-space-400">s</span></> // Note: Typo in logic if this says 's', fixed below
                            : <>{(result.maxHeight/1000).toFixed(2)} <span className="text-sm font-normal text-space-400">km</span></>
                        }
                        {settings.optimizationTarget === 'maxHeight' && <span className="text-sm font-normal text-space-400">m/s</span>}
                    </p>
                </div>
             </div>

             {/* Navigation Tabs */}
             <div className="flex gap-2 border-b border-space-700 pb-1">
               <button 
                 onClick={() => setActiveView('charts')}
                 className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeView === 'charts' ? 'bg-space-800 text-space-accent border-t border-x border-space-700' : 'text-space-400 hover:text-space-200'}`}
               >
                 <Activity size={16} /> {t('sim_view_charts')}
               </button>
               <button 
                 onClick={() => setActiveView('table')}
                 className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeView === 'table' ? 'bg-space-800 text-space-accent border-t border-x border-space-700' : 'text-space-400 hover:text-space-200'}`}
               >
                 <TableIcon size={16} /> {t('sim_view_table')}
               </button>
             </div>

             {/* View Content */}
             <div className="flex-1 bg-space-800 border border-space-600 rounded-b-xl rounded-tr-xl p-4 overflow-hidden flex flex-col relative">
                
                <div className={`flex flex-col h-full gap-4 ${activeView === 'charts' ? '' : 'hidden'}`}>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setActiveChart('profile')} className={`px-3 py-1 text-xs rounded-full border ${activeChart === 'profile' ? 'bg-space-accent text-white border-space-accent' : 'border-space-600 text-space-400'}`}>{t('sim_chart_profile')}</button>
                      <button onClick={() => setActiveChart('forces')} className={`px-3 py-1 text-xs rounded-full border ${activeChart === 'forces' ? 'bg-space-accent text-white border-space-accent' : 'border-space-600 text-space-400'}`}>{t('sim_chart_forces')}</button>
                      <button onClick={() => setActiveChart('mass')} className={`px-3 py-1 text-xs rounded-full border ${activeChart === 'mass' ? 'bg-space-accent text-white border-space-accent' : 'border-space-600 text-space-400'}`}>{t('sim_chart_mass')}</button>
                    </div>

                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        {activeChart === 'profile' ? (
                          <ComposedChart data={sampledChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#2E3652' : '#E2E8F0'} vertical={false} />
                            <XAxis dataKey="time" stroke="#94A3B8" fontSize={12} tickFormatter={(v) => v.toFixed(0)} />
                            <YAxis yAxisId="h" stroke="#34D399" fontSize={12} label={{ value: t('log_height_km'), angle: -90, position: 'insideLeft', fill: '#34D399' }} />
                            <YAxis yAxisId="v" orientation="right" stroke="#38BDF8" fontSize={12} label={{ value: t('log_velocity'), angle: 90, position: 'insideRight', fill: '#38BDF8' }} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--color-space-800)', borderColor: 'var(--color-space-600)', color: 'var(--color-space-100)' }}
                              formatter={(val: number) => val.toFixed(2)}
                            />
                            <Legend />
                            <Area yAxisId="h" type="monotone" dataKey="heightKm" name={t('log_height_km')} stroke="#34D399" fill="#34D399" fillOpacity={0.2} />
                            <Line yAxisId="v" type="monotone" dataKey="velocity" name={t('log_velocity')} stroke="#38BDF8" strokeWidth={2} dot={false} />
                          </ComposedChart>
                        ) : activeChart === 'forces' ? (
                          <LineChart data={sampledChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#2E3652' : '#E2E8F0'} vertical={false} />
                            <XAxis dataKey="time" stroke="#94A3B8" fontSize={12} />
                            <YAxis stroke="#F87171" fontSize={12} label={{ value: 'Acceleration (m/s²)', angle: -90, position: 'insideLeft', fill: '#F87171' }} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--color-space-800)', borderColor: 'var(--color-space-600)', color: 'var(--color-space-100)' }}
                              formatter={(val: number) => val.toFixed(2)}
                            />
                            <Legend />
                            <Line type="monotone" dataKey="acceleration" name={t('log_accel')} stroke="#F87171" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="gravity" name={t('log_gravity')} stroke="#94A3B8" strokeDasharray="4 4" dot={false} />
                          </LineChart>
                        ) : (
                          <ComposedChart data={sampledChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#2E3652' : '#E2E8F0'} vertical={false} />
                            <XAxis dataKey="time" stroke="#94A3B8" fontSize={12} />
                            <YAxis yAxisId="left" stroke="#A78BFA" fontSize={12} label={{ value: t('log_mass'), angle: -90, position: 'insideLeft', fill: '#A78BFA' }} />
                            <YAxis yAxisId="right" orientation="right" stroke="#FBBF24" fontSize={12} domain={[0, 100]} label={{ value: t('log_fuel_pct'), angle: 90, position: 'insideRight', fill: '#FBBF24' }} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--color-space-800)', borderColor: 'var(--color-space-600)', color: 'var(--color-space-100)' }}
                              formatter={(val: number, name: string) => {
                                  if (name === t('log_fuel_pct')) return [val.toFixed(1) + '%', name];
                                  return [val.toFixed(2), name];
                              }}
                            />
                            <Legend />
                            <Line yAxisId="left" type="monotone" dataKey="mass" name={t('log_mass')} stroke="#A78BFA" strokeWidth={2} dot={false} />
                            <Line yAxisId="right" type="monotone" dataKey="fuelPercent" name={t('log_fuel_pct')} stroke="#FBBF24" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                          </ComposedChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                </div>

                <div 
                  ref={tableContainerRef}
                  onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                  className={`flex-1 overflow-auto custom-scrollbar -m-4 ${activeView === 'table' ? '' : 'hidden'}`}
                >
                  <table className="w-full text-sm text-left text-space-300 relative">
                    <thead className="text-xs text-space-400 uppercase bg-space-900 sticky top-0 z-10 shadow-md h-[45px]">
                      <tr>
                        <th className="px-4 py-3 whitespace-nowrap bg-space-900">{t('log_time')}</th>
                        <th className="px-4 py-3 whitespace-nowrap bg-space-900">{t('log_height')}</th>
                        <th className="px-4 py-3 whitespace-nowrap bg-space-900">{t('log_velocity')}</th>
                        <th className="px-4 py-3 whitespace-nowrap text-space-accent bg-space-900">{t('log_accel')}</th>
                        <th className="px-4 py-3 whitespace-nowrap bg-space-900">{t('log_gravity')}</th>
                        <th className="px-4 py-3 whitespace-nowrap bg-space-900">{t('log_mass')}</th>
                        <th className="px-4 py-3 whitespace-nowrap bg-space-900">{t('log_fuel_consumed')}</th>
                        <th className="px-4 py-3 whitespace-nowrap bg-space-900">{t('log_fuel_pct')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-space-700">
                        {/* Top Spacer */}
                        {virtualTableData.paddingTop > 0 && (
                          <tr style={{ height: `${virtualTableData.paddingTop}px` }}>
                            <td colSpan={8} style={{ padding: 0, border: 0 }} />
                          </tr>
                        )}
                        
                        {/* Visible Rows */}
                      {virtualTableData.visibleData.map((row, i) => (
                        <tr key={virtualTableData.startIndex + i} className="hover:bg-space-700/50 transition-colors h-[40px]">
                          <td className="px-4 py-2 font-mono text-space-accent whitespace-nowrap">{row.time.toFixed(1)}</td>
                          <td className="px-4 py-2 font-mono whitespace-nowrap">{row.height.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono whitespace-nowrap">{row.velocity.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono text-space-accent whitespace-nowrap">{row.acceleration.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono text-space-500 whitespace-nowrap">{row.gravity.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono whitespace-nowrap">{row.mass.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono text-space-300 whitespace-nowrap">{row.fuelConsumed.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono text-space-400 whitespace-nowrap">
                            <span className={`${row.fuelPercent < 10 ? 'text-danger' : ''}`}>
                              {row.fuelPercent.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                      
                      {/* Bottom Spacer */}
                        {virtualTableData.paddingBottom > 0 && (
                          <tr style={{ height: `${virtualTableData.paddingBottom}px` }}>
                            <td colSpan={8} style={{ padding: 0, border: 0 }} />
                          </tr>
                        )}
                    </tbody>
                  </table>
                </div>
             </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-space-500 bg-space-800 border border-space-600 rounded-xl p-8">
            <RocketParams size={64} className="mb-4 opacity-50" />
            <p className="text-lg font-medium">{t('res_sim_empty')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

function RocketParams({ size, className }: { size: number, className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
    </svg>
  );
}
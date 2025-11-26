

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Upload, Play, Download, Activity, RotateCcw, Pause, Square as SquareIcon, Cpu, ZoomIn, ZoomOut, Maximize2, Move, MousePointer2, Layers, CheckCircle, Clock, AlertCircle, Loader2, RefreshCw, ChevronLeft, ChevronRight, SkipBack, SkipForward } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Area, Legend 
} from 'recharts';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { InputGroup, NumberInput, Select } from './InputGroup';

interface AnalyzedFrame {
  time: number;
  height: number;
  velocity: number;
  fuelPercent: number;
  engineOn: boolean;
}

interface AnalysisJob {
  id: string;
  time: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  base64Data?: string; // Temporarily hold data until processed
  result?: AnalyzedFrame;
}

type AIProvider = 'gemini' | 'volcengine';

// Config
const MAX_CONCURRENT_REQUESTS = 3;
const MAX_PENDING_QUEUE_SIZE = 5; // Backpressure limit: Pause video capture if queue > 5
const ROW_HEIGHT = 40; // px
// Assuming 30 FPS for frame calculations
const ASSUMED_FPS = 30;

const PROMPT_TEXT = `
Analyze this game screen from Space Flight Simulator. Identify the telemetry values on the HUD.
Output strictly valid JSON matching this schema:
{
  "height": number, // Height in meters (convert km to m)
  "velocity": number, // Velocity in m/s
  "fuel": number, // Fuel percentage (0-100)
  "engineOn": boolean // Engine active status
}

Rules:
1. Height: Look for "Height: X" or "X m" or "X km". Convert "km" to meters. Return float.
2. Velocity: Look for "Velocity: Y" or "Y m/s". Return float.
3. Fuel: Look for percentages (e.g. "Liquid Fuel: 95%"). Return the number.
4. engineOn: Look for the ON/OFF button. Return true if ON, false if OFF.
`;

const parseBoolean = (val: any): boolean => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    return lower === 'true' || lower === 'on' || lower === 'yes' || lower === '1';
  }
  if (typeof val === 'number') return val === 1;
  return false;
};

export const VideoAnalyzer: React.FC = () => {
  const { t } = useLanguage();
  const { theme } = useTheme();

  // State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  
  // View Transform State (Zoom/Pan)
  const [viewTransform, setViewTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });

  // Analysis Config & State
  const [fps, setFps] = useState(1);
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'running' | 'paused'>('idle');
  const [results, setResults] = useState<AnalyzedFrame[]>([]);
  const [activeResultTab, setActiveResultTab] = useState<'charts' | 'table'>('charts');
  
  // Provider Config
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [volcConfig, setVolcConfig] = useState({
    apiKey: '',
    model: 'ep-20250218151806-xxxxx',
  });
  const [geminiConfig, setGeminiConfig] = useState({
    apiKey: '',
  });

  // Batch Queue State
  const [jobQueue, setJobQueue] = useState<AnalysisJob[]>([]);
  const [queueStats, setQueueStats] = useState({ active: 0, completed: 0, errors: 0, total: 0 });

  // Manual Debugging State
  const [manualFrameData, setManualFrameData] = useState<AnalyzedFrame | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [manualTimeInput, setManualTimeInput] = useState('');
  const [manualFrameInput, setManualFrameInput] = useState('');

  // Virtual Scroll State
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(500);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Refs for Analysis Loop Control
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null); 
  const isPausedRef = useRef(false);
  const shouldStopRef = useRef(false);
  
  // Refs for Concurrency
  const jobQueueRef = useRef<AnalysisJob[]>([]); // Mutable ref for instant access in loop
  const activeRequestsRef = useRef(0);

  // Handle File Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setResults([]);
      setJobQueue([]);
      jobQueueRef.current = [];
      setViewTransform({ scale: 1, x: 0, y: 0 });
      setAnalysisStatus('idle');
      setManualFrameData(null);
      setScrollTop(0);
      setManualTimeInput('0.000');
      setManualFrameInput('0');
    }
  };

  // --- Zoom & Pan Logic (Native Listeners) ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !videoUrl) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); 
      e.stopPropagation();

      if (e.ctrlKey) {
        // ZOOM
        const zoomSensitivity = 0.01;
        const delta = -e.deltaY * zoomSensitivity; 
        
        setViewTransform(prev => ({
          ...prev, 
          scale: Math.min(Math.max(0.1, prev.scale + delta), 8)
        }));
      } else {
        // PAN
        setViewTransform(prev => ({
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY
        }));
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [videoUrl]);

  const handleZoomIn = () => setViewTransform(prev => ({ ...prev, scale: Math.min(prev.scale + 0.5, 8) }));
  const handleZoomOut = () => setViewTransform(prev => ({ ...prev, scale: Math.max(prev.scale - 0.5, 0.5) }));
  const resetView = () => setViewTransform({ scale: 1, x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!videoUrl) return;
    setIsPanning(true);
    setLastPanPoint({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastPanPoint.x;
      const dy = e.clientY - lastPanPoint.y;
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      setViewTransform(prev => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy
      }));
    }
  };

  const handleMouseUp = () => setIsPanning(false);

  const onVideoTimeUpdate = () => {
    if (analysisStatus === 'idle' || analysisStatus === 'paused') {
      if (videoRef.current) {
        const t = videoRef.current.currentTime;
        const tolerance = 1 / fps / 2;
        
        // Update input fields only if not focused
        const activeId = document.activeElement?.id;
        if (activeId !== 'manual-time-input' && activeId !== 'manual-frame-input') {
           setManualTimeInput(t.toFixed(3));
           setManualFrameInput(Math.round(t * ASSUMED_FPS).toString());
        }

        const existing = results.find(r => Math.abs(r.time - t) < tolerance);
        if (existing) {
          setManualFrameData(existing);
        } else {
          if (!manualFrameData || Math.abs(manualFrameData.time - t) > 0.1) {
             setManualFrameData({
                time: t,
                height: 0,
                velocity: 0,
                fuelPercent: 0,
                engineOn: false
             });
          }
        }
      }
    }
  };

  // --- Frame Navigation ---
  const stepFrame = (frames: number) => {
    if (!videoRef.current) return;
    const dt = frames * (1/ASSUMED_FPS);
    const newTime = Math.max(0, Math.min(videoRef.current.duration, videoRef.current.currentTime + dt));
    videoRef.current.currentTime = newTime;
    setManualTimeInput(newTime.toFixed(3));
    setManualFrameInput(Math.round(newTime * ASSUMED_FPS).toString());
  };
  
  const handleTimeChange = (val: string) => {
    setManualTimeInput(val);
    const t = parseFloat(val);
    if (!isNaN(t)) {
      setManualFrameInput(Math.round(t * ASSUMED_FPS).toString());
    } else {
      setManualFrameInput('');
    }
  };

  const handleFrameChange = (val: string) => {
    setManualFrameInput(val);
    const f = parseInt(val);
    if (!isNaN(f)) {
      setManualTimeInput((f / ASSUMED_FPS).toFixed(3));
    } else {
      setManualTimeInput('');
    }
  };

  const applyTimeInput = () => {
    const t = parseFloat(manualTimeInput);
    if (!isNaN(t) && videoRef.current) {
       // Snap to nearest frame
       const frame = Math.round(t * ASSUMED_FPS);
       const snappedTime = frame / ASSUMED_FPS;
       
       videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration, snappedTime));
       videoRef.current.pause();
       
       setManualTimeInput(snappedTime.toFixed(3));
       setManualFrameInput(frame.toString());
    }
  };

  const applyFrameInput = () => {
    const f = parseInt(manualFrameInput);
    if (!isNaN(f) && videoRef.current) {
      const time = f / ASSUMED_FPS;
      videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration, time));
      videoRef.current.pause();
      
      setManualTimeInput(time.toFixed(3));
      setManualFrameInput(f.toString());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, type: 'time' | 'frame') => {
    if (e.key === 'Enter') {
      type === 'time' ? applyTimeInput() : applyFrameInput();
    }
  };

  const jumpToFrame = (frame: AnalyzedFrame) => {
    if (videoRef.current) {
      videoRef.current.pause();
      setAnalysisStatus('idle'); // Force stop batch to inspect
      shouldStopRef.current = true; // Ensure loop stops
      videoRef.current.currentTime = frame.time;
      setManualFrameData(frame);
      setManualTimeInput(frame.time.toFixed(3));
      setManualFrameInput(Math.round(frame.time * ASSUMED_FPS).toString());
    }
  };

  // --- AI API Calls ---

  const callAI = async (base64Data: string, time: number): Promise<AnalyzedFrame> => {
    if (aiProvider === 'gemini') {
      return callGemini(base64Data, time);
    } else {
      return callVolcengine(base64Data, time);
    }
  };

  const callGemini = async (base64Data: string, time: number): Promise<AnalyzedFrame> => {
    if (!geminiConfig.apiKey) throw new Error("Gemini API Key missing");

    const ai = new GoogleGenAI({ apiKey: geminiConfig.apiKey });
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
            { text: PROMPT_TEXT }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              height: { type: Type.NUMBER },
              velocity: { type: Type.NUMBER },
              fuel: { type: Type.NUMBER },
              engineOn: { type: Type.BOOLEAN }
            }
          }
        }
      });

      const text = response.text || "{}";
      const data = JSON.parse(text);

      // Support both 'engineOn' (schema compliant) and 'engine' (common fallback)
      const rawEngine = data.engineOn ?? data.engine ?? false;
      const engineOn = parseBoolean(rawEngine);

      return {
        time: parseFloat(time.toFixed(3)),
        height: data.height || 0,
        velocity: data.velocity || 0,
        fuelPercent: data.fuel || 0,
        engineOn: engineOn
      };
    } catch (e) {
      console.error("Gemini Error", e);
      throw e;
    }
  };

  const callVolcengine = async (base64Data: string, time: number): Promise<AnalyzedFrame> => {
    if (!volcConfig.apiKey || !volcConfig.model) throw new Error("Volcengine Config Missing");

    try {
      const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${volcConfig.apiKey}`
        },
        body: JSON.stringify({
          model: volcConfig.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: PROMPT_TEXT },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } }
              ]
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "rocket_state",
              schema: {
                type: "object",
                properties: {
                  height: {
                    type: "number",
                    description: "height in meter"
                  },
                  velocity: {
                    type: "number",
                    description: "velocity in m/s"
                  },
                  fuel: {
                    type: "number",
                    description: "fuel percentage number"
                  },
                  engineOn: {
                    type: "boolean",
                    description: "engine on/off status"
                  }
                },
                required: ["height", "velocity", "fuel", "engineOn"],
                additionalProperties: false
              }
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Volcengine API Error: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "{}";
      
      // Clean up markdown code blocks if present (Volcengine might output them even if asked not to)
      const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
      
      let parsed: any = {};
      try {
        parsed = JSON.parse(cleanContent);
      } catch (e) {
         // Fallback: try finding JSON object via regex if markdown cleanup failed or extra text exists
         const match = cleanContent.match(/\{[\s\S]*\}/);
         if (match) {
             try {
                parsed = JSON.parse(match[0]);
             } catch (e2) {
                console.error("Failed to parse Volcengine JSON", cleanContent);
                throw e;
             }
         } else {
             throw e;
         }
      }

      // Handle cases where model returns array of objects
      if (Array.isArray(parsed)) {
          parsed = parsed[0] || {};
      }

      // Support both 'engineOn' and 'engine' keys, and handle type conversion
      const rawEngine = parsed.engineOn ?? parsed.engine ?? parsed.Engine ?? false;
      const engineOn = parseBoolean(rawEngine);

      return {
        time: parseFloat(time.toFixed(3)),
        height: Number(parsed.height) || 0,
        velocity: Number(parsed.velocity) || 0,
        fuelPercent: Number(parsed.fuel) || 0,
        engineOn: engineOn
      };
    } catch (e) {
      console.error("Volcengine Error", e);
      throw e;
    }
  };

  // --- Manual Single Frame ---
  const analyzeCurrentFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsAiLoading(true);
    
    // Capture
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    try {
      const data = await callAI(base64, video.currentTime);
      setManualFrameData(data);
      updateResultsWithFrame(data);
    } catch (e) {
      alert("Analysis failed. Check console.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const updateResultsWithFrame = (frame: AnalyzedFrame) => {
    setResults(prev => {
      const idx = prev.findIndex(r => Math.abs(r.time - frame.time) < 0.1);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = frame;
        return copy.sort((a, b) => a.time - b.time);
      } else {
        return [...prev, frame].sort((a, b) => a.time - b.time);
      }
    });
  };

  const saveManualFrame = () => {
    if (!manualFrameData) return;
    updateResultsWithFrame(manualFrameData);
  };

  // --- Batch Analysis Core (Producer / Consumer) ---

  const syncQueueState = () => {
    // Sync ref to React State for UI updates
    setJobQueue([...jobQueueRef.current]);
    
    const doneCount = jobQueueRef.current.filter(j => j.status === 'done').length;
    const errorCount = jobQueueRef.current.filter(j => j.status === 'error').length;
    const total = jobQueueRef.current.length;
    setQueueStats({
      active: activeRequestsRef.current,
      completed: doneCount,
      errors: errorCount,
      total
    });
  };

  const processQueue = async () => {
    // While we have capacity and pending jobs
    while (activeRequestsRef.current < MAX_CONCURRENT_REQUESTS) {
      // Find next pending
      const jobIndex = jobQueueRef.current.findIndex(j => j.status === 'pending');
      if (jobIndex === -1) break; // No pending jobs

      const job = jobQueueRef.current[jobIndex];
      
      // Update Job Status
      jobQueueRef.current[jobIndex] = { ...job, status: 'processing' };
      activeRequestsRef.current++;
      syncQueueState();

      // Execute (Non-blocking the loop)
      callAI(job.base64Data!, job.time)
        .then(result => {
          // Success
          const currentJob = jobQueueRef.current.find(j => j.id === job.id);
          if (currentJob) {
             currentJob.status = 'done';
             currentJob.result = result;
             currentJob.base64Data = undefined; // Free memory on success
             updateResultsWithFrame(result);
          }
        })
        .catch(() => {
          // Error
          const currentJob = jobQueueRef.current.find(j => j.id === job.id);
          if (currentJob) {
            currentJob.status = 'error';
            // IMPORTANT: Do NOT clear base64Data here so user can retry
          }
        })
        .finally(() => {
          activeRequestsRef.current--;
          syncQueueState();
          // Trigger next
          processQueue(); 
        });
    }
  };

  const retryJob = (id: string) => {
    const job = jobQueueRef.current.find(j => j.id === id);
    if (job && job.status === 'error' && job.base64Data) {
       job.status = 'pending';
       syncQueueState();
       processQueue();
    }
  };

  const retryAllFailed = () => {
    let hasUpdates = false;
    jobQueueRef.current.forEach(job => {
      if (job.status === 'error' && job.base64Data) {
        job.status = 'pending';
        hasUpdates = true;
      }
    });
    
    if (hasUpdates) {
      syncQueueState();
      processQueue();
    }
  };

  const startAnalysisLoop = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    shouldStopRef.current = false;
    isPausedRef.current = false;
    activeRequestsRef.current = 0;
    
    setAnalysisStatus('running');
    setResults([]);
    jobQueueRef.current = [];
    syncQueueState();
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const duration = video.duration;
    const maxDuration = Math.min(duration, 300); // 5 min cap for demo
    const stepTime = 1 / fps; 
    
    let currentTime = 0;
    
    video.currentTime = 0;

    // PRODUCER LOOP
    while (currentTime < maxDuration) {
      if (shouldStopRef.current) break;
      
      // Pause handling
      while (isPausedRef.current) {
        if (shouldStopRef.current) break;
        await new Promise(r => setTimeout(r, 200));
      }

      // Backpressure: If queue has too many PENDING jobs, wait.
      // This prevents capturing 1000 frames instantly and filling RAM.
      while (jobQueueRef.current.filter(j => j.status === 'pending').length >= MAX_PENDING_QUEUE_SIZE) {
         if (shouldStopRef.current) break;
         await new Promise(r => setTimeout(r, 100)); // Check every 100ms
         processQueue(); // Poke the consumer just in case
      }

      // Seek Video
      video.currentTime = currentTime;
      await new Promise(r => {
        const onSeeked = () => { video.removeEventListener('seeked', onSeeked); r(null); };
        video.addEventListener('seeked', onSeeked);
      });
      // Small render buffer
      await new Promise(r => setTimeout(r, 50)); 

      // Capture Frame
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1]; // Lower quality for speed/size

        // Add Job
        const newJob: AnalysisJob = {
          id: Math.random().toString(36).substr(2, 9),
          time: currentTime,
          status: 'pending',
          base64Data: base64
        };
        jobQueueRef.current.push(newJob);
        syncQueueState();
        
        // Trigger Consumer
        processQueue();
      }

      currentTime += stepTime;
    }

    // Producer finished, but consumers might still be running
    const waitForCompletion = async () => {
       while (activeRequestsRef.current > 0 || jobQueueRef.current.some(j => j.status === 'pending')) {
          if (shouldStopRef.current) break;
          await new Promise(r => setTimeout(r, 500));
          processQueue();
       }
       setAnalysisStatus('idle');
       setQueueStats(prev => ({ ...prev, total: prev.total })); // Final refresh
    };
    
    waitForCompletion();
  };

  const stopAnalysis = () => {
    shouldStopRef.current = true;
    setAnalysisStatus('idle');
    jobQueueRef.current = []; // Clear queue? Or keep for review? Let's keep visually but stop processing
  };

  const exportCSV = () => {
    if (results.length === 0) return;
    const headers = ['Time (s)', 'Height (m)', 'Velocity (m/s)', 'Fuel (%)', 'Engine On'];
    const csvContent = [
      headers.join(','),
      ...results.map(r => `${r.time},${r.height},${r.velocity},${r.fuelPercent},${r.engineOn ? 1 : 0}`)
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sfs_telemetry_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  // Virtualization Logic for Results Table
  useEffect(() => {
    if (activeResultTab === 'table' && tableContainerRef.current) {
      setContainerHeight(tableContainerRef.current.clientHeight);
      
      const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
           setContainerHeight(entry.contentRect.height);
        }
      });
      
      resizeObserver.observe(tableContainerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [activeResultTab]);

  const virtualTableData = useMemo(() => {
    const totalRows = results.length;
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT));
    // Render enough rows to fill container + buffer
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT);
    const endIndex = Math.min(totalRows, startIndex + visibleCount + 5); 
    
    const visibleData = results.slice(startIndex, endIndex);
    const paddingTop = startIndex * ROW_HEIGHT;
    const paddingBottom = (totalRows - endIndex) * ROW_HEIGHT;

    return { visibleData, paddingTop, paddingBottom, startIndex };
  }, [results, scrollTop, containerHeight]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full overflow-hidden">
      <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-2">
        {/* Step 1: Upload */}
        <section className="bg-space-800 border border-space-700 rounded-xl p-4">
           <h3 className="text-space-accent font-bold mb-3">{t('va_step_1')}</h3>
           <div className="relative border-2 border-dashed border-space-600 rounded-lg p-6 hover:bg-space-700/30 transition text-center cursor-pointer group">
             <input 
               type="file" 
               accept="video/*" 
               onChange={handleFileChange} 
               className="absolute inset-0 opacity-0 cursor-pointer z-10"
             />
             <div className="flex flex-col items-center gap-2 group-hover:scale-105 transition-transform">
               <Upload className="text-space-400 group-hover:text-space-accent" size={32} />
               <p className="text-sm text-space-300 font-medium">{videoFile ? videoFile.name : t('va_upload_btn')}</p>
             </div>
           </div>
        </section>

        {/* Step 2: Config */}
        {videoUrl && (
          <section className="bg-space-800 border border-space-700 rounded-xl p-4">
            <h3 className="text-space-accent font-bold mb-3">{t('va_step_2')}</h3>
            
            <div className="space-y-4">
              <InputGroup label={t('va_provider_label')}>
                 <Select 
                   value={aiProvider}
                   onChange={(e) => setAiProvider(e.target.value as AIProvider)}
                 >
                   <option value="gemini">Google Gemini</option>
                   <option value="volcengine">Volcengine (Doubao/Ark)</option>
                 </Select>
              </InputGroup>

              {aiProvider === 'volcengine' && (
                <div className="bg-space-900/50 p-3 rounded-lg border border-space-700/50 space-y-3">
                  <InputGroup label={t('va_volc_key_label')}>
                    <input 
                      type="password"
                      className="w-full bg-space-800 border border-space-600 rounded-md px-3 py-2 text-sm text-space-100 focus:outline-none focus:ring-2 focus:ring-space-accent"
                      placeholder={t('va_volc_ph_key')}
                      value={volcConfig.apiKey}
                      onChange={(e) => setVolcConfig({...volcConfig, apiKey: e.target.value})}
                    />
                  </InputGroup>
                   <InputGroup label={t('va_volc_model_label')}>
                    <input 
                      type="text"
                      className="w-full bg-space-800 border border-space-600 rounded-md px-3 py-2 text-sm text-space-100 focus:outline-none focus:ring-2 focus:ring-space-accent"
                      placeholder={t('va_volc_ph_model')}
                      value={volcConfig.model}
                      onChange={(e) => setVolcConfig({...volcConfig, model: e.target.value})}
                    />
                  </InputGroup>
                </div>
              )}

              {aiProvider === 'gemini' && (
                <div className="bg-space-900/50 p-3 rounded-lg border border-space-700/50 space-y-3">
                  <InputGroup label={t('va_gemini_key_label')}>
                    <input 
                      type="password"
                      className="w-full bg-space-800 border border-space-600 rounded-md px-3 py-2 text-sm text-space-100 focus:outline-none focus:ring-2 focus:ring-space-accent"
                      placeholder={t('va_gemini_ph_key')}
                      value={geminiConfig.apiKey}
                      onChange={(e) => setGeminiConfig({...geminiConfig, apiKey: e.target.value})}
                    />
                  </InputGroup>
                </div>
              )}

              <InputGroup label={t('va_fps_label')} subLabel={t('va_fps_sub')}>
                <NumberInput 
                  min={0.1} max={5} step={0.1}
                  value={fps} 
                  onChange={(e) => setFps(Math.max(0.1, Math.min(5, Number(e.target.value))))} 
                  disabled={analysisStatus !== 'idle'}
                />
              </InputGroup>
            </div>

            <p className="text-xs text-space-500 mt-3 bg-space-900/50 p-3 rounded-lg border border-space-700/50 leading-relaxed">
              <Cpu size={14} className="inline mr-1.5 align-text-bottom text-space-400"/>
              {t('va_note')}
            </p>
          </section>
        )}

        {/* Step 3: Analysis & Queue */}
        {videoUrl && (
          <section className="bg-space-800 border border-space-700 rounded-xl p-4 flex flex-col gap-4">
            <div>
              <h3 className="text-space-accent font-bold mb-3">{t('va_step_3')}</h3>
              
              {/* Controls */}
              {analysisStatus === 'idle' ? (
                <div className="flex flex-col gap-3">
                   <button
                    onClick={startAnalysisLoop}
                    disabled={!videoUrl || (aiProvider === 'volcengine' && !volcConfig.apiKey) || (aiProvider === 'gemini' && !geminiConfig.apiKey)}
                    className="w-full py-3 bg-space-accent hover:bg-space-accent/90 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition shadow-lg shadow-space-accent/20 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <Layers size={18} /> {t('va_start_analysis')}
                  </button>
                  {results.length > 0 && (
                    <button
                      onClick={exportCSV}
                      className="w-full py-2 bg-space-700 hover:bg-space-600 text-space-100 rounded-lg flex items-center justify-center gap-2 transition border border-space-600"
                    >
                      <Download size={18} /> {t('va_export_csv')}
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                   {analysisStatus === 'running' ? (
                      <button onClick={() => { isPausedRef.current = true; setAnalysisStatus('paused'); }} className="flex items-center justify-center gap-2 py-2 bg-space-700 hover:bg-space-600 rounded-lg text-sm border border-space-600 text-space-200 transition-colors">
                        <Pause size={16} /> Pause
                      </button>
                   ) : (
                      <button onClick={() => { isPausedRef.current = false; setAnalysisStatus('running'); }} className="flex items-center justify-center gap-2 py-2 bg-space-success text-space-900 font-bold hover:bg-space-success/90 rounded-lg text-sm transition-colors shadow-lg shadow-space-success/10">
                        <Play size={16} /> Resume
                      </button>
                   )}
                   <button onClick={stopAnalysis} className="flex items-center justify-center gap-2 py-2 bg-danger/10 text-danger hover:bg-danger/20 rounded-lg text-sm border border-danger/20 transition-colors">
                     <SquareIcon size={16} /> Stop
                   </button>
                </div>
              )}
            </div>

            {/* Queue Visualization */}
            {(jobQueue.length > 0 || analysisStatus !== 'idle') && (
              <div className="border-t border-space-700 pt-4 mt-2">
                 <div className="flex items-center justify-between mb-2">
                   <h4 className="text-xs font-bold text-space-300 uppercase tracking-wide">{t('va_queue_title')}</h4>
                   <div className="flex gap-3 text-xs font-mono">
                      <span className="text-space-accent">{t('va_queue_active')}: {queueStats.active}</span>
                      <span className="text-space-success">{t('va_queue_completed')}: {queueStats.completed}</span>
                      {queueStats.errors > 0 && (
                         <button onClick={retryAllFailed} className="text-danger hover:text-danger/80 flex items-center gap-1">
                            {t('va_queue_errors')}: {queueStats.errors} ({t('va_retry_all')})
                         </button>
                      )}
                   </div>
                 </div>
                 
                 {/* Queue List Window */}
                 <div className="bg-space-900/50 rounded-lg border border-space-700/50 h-[200px] overflow-y-auto custom-scrollbar p-1">
                    {jobQueue.slice().reverse().map((job) => (
                      <div key={job.id} className="grid grid-cols-12 gap-2 items-center p-2 text-xs border-b border-space-700/30 last:border-0 hover:bg-space-800/50 transition">
                         <div className="col-span-2 font-mono text-space-400">{job.time.toFixed(1)}s</div>
                         <div className="col-span-4 flex items-center">
                            {job.status === 'pending' && <span className="flex items-center gap-1 text-space-500"><Clock size={12}/> {t('va_status_pending')}</span>}
                            {job.status === 'processing' && <span className="flex items-center gap-1 text-space-accent animate-pulse"><Loader2 size={12} className="animate-spin"/> {t('va_status_processing')}</span>}
                            {job.status === 'done' && <span className="flex items-center gap-1 text-space-success"><CheckCircle size={12}/> {t('va_status_done')}</span>}
                            {job.status === 'error' && (
                               <span className="flex items-center gap-1 text-danger">
                                 <AlertCircle size={12}/> {t('va_status_error')}
                                 <button onClick={() => retryJob(job.id)} className="ml-2 p-1 hover:bg-danger/20 rounded" title={t('va_retry')}>
                                    <RefreshCw size={10} />
                                 </button>
                               </span>
                            )}
                         </div>
                         <div className="col-span-6 text-right font-mono truncate text-space-300">
                            {job.result ? `H:${job.result.height} V:${job.result.velocity}` : '-'}
                         </div>
                      </div>
                    ))}
                    {jobQueue.length === 0 && <div className="text-center text-space-600 py-8">Queue Empty</div>}
                 </div>
              </div>
            )}
          </section>
        )}

         {/* Manual Correction (Moved to bottom of sidebar or keep here) */}
         {videoUrl && (analysisStatus === 'idle' || analysisStatus === 'paused') && (
              <div className="bg-space-800 border border-space-700 rounded-xl p-4">
                 <div className="flex items-center justify-between mb-4">
                   <span className="text-sm font-bold text-space-200 flex items-center gap-2">
                     <Maximize2 size={16} className="text-space-accent" /> {t('va_manual_correction')}
                   </span>
                   <button 
                    onClick={analyzeCurrentFrame}
                    disabled={isAiLoading || (aiProvider === 'volcengine' && !volcConfig.apiKey) || (aiProvider === 'gemini' && !geminiConfig.apiKey)}
                    className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 font-medium transition-all ${isAiLoading ? 'bg-space-700 text-space-500 cursor-wait' : 'bg-space-accent hover:bg-space-accent/90 text-white shadow-lg shadow-space-accent/20'}`}
                   >
                     {isAiLoading ? (
                       <><div className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full"/> Processing...</>
                     ) : (
                       <><Cpu size={14} /> {t('va_analyze_frame')}</>
                     )}
                   </button>
                 </div>
                 
                 {/* Video Navigation & Time Control */}
                 <div className="mb-4 bg-space-900/50 p-2 rounded-lg border border-space-700/50 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                        <button onClick={() => stepFrame(-30)} className="p-1.5 text-space-400 hover:text-space-100 hover:bg-space-700 rounded transition" title="-1s"><SkipBack size={16}/></button>
                        <button onClick={() => stepFrame(-1)} className="p-1.5 text-space-400 hover:text-space-100 hover:bg-space-700 rounded transition" title={t('va_prev_frame')}><ChevronLeft size={16}/></button>
                        
                        <div className="flex-1 flex gap-2">
                           <div className="flex-1 relative">
                              <label className="absolute -top-1.5 left-2 px-1 bg-space-900 text-[9px] text-space-500">{t('va_input_time')}</label>
                              <input 
                                id="manual-time-input"
                                type="number"
                                step="0.001"
                                value={manualTimeInput}
                                onChange={(e) => handleTimeChange(e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, 'time')}
                                onBlur={applyTimeInput}
                                className="w-full bg-space-800 border border-space-600 rounded px-2 py-1 text-center text-xs font-mono text-space-accent focus:outline-none focus:ring-1 focus:ring-space-accent pt-2"
                              />
                           </div>
                           <div className="flex-1 relative">
                              <label className="absolute -top-1.5 left-2 px-1 bg-space-900 text-[9px] text-space-500">{t('va_input_frame')}</label>
                              <input 
                                id="manual-frame-input"
                                type="number"
                                step="1"
                                value={manualFrameInput}
                                onChange={(e) => handleFrameChange(e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, 'frame')}
                                onBlur={applyFrameInput}
                                className="w-full bg-space-800 border border-space-600 rounded px-2 py-1 text-center text-xs font-mono text-space-accent focus:outline-none focus:ring-1 focus:ring-space-accent pt-2"
                              />
                           </div>
                        </div>

                        <button onClick={() => stepFrame(1)} className="p-1.5 text-space-400 hover:text-space-100 hover:bg-space-700 rounded transition" title={t('va_next_frame')}><ChevronRight size={16}/></button>
                        <button onClick={() => stepFrame(30)} className="p-1.5 text-space-400 hover:text-space-100 hover:bg-space-700 rounded transition" title="+1s"><SkipForward size={16}/></button>
                    </div>
                 </div>
                 
                 {manualFrameData ? (
                   <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="grid grid-cols-2 gap-3">
                        <InputGroup label={t('va_region_height')}>
                           <NumberInput 
                            value={manualFrameData.height}
                            onChange={(e) => setManualFrameData({...manualFrameData, height: parseFloat(e.target.value)})}
                           />
                        </InputGroup>
                        <InputGroup label={t('va_region_velocity')}>
                           <NumberInput 
                            value={manualFrameData.velocity}
                            onChange={(e) => setManualFrameData({...manualFrameData, velocity: parseFloat(e.target.value)})}
                           />
                        </InputGroup>
                        <InputGroup label={t('va_region_fuel')}>
                           <NumberInput 
                            value={manualFrameData.fuelPercent}
                            onChange={(e) => setManualFrameData({...manualFrameData, fuelPercent: parseFloat(e.target.value)})}
                           />
                        </InputGroup>
                        <div className="flex items-end">
                           <button 
                             onClick={() => setManualFrameData({...manualFrameData, engineOn: !manualFrameData.engineOn})}
                             className={`w-full h-[38px] rounded-lg text-xs font-bold border transition-all ${manualFrameData.engineOn ? 'bg-success/20 text-success border-success' : 'bg-space-800 text-space-500 border-space-600 hover:bg-space-700'}`}
                           >
                             ENGINE: {manualFrameData.engineOn ? 'ON' : 'OFF'}
                           </button>
                        </div>
                      </div>
                      <button 
                        onClick={saveManualFrame}
                        className="w-full mt-2 bg-space-800 hover:bg-space-700 text-space-100 border border-space-600 rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                      >
                        <Activity size={14} /> {t('va_save_frame')}
                      </button>
                   </div>
                 ) : (
                   <div className="text-center py-6 text-xs text-space-500 italic bg-space-800/30 rounded-lg border border-dashed border-space-700/50">
                     {t('va_no_data_frame')}
                   </div>
                 )}
              </div>
            )}
      </div>

      {/* Main View: Video & Charts */}
      <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-6 h-full overflow-y-auto pr-2 custom-scrollbar">
        
        {/* Beautified Video Preview Area */}
        <div className="bg-space-800 rounded-2xl overflow-hidden shadow-2xl border border-space-700 relative group shrink-0">
          
          {/* Header Bar */}
          <div className="h-10 bg-space-900 border-b border-space-700 flex items-center px-4 justify-between">
            <span className="text-xs font-bold text-space-400 uppercase tracking-widest flex items-center gap-2">
              <Activity size={14} className="text-space-accent" /> Video Feed
            </span>
            {videoUrl && (
               <div className="flex items-center gap-3">
                 <span className="text-[10px] text-space-500 hidden md:inline-flex items-center gap-1">
                   <MousePointer2 size={10} /> Scroll to Pan • Ctrl/Pinch to Zoom
                 </span>
                 <span className="text-xs font-mono text-space-300 bg-space-800 px-2 py-0.5 rounded border border-space-700">
                    {((viewTransform.scale) * 100).toFixed(0)}%
                 </span>
               </div>
            )}
          </div>

          {/* Video Container with Tech Grid Background */}
          <div 
            ref={containerRef}
            className="relative h-[400px] bg-space-900 overflow-hidden cursor-crosshair flex items-center justify-center"
            style={{
              backgroundImage: `radial-gradient(var(--color-space-700) 1px, transparent 1px)`,
              backgroundSize: '20px 20px',
            }}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {!videoUrl ? (
              <div className="flex flex-col items-center justify-center text-space-600 gap-4">
                <div className="w-16 h-16 rounded-full bg-space-800 flex items-center justify-center border border-space-700">
                  <SquareIcon size={32} className="opacity-20" />
                </div>
                <p className="text-sm font-medium">Upload a video to begin analysis</p>
              </div>
            ) : (
              <div 
                style={{ 
                  transform: `scale(${viewTransform.scale}) translate(${viewTransform.x}px, ${viewTransform.y}px)`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.1s ease-out',
                  maxWidth: '100%',
                  maxHeight: '100%',
                }}
                className="relative shadow-2xl"
              >
                {/* Video Element */}
                <video 
                  ref={videoRef}
                  src={videoUrl}
                  className="max-h-[380px] rounded-lg shadow-black/50 select-none pointer-events-none"
                  controls={false}
                  onTimeUpdate={onVideoTimeUpdate}
                />
                
                {/* Hidden Canvas for Analysis */}
                <canvas ref={canvasRef} className="hidden" />
              </div>
            )}

            {/* Floating Controls */}
            {videoUrl && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-space-900/90 backdrop-blur border border-space-700 rounded-full px-3 py-1.5 shadow-xl z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                 <button onClick={handleZoomOut} className="p-1.5 hover:bg-space-700 rounded-full text-space-300 hover:text-white transition"><ZoomOut size={16} /></button>
                 <span className="text-xs font-mono text-space-400 w-12 text-center">{Math.round(viewTransform.scale * 100)}%</span>
                 <button onClick={handleZoomIn} className="p-1.5 hover:bg-space-700 rounded-full text-space-300 hover:text-white transition"><ZoomIn size={16} /></button>
                 <div className="w-px h-4 bg-space-700 mx-1"></div>
                 <button onClick={resetView} className="p-1.5 hover:bg-space-700 rounded-full text-space-300 hover:text-white transition" title="Reset View"><RotateCcw size={16} /></button>
              </div>
            )}
            
            {/* Pan Indicator Hint */}
            {videoUrl && viewTransform.scale > 1 && (
               <div className="absolute top-4 right-4 bg-black/40 text-white px-2 py-1 rounded text-[10px] pointer-events-none border border-white/10 flex items-center gap-1">
                 <Move size={10} /> Drag or Scroll to Pan
               </div>
            )}
          </div>
        </div>

        {/* Results: Tabbed Interface */}
        {results.length > 0 && (
          <div className="bg-space-800 border border-space-600 rounded-xl p-4 min-h-[500px] flex flex-col shadow-lg">
             {/* Tab Switcher */}
             <div className="flex gap-2 border-b border-space-700 pb-1 mb-4">
               <button 
                 onClick={() => setActiveResultTab('charts')}
                 className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeResultTab === 'charts' ? 'bg-space-700 text-space-accent border-t border-x border-space-600' : 'text-space-400 hover:text-space-200'}`}
               >
                 <Activity size={16} /> {t('va_view_charts')}
               </button>
               <button 
                 onClick={() => setActiveResultTab('table')}
                 className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeResultTab === 'table' ? 'bg-space-700 text-space-accent border-t border-x border-space-600' : 'text-space-400 hover:text-space-200'}`}
               >
                 <Activity size={16} /> {t('va_view_table')}
               </button>
             </div>

             {/* Charts View */}
             {activeResultTab === 'charts' && (
              <div className="flex-1 flex flex-col gap-8">
                <div className="flex-1 min-h-[250px]">
                  <h3 className="text-space-100 font-bold mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                    <Activity size={16} className="text-space-accent" />
                    {t('sim_chart_profile')}
                  </h3>
                  <div className="h-full bg-space-900/30 rounded-lg p-2 border border-space-700/30">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={results}>
                          <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#2E3652' : '#E2E8F0'} vertical={false} />
                          <XAxis dataKey="time" stroke="#94A3B8" fontSize={12} tickFormatter={v => v.toFixed(0)} />
                          <YAxis yAxisId="h" stroke="#34D399" fontSize={12} label={{ value: 'Height (m)', angle: -90, position: 'insideLeft', fill: '#34D399' }} />
                          <YAxis yAxisId="v" orientation="right" stroke="#38BDF8" fontSize={12} label={{ value: 'Velocity (m/s)', angle: 90, position: 'insideRight', fill: '#38BDF8' }} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'var(--color-space-800)', borderColor: 'var(--color-space-600)', color: 'var(--color-space-100)', borderRadius: '8px' }}
                            labelFormatter={v => `Time: ${v}s`}
                          />
                          <Legend />
                          <Area yAxisId="h" type="monotone" dataKey="height" name={t('va_region_height')} stroke="#34D399" fill="#34D399" fillOpacity={0.2} strokeWidth={2} />
                          <Line yAxisId="v" type="monotone" dataKey="velocity" name={t('va_region_velocity')} stroke="#38BDF8" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                
                <div className="h-[180px] flex flex-col">
                  <h4 className="text-xs text-space-400 uppercase font-bold mb-2 shrink-0">{t('va_region_fuel')}</h4>
                  <div className="flex-1 min-h-0 bg-space-900/30 rounded-lg p-2 border border-space-700/30">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={results}>
                          <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#2E3652' : '#E2E8F0'} vertical={false} />
                          <XAxis dataKey="time" stroke="#94A3B8" fontSize={12} />
                          <YAxis stroke="#FBBF24" fontSize={12} domain={[0, 100]} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'var(--color-space-800)', borderColor: 'var(--color-space-600)', color: 'var(--color-space-100)', borderRadius: '8px' }}
                          />
                          <Line type="monotone" dataKey="fuelPercent" name={t('va_region_fuel')} stroke="#FBBF24" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
             )}

             {/* Table View */}
             {activeResultTab === 'table' && (
               <div 
                 ref={tableContainerRef}
                 onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                 className="flex-1 overflow-auto custom-scrollbar relative bg-space-900/30 rounded-lg border border-space-700/30"
               >
                 <div className="text-xs text-space-500 mb-2 italic text-center sticky top-0 bg-space-800 z-20 py-2 border-b border-space-700 shadow-sm">
                   {t('va_tbl_click_fix')}
                 </div>
                 <table className="w-full text-sm text-left text-space-300 relative">
                    <thead className="text-xs text-space-400 uppercase bg-space-900 sticky top-8 z-10 shadow-md h-[40px]">
                      <tr>
                        <th className="px-4 py-3 bg-space-900">{t('log_time')}</th>
                        <th className="px-4 py-3 bg-space-900">{t('log_height')}</th>
                        <th className="px-4 py-3 bg-space-900">{t('log_velocity')}</th>
                        <th className="px-4 py-3 bg-space-900">{t('log_fuel_pct')}</th>
                        <th className="px-4 py-3 bg-space-900">Eng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-space-700">
                      {virtualTableData.paddingTop > 0 && (
                         <tr style={{ height: `${virtualTableData.paddingTop}px` }}>
                           <td colSpan={5} style={{ padding: 0, border: 0 }} />
                         </tr>
                      )}
                      {virtualTableData.visibleData.map((row, i) => (
                        <tr 
                          key={virtualTableData.startIndex + i} 
                          onClick={() => jumpToFrame(row)}
                          className={`
                            hover:bg-space-700/50 cursor-pointer transition-colors h-[40px]
                            ${manualFrameData?.time === row.time ? 'bg-space-accent/10 border-l-2 border-space-accent' : ''}
                          `}
                        >
                          <td className="px-4 py-2 font-mono text-space-accent">{row.time.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono">{row.height.toFixed(1)}</td>
                          <td className="px-4 py-2 font-mono">{row.velocity.toFixed(1)}</td>
                          <td className="px-4 py-2 font-mono text-space-400">
                             {row.fuelPercent}%
                          </td>
                          <td className="px-4 py-2 font-mono">
                             <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${row.engineOn ? 'bg-success/20 text-success' : 'bg-space-700 text-space-500'}`}>
                               {row.engineOn ? 'ON' : 'OFF'}
                             </span>
                          </td>
                        </tr>
                      ))}
                      {virtualTableData.paddingBottom > 0 && (
                         <tr style={{ height: `${virtualTableData.paddingBottom}px` }}>
                           <td colSpan={5} style={{ padding: 0, border: 0 }} />
                         </tr>
                      )}
                    </tbody>
                 </table>
               </div>
             )}
          </div>
        )}
      </div>
    </div>
  );
}
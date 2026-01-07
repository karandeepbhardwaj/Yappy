import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Mic, Copy, Check, Settings2, Sparkles, Wand2, Volume2, History, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import logoImg from "./assets/logo.png";

type Status = "idle" | "recording" | "processing";

export default function App() {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const [status, setStatus] = useState<Status>("idle");
  const [rawText, setRawText] = useState("");
  const [refinedText, setRefinedText] = useState("");
  const [language, setLanguage] = useState("en");
  const [model, setModel] = useState("gpt-4o");
  const [copied, setCopied] = useState(false);
  const [transcriptHistory, setTranscriptHistory] = useState<{ raw: string; refined: string }[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  // Apply dark mode class to document root
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
  }, [isDarkMode]);
  const [vsConnected, setVsConnected] = useState(false);

  // Check VS Code connection
  useEffect(() => {
    const check = () => {
      invoke<boolean>("check_vscode_connection").then(setVsConnected).catch(() => setVsConnected(false));
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  // Listen for global hotkey
  useEffect(() => {
    const unlisten = listen("toggle-dictation", () => toggleRecording());
    return () => { unlisten.then((fn) => fn()); };
  }, [status]);

  // Interim transcription loop — runs every 3s while recording
  const interimRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptAccum = useRef("");

  const startInterimLoop = () => {
    transcriptAccum.current = "";
    interimRef.current = setInterval(async () => {
      try {
        const segment = await invoke<string>("interim_transcribe", { language });
        if (segment && segment.trim()) {
          transcriptAccum.current += (transcriptAccum.current ? " " : "") + segment.trim();
          setRawText(transcriptAccum.current);
        }
      } catch {
        // Segment was empty or transcription failed — skip
      }
    }, 4000);
  };

  const stopInterimLoop = () => {
    if (interimRef.current) {
      clearInterval(interimRef.current);
      interimRef.current = null;
    }
  };

  const toggleRecording = useCallback(async () => {
    if (status === "recording") {
      stopInterimLoop();
      setStatus("processing");
      try {
        // Stop final segment and transcribe it
        const wavPath = await invoke<string>("stop_recording");
        const finalSegment = await invoke<string>("transcribe", { audioPath: wavPath, language });

        // Combine accumulated interim text + final segment
        const fullRaw = transcriptAccum.current + (finalSegment.trim() ? " " + finalSegment.trim() : "");
        setRawText(fullRaw.trim());

        // Refine the full text
        if (vsConnected && fullRaw.trim()) {
          try {
            const refined = await invoke<string>("refine_via_copilot", { text: fullRaw.trim(), language, model });
            setRefinedText(refined);
          } catch {
            setRefinedText(fullRaw.trim());
          }
        } else {
          setRefinedText(fullRaw.trim());
        }

        if (fullRaw.trim()) {
          setTranscriptHistory((prev) => [{ raw: fullRaw.trim(), refined: refinedText || fullRaw.trim() }, ...prev].slice(0, 10));
        }
      } catch (err: any) {
        setRawText(`Error: ${err}`);
      } finally {
        // Clean up temp WAV files after everything is done
        invoke("cleanup_recording_files").catch(() => {});
      }
      setStatus("idle");
    } else if (status === "idle") {
      setRawText("");
      setRefinedText("");
      setCopied(false);
      try {
        await invoke("start_recording");
        setStatus("recording");
        startInterimLoop();
      } catch (err: any) {
        setRawText(`Error: ${err}`);
      }
    }
  }, [status, language, vsConnected]);

  const copyToClipboard = async () => {
    try {
      await invoke("paste_text", { text: refinedText || rawText });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const loadFromHistory = (item: { raw: string; refined: string }) => {
    setRawText(item.raw);
    setRefinedText(item.refined);
  };

  return (
    <div className={isDarkMode ? "dark" : ""}>
      <div className="h-screen font-sans text-[#282827] dark:text-[#e0deda]" style={{ background: 'transparent' }}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full h-full bg-white dark:bg-[#222120] rounded-2xl shadow-sm border border-[#e5e3d9] dark:border-[#333230] overflow-hidden flex flex-col transition-colors duration-500"
        >
          {/* Header — draggable */}
          <header
            className="px-5 py-4 flex items-center justify-between shrink-0 border-b border-[#e5e3d9] dark:border-[#333230] transition-colors duration-500 select-none"
            onMouseDown={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest("button") || target.closest("select")) return;
              getCurrentWindow().startDragging();
            }}
          >
            <div className="flex items-center space-x-4">
              <div className="relative flex items-center justify-center w-11 h-11 shrink-0 bg-[#f9f8f6] dark:bg-[#2a2928] rounded-xl border border-[#e5e3d9] dark:border-[#333230]">
                <img src={logoImg} alt="SunYapper" className="w-8 h-8 object-contain" />
                <div className="absolute -bottom-1.5 -right-1.5 bg-white dark:bg-[#222120] rounded-full p-0.5 border border-[#e5e3d9] dark:border-[#333230]">
                  <Mic className="w-3.5 h-3.5 text-[#d97757] dark:text-[#e88a6c]" />
                </div>
              </div>
              <h1 className="text-2xl font-serif font-medium tracking-tight text-[#1a1919] dark:text-[#fdfcfb]">
                SunYapper
              </h1>
            </div>

            <div className="flex items-center space-x-4">
              {/* Status */}
              <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full border border-[#e5e3d9] dark:border-[#333230] bg-[#faf9f7] dark:bg-[#1a1918]">
                {status === "recording" && (
                  <>
                    <motion.div
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="w-2 h-2 bg-red-500 rounded-full"
                    />
                    <span className="text-xs font-medium text-red-600 dark:text-red-400">Recording</span>
                  </>
                )}
                {status === "processing" && (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-[#d97757] dark:text-[#e88a6c] animate-spin-slow" />
                    <span className="text-xs font-medium text-[#d97757] dark:text-[#e88a6c]">Refining...</span>
                  </>
                )}
                {status === "idle" && (
                  <>
                    <div className={`w-2 h-2 rounded-full ${vsConnected ? "bg-green-500" : "bg-[#d6d3cc] dark:bg-[#4a4947]"}`} />
                    <span className="text-xs font-medium text-[#878681] dark:text-[#918f8a]">
                      {vsConnected ? "Connected" : "Idle"}
                    </span>
                  </>
                )}
              </div>

              {/* Theme Toggle */}
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 rounded-full hover:bg-[#f0ece5] dark:hover:bg-[#333230] text-[#878681] dark:text-[#918f8a] transition-colors"
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

              {/* Window controls */}
              <div className="flex space-x-2">
                <button onClick={() => getCurrentWindow().minimize()} className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#f0a500]" />
                <button onClick={() => getCurrentWindow().close()} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff3b30]" />
              </div>
            </div>
          </header>

          {/* Main */}
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar */}
            <div className="w-64 bg-[#faf9f7] dark:bg-[#1a1918] border-r border-[#e5e3d9] dark:border-[#333230] p-6 shrink-0 overflow-y-auto transition-colors duration-500">
              <h2 className="text-xs font-semibold text-[#878681] dark:text-[#7a7873] uppercase tracking-widest mb-6 flex items-center">
                <Settings2 className="w-4 h-4 mr-2" /> Settings
              </h2>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-2">Input Language</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    disabled={status !== "idle"}
                    className="w-full bg-transparent border border-[#d6d3cc] dark:border-[#4a4947] rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#d97757] disabled:opacity-50 appearance-none"
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="hi">Hindi</option>
                    <option value="zh">Chinese</option>
                    <option value="ja">Japanese</option>
                    <option value="ko">Korean</option>
                    <option value="pt">Portuguese</option>
                    <option value="ar">Arabic</option>
                    <option value="auto">Auto-detect</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Refinement Model</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={status !== "idle"}
                    className="w-full bg-transparent border border-[#d6d3cc] dark:border-[#4a4947] rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#d97757] disabled:opacity-50 appearance-none"
                  >
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                    <option value="o3-mini">o3-mini</option>
                  </select>
                </div>

                <hr className="border-[#e5e3d9] dark:border-[#333230]" />

                <div>
                  <h3 className="text-xs font-semibold text-[#878681] dark:text-[#7a7873] uppercase tracking-widest mb-4 flex items-center">
                    <History className="w-4 h-4 mr-2" /> Recent
                  </h3>
                  {transcriptHistory.length === 0 ? (
                    <p className="text-sm text-[#a8a6a1] dark:text-[#6a6863] italic">No recent recordings.</p>
                  ) : (
                    <div className="space-y-3">
                      {transcriptHistory.slice(0, 5).map((item, i) => (
                        <button
                          key={i}
                          onClick={() => loadFromHistory(item)}
                          className="w-full text-left text-sm p-3 bg-white dark:bg-[#222120] rounded-lg border border-[#e5e3d9] dark:border-[#333230] truncate hover:border-[#d97757] dark:hover:border-[#e88a6c] transition-colors"
                        >
                          {item.raw.slice(0, 60)}...
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col p-6 overflow-hidden bg-white dark:bg-[#222120] transition-colors duration-500">
              <div className="flex-1 flex gap-6 overflow-hidden items-stretch">
                {/* Transcript — no border, plain background (matches Figma) */}
                <div className="flex flex-col flex-1 basis-0 min-w-0">
                  <div className="flex items-center mb-3 h-8">
                    <label className="text-sm font-medium flex items-center text-[#878681] dark:text-[#918f8a]">
                      <Volume2 className="w-4 h-4 mr-2" /> Transcript
                    </label>
                  </div>
                  <div
                    className={`flex-1 rounded-xl p-5 overflow-y-auto text-base font-serif leading-relaxed transition-all duration-300 ${
                      status === "recording"
                        ? "bg-[#faf9f7] dark:bg-[#1a1918] border-2 border-[#d97757]/40 dark:border-[#e88a6c]/40"
                        : "bg-[#faf9f7] dark:bg-[#1a1918] border-2 border-transparent"
                    }`}
                  >
                    {rawText ? (
                      <span className="text-[#2d2d2d] dark:text-[#ececeb]">
                        {rawText}
                        {status === "recording" && (
                          <span className="inline-block w-1.5 h-4 ml-1 bg-[#d97757] animate-pulse align-middle" />
                        )}
                      </span>
                    ) : (
                      <span className="text-[#a8a6a1] dark:text-[#6a6863]">Press record and start speaking...</span>
                    )}
                  </div>
                </div>

                {/* Refined Output — bordered card (matches Figma) */}
                <div className="flex flex-col flex-1 basis-0 min-w-0">
                  <div className="flex items-center justify-between mb-3 h-8">
                    <label className="text-sm font-medium flex items-center text-[#878681] dark:text-[#918f8a]">
                      <Wand2 className="w-4 h-4 mr-2" /> Refined Output
                    </label>
                    <button
                      onClick={copyToClipboard}
                      disabled={!refinedText || status !== "idle"}
                      className="flex items-center space-x-1.5 px-3 py-1 text-sm text-[#878681] hover:text-[#1a1919] dark:hover:text-[#fdfcfb] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-green-600" />
                          <span className="text-green-600">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex-1 bg-white dark:bg-[#252423] border border-[#e5e3d9] dark:border-[#333230] rounded-xl p-5 overflow-y-auto relative">
                    {status === "processing" ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 dark:bg-[#252423]/80 backdrop-blur-sm rounded-xl z-10">
                        <Sparkles className="w-8 h-8 text-[#d97757] dark:text-[#e88a6c] animate-spin-slow mb-4" />
                        <p className="text-[#1a1919] dark:text-[#fdfcfb] font-medium">Refining with Copilot...</p>
                      </div>
                    ) : refinedText ? (
                      <div className="text-[#2d2d2d] dark:text-[#ececeb] whitespace-pre-wrap text-base font-serif leading-relaxed">
                        {refinedText}
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-[#a8a6a1] dark:text-[#6a6863]">
                        Structured text will appear here.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Mic Button */}
              <div className="mt-6 shrink-0 flex flex-col items-center">
                  <button
                  onClick={toggleRecording}
                  disabled={status === "processing"}
                  className={`relative flex items-center justify-center w-14 h-14 rounded-full shadow-md transition-all duration-200 z-20 disabled:opacity-50 disabled:cursor-not-allowed ${
                    status === "recording"
                      ? "bg-[#1a1919] dark:bg-[#fdfcfb] hover:scale-105"
                      : "bg-[#d97757] dark:bg-[#e88a6c] text-white dark:text-[#1a1919] hover:bg-[#c66949] hover:-translate-y-0.5"
                  }`}
                >
                  {status === "recording" ? (
                    <>
                      <div className="w-5 h-5 bg-white dark:bg-[#1a1919] rounded-sm" />
                      <span className="absolute inset-0 rounded-full border-2 border-[#1a1919] dark:border-[#fdfcfb] animate-ping opacity-30" />
                    </>
                  ) : (
                    <Mic className="w-6 h-6" />
                  )}
                </button>
                <p className="mt-3 text-xs text-[#a8a6a1] dark:text-[#6a6863]">
                  <kbd className="px-1.5 py-0.5 rounded border border-[#e5e3d9] dark:border-[#333230] bg-[#faf9f7] dark:bg-[#1a1918] text-[10px]">
                    {isMac ? "Cmd" : "Ctrl"}+Shift+Y
                  </kbd>{" "}
                  to toggle from anywhere
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Mic, Copy, Check, Settings2, Sparkles, Wand2, Volume2, History, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import logoImg from "./assets/logo.png";

type Status = "idle" | "recording" | "processing";

/** Local keyword matching for app actions — works without VS Code/LLM */
function matchAppAction(text: string): any | null {
  const lower = text.toLowerCase().trim();

  // Chrome
  if (/open\s+(google\s+)?chrome/i.test(lower) || /open\s+new\s+tab/i.test(lower)) {
    return { kind: "app:chrome", command: "new_tab", description: "Open new Chrome tab", risk: "safe", app: "chrome", actionId: "new_tab", params: {} };
  }
  const urlMatch = lower.match(/(?:open|go\s+to|visit|navigate\s+to)\s+(https?:\/\/\S+|[\w.-]+\.(?:com|org|net|io|dev|ai)\S*)/i);
  if (urlMatch) {
    let url = urlMatch[1];
    if (!url.startsWith("http")) url = "https://" + url;
    return { kind: "app:chrome", command: "open_url", description: `Open ${url} in Chrome`, risk: "safe", app: "chrome", actionId: "open_url", params: { url } };
  }
  const searchMatch = lower.match(/(?:search|google|look\s+up)\s+(?:for\s+)?(.+)/i);
  if (searchMatch && !searchMatch[1].match(/file|function|class|todo/i)) {
    return { kind: "app:chrome", command: "search", description: `Search Google for "${searchMatch[1]}"`, risk: "safe", app: "chrome", actionId: "search", params: { query: searchMatch[1] } };
  }

  // Notes
  if (/(?:create|make|new)\s+(?:a\s+)?note/i.test(lower)) {
    const noteText = lower.replace(/(?:create|make|new)\s+(?:a\s+)?note\s*(?:saying|with|that\s+says?)?\s*/i, "").trim();
    return { kind: "app:notes", command: "create_note", description: "Create a note", risk: "safe", app: "notes", actionId: "create_note", params: { text: noteText || text } };
  }

  // Outlook
  if (/next\s+meeting/i.test(lower) || /upcoming\s+meeting/i.test(lower)) {
    return { kind: "app:outlook", command: "next_meeting", description: "Get next meeting", risk: "safe", app: "outlook", actionId: "next_meeting", params: {} };
  }
  if (/latest\s+(?:email|message)/i.test(lower) || /new\s+(?:email|message)/i.test(lower)) {
    return { kind: "app:outlook", command: "latest_message", description: "Get latest email", risk: "safe", app: "outlook", actionId: "latest_message", params: {} };
  }
  if (/reply\s+(?:to\s+)?(?:latest\s+)?(?:email|message)/i.test(lower)) {
    return { kind: "app:outlook", command: "reply_message", description: "Reply to latest email", risk: "safe", app: "outlook", actionId: "reply_message", params: {} };
  }

  return null;
}

export default function App() {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const [status, setStatus] = useState<Status>("idle");
  const [rawText, setRawText] = useState("");
  const [refinedText, setRefinedText] = useState("");
  const [language, setLanguage] = useState("en");
  const [model, setModel] = useState("gpt-4o");
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"dictation" | "actions">("dictation");
  const [pendingAction, setPendingAction] = useState<any>(null);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [transcriptHistory, setTranscriptHistory] = useState<{ raw: string; refined: string }[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const [showVsCodePrompt, setShowVsCodePrompt] = useState(false);

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
      setPendingAction(null);
      setActionResult(null);
      try {
        const wavPath = await invoke<string>("stop_recording");
        const finalSegment = await invoke<string>("transcribe", { audioPath: wavPath, language });
        const fullRaw = transcriptAccum.current + (finalSegment.trim() ? " " + finalSegment.trim() : "");
        setRawText(fullRaw.trim());

        if (mode === "actions" && fullRaw.trim()) {
          // Actions mode: try LLM classification, fall back to local matching
          let classified = false;

          // Try local keyword matching first for app actions (works without VS Code)
          const localMatch = matchAppAction(fullRaw.trim());
          if (localMatch) {
            setPendingAction(localMatch);
            setRefinedText("");
            classified = true;
          }

          // If no local match and VS Code is connected, use LLM classification
          if (!classified && vsConnected) {
            try {
              const result = await invoke<any>("classify_via_copilot", { text: fullRaw.trim(), language, model });
              if (result.intent === "action" && result.action) {
                setPendingAction(result.action);
                setRefinedText("");
                classified = true;
              } else if (result.intent === "app_action" && result.app && result.actionId) {
                setPendingAction({
                  kind: `app:${result.app}`,
                  command: result.actionId,
                  description: result.description || `${result.app}: ${result.actionId}`,
                  risk: "safe",
                  app: result.app,
                  actionId: result.actionId,
                  params: result.params || {},
                });
                setRefinedText("");
                classified = true;
              } else {
                setRefinedText(result.refinedText || fullRaw.trim());
                classified = true;
              }
            } catch {
              // LLM failed — fall through
            }
          }

          if (!classified) {
            if (!vsConnected) {
              setRefinedText(fullRaw.trim());
              setShowVsCodePrompt(true);
            } else {
              setRefinedText(fullRaw.trim());
            }
          }
        } else if (!vsConnected && fullRaw.trim()) {
          // Dictation mode without VS Code
          setRefinedText(fullRaw.trim());
          setShowVsCodePrompt(true);
        } else if (fullRaw.trim()) {
          // Dictation mode: refine
          let finalRefined = fullRaw.trim();
          try {
            finalRefined = await invoke<string>("refine_via_copilot", { text: fullRaw.trim(), language, model });
          } catch { /* keep raw */ }
          setRefinedText(finalRefined);

          if (fullRaw.trim()) {
            setTranscriptHistory((prev) => [{ raw: fullRaw.trim(), refined: finalRefined }, ...prev].slice(0, 10));
          }
        }
      } catch (err: unknown) {
        setRawText(`Error: ${String(err)}`);
      } finally {
        invoke("cleanup_recording_files").catch(() => {});
      }
      setStatus("idle");
    } else if (status === "idle") {
      setRawText("");
      setRefinedText("");
      setCopied(false);
      setPendingAction(null);
      setActionResult(null);
      setShowVsCodePrompt(false);
      try {
        await invoke("start_recording");
        setStatus("recording");
        startInterimLoop();
      } catch (err: unknown) {
        setRawText(`Error: ${String(err)}`);
      }
    }
  }, [status, language, vsConnected, model, mode]);

  const executeAction = async (action: any) => {
    setPendingAction(null);
    setStatus("processing");
    try {
      let result;
      if (action.app && action.actionId) {
        result = await invoke<any>("execute_app_action", {
          app: action.app, actionId: action.actionId, params: action.params || {}
        });
      } else {
        result = await invoke<any>("execute_action_via_vscode", { action });
      }
      setActionResult({ success: result.success !== false, message: result.message || "Done" });
    } catch (err: unknown) {
      setActionResult({ success: false, message: String(err) });
    }
    setStatus("idle");
  };

  const retryVsCodeConnection = () => {
    setShowVsCodePrompt(false);
    // Check connection again after a brief delay
    setTimeout(() => {
      invoke<boolean>("check_vscode_connection").then(setVsConnected).catch(() => setVsConnected(false));
    }, 2000);
  };

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
                <img src={logoImg} alt="yapper" className="w-8 h-8 object-contain" />
                <div className="absolute -bottom-1.5 -right-1.5 bg-white dark:bg-[#222120] rounded-full p-0.5 border border-[#e5e3d9] dark:border-[#333230]">
                  <Mic className="w-3.5 h-3.5 text-[#d97757] dark:text-[#e88a6c]" />
                </div>
              </div>
              <h1 className="text-2xl font-serif font-medium tracking-tight text-[#1a1919] dark:text-[#fdfcfb]">
                yapper
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

                <div>
                  <label className="block text-sm font-medium mb-2">Mode</label>
                  <div className="flex rounded-lg border border-[#d6d3cc] dark:border-[#4a4947] overflow-hidden">
                    <button
                      onClick={() => setMode("dictation")}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${
                        mode === "dictation"
                          ? "bg-[#d97757] text-white"
                          : "bg-transparent text-[#878681] hover:bg-[#f0ece5] dark:hover:bg-[#333230]"
                      }`}
                    >
                      Dictation
                    </button>
                    <button
                      onClick={() => setMode("actions")}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${
                        mode === "actions"
                          ? "bg-[#d97757] text-white"
                          : "bg-transparent text-[#878681] hover:bg-[#f0ece5] dark:hover:bg-[#333230]"
                      }`}
                    >
                      Actions
                    </button>
                  </div>
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
                    {/* Processing spinner */}
                    {status === "processing" && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 dark:bg-[#252423]/80 backdrop-blur-sm rounded-xl z-10">
                        <Sparkles className="w-8 h-8 text-[#d97757] dark:text-[#e88a6c] animate-spin-slow mb-4" />
                        <p className="text-[#1a1919] dark:text-[#fdfcfb] font-medium">
                          {mode === "actions" ? "Classifying intent..." : "Refining with Copilot..."}
                        </p>
                      </div>
                    )}

                    {/* VS Code connection prompt */}
                    {showVsCodePrompt && (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                        <p className="text-sm text-[#878681]">VS Code with yapper extension is required for refinement.</p>
                        <button
                          onClick={retryVsCodeConnection}
                          className="px-4 py-2 bg-[#d97757] text-white rounded-lg text-sm font-medium hover:bg-[#c66949] transition-colors"
                        >
                          Retry Connection
                        </button>
                      </div>
                    )}

                    {/* Pending action card */}
                    {pendingAction && !showVsCodePrompt && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-[#f0ece5] dark:bg-[#333230] text-[#878681]">
                            {pendingAction.kind?.replace("_", " ")}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            pendingAction.risk === "destructive"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          }`}>
                            {pendingAction.risk}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-[#2d2d2d] dark:text-[#ececeb]">{pendingAction.description}</p>
                        <code className="block text-xs bg-[#faf9f7] dark:bg-[#1a1918] border border-[#e5e3d9] dark:border-[#333230] rounded-lg p-3 text-[#878681] break-all">
                          {pendingAction.command}
                        </code>
                        <div className="flex gap-2">
                          <button
                            onClick={() => executeAction(pendingAction)}
                            className="px-4 py-1.5 bg-[#d97757] text-white rounded-lg text-sm font-medium hover:bg-[#c66949] transition-colors"
                          >
                            Execute
                          </button>
                          <button
                            onClick={() => setPendingAction(null)}
                            className="px-4 py-1.5 border border-[#e5e3d9] dark:border-[#333230] rounded-lg text-sm hover:bg-[#f0ece5] dark:hover:bg-[#333230] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Action result */}
                    {actionResult && !pendingAction && !showVsCodePrompt && (
                      <div className={`flex items-start gap-2 text-sm ${actionResult.success ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                        <span className="font-bold text-base">{actionResult.success ? "✓" : "✗"}</span>
                        <span>{actionResult.message}</span>
                      </div>
                    )}

                    {/* Refined text (dictation mode) */}
                    {refinedText && !pendingAction && !actionResult && !showVsCodePrompt ? (
                      <div className="text-[#2d2d2d] dark:text-[#ececeb] whitespace-pre-wrap text-base font-serif leading-relaxed">
                        {refinedText}
                      </div>
                    ) : !pendingAction && !actionResult && !showVsCodePrompt && status !== "processing" ? (
                      <div className="h-full flex items-center justify-center text-[#a8a6a1] dark:text-[#6a6863]">
                        {mode === "actions" ? "Say a command like \"run tests\" or \"open settings\"" : "Structured text will appear here."}
                      </div>
                    ) : null}
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

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AnimatedLogo from "./AnimatedLogo";

type AppState = "idle" | "recording" | "processing" | "done";

function App() {
  const [state, setState] = useState<AppState>("idle");
  const [timer, setTimer] = useState("0:00.0");
  const [rawText, setRawText] = useState("");
  const [refinedText, setRefinedText] = useState("");
  const [vsConnected, setVsConnected] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(40).fill(0));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const levelRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check VS Code connection periodically
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
    const unlisten = listen("toggle-dictation", () => {
      toggleRecording();
    });
    return () => { unlisten.then(fn => fn()); };
  }, [state]);

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const frac = Math.floor((ms % 1000) / 100);
    return `${m}:${String(sec).padStart(2, "0")}.${frac}`;
  };

  const startTimer = () => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setTimer(formatTime(Date.now() - startTimeRef.current));
    }, 100);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const startLevels = () => {
    levelRef.current = setInterval(() => {
      setLevels(prev => {
        const next = [...prev.slice(1), Math.random() * 0.6 + 0.1];
        return next;
      });
    }, 80);
  };

  const stopLevels = () => {
    if (levelRef.current) { clearInterval(levelRef.current); levelRef.current = null; }
    setLevels(Array(40).fill(0));
  };

  const toggleRecording = useCallback(async () => {
    if (state === "recording") {
      // Stop
      stopTimer();
      stopLevels();
      setState("processing");

      try {
        const wavPath = await invoke<string>("stop_recording");
        const raw = await invoke<string>("transcribe", { audioPath: wavPath, language: "en" });
        setRawText(raw);

        // Try Copilot refinement if VS Code is connected
        if (vsConnected) {
          try {
            const refined = await invoke<string>("refine_via_copilot", { text: raw });
            setRefinedText(refined);
          } catch {
            setRefinedText(raw); // Fallback to raw on error
          }
        } else {
          setRefinedText(raw);
        }
        setState("done");
      } catch (err: any) {
        setRawText(`Error: ${err}`);
        setState("idle");
      }
    } else if (state === "idle" || state === "done") {
      // Start
      setRawText("");
      setRefinedText("");
      try {
        await invoke("start_recording");
        setState("recording");
        startTimer();
        startLevels();
      } catch (err: any) {
        setRawText(`Error: ${err}`);
      }
    }
  }, [state, vsConnected]);

  const handlePaste = async () => {
    const text = refinedText || rawText;
    if (!text) return;
    try {
      await invoke("paste_text", { text });
    } catch (err: any) {
      console.error("Paste failed:", err);
    }
  };

  return (
    <div className="app">
      <div
        className="titlebar"
        onMouseDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.no-drag')) return;
          e.preventDefault();
          getCurrentWindow().startDragging();
        }}
      >
        <div className="window-controls no-drag">
          <button className="win-btn close" onClick={() => getCurrentWindow().close()} title="Close" />
          <button className="win-btn minimize" onClick={() => getCurrentWindow().minimize()} title="Minimize" />
        </div>
        <span className="titlebar-label">SunYapper</span>
        <div className="connection-indicator">
          <div className={`connection-dot ${vsConnected ? "connected" : ""}`} />
          <span>{vsConnected ? "Copilot" : "Offline"}</span>
        </div>
      </div>

      <div className="content">
        <div className="record-area">
          <div className="mascot">
            <AnimatedLogo size={80} phase={state} />
          </div>
          <button
            className={`record-btn ${state === "recording" ? "recording" : ""}`}
            onClick={toggleRecording}
            disabled={state === "processing"}
            title={state === "recording" ? "Stop recording" : "Start recording"}
          >
            <svg viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            <div className="stop-icon" />
          </button>

          <div className={`timer ${state === "recording" ? "active" : ""}`}>{timer}</div>

          <div className="waveform">
            {levels.map((level, i) => (
              <div
                key={i}
                className={`wave-bar ${state !== "recording" ? "idle" : ""}`}
                style={state === "recording" ? { height: `${Math.max(3, level * 36)}px` } : undefined}
              />
            ))}
          </div>
        </div>

        <div className="status-row">
          <span className={`status-badge ${state}`}>{state}</span>
        </div>

        <div className="output-area">
          <div className={`card ${rawText ? "highlight" : ""}`}>
            <div className="card-header">
              <span className="card-label">Transcription</span>
            </div>
            <div className={`card-body ${!rawText ? "empty" : ""}`}>
              {rawText || "Press record and start speaking..."}
            </div>
          </div>

          <div className={`card refined ${refinedText ? "highlight" : ""}`}>
            <div className="card-header">
              <span className="card-label">Refined &rarr; Copilot</span>
            </div>
            <div className={`card-body ${!refinedText ? "empty" : ""}`}>
              {refinedText || "AI-refined text appears here"}
            </div>
          </div>
        </div>

        <div className="actions">
          <button
            className="btn btn-primary"
            onClick={handlePaste}
            disabled={state !== "done"}
          >
            Paste to app
          </button>
          <button
            className="btn btn-ghost"
            onClick={toggleRecording}
            disabled={state === "processing"}
          >
            {state === "recording" ? "Stop" : "Record again"}
          </button>
        </div>
      </div>

      <div className="footer">
        <kbd>Cmd+Shift+Y</kbd> to toggle from anywhere
      </div>
    </div>
  );
}

export default App;

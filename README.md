# SunYapper

Offline voice-to-text dictation with Copilot LLM refinement. Free, secure, and enterprise-friendly.

**Speak naturally, get polished text** — works in any app, not just VS Code.

## Two Ways to Use

### Desktop App (.dmg) — Dictate in Any App

Download the `.dmg`, drag to Applications, open. Works system-wide.

1. Press `Cmd+Shift+Y` from any app (Chrome, Slack, terminal, etc.)
2. Speak naturally
3. Click **Paste to app** — refined text appears at your cursor

The desktop app bundles everything: sox (mic capture), whisper-cli (offline STT), and the base whisper model (~142MB). Only prerequisite: VS Code with Copilot running for text refinement.

### VS Code Extension (.vsix) — Dictate in the Editor

Install the extension, dictate directly into your code editor.

1. `Cmd+Shift+P` → **SunYapper: Download Whisper Model** (first time only)
2. `Cmd+Shift+Y` to record
3. Click **Insert at cursor**

## Build from Source

### Desktop App

```bash
# Prerequisites (one-time, for building only)
brew install sox whisper-cpp rust

# Build
cd desktop
npm install
node scripts/bundle-sidecars.cjs    # bundles sox + whisper + model
npx tauri build                     # produces .app + .dmg
```

Output: `desktop/src-tauri/target/release/bundle/dmg/SunYapper_0.2.0_aarch64.dmg`

### VS Code Extension

```bash
# Prerequisites (one-time)
brew install sox whisper-cpp

# Build
npm install           # bundles binaries
npm run compile
npm run package       # produces .vsix
```

## Architecture

```
┌─────────────────────────────┐         ┌──────────────────┐
│  SunYapper Desktop (Tauri)  │         │  VS Code + Copilot│
│                             │◄───────►│                  │
│  sox/rec     → mic capture  │ ws://   │  CopilotBridge   │
│  whisper-cli → offline STT  │ :19542  │  (vscode.lm API) │
│  clipboard   → Cmd+V paste  │         └──────────────────┘
│  global hotkey (Cmd+Shift+Y)│
└─────────────────────────────┘
         │
         ▼
    Any Application
    (Slack, Chrome, Terminal, etc.)
```

**Desktop app** (`desktop/`): Tauri v2 + React. Rust backend handles audio recording (sox sidecar), speech-to-text (whisper-cli sidecar), clipboard paste (enigo), and global hotkey. React frontend shows the animated sun mascot, waveform, and transcription cards.

**VS Code extension** (root): WebView panel with recording controls and transcription display. WebSocket server (port 19542) bridges the desktop app to Copilot's LLM for text refinement.

## Settings (VS Code Extension)

| Setting | Default | Description |
|---------|---------|-------------|
| `sunyapper.whisperModel` | `base` | Model size: tiny (~75MB), base (~142MB), small (~466MB) |
| `sunyapper.language` | `en` | Language code (en, es, fr, hi, etc.) |
| `sunyapper.refinementEnabled` | `true` | Enable Copilot LLM text refinement |
| `sunyapper.copilotModelFamily` | `gpt-4o` | Copilot model family for refinement |
| `sunyapper.insertMode` | `cursor` | Insert at cursor or replace selection |

## Enterprise Use

- **Zero runtime dependencies** — binaries and model bundled in the .dmg
- **Fully offline STT** — whisper runs locally, no cloud APIs
- **Copilot-approved channel** — refinement uses your enterprise Copilot plan
- **No marketplace needed** — share the .dmg or .vsix directly
- **MIT licensed** — fully open source, auditable

## Roadmap

- **Phase 3**: Voice-triggered actions (run tests, open terminal, execute commands)

## License

MIT

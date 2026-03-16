# SunYapper

Offline voice-to-text dictation for VS Code with Copilot LLM refinement. Free, secure, and enterprise-friendly.

**Speak naturally, get polished text** — no cloud STT, no API keys, no subscriptions, no external tools.

## How It Works

1. Press `Cmd+Shift+Y` (Mac) or `Ctrl+Shift+Y` (Windows) to open the dictation panel
2. Click **Record** and speak naturally
3. Click **Stop** — your speech is transcribed locally using whisper.cpp WASM
4. Copilot refines the text (removes filler words, fixes grammar)
5. Click **Insert Text** to place it at your cursor

Speech-to-text runs **entirely on your machine** via WebAssembly. Text refinement uses your existing Copilot enterprise plan — no extra cost or API keys.

## Requirements

- VS Code 1.95+
- GitHub Copilot extension (signed in with enterprise or individual plan)
- Node.js 18+ (for building from source)

No external tools (sox, ffmpeg, whisper-cli) required.

## Quick Start

```bash
git clone https://github.com/karandeepbhardwaj/SunYapper.git
cd SunYapper
npm install          # installs deps + downloads whisper WASM artifacts
npm run compile
```

Then in VS Code:
1. Open the `SunYapper` folder
2. Press `F5` to launch the Extension Development Host
3. Run **SunYapper: Download Whisper Model** from the Command Palette
4. Press `Cmd+Shift+Y` to start dictating

### Install as VSIX (for enterprise machines)

```bash
npm run package
code --install-extension sunyapper-0.1.0.vsix
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sunyapper.whisperModel` | `base` | Whisper model size: tiny, base, or small |
| `sunyapper.language` | `en` | Language code for speech recognition |
| `sunyapper.refinementEnabled` | `true` | Enable Copilot LLM text refinement |
| `sunyapper.copilotModelFamily` | `gpt-4o` | Copilot model family for refinement |
| `sunyapper.insertMode` | `cursor` | Insert at cursor or replace selection |

## Architecture

```
WebView (browser context):
  getUserMedia() → ScriptProcessorNode (PCM 16kHz mono)
  → whisper.cpp WASM (local STT, fully offline)
  → postMessage to extension host

Extension Host (Node.js):
  → Copilot LLM refinement (vscode.lm API)
  → Insert refined text at editor cursor
```

- **Audio capture**: Web Audio API (`getUserMedia` + `ScriptProcessorNode`) — runs in the WebView, no native dependencies
- **Speech-to-text**: whisper.cpp compiled to WebAssembly — runs in the WebView, fully offline
- **Text refinement**: VS Code Language Model API — uses your existing Copilot access
- **Zero data leakage**: Audio never leaves your machine. Only refined text prompts go through Copilot's approved channel.

## Enterprise Use

SunYapper is designed for restricted enterprise environments:

- **Zero external dependencies** — no sox, ffmpeg, whisper-cli, or native addons to install
- STT runs as WebAssembly inside VS Code — no CLI tools on PATH required
- LLM refinement goes through Copilot, which your enterprise already approved
- Clone the repo, build, and install as a VSIX — no marketplace needed
- MIT licensed, fully open source

## Roadmap

- **Phase 2**: System-wide voice input (works in any app, not just VS Code)
- **Phase 3**: Voice-triggered actions (run tests, open terminal, execute commands)

## License

MIT

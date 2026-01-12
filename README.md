# SunYapper

Offline voice-to-text dictation for VS Code with Copilot LLM refinement. Free, secure, and enterprise-friendly.

**Speak naturally, get polished text** — no cloud STT, no API keys, no subscriptions.

## How It Works

1. Press `Cmd+Shift+Y` (Mac) or `Ctrl+Shift+Y` (Windows) to open the dictation panel
2. Click **Record** and speak naturally
3. Click **Stop** — your speech is transcribed locally using whisper.cpp
4. Copilot refines the text (removes filler words, fixes grammar)
5. Click **Insert Text** to place it at your cursor

Speech-to-text runs **entirely on your machine**. Text refinement uses your existing Copilot enterprise plan — no extra cost or API keys.

## Requirements

- VS Code 1.95+
- GitHub Copilot extension (signed in with enterprise or individual plan)
- Node.js 18+ (for building from source)
- sox (audio recording): `brew install sox` (macOS) or `choco install sox` (Windows)
- whisper.cpp (speech-to-text): `brew install whisper-cpp` (macOS) or [build from source](https://github.com/ggerganov/whisper.cpp)

## Quick Start

```bash
# Install dependencies first
brew install sox whisper-cpp   # macOS
# choco install sox            # Windows (+ build whisper.cpp from source)

git clone https://github.com/karandeepbhardwaj/SunYapper.git
cd sunyapper
npm install
npm run compile
```

Then in VS Code:
1. Open the `sunyapper` folder
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
Microphone → WebView (Web Audio API)
    → whisper.cpp (local STT, offline)
    → Copilot LLM (text refinement via vscode.lm API)
    → Insert at editor cursor
```

- **Audio capture**: sox/rec via child process — reliable cross-platform mic access
- **Speech-to-text**: whisper-cli (whisper.cpp) via child process — fully offline
- **Text refinement**: VS Code Language Model API — uses your existing Copilot access
- **Zero data leakage**: Audio never leaves your machine. Only refined text prompts go through Copilot's approved channel.

## Enterprise Use

SunYapper is designed for restricted enterprise environments:

- No software to install beyond VS Code (it's just an extension)
- STT is completely offline — no internet needed
- LLM refinement goes through Copilot, which your enterprise already approved
- Clone the repo, build, and install as a VSIX — no marketplace needed
- MIT licensed, fully open source

## Roadmap

- **Phase 2**: System-wide voice input (works in any app, not just VS Code)
- **Phase 3**: Voice-triggered actions (run tests, open terminal, execute commands)

## License

MIT

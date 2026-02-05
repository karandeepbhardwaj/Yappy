# SunYapper

Offline voice-to-text dictation for VS Code with Copilot LLM refinement. Free, secure, and enterprise-friendly.

**Speak naturally, get polished text** — no cloud STT, no API keys, no subscriptions.

## For Users (Install the VSIX)

If someone has already built the VSIX for you:

```bash
code --install-extension sunyapper-0.1.0.vsix
```

Then in VS Code:
1. Open the Command Palette (`Cmd+Shift+P`) and run **SunYapper: Download Whisper Model**
2. Select **base** (~142MB, downloaded once)
3. Press `Cmd+Shift+Y` (Mac) or `Ctrl+Shift+Y` (Windows)
4. Click the record button and speak
5. Click **Insert at cursor** to place the refined text in your editor

That's it. No brew, no pip, no PATH configuration. Everything is bundled.

## For Builders (Build from Source)

You need Homebrew on macOS (or equivalent on other platforms) to compile the VSIX:

```bash
# 1. Install build dependencies (one-time)
brew install sox whisper-cpp

# 2. Clone and build
git clone https://github.com/karandeepbhardwaj/SunYapper.git
cd SunYapper
npm install       # bundles sox + whisper-cli binaries from your system
npm run compile

# 3. Package as VSIX
npm run package   # creates sunyapper-0.1.0.vsix
```

The VSIX is self-contained (~3MB of binaries + extension code). Share it with your team via Slack, email, or an internal repo. Recipients don't need brew or any tools installed.

### Development

```bash
# Open in VS Code and press F5 to launch Extension Development Host
code .
```

## How It Works

1. Press `Cmd+Shift+Y` to open the SunYapper panel
2. Click the record button — speaks are captured via the bundled `sox` binary
3. Click stop — audio is transcribed locally by the bundled `whisper-cli`
4. If Copilot is available, the text is refined (filler words removed, grammar fixed)
5. Click **Insert at cursor** to place the text in your editor

Speech-to-text is **fully offline**. Text refinement uses your existing Copilot plan — no extra cost or API keys.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sunyapper.whisperModel` | `base` | Whisper model size: tiny (~75MB), base (~142MB), or small (~466MB) |
| `sunyapper.language` | `en` | Language code for recognition (en, es, fr, hi, etc.) |
| `sunyapper.refinementEnabled` | `true` | Enable Copilot LLM text refinement |
| `sunyapper.copilotModelFamily` | `gpt-4o` | Copilot model family for refinement |
| `sunyapper.insertMode` | `cursor` | Insert at cursor or replace selection |

## Architecture

```
Extension Host (Node.js):
  bundled rec (sox)    → captures mic → WAV file
  bundled whisper-cli  → transcribes WAV → raw text
  Copilot LLM          → refines text
  → inserts at editor cursor

WebView (display only):
  Record button, waveform, timer, transcription cards
```

- **Audio capture**: Bundled `sox`/`rec` binary (~500KB)
- **Speech-to-text**: Bundled `whisper-cli` + dylibs (~2.5MB) — fully offline
- **Text refinement**: VS Code Language Model API — uses your existing Copilot access
- **Binary resolution**: Checks `bin/<platform>/` first, falls back to system PATH
- **Zero data leakage**: Audio never leaves your machine

## Enterprise Use

SunYapper is designed for locked-down enterprise environments:

- **Zero runtime dependencies** — sox and whisper-cli are bundled inside the VSIX
- **No PATH configuration** — binaries ship inside the extension
- **No marketplace needed** — share the VSIX file directly
- **Copilot-approved channel** — LLM refinement uses your enterprise Copilot plan
- **Fully offline STT** — only the one-time model download needs internet
- **MIT licensed** — fully open source, auditable

## Roadmap

- **Phase 2**: System-wide voice input (works in any app, not just VS Code)
- **Phase 3**: Voice-triggered actions (run tests, open terminal, execute commands)

## License

MIT

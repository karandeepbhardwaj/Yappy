<h1 align="center">Yapper</h1>

<p align="center">
  <strong>Voice-powered productivity: dictation, commands, and app control</strong><br>
  Free &middot; Secure &middot; Enterprise-friendly &middot; Works in any app
</p>

<p align="center">
  <a href="https://github.com/karandeepbhardwaj/Yapper/releases/latest">
    <img src="https://img.shields.io/github/v/release/karandeepbhardwaj/Yapper?style=flat-square" alt="Release">
  </a>
  <a href="https://github.com/karandeepbhardwaj/Yapper/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey?style=flat-square" alt="Platform">
</p>

---

<p align="center">
  <img src="docs/Yapper.png" width="700" alt="Yapper — Idle">
</p>

---

## What is Yapper?

Yapper is a voice-powered productivity tool with three modes:

1. **Dictation** — Speak naturally, get polished English text. Works in any language.
2. **VS Code Actions** — Say "run tests", "open settings", "search for TODO" — executes in VS Code.
3. **App Actions** — Say "open YouTube", "check my next meeting", "create a note" — controls Chrome, Notes, Outlook.

All speech-to-text runs **locally** via whisper.cpp. AI refinement uses GitHub Copilot. No cloud STT, no API keys.

## Download

| Platform                  | Download                                                                              | Size    | What's included                               |
| ------------------------- | ------------------------------------------------------------------------------------- | ------- | --------------------------------------------- |
| **macOS** (Apple Silicon) | [Yapper.dmg](https://github.com/karandeepbhardwaj/Yapper/releases/latest)       | ~140 MB | Desktop app + sox + whisper + base model      |
| **Windows** (x64)         | [Yapper-setup.exe](https://github.com/karandeepbhardwaj/Yapper/releases/latest) | ~150 MB | Desktop app + sox + whisper + base model      |
| **VS Code Extension**     | [Yapper.vsix](https://github.com/karandeepbhardwaj/Yapper/releases/latest)      | ~1.5 MB | Extension (model auto-downloads on first use) |

## Installation

### Desktop App — macOS

1. Download `Yapper.dmg` from [Releases](https://github.com/karandeepbhardwaj/Yapper/releases/latest)
2. Open the DMG and drag Yapper to Applications
3. **Important — first launch**: macOS will show "Yapper is damaged" because the app is not notarized. Fix it by running this in Terminal:
   ```bash
   xattr -cr /Applications/Yapper.app
   ```
4. Open Yapper from Applications
5. Grant **Microphone** permission when prompted (System Settings → Privacy & Security → Microphone)

### Desktop App — Windows

1. Download `Yapper-setup.exe` from [Releases](https://github.com/karandeepbhardwaj/Yapper/releases/latest)
2. Run the installer (Windows SmartScreen may warn — click "More info" → "Run anyway")
3. Open Yapper from the Start menu

### VS Code Extension

1. Download `Yapper.vsix` from [Releases](https://github.com/karandeepbhardwaj/Yapper/releases/latest)
2. Install: `code --install-extension Yapper-v0.3.0.vsix`
3. Restart VS Code — the extension activates automatically
4. The whisper model (~142MB) downloads automatically on first activation
5. Press `Cmd+Shift+Y` (Mac) or `Ctrl+Shift+Y` (Win) to start dictating

### Prerequisites

| Component | Desktop App | VS Code Extension |
|-----------|------------|-------------------|
| macOS 13+ or Windows 10+ | Required | — |
| VS Code 1.95+ | Optional (for Copilot refinement) | Required |
| GitHub Copilot extension | Optional (for AI text refinement) | Required |
| Internet | One-time model download (if not bundled) | One-time model download |
| Microphone | Required | Required |

**The desktop app works standalone** for recording + transcription. VS Code with Copilot is only needed for AI text refinement and VS Code action execution.

## Three Modes

### Dictation Mode

Speak naturally → whisper transcribes → Copilot refines (removes filler words, fixes grammar, handles self-corrections).

- Multi-language: select your language, whisper translates to English automatically
- Live transcription: text appears as you speak (every 4 seconds)
- Self-correction: say "Friday 9 PM, actually 7 PM" → output is "Friday at 7 PM"

### VS Code Actions Mode

Say commands → AI classifies intent → executes in VS Code.

| Voice Command            | What Happens                                        |
| ------------------------ | --------------------------------------------------- |
| "Run tests"              | Opens terminal, runs `npm test`                     |
| "Open settings"          | Opens VS Code settings                              |
| "Search for handleClick" | Searches workspace                                  |
| "Open package.json"      | Opens the file                                      |
| "Commit my changes"      | Runs `git add -A && git commit` (with confirmation) |
| "Format document"        | Formats current file                                |
| "Toggle terminal"        | Shows/hides terminal panel                          |

Safe commands execute immediately. Destructive commands (git push, delete) require confirmation.

### App Actions Mode (Plugin System)

Say commands → local keyword matching or AI classification → controls external apps.

| Voice Command                        | App           | Action                    |
| ------------------------------------ | ------------- | ------------------------- |
| "Open YouTube"                       | Chrome        | Opens youtube.com         |
| "Search for React tutorials"         | Chrome        | Google search             |
| "Create a note saying buy groceries" | Notes/Notepad | Creates a note            |
| "What's my next meeting"             | Outlook       | Shows next calendar event |
| "What's my latest email"             | Outlook       | Shows latest email        |
| "Reply to message"                   | Outlook       | Opens reply window        |

App actions work **without VS Code** for common commands (local keyword matching). Complex commands use AI classification via Copilot.

## Plugin Architecture (MCP-Style)

Each app integration is a plugin implementing a standard `AppPlugin` trait:

```
desktop/src-tauri/src/plugins/
├── mod.rs       — Plugin trait + registry
├── chrome.rs    — Google Chrome (osascript / PowerShell)
├── notes.rs     — Apple Notes / Notepad (osascript / PowerShell)
└── outlook.rs   — Microsoft Outlook (osascript / COM)
```

**Adding a new app** = create one Rust file implementing the `AppPlugin` trait + register it in `PluginRegistry::new()`.

```rust
pub trait AppPlugin: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn platforms(&self) -> &[&str];
    fn actions(&self) -> Vec<ActionDefinition>;
    fn execute(&self, action_id: &str, params: &serde_json::Value) -> ActionResult;
    fn is_available(&self) -> bool;
}
```

## Architecture

```
┌────────────────────────────────────┐      ┌──────────────────┐
│  Yapper Desktop (Tauri v2)      │      │  VS Code + Copilot│
│                                    │◄────►│                  │
│  sox/rec       → mic capture       │ws:// │  CopilotBridge   │
│  whisper-cli   → offline STT       │19542 │  IntentClassifier│
│  Plugin System → app control       │      │  ActionExecutor  │
│  Global hotkey (Cmd/Ctrl+Shift+Y)  │      └──────────────────┘
│                                    │
│  Plugins:                          │
│  ├── Chrome  (osascript/PowerShell)│
│  ├── Notes   (osascript/PowerShell)│
│  └── Outlook (osascript/COM)       │
└────────────────────────────────────┘
```

## Settings

| Setting                           | Default     | Description                    |
| --------------------------------- | ----------- | ------------------------------ |
| `Yapper.whisperModel`          | `base`      | Model: tiny, base, small       |
| `Yapper.language`              | `en`        | Source language                |
| `Yapper.actionMode`            | `dictation` | Mode: dictation or actions     |
| `Yapper.actionsEnabled`        | `true`      | Enable voice-triggered actions |
| `Yapper.actionAutoExecuteSafe` | `true`      | Auto-execute safe actions      |
| `Yapper.refinementEnabled`     | `true`      | Enable Copilot refinement      |
| `Yapper.copilotModelFamily`    | `gpt-4o`    | Copilot model for AI           |

## Build from Source

### Desktop App

```bash
# macOS prerequisites
brew install sox whisper-cpp rust node

# Clone and build
git clone https://github.com/karandeepbhardwaj/Yapper.git
cd Yapper/desktop
npm install
node scripts/bundle-sidecars.cjs    # bundles sox + whisper + model (~142MB download)
npx tauri build                     # outputs .app + .dmg

# Remove quarantine for local builds too
xattr -cr src-tauri/target/release/bundle/macos/Yapper.app
```

### VS Code Extension

```bash
cd Yapper
npm install
npm run bundle                      # esbuild bundles everything into out/extension.js
npx @vscode/vsce package --no-dependencies  # outputs .vsix
```

### Windows (build on Windows machine or CI)

```bash
# Prerequisites: Node.js 18+, Rust, Visual Studio Build Tools
cd Yapper/desktop
npm install
node scripts/bundle-sidecars.cjs    # downloads sox + whisper for Windows
npx tauri build                     # outputs NSIS .exe installer
```

## Enterprise Use

- **Zero runtime dependencies** — everything bundled
- **Fully offline STT** — whisper runs locally
- **Copilot-approved channel** — uses enterprise Copilot plan
- **No marketplace needed** — share .dmg/.exe/.vsix directly
- **MIT licensed** — fully open source, auditable

## Roadmap

- [x] Phase 1: VS Code extension with local STT + Copilot refinement
- [x] Phase 2: Standalone desktop app with system-wide dictation
- [x] Phase 3: Voice-triggered VS Code/terminal actions
- [x] Phase 3b: App plugin system (Chrome, Notes, Outlook)
- [ ] Phase 4: More app plugins (Slack, Teams, Spotify, Finder)
- [ ] Phase 5: Multi-step workflows ("run tests, if pass then commit and push")

## License

[MIT](LICENSE)

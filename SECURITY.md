# Security Report — SunYapper

**Version**: 0.3.0
**Date**: March 2026
**Classification**: Public

---

## Executive Summary

SunYapper is a voice-to-text dictation tool with two components: a VS Code extension and a Tauri desktop app. It is designed for **local-first operation** with offline speech-to-text. This report details the security posture for enterprise deployment.

**Overall Risk**: MODERATE — suitable for general productivity with documented limitations.

---

## 1. Data Flow

### What stays local (never leaves your machine)
- Audio recording (sox captures to local temp files)
- Speech-to-text transcription (whisper.cpp runs locally)
- App plugin actions (osascript/PowerShell execute locally)
- WebSocket communication (localhost:19542 only)

### What goes to external servers

| Data | Destination | When | Can be disabled? |
|------|-------------|------|-----------------|
| Transcribed text | Microsoft Copilot servers | During refinement | Yes (`sunyapper.refinementEnabled: false`) |
| Language code | Microsoft Copilot servers | During refinement | Yes |
| Whisper model file | HuggingFace CDN (HTTPS) | First-time download only | Yes (bundle model in VSIX/DMG) |

**Important**: Raw audio is NEVER transmitted over the network. Only the transcribed text is sent to Copilot for refinement, and only when refinement is enabled.

---

## 2. Storage & Data Retention

| Data | Location | Lifetime | Encrypted? |
|------|----------|----------|-----------|
| Audio recordings | `/tmp/sunyapper_*.wav` | Deleted after transcription | No |
| Transcriptions | In-memory (UI display) | Until app restart | No |
| Whisper models | App bundle or user storage | Permanent | No |
| VS Code settings | VS Code config | Permanent | No |
| Conversation history | React state (in-memory) | Until app restart | No |

**No persistent storage of recordings or transcriptions.** Audio files are explicitly deleted after each transcription segment. No database, no logs, no history files on disk.

---

## 3. Network Security

### Ports

| Port | Purpose | Binding | Authentication |
|------|---------|---------|---------------|
| 19542 | WebSocket (VS Code ↔ Desktop) | `127.0.0.1` only | None (localhost) |

The WebSocket server binds exclusively to localhost. No remote connections are possible.

### HTTPS Connections
- Model downloads: `huggingface.co` (HTTPS, follows redirects)
- Copilot API: Via VS Code's built-in Copilot (TLS 1.2+, Microsoft infrastructure)

### No Telemetry
SunYapper does not collect analytics, crash reports, or usage telemetry.

---

## 4. Dependencies

### NPM (VS Code Extension)

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| ws | ^8.19.0 | MIT | WebSocket server |
| typescript | ^5.5.0 | Apache-2.0 | Compiler (dev only) |

### NPM (Desktop App)

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| @tauri-apps/api | ^2 | MIT/Apache-2.0 | Desktop framework |
| react | ^19.1.0 | MIT | UI |
| tailwindcss | ^4.2.1 | MIT | Styling |
| lucide-react | latest | ISC | Icons |
| motion | ^12.36.0 | MIT | Animations |

### Rust Crates

| Crate | Version | License | Purpose |
|-------|---------|---------|---------|
| tauri | 2 | MIT/Apache-2.0 | Desktop framework |
| serde | 1 | MIT/Apache-2.0 | Serialization |
| uuid | 1.22.0 | MIT/Apache-2.0 | ID generation |
| libc | 0.2.183 | MIT/Apache-2.0 | POSIX bindings (Unix only) |

### Bundled Binaries

| Binary | Source | License | Verification |
|--------|--------|---------|-------------|
| whisper-cli | github.com/ggml-org/whisper.cpp | MIT | Downloaded via HTTPS |
| rec (sox) | Homebrew / SourceForge | GPL v2+ | Downloaded via HTTPS |

---

## 5. Permissions

### macOS

| Permission | Required for | Granted by |
|-----------|-------------|-----------|
| Microphone | Audio recording | macOS system prompt |
| Accessibility | Keyboard simulation (optional) | System Settings |

### Windows

| Permission | Required for |
|-----------|-------------|
| Microphone | Audio recording |
| No UAC elevation required | — |

### Tauri Capabilities

```json
{
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "clipboard-manager:default",
    "global-shortcut:default",
    "shell:default"
  ]
}
```

---

## 6. Offline Operation

SunYapper can operate **fully offline** with these limitations:

| Feature | Offline? | Notes |
|---------|----------|-------|
| Audio recording | Yes | sox runs locally |
| Speech-to-text | Yes | whisper.cpp runs locally |
| Text refinement | No | Requires Copilot (Microsoft servers) |
| App actions (Chrome, Notes, Outlook) | Yes | osascript/PowerShell runs locally |
| VS Code actions | Partially | Requires VS Code but no internet |
| Live transcription | Yes | All local |

To operate fully offline: set `sunyapper.refinementEnabled: false`. Raw transcription still works without any network.

---

## 7. Known Limitations

### Security
1. Bundled binaries downloaded via HTTPS but not checksum-verified
2. WebSocket has no authentication (relies on localhost binding)
3. Temp audio files deleted with standard `unlink()`, not secure erasure
4. CSP disabled on desktop app (`csp: null`)
5. osascript/PowerShell commands use string interpolation (injection risk mitigated by escaping)

### Privacy
1. Copilot refinement sends transcribed text to Microsoft — can be disabled
2. Audio temporarily exists on disk as `.wav` files — deleted after transcription
3. No data processing agreement included — enterprises should use their own Copilot DPA

### Compliance

| Standard | Status | Notes |
|----------|--------|-------|
| SOC 2 | Not assessed | Recommended for enterprise |
| GDPR | Partial | Copilot usage requires consent |
| HIPAA | Not suitable | No encryption at rest, no audit logging |
| CCPA | Partial | No deletion mechanism for Copilot-processed data |

---

## 8. Enterprise Deployment Recommendations

### Before Deployment
- [ ] Review Microsoft Copilot enterprise agreement for data handling
- [ ] Configure `sunyapper.refinementEnabled: false` for sensitive environments
- [ ] Deploy via internal software distribution (SCCM, Jamf, etc.)
- [ ] Grant microphone permission via MDM policy

### Configuration for Maximum Privacy

```json
{
  "sunyapper.refinementEnabled": false,
  "sunyapper.actionsEnabled": false,
  "sunyapper.actionMode": "dictation"
}
```

This gives offline-only dictation with no external data transmission.

### Network Firewall Rules
- **Allow (one-time)**: `huggingface.co` — HTTPS model download
- **Allow (internal)**: `localhost:19542` — VS Code ↔ Desktop WebSocket
- **Optional block**: Copilot endpoints if refinement disabled

---

## 9. Vulnerability Disclosure

To report security vulnerabilities, open a private security advisory at:
https://github.com/karandeepbhardwaj/SunYapper/security/advisories

---

## 10. License Compliance

| Component | License | Redistribution |
|-----------|---------|---------------|
| SunYapper | MIT | Free |
| whisper.cpp | MIT | Free |
| sox | GPL v2+ | Source available at sourceforge.net/projects/sox |
| Tauri | MIT/Apache-2.0 | Free |
| React | MIT | Free |

**Note**: sox is GPL v2+ licensed. Source code is available at https://sourceforge.net/projects/sox/.

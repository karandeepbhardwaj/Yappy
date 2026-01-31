import * as vscode from 'vscode';
import * as fs from 'fs';
import { AudioRecorder } from './AudioRecorder';
import { WhisperEngine } from '../stt/WhisperEngine';
import { ModelManager } from '../stt/ModelManager';
import { CopilotRefiner } from '../llm/CopilotRefiner';
import { TextInserter } from '../output/TextInserter';
import { getConfig } from '../config/Settings';

export class AudioPanel {
  public static currentPanel: AudioPanel | undefined;
  private static readonly viewType = 'sunyapper.panel';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly audioRecorder: AudioRecorder;
  private readonly whisperEngine: WhisperEngine;
  private readonly modelManager: ModelManager;
  private readonly copilotRefiner: CopilotRefiner;
  private readonly textInserter: TextInserter;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    audioRecorder: AudioRecorder,
    whisperEngine: WhisperEngine,
    modelManager: ModelManager,
    copilotRefiner: CopilotRefiner,
    textInserter: TextInserter
  ) {
    const column = vscode.ViewColumn.Beside;

    if (AudioPanel.currentPanel) {
      AudioPanel.currentPanel.panel.reveal(column);
      return AudioPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      AudioPanel.viewType,
      'SunYapper',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    AudioPanel.currentPanel = new AudioPanel(
      panel, extensionUri, audioRecorder, whisperEngine, modelManager, copilotRefiner, textInserter
    );
    return AudioPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    audioRecorder: AudioRecorder,
    whisperEngine: WhisperEngine,
    modelManager: ModelManager,
    copilotRefiner: CopilotRefiner,
    textInserter: TextInserter
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.audioRecorder = audioRecorder;
    this.whisperEngine = whisperEngine;
    this.modelManager = modelManager;
    this.copilotRefiner = copilotRefiner;
    this.textInserter = textInserter;

    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );
  }

  public toggleRecording() {
    if (this.audioRecorder.isRecording()) {
      this.stopAndProcess();
    } else {
      this.startRecording();
    }
  }

  private startRecording() {
    try {
      this.audioRecorder.start();
      this.panel.webview.postMessage({ type: 'setState', state: 'recording' });

      this.timerInterval = setInterval(() => {
        if (this.audioRecorder.isRecording()) {
          this.panel.webview.postMessage({
            type: 'audioLevel',
            level: Math.random() * 0.5 + 0.1,
          });
        }
      }, 80);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`SunYapper: Failed to start recording — ${msg}`);
      this.panel.webview.postMessage({ type: 'setState', state: 'idle' });
    }
  }

  private async stopAndProcess() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    this.panel.webview.postMessage({ type: 'setState', state: 'processing' });

    let wavPath: string | null = null;
    try {
      wavPath = await this.audioRecorder.stop();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`SunYapper: ${msg}`);
      this.panel.webview.postMessage({ type: 'setState', state: 'idle' });
      return;
    }

    if (!wavPath) {
      this.panel.webview.postMessage({ type: 'error', message: 'No audio captured.' });
      return;
    }

    const config = getConfig();

    try {
      // Find a model: preferred > any available > prompt download
      let model = this.modelManager.findAnyAvailableModel(config.whisperModel);

      if (!model) {
        const action = await vscode.window.showWarningMessage(
          'SunYapper: No whisper model available. Download one now?',
          'Download tiny (~75MB)', 'Download base (~142MB)'
        );
        if (action) {
          const choice = action.includes('tiny') ? 'tiny' : 'base';
          try {
            await this.modelManager.downloadModel(choice);
            model = choice;
          } catch (dlErr: unknown) {
            const dlMsg = dlErr instanceof Error ? dlErr.message : String(dlErr);
            this.panel.webview.postMessage({
              type: 'error',
              message: `Download failed: ${dlMsg}. For air-gapped machines, place a model file in the models/ directory.`,
            });
            return;
          }
        } else {
          this.panel.webview.postMessage({ type: 'setState', state: 'idle' });
          return;
        }
      }

      if (model !== config.whisperModel) {
        vscode.window.showInformationMessage(
          `SunYapper: Using "${model}" model (configured "${config.whisperModel}" not available).`
        );
      }

      // Transcribe with whisper-cli
      const rawText = await this.whisperEngine.transcribe(wavPath, model, config.language);

      if (!rawText || rawText.trim().length === 0) {
        this.panel.webview.postMessage({
          type: 'error',
          message: 'No speech detected. Try speaking louder or closer to the mic.',
        });
        return;
      }

      // Show raw transcription
      this.panel.webview.postMessage({
        type: 'transcription',
        text: rawText,
        refining: config.refinementEnabled,
      });

      // Refine with Copilot
      if (config.refinementEnabled) {
        try {
          const refined = await this.copilotRefiner.refine(rawText);
          this.panel.webview.postMessage({ type: 'refined', text: refined });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.panel.webview.postMessage({ type: 'refined', text: rawText });
          vscode.window.showWarningMessage(
            `SunYapper: Copilot refinement failed (${errMsg}). Using raw transcription.`
          );
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: 'error', message: errMsg });
    } finally {
      if (wavPath && fs.existsSync(wavPath)) {
        try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
      }
    }
  }

  private async handleMessage(msg: { type: string; text?: string; message?: string }) {
    switch (msg.type) {
      case 'record':
        this.startRecording();
        break;
      case 'stop':
        await this.stopAndProcess();
        break;
      case 'insertText':
        await this.textInserter.insert(msg.text!);
        break;
      case 'error':
        vscode.window.showErrorMessage(`SunYapper: ${msg.message}`);
        break;
    }
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'panel.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'panel.js')
    );

    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'logo.svg')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};">
  <link rel="stylesheet" href="${cssUri}">
  <title>SunYapper</title>
</head>
<body>
  <div class="header">
    <div class="brand">
      <img src="${logoUri}" alt="SunYapper" style="width:22px;height:22px;border-radius:4px;">
      <h2>SunYapper</h2>
    </div>
    <span id="status" class="status-badge status-idle">idle</span>
  </div>

  <div class="record-section">
    <button class="record-btn" id="btn-record" title="Start recording">
      <svg class="icon-mic" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
      <div class="icon-stop"></div>
    </button>
    <div class="timer" id="timer">0:00.0</div>
    <div class="waveform-wrap">
      <canvas id="waveform"></canvas>
    </div>
  </div>

  <div class="controls">
    <button class="btn-secondary" id="btn-insert" disabled>Insert at cursor</button>
  </div>

  <div class="divider"></div>

  <div class="output-section">
    <div class="output-card" id="card-raw">
      <div class="output-card-header">
        <span class="output-card-label">Transcription</span>
      </div>
      <div class="output-card-body" id="raw-text" data-placeholder="Press the record button and start speaking..."></div>
    </div>
    <div class="output-card refined" id="card-refined">
      <div class="output-card-header">
        <span class="output-card-label">Refined <span class="arrow">&rarr;</span> Copilot</span>
      </div>
      <div class="output-card-body" id="refined-text" data-placeholder="AI-refined text will appear here"></div>
    </div>
  </div>

  <div class="hint">Press <kbd>Cmd+Shift+Y</kbd> to toggle recording</div>

  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private dispose() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    if (this.audioRecorder.isRecording()) {
      this.audioRecorder.stop().catch(() => { /* ignore on dispose */ });
    }
    AudioPanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

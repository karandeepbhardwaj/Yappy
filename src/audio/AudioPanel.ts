import * as vscode from 'vscode';
import * as fs from 'fs';
import { AudioRecorder } from './AudioRecorder';
import { WhisperEngine } from '../stt/WhisperEngine';
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
  private readonly copilotRefiner: CopilotRefiner;
  private readonly textInserter: TextInserter;
  private levelInterval: ReturnType<typeof setInterval> | null = null;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    audioRecorder: AudioRecorder,
    whisperEngine: WhisperEngine,
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
      panel, extensionUri, audioRecorder, whisperEngine, copilotRefiner, textInserter
    );
    return AudioPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    audioRecorder: AudioRecorder,
    whisperEngine: WhisperEngine,
    copilotRefiner: CopilotRefiner,
    textInserter: TextInserter
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.audioRecorder = audioRecorder;
    this.whisperEngine = whisperEngine;
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

      // Send audio levels to webview for waveform visualization
      this.levelInterval = setInterval(() => {
        if (this.audioRecorder.isRecording()) {
          const level = this.audioRecorder.getCurrentLevel();
          this.panel.webview.postMessage({ type: 'audioLevel', level });
        }
      }, 50);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`SunYapper: Failed to start recording — ${msg}`);
      this.panel.webview.postMessage({ type: 'setState', state: 'idle' });
    }
  }

  private async stopAndProcess() {
    if (this.levelInterval) {
      clearInterval(this.levelInterval);
      this.levelInterval = null;
    }

    const wavPath = await this.audioRecorder.stop();
    if (!wavPath) {
      this.panel.webview.postMessage({ type: 'setState', state: 'idle' });
      return;
    }

    this.panel.webview.postMessage({ type: 'setState', state: 'processing' });

    const config = getConfig();

    try {
      // Transcribe with whisper
      const rawText = await this.whisperEngine.transcribe(
        wavPath,
        config.whisperModel,
        config.language
      );

      if (!rawText || rawText.trim().length === 0) {
        this.panel.webview.postMessage({
          type: 'error',
          message: 'No speech detected. Try speaking louder or closer to the mic.',
        });
        return;
      }

      // Send raw transcription to webview
      this.panel.webview.postMessage({
        type: 'transcription',
        text: rawText,
        refining: config.refinementEnabled,
      });

      // Refine with Copilot if enabled
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
      if (fs.existsSync(wavPath)) {
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

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>SunYapper</title>
</head>
<body>
  <div class="header">
    <h2>SunYapper</h2>
    <span id="status" class="status-badge status-idle">idle</span>
  </div>

  <div class="waveform-container">
    <canvas id="waveform"></canvas>
  </div>

  <div class="timer" id="timer">0:00.0</div>

  <div class="controls">
    <button class="btn" id="btn-record">Record</button>
    <button class="btn btn-danger" id="btn-stop" disabled>Stop</button>
    <button class="btn" id="btn-insert" disabled>Insert Text</button>
  </div>

  <div class="output-section">
    <div>
      <span class="output-label">Raw Transcription</span>
      <div class="output-text" id="raw-text"></div>
    </div>
    <div>
      <span class="output-label">Refined Text</span>
      <div class="output-text" id="refined-text"></div>
    </div>
  </div>

  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private dispose() {
    if (this.levelInterval) {
      clearInterval(this.levelInterval);
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

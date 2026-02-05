import * as vscode from 'vscode';
import { ModelManager } from '../stt/ModelManager';
import { CopilotRefiner } from '../llm/CopilotRefiner';
import { TextInserter } from '../output/TextInserter';
import { getConfig } from '../config/Settings';

export class AudioPanel {
  public static currentPanel: AudioPanel | undefined;
  private static readonly viewType = 'sunyapper.panel';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly modelManager: ModelManager;
  private readonly copilotRefiner: CopilotRefiner;
  private readonly textInserter: TextInserter;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
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
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.file(modelManager.modelsDir),
        ],
      }
    );

    AudioPanel.currentPanel = new AudioPanel(
      panel, extensionUri, modelManager, copilotRefiner, textInserter
    );
    return AudioPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    modelManager: ModelManager,
    copilotRefiner: CopilotRefiner,
    textInserter: TextInserter
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
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

  // toggleRecording is now a no-op signal: webview owns recording state.
  // Calling this posts a 'toggleRecording' message so the webview simulates
  // the Record/Stop button click from the keyboard shortcut.
  public toggleRecording() {
    this.panel.webview.postMessage({ type: 'toggleRecording' });
  }

  private async handleMessage(msg: {
    type: string;
    text?: string;
    message?: string;
    pcm16?: number[];
    sampleRate?: number;
  }) {
    switch (msg.type) {
      case 'audioData':
        await this.processAudioData(msg.pcm16!, msg.sampleRate ?? 16000);
        break;
      case 'transcription':
        await this.handleTranscription(msg.text!);
        break;
      case 'insertText':
        await this.textInserter.insert(msg.text!);
        break;
      case 'error':
        vscode.window.showErrorMessage(`SunYapper: ${msg.message}`);
        break;
    }
  }

  // Received raw PCM from webview; ask webview to run WASM transcription.
  private async processAudioData(pcm16: number[], sampleRate: number) {
    const config = getConfig();
    const model = config.whisperModel;

    if (!this.modelManager.isModelDownloaded(model)) {
      const action = await vscode.window.showWarningMessage(
        `SunYapper: Model "${model}" not downloaded.`,
        'Download Now'
      );
      if (action === 'Download Now') {
        try {
          await this.modelManager.downloadModel(model);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.panel.webview.postMessage({ type: 'error', message: msg });
          return;
        }
      } else {
        this.panel.webview.postMessage({ type: 'setState', state: 'idle' });
        return;
      }
    }

    const modelPath = this.modelManager.getModelPath(model);
    const modelWebviewUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(modelPath)
    );

    const wasmJsUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'wasm', 'main.js')
    );

    this.panel.webview.postMessage({
      type: 'transcribeAudio',
      pcm16,
      sampleRate,
      language: config.language,
      modelUrl: modelWebviewUri.toString(),
      wasmJsUrl: wasmJsUri.toString(),
    });
  }

  // Received transcription from webview WASM; drive Copilot refinement.
  private async handleTranscription(rawText: string) {
    if (!rawText || rawText.trim().length === 0) {
      this.panel.webview.postMessage({
        type: 'error',
        message: 'No speech detected. Try speaking louder or closer to the mic.',
      });
      return;
    }

    const config = getConfig();

    this.panel.webview.postMessage({
      type: 'transcription',
      text: rawText,
      refining: config.refinementEnabled,
    });

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

    // media-src: allows getUserMedia audio streams (blob:) and webview resources
    // worker-src: not needed — ScriptProcessorNode runs on main thread
    // wasm-unsafe-eval: required for WebAssembly.instantiate()
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${webview.cspSource}`,
      `media-src blob: ${webview.cspSource}`,
      `connect-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
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

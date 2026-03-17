import * as vscode from 'vscode';
import { AudioPanel } from './audio/AudioPanel';
import { AudioRecorder } from './audio/AudioRecorder';
import { ModelManager } from './stt/ModelManager';
import { WhisperEngine } from './stt/WhisperEngine';
import { CopilotRefiner } from './llm/CopilotRefiner';
import { TextInserter } from './output/TextInserter';
import { getConfig } from './config/Settings';
import { CopilotBridge } from './ws/CopilotBridge';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const extPath = context.extensionUri.fsPath;
  const audioRecorder = new AudioRecorder(extPath);
  const modelManager = new ModelManager(context.globalStorageUri.fsPath, extPath);
  const whisperEngine = new WhisperEngine(modelManager, extPath);
  const copilotRefiner = new CopilotRefiner();
  const textInserter = new TextInserter();

  // Start WebSocket bridge for yapper desktop app
  try {
    const bridge = new CopilotBridge(copilotRefiner);
    context.subscriptions.push(bridge.start());
    console.log('yapper: WebSocket bridge started on port 19542');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('yapper: Failed to start WebSocket bridge:', msg);
    vscode.window.showWarningMessage(`yapper Bridge failed: ${msg}`);
  }

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'yapper.toggleDictation';
  statusBarItem.text = '$(mic) yapper';
  statusBarItem.tooltip = 'Click to toggle dictation (Cmd+Shift+Y)';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Toggle dictation command
  context.subscriptions.push(
    vscode.commands.registerCommand('yapper.toggleDictation', () => {
      const panel = AudioPanel.createOrShow(
        context.extensionUri,
        audioRecorder,
        whisperEngine,
        modelManager,
        copilotRefiner,
        textInserter
      );
      panel.toggleRecording();
    })
  );

  // Open panel command
  context.subscriptions.push(
    vscode.commands.registerCommand('yapper.openPanel', () => {
      AudioPanel.createOrShow(
        context.extensionUri,
        audioRecorder,
        whisperEngine,
        modelManager,
        copilotRefiner,
        textInserter
      );
    })
  );

  // Download model command
  context.subscriptions.push(
    vscode.commands.registerCommand('yapper.downloadModel', async () => {
      const models = modelManager.getAvailableModels();
      const items = models.map((m) => ({
        label: m.name,
        description: m.size,
        detail: m.downloaded ? 'Downloaded' : m.bundled ? 'Bundled (ready to use)' : 'Not downloaded',
        needsDownload: !m.downloaded && !m.bundled,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a Whisper model to download',
      });

      if (selected && selected.needsDownload) {
        try {
          await modelManager.downloadModel(selected.label);
          vscode.window.showInformationMessage(
            `yapper: ${selected.label} model downloaded successfully!`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`yapper: Download failed — ${msg}`);
        }
      } else if (selected && !selected.needsDownload) {
        vscode.window.showInformationMessage(
          `yapper: ${selected.label} model is already available.`
        );
      }
    })
  );

  // Select model command
  context.subscriptions.push(
    vscode.commands.registerCommand('yapper.selectModel', async () => {
      const models = modelManager.getAvailableModels();
      const downloaded = models.filter((m) => m.downloaded);

      if (downloaded.length === 0) {
        const action = await vscode.window.showWarningMessage(
          'yapper: No models downloaded yet.',
          'Download Model'
        );
        if (action === 'Download Model') {
          vscode.commands.executeCommand('yapper.downloadModel');
        }
        return;
      }

      const selected = await vscode.window.showQuickPick(
        downloaded.map((m) => ({ label: m.name, description: m.size })),
        { placeHolder: 'Select active Whisper model' }
      );

      if (selected) {
        await vscode.workspace
          .getConfiguration('yapper')
          .update('whisperModel', selected.label, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          `yapper: Now using ${selected.label} model.`
        );
      }
    })
  );

  // Auto-download model on first activation if none available
  autoDownloadModel(context, modelManager);
}

async function autoDownloadModel(
  context: vscode.ExtensionContext,
  modelManager: ModelManager
) {
  // Check if any model is already available (downloaded or bundled)
  const available = modelManager.findAnyAvailableModel('base');
  if (available) return; // Already have a model, nothing to do

  // No model available — download base model automatically
  const config = getConfig();
  const model = config.whisperModel;

  try {
    await modelManager.downloadModel(model);
    vscode.window.showInformationMessage(
      `yapper: ${model} model ready! Press Cmd+Shift+Y to start dictating.`
    );
  } catch {
    // Download failed (offline?) — show a one-time hint
    const hasNotified = context.globalState.get<boolean>('yapper.downloadHintShown');
    if (!hasNotified) {
      vscode.window.showWarningMessage(
        'yapper: Could not auto-download the whisper model. Run "yapper: Download Whisper Model" when you have internet.',
        'Download Now'
      ).then(action => {
        if (action === 'Download Now') {
          vscode.commands.executeCommand('yapper.downloadModel');
        }
      });
      context.globalState.update('yapper.downloadHintShown', true);
    }
  }
}

export function deactivate() {
  // cleanup handled by disposables
}

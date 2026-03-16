import * as vscode from 'vscode';
import { AudioPanel } from './audio/AudioPanel';
import { AudioRecorder } from './audio/AudioRecorder';
import { ModelManager } from './stt/ModelManager';
import { WhisperEngine } from './stt/WhisperEngine';
import { CopilotRefiner } from './llm/CopilotRefiner';
import { TextInserter } from './output/TextInserter';
import { getConfig } from './config/Settings';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const modelManager = new ModelManager(context.globalStorageUri.fsPath);
  const audioRecorder = new AudioRecorder();
  const whisperEngine = new WhisperEngine(modelManager);
  const copilotRefiner = new CopilotRefiner();
  const textInserter = new TextInserter();

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'sunyapper.toggleDictation';
  statusBarItem.text = '$(mic) SunYapper';
  statusBarItem.tooltip = 'Click to toggle dictation (Cmd+Shift+Y)';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Toggle dictation command
  context.subscriptions.push(
    vscode.commands.registerCommand('sunyapper.toggleDictation', () => {
      const panel = AudioPanel.createOrShow(
        context.extensionUri,
        audioRecorder,
        whisperEngine,
        copilotRefiner,
        textInserter
      );
      panel.toggleRecording();
    })
  );

  // Open panel command
  context.subscriptions.push(
    vscode.commands.registerCommand('sunyapper.openPanel', () => {
      AudioPanel.createOrShow(
        context.extensionUri,
        audioRecorder,
        whisperEngine,
        copilotRefiner,
        textInserter
      );
    })
  );

  // Download model command
  context.subscriptions.push(
    vscode.commands.registerCommand('sunyapper.downloadModel', async () => {
      const models = modelManager.getAvailableModels();
      const items = models.map((m) => ({
        label: m.name,
        description: m.size,
        detail: m.downloaded ? 'Downloaded' : 'Not downloaded',
        downloaded: m.downloaded,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a Whisper model to download',
      });

      if (selected && !selected.downloaded) {
        try {
          await modelManager.downloadModel(selected.label);
          vscode.window.showInformationMessage(
            `SunYapper: ${selected.label} model downloaded successfully!`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`SunYapper: Download failed — ${msg}`);
        }
      } else if (selected?.downloaded) {
        vscode.window.showInformationMessage(
          `SunYapper: ${selected.label} model is already downloaded.`
        );
      }
    })
  );

  // Select model command
  context.subscriptions.push(
    vscode.commands.registerCommand('sunyapper.selectModel', async () => {
      const models = modelManager.getAvailableModels();
      const downloaded = models.filter((m) => m.downloaded);

      if (downloaded.length === 0) {
        const action = await vscode.window.showWarningMessage(
          'SunYapper: No models downloaded yet.',
          'Download Model'
        );
        if (action === 'Download Model') {
          vscode.commands.executeCommand('sunyapper.downloadModel');
        }
        return;
      }

      const selected = await vscode.window.showQuickPick(
        downloaded.map((m) => ({ label: m.name, description: m.size })),
        { placeHolder: 'Select active Whisper model' }
      );

      if (selected) {
        await vscode.workspace
          .getConfiguration('sunyapper')
          .update('whisperModel', selected.label, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          `SunYapper: Now using ${selected.label} model.`
        );
      }
    })
  );

  // First-use check
  const hasSeenWelcome = context.globalState.get<boolean>('sunyapper.welcomed');
  if (!hasSeenWelcome) {
    showWelcome(context, modelManager);
  }
}

async function showWelcome(
  context: vscode.ExtensionContext,
  modelManager: ModelManager
) {
  const config = getConfig();
  const action = await vscode.window.showInformationMessage(
    'Welcome to SunYapper! You need to download a Whisper model before dictating. Download now?',
    'Download Model',
    'Later'
  );

  if (action === 'Download Model') {
    try {
      await modelManager.downloadModel(config.whisperModel);
      vscode.window.showInformationMessage(
        `SunYapper: ${config.whisperModel} model ready! Press Cmd+Shift+Y to start dictating.`
      );
    } catch {
      // User cancelled or download failed — they can try again later
    }
  }

  context.globalState.update('sunyapper.welcomed', true);
}

export function deactivate() {
  // cleanup handled by disposables
}

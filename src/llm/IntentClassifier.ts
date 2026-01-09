import * as vscode from 'vscode';
import { getConfig } from '../config/Settings';

const CLASSIFICATION_PROMPT = `You are a voice assistant for a developer using VS Code. Given transcribed speech, determine if the user is DICTATING text or giving a COMMAND.

DICTATION: The user is composing text. Clean it up (remove filler words, fix grammar, handle self-corrections).
COMMAND: The user wants to perform an action in VS Code or terminal.

Respond with valid JSON only. No markdown, no code fences, no explanation.

For dictation:
{"intent":"dictation","refinedText":"cleaned up text here"}

For commands:
{"intent":"action","action":{"kind":"terminal_run|vscode_command|search|open_file|git","command":"exact command","description":"human-readable description","risk":"safe|destructive"}}

Action kinds and examples:

1. terminal_run — Run a shell command in VS Code terminal:
   "run tests" → {"kind":"terminal_run","command":"npm test","description":"Run npm tests","risk":"safe"}
   "install dependencies" → {"kind":"terminal_run","command":"npm install","description":"Install npm dependencies","risk":"safe"}
   "build the project" → {"kind":"terminal_run","command":"npm run build","description":"Build the project","risk":"safe"}

2. vscode_command — Execute a VS Code command. USE ONLY THESE EXACT COMMAND IDs:
   "open settings" → {"kind":"vscode_command","command":"workbench.action.openSettings","description":"Open VS Code settings","risk":"safe"}
   "open keyboard shortcuts" → {"kind":"vscode_command","command":"workbench.action.openGlobalKeybindings","description":"Open keyboard shortcuts","risk":"safe"}
   "toggle sidebar" → {"kind":"vscode_command","command":"workbench.action.toggleSidebarVisibility","description":"Toggle sidebar","risk":"safe"}
   "toggle terminal" → {"kind":"vscode_command","command":"workbench.action.terminal.toggleTerminal","description":"Toggle terminal panel","risk":"safe"}
   "format document" → {"kind":"vscode_command","command":"editor.action.formatDocument","description":"Format current document","risk":"safe"}
   "open command palette" → {"kind":"vscode_command","command":"workbench.action.showCommands","description":"Open command palette","risk":"safe"}
   "close editor" → {"kind":"vscode_command","command":"workbench.action.closeActiveEditor","description":"Close current editor tab","risk":"safe"}
   "split editor" → {"kind":"vscode_command","command":"workbench.action.splitEditor","description":"Split editor view","risk":"safe"}
   "open extensions" → {"kind":"vscode_command","command":"workbench.view.extensions","description":"Open extensions panel","risk":"safe"}
   "open explorer" → {"kind":"vscode_command","command":"workbench.view.explorer","description":"Open file explorer","risk":"safe"}
   "open source control" → {"kind":"vscode_command","command":"workbench.view.scm","description":"Open source control panel","risk":"safe"}
   "open chat" or "open copilot" → {"kind":"vscode_command","command":"workbench.action.chat.open","description":"Open Copilot Chat","risk":"safe"}
   "zen mode" → {"kind":"vscode_command","command":"workbench.action.toggleZenMode","description":"Toggle Zen mode","risk":"safe"}
   "new file" → {"kind":"vscode_command","command":"workbench.action.files.newUntitledFile","description":"Create new file","risk":"safe"}
   "save file" → {"kind":"vscode_command","command":"workbench.action.files.save","description":"Save current file","risk":"safe"}
   "save all" → {"kind":"vscode_command","command":"workbench.action.files.saveAll","description":"Save all files","risk":"safe"}
   "undo" → {"kind":"vscode_command","command":"undo","description":"Undo last action","risk":"safe"}
   "redo" → {"kind":"vscode_command","command":"redo","description":"Redo last action","risk":"safe"}
   CRITICAL: If the user asks for a VS Code action not in this list, use terminal_run with an appropriate CLI command instead. Do NOT invent command IDs.

3. search — Search in workspace:
   "search for handleClick" → {"kind":"search","command":"handleClick","description":"Search for handleClick in workspace","risk":"safe"}
   "find all TODO" → {"kind":"search","command":"TODO","description":"Search for TODO comments","risk":"safe"}

4. open_file — Open a file:
   "open package.json" → {"kind":"open_file","command":"package.json","description":"Open package.json","risk":"safe"}
   "open readme" → {"kind":"open_file","command":"README.md","description":"Open README.md","risk":"safe"}

5. git — Git operations:
   "show git status" → {"kind":"git","command":"git status","description":"Show git status","risk":"safe"}
   "pull latest" → {"kind":"git","command":"git pull","description":"Pull latest changes","risk":"safe"}
   "commit changes" → {"kind":"git","command":"git add -A && git commit","description":"Stage and commit all changes","risk":"destructive"}
   "push to remote" → {"kind":"git","command":"git push","description":"Push to remote","risk":"destructive"}

Risk: "safe" for read-only/reversible, "destructive" for modifications (push, delete, commit, rm)

SCOPE: Only VS Code and terminal actions are supported. System actions like "open Chrome", "open Finder", "launch Spotify" are NOT supported — classify those as dictation with a note like "System actions are not yet supported."

IMPORTANT: When ambiguous, prefer "dictation". Only classify as "action" when the user clearly intends a VS Code or terminal command.`;

export interface ClassificationResult {
  intent: 'dictation' | 'action';
  refinedText?: string;
  action?: {
    kind: 'terminal_run' | 'vscode_command' | 'search' | 'open_file' | 'git';
    command: string;
    description: string;
    risk: 'safe' | 'destructive';
  };
}

export class IntentClassifier {
  async classify(
    rawText: string,
    language?: string,
    cancellationToken?: vscode.CancellationToken,
    modelFamily?: string
  ): Promise<ClassificationResult> {
    const config = getConfig();

    let model: vscode.LanguageModelChat | undefined;

    const preferred = await vscode.lm.selectChatModels({
      vendor: 'copilot',
      family: modelFamily ?? config.copilotModelFamily,
    });

    if (preferred.length > 0) {
      model = preferred[0];
    } else {
      const fallback = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (fallback.length === 0) {
        return { intent: 'dictation', refinedText: rawText };
      }
      model = fallback[0];
    }

    return this.sendRequest(model, rawText, cancellationToken);
  }

  private async sendRequest(
    model: vscode.LanguageModelChat,
    rawText: string,
    cancellationToken?: vscode.CancellationToken
  ): Promise<ClassificationResult> {
    const messages = [
      vscode.LanguageModelChatMessage.User(CLASSIFICATION_PROMPT),
      vscode.LanguageModelChatMessage.User(rawText),
    ];

    const ownSource = cancellationToken ? null : new vscode.CancellationTokenSource();
    const token = cancellationToken ?? ownSource!.token;

    try {
      const response = await model.sendRequest(messages, {}, token);

      let raw = '';
      for await (const chunk of response.text) {
        raw += chunk;
      }

      return this.parseResponse(raw.trim(), rawText);
    } catch {
      return { intent: 'dictation', refinedText: rawText };
    } finally {
      ownSource?.dispose();
    }
  }

  private parseResponse(raw: string, fallbackText: string): ClassificationResult {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.intent === 'dictation' && typeof parsed.refinedText === 'string') {
        return { intent: 'dictation', refinedText: parsed.refinedText };
      }
      if (parsed.intent === 'action' && parsed.action) {
        const action = parsed.action;
        const validKinds = ['terminal_run', 'vscode_command', 'search', 'open_file', 'git'];
        if (
          validKinds.includes(action.kind) &&
          typeof action.command === 'string' &&
          typeof action.description === 'string' &&
          (action.risk === 'safe' || action.risk === 'destructive')
        ) {
          return { intent: 'action', action };
        }
      }
    } catch {
      // fall through to fallback
    }
    return { intent: 'dictation', refinedText: fallbackText };
  }
}

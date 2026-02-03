import * as vscode from 'vscode';
import { getConfig } from '../config/Settings';

const CLASSIFICATION_PROMPT = `You are a voice assistant for a developer using VS Code. Given transcribed speech, determine if the user is DICTATING text or giving a COMMAND.

DICTATION: The user is composing text. Clean it up (remove filler words, fix grammar, handle self-corrections).
COMMAND: The user wants to perform an action in VS Code or terminal.

Respond with valid JSON only. No markdown, no explanation.

For dictation:
{"intent":"dictation","refinedText":"cleaned up text here"}

For commands:
{"intent":"action","action":{"kind":"terminal_run|vscode_command|search|open_file|git","command":"the actual command","description":"human-readable description","risk":"safe|destructive"}}

Action kinds:
- terminal_run: shell command (e.g., "npm test", "cargo build")
- vscode_command: VS Code command ID (e.g., "workbench.action.openSettings")
- search: search workspace (command = search query)
- open_file: open a file (command = filename or pattern)
- git: git operation (command = git command like "git commit -m 'message'")

Risk: "safe" for read-only/reversible, "destructive" for modifications (push, delete, rm)

IMPORTANT: When ambiguous, prefer "dictation". Only classify as "action" when the user clearly intends a command.`;

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

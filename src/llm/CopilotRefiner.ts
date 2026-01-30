import * as vscode from 'vscode';
import { getConfig } from '../config/Settings';

const REFINEMENT_PROMPT = `You are a text refinement assistant. Clean up this dictated text:
- Remove filler words (um, uh, like, you know, so, basically)
- Fix grammar, spelling, and punctuation
- Maintain the speaker's intent, meaning, and tone exactly
- Do not add or remove ideas — only clean up the language
- Format appropriately (sentences, paragraphs)

Return ONLY the refined text. No explanations, no quotes, no prefixes.`;

export class CopilotRefiner {
  async refine(rawText: string, cancellationToken?: vscode.CancellationToken): Promise<string> {
    const config = getConfig();

    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',
      family: config.copilotModelFamily,
    });

    if (models.length === 0) {
      // Fall back to any available copilot model
      const fallbackModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (fallbackModels.length === 0) {
        throw new Error(
          'No Copilot language models available. Make sure GitHub Copilot is installed and signed in.'
        );
      }
      return this.sendRequest(fallbackModels[0], rawText, cancellationToken);
    }

    return this.sendRequest(models[0], rawText, cancellationToken);
  }

  private async sendRequest(
    model: vscode.LanguageModelChat,
    rawText: string,
    cancellationToken?: vscode.CancellationToken
  ): Promise<string> {
    const messages = [
      vscode.LanguageModelChatMessage.User(REFINEMENT_PROMPT),
      vscode.LanguageModelChatMessage.User(rawText),
    ];

    const token = cancellationToken ?? new vscode.CancellationTokenSource().token;
    const response = await model.sendRequest(messages, {}, token);

    let refined = '';
    for await (const chunk of response.text) {
      refined += chunk;
    }

    return refined.trim();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      return models.length > 0;
    } catch {
      return false;
    }
  }
}

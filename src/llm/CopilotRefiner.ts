import * as vscode from 'vscode';
import { getConfig } from '../config/Settings';

const REFINE_ONLY_PROMPT = `You are a text refinement assistant. Clean up this dictated text:
- Remove filler words (um, uh, like, you know, so, basically)
- Fix grammar, spelling, and punctuation
- Maintain the speaker's intent, meaning, and tone exactly
- Do not add or remove ideas — only clean up the language
- Format appropriately (sentences, paragraphs)

Return ONLY the refined text. No explanations, no quotes, no prefixes.`;

const TRANSLATE_AND_REFINE_PROMPT = `You are a translation and text refinement assistant. The following text was dictated in a non-English language. Your job:
1. Translate it accurately into English
2. Remove filler words and verbal tics
3. Fix grammar, spelling, and punctuation
4. Maintain the speaker's intent, meaning, and tone exactly
5. Do not add or remove ideas

Return ONLY the final English text. No explanations, no quotes, no prefixes, no "Translation:" labels.`;

export class CopilotRefiner {
  async refine(rawText: string, language?: string, cancellationToken?: vscode.CancellationToken): Promise<string> {
    const config = getConfig();
    const lang = language || config.language;

    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',
      family: config.copilotModelFamily,
    });

    if (models.length === 0) {
      const fallbackModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (fallbackModels.length === 0) {
        throw new Error(
          'No Copilot language models available. Make sure GitHub Copilot is installed and signed in.'
        );
      }
      return this.sendRequest(fallbackModels[0], rawText, lang, cancellationToken);
    }

    return this.sendRequest(models[0], rawText, lang, cancellationToken);
  }

  private async sendRequest(
    model: vscode.LanguageModelChat,
    rawText: string,
    language: string,
    cancellationToken?: vscode.CancellationToken
  ): Promise<string> {
    // Use translation prompt for non-English, refinement-only for English
    const needsTranslation = language !== 'en';
    const prompt = needsTranslation ? TRANSLATE_AND_REFINE_PROMPT : REFINE_ONLY_PROMPT;

    const messages = [
      vscode.LanguageModelChatMessage.User(prompt),
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

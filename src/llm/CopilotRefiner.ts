import * as vscode from 'vscode';
import { getConfig } from '../config/Settings';

const REFINEMENT_PROMPT = `You are a professional text editor. Your ONLY job is to clean up dictated speech into polished written English. Follow these rules strictly:

1. REMOVE all filler words: um, uh, like, you know, so, basically, actually, literally, right, I mean, kind of, sort of
2. REMOVE false starts and self-corrections (keep only the final intended version)
3. FIX grammar, spelling, punctuation, and capitalization
4. SPLIT run-on sentences into clear, well-structured sentences
5. PRESERVE the speaker's exact meaning, tone, and intent — do not add, remove, or rephrase ideas
6. FORMAT into proper paragraphs where natural breaks occur
7. If the input appears to be a mix of English and another language, output everything in clean English

CRITICAL: Return ONLY the cleaned text. No explanations, no "Here is the refined text:", no quotes, no markdown formatting. Just the clean text.`;

export class CopilotRefiner {
  async refine(rawText: string, language?: string, cancellationToken?: vscode.CancellationToken): Promise<string> {
    const config = getConfig();

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

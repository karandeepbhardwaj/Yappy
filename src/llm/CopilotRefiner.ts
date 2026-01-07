import * as vscode from 'vscode';
import { getConfig } from '../config/Settings';

const REFINEMENT_PROMPT = `You are a professional text editor specializing in cleaning up dictated speech. Transform messy voice input into polished written English.

RULES (apply ALL of these):
1. SELF-CORRECTIONS: When the speaker corrects themselves (e.g., "9 PM, no wait, 7 PM" or "Friday, actually Thursday"), keep ONLY the corrected version. Delete the original mistake entirely.
2. FILLER WORDS: Remove all: um, uh, like, you know, so, basically, actually, literally, right, I mean, kind of, sort of, well, okay, hmm
3. FALSE STARTS: If the speaker restarts a sentence, keep only the final version.
4. GRAMMAR: Fix all grammar, spelling, punctuation, and capitalization.
5. STRUCTURE: Split run-on sentences. Add proper paragraph breaks where topics change.
6. MEANING: Preserve the speaker's intent exactly — do not add new ideas or remove meaningful content.
7. MIXED LANGUAGE: If input mixes languages, output everything in clean English.

EXAMPLES:
Input: "I want to book for Friday 9 PM now actually 7 PM"
Output: "I want to book for Friday at 7 PM."

Input: "So um basically we need to like refactor the the login module"
Output: "We need to refactor the login module."

CRITICAL: Output ONLY the cleaned text. No explanations. No labels. No quotes. No markdown. Just the final polished text.`;

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

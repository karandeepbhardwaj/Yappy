import { execFile } from 'child_process';
import { ModelManager } from './ModelManager';
import { getBinaryPath } from '../binaries';

export class WhisperEngine {
  private modelManager: ModelManager;
  private extensionPath: string;

  constructor(modelManager: ModelManager, extensionPath: string) {
    this.modelManager = modelManager;
    this.extensionPath = extensionPath;
  }

  async transcribe(audioFilePath: string, model: string, language: string): Promise<string> {
    const modelPath = this.modelManager.getModelPath(model);
    if (!this.modelManager.isModelAvailable(model)) {
      throw new Error(`Model "${model}" not available. Run "SunYapper: Download Whisper Model" first.`);
    }

    const cmd = getBinaryPath('whisper-cli', this.extensionPath);

    // Build args: force language detection + translate non-English to English
    const args = ['-m', modelPath, '-np', '-nt'];

    if (language && language !== 'auto') {
      args.push('-l', language);
    }

    // For non-English: use whisper's built-in translate-to-English mode
    // This is far more accurate than LLM translation after the fact
    if (language !== 'en') {
      args.push('-tr');
    }

    args.push('-f', audioFilePath);

    return new Promise<string>((resolve, reject) => {
      execFile(cmd, args,
        { timeout: 120000 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Transcription failed: ${stderr || error.message}`));
            return;
          }
          resolve(stdout.trim());
        }
      );
    });
  }
}

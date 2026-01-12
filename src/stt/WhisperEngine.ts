import { execFile } from 'child_process';
import { ModelManager } from './ModelManager';

export class WhisperEngine {
  private modelManager: ModelManager;

  constructor(modelManager: ModelManager) {
    this.modelManager = modelManager;
  }

  async transcribe(audioFilePath: string, model: string, language: string): Promise<string> {
    const modelPath = this.modelManager.getModelPath(model);
    if (!this.modelManager.isModelDownloaded(model)) {
      throw new Error(`Model "${model}" not downloaded. Run "SunYapper: Download Whisper Model" first.`);
    }

    // Use whisper-cli (from brew install whisper-cpp) or whisper-cpp
    const cmd = await this.findWhisperBinary();

    return new Promise<string>((resolve, reject) => {
      const args = [
        '-m', modelPath,
        '-l', language,
        '-np',         // no prints except results
        '-nt',         // no timestamps
        '-f', audioFilePath,
      ];

      execFile(cmd, args, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          // Check if it's a "not found" error
          if (error.message.includes('ENOENT')) {
            reject(new Error(
              'whisper-cli not found. Install it: brew install whisper-cpp (macOS) or build from https://github.com/ggerganov/whisper.cpp'
            ));
            return;
          }
          reject(new Error(`Whisper transcription failed: ${stderr || error.message}`));
          return;
        }

        const text = stdout.trim();
        resolve(text);
      });
    });
  }

  private async findWhisperBinary(): Promise<string> {
    // Try common binary names in order
    const candidates = ['whisper-cli', 'whisper-cpp', 'main'];

    for (const name of candidates) {
      const found = await this.commandExists(name);
      if (found) return name;
    }

    throw new Error(
      'whisper-cli not found. Install it:\n  macOS: brew install whisper-cpp\n  Build from source: https://github.com/ggerganov/whisper.cpp'
    );
  }

  private commandExists(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
      const which = process.platform === 'win32' ? 'where' : 'which';
      execFile(which, [cmd], (error) => {
        resolve(!error);
      });
    });
  }
}

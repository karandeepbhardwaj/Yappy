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

    const cmd = await this.findBinary();

    return new Promise<string>((resolve, reject) => {
      execFile(cmd, ['-m', modelPath, '-l', language, '-np', '-nt', '-f', audioFilePath],
        { timeout: 120000 },
        (error, stdout, stderr) => {
          if (error) {
            if (error.message.includes('ENOENT')) {
              reject(new Error('whisper-cli not found. Install: brew install whisper-cpp'));
              return;
            }
            reject(new Error(`Transcription failed: ${stderr || error.message}`));
            return;
          }
          resolve(stdout.trim());
        }
      );
    });
  }

  private async findBinary(): Promise<string> {
    for (const name of ['whisper-cli', 'whisper-cpp', 'main']) {
      if (await this.exists(name)) return name;
    }
    throw new Error('whisper-cli not found. Install: brew install whisper-cpp');
  }

  private exists(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], (err) => resolve(!err));
    });
  }
}

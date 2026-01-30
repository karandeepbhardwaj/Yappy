import { ModelManager } from './ModelManager';

// whisper-node-addon types (loaded dynamically to handle missing native binary gracefully)
interface WhisperAddon {
  whisper: (params: {
    language: string;
    model: string;
    fname_inp: string;
  }) => Promise<Array<[number, number, string]>>;
}

export class WhisperEngine {
  private modelManager: ModelManager;
  private addon: WhisperAddon | null = null;

  constructor(modelManager: ModelManager) {
    this.modelManager = modelManager;
  }

  private getAddon(): WhisperAddon {
    if (!this.addon) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.addon = require('@kutalia/whisper-node-addon') as WhisperAddon;
      } catch (err) {
        throw new Error(
          'Failed to load whisper-node-addon. Make sure native dependencies are installed: npm install'
        );
      }
    }
    return this.addon;
  }

  async transcribe(audioFilePath: string, model: string, language: string): Promise<string> {
    const modelPath = this.modelManager.getModelPath(model);
    if (!this.modelManager.isModelDownloaded(model)) {
      throw new Error(`Model "${model}" not downloaded. Run "SunYapper: Download Whisper Model" first.`);
    }

    const addon = this.getAddon();
    const result = await addon.whisper({
      language,
      model: modelPath,
      fname_inp: audioFilePath,
    });

    // result is array of [startTime, endTime, text] segments
    return result.map(([, , text]) => text.trim()).join(' ').trim();
  }
}

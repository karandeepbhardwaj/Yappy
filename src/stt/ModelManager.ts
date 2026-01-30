import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const MODEL_URLS: Record<string, string> = {
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
};

const MODEL_SIZES: Record<string, string> = {
  tiny: '~75 MB',
  base: '~142 MB',
  small: '~466 MB',
};

export class ModelManager {
  private modelsDir: string;

  constructor(globalStoragePath: string) {
    this.modelsDir = path.join(globalStoragePath, 'models');
    if (!fs.existsSync(this.modelsDir)) {
      fs.mkdirSync(this.modelsDir, { recursive: true });
    }
  }

  getModelPath(model: string): string {
    return path.join(this.modelsDir, `ggml-${model}.bin`);
  }

  isModelDownloaded(model: string): boolean {
    return fs.existsSync(this.getModelPath(model));
  }

  getAvailableModels(): { name: string; downloaded: boolean; size: string }[] {
    return Object.keys(MODEL_URLS).map(name => ({
      name,
      downloaded: this.isModelDownloaded(name),
      size: MODEL_SIZES[name],
    }));
  }

  async downloadModel(model: string): Promise<string> {
    const url = MODEL_URLS[model];
    if (!url) {
      throw new Error(`Unknown model: ${model}`);
    }

    const destPath = this.getModelPath(model);
    if (fs.existsSync(destPath)) {
      return destPath;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `SunYapper: Downloading ${model} model (${MODEL_SIZES[model]})...`,
        cancellable: true,
      },
      async (progress, token) => {
        return new Promise<string>((resolve, reject) => {
          const tmpPath = destPath + '.tmp';
          const file = fs.createWriteStream(tmpPath);

          const request = (urlStr: string) => {
            https.get(urlStr, { headers: { 'User-Agent': 'SunYapper' } }, (response) => {
              if (response.statusCode === 302 || response.statusCode === 301) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                  request(redirectUrl);
                  return;
                }
              }

              if (response.statusCode !== 200) {
                reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                return;
              }

              const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
              let downloadedBytes = 0;

              response.on('data', (chunk: Buffer) => {
                downloadedBytes += chunk.length;
                if (totalBytes > 0) {
                  const pct = Math.round((downloadedBytes / totalBytes) * 100);
                  progress.report({ increment: chunk.length / totalBytes * 100, message: `${pct}%` });
                }
              });

              response.pipe(file);

              file.on('finish', () => {
                file.close();
                fs.renameSync(tmpPath, destPath);
                resolve(destPath);
              });

              token.onCancellationRequested(() => {
                response.destroy();
                file.close();
                if (fs.existsSync(tmpPath)) {
                  fs.unlinkSync(tmpPath);
                }
                reject(new Error('Download cancelled'));
              });
            }).on('error', (err) => {
              file.close();
              if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
              }
              reject(err);
            });
          };

          request(url);
        });
      }
    );
  }
}

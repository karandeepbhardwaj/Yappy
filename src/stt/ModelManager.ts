import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// Multiple mirrors — tries each in order until one succeeds
const MODEL_MIRRORS: Record<string, string[]> = {
  tiny: [
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    'https://cdn-lfs.hf.co/repos/39/06/3906b8c47b9e1dac279f48f1b6e09c6cfa985c7e0e75a750c7feaf664a9c0cf3/be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21?response-content-disposition=attachment%3B+filename*%3DUTF-8%27%27ggml-tiny.bin',
    'https://ggml.ggerganov.com/ggml-model-whisper-tiny.bin',
  ],
  base: [
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    'https://cdn-lfs.hf.co/repos/39/06/3906b8c47b9e1dac279f48f1b6e09c6cfa985c7e0e75a750c7feaf664a9c0cf3/60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe?response-content-disposition=attachment%3B+filename*%3DUTF-8%27%27ggml-base.bin',
    'https://ggml.ggerganov.com/ggml-model-whisper-base.bin',
  ],
  small: [
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    'https://cdn-lfs.hf.co/repos/39/06/3906b8c47b9e1dac279f48f1b6e09c6cfa985c7e0e75a750c7feaf664a9c0cf3/1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1571c230d4?response-content-disposition=attachment%3B+filename*%3DUTF-8%27%27ggml-small.bin',
    'https://ggml.ggerganov.com/ggml-model-whisper-small.bin',
  ],
};

// Primary URL for backward compat
const MODEL_URLS: Record<string, string> = {
  tiny: MODEL_MIRRORS.tiny[0],
  base: MODEL_MIRRORS.base[0],
  small: MODEL_MIRRORS.small[0],
};

const MODEL_SIZES: Record<string, string> = {
  tiny: '~75 MB',
  base: '~142 MB',
  small: '~466 MB',
};

export class ModelManager {
  public readonly modelsDir: string;
  private readonly bundledModelsDir: string;

  constructor(globalStoragePath: string, extensionPath: string) {
    this.modelsDir = path.join(globalStoragePath, 'models');
    this.bundledModelsDir = path.join(extensionPath, 'models');
    if (!fs.existsSync(this.modelsDir)) {
      fs.mkdirSync(this.modelsDir, { recursive: true });
    }
  }

  getModelPath(model: string): string {
    // 1. Check user-downloaded models first (better quality choices)
    const downloaded = path.join(this.modelsDir, `ggml-${model}.bin`);
    if (fs.existsSync(downloaded)) {
      return downloaded;
    }

    // 2. Check bundled models (fallback for air-gapped machines)
    const bundled = path.join(this.bundledModelsDir, `ggml-${model}.bin`);
    if (fs.existsSync(bundled)) {
      return bundled;
    }

    // 3. Return the download path (caller should check isModelAvailable first)
    return downloaded;
  }

  /** Returns true if the model exists either downloaded or bundled */
  isModelAvailable(model: string): boolean {
    const downloaded = path.join(this.modelsDir, `ggml-${model}.bin`);
    const bundled = path.join(this.bundledModelsDir, `ggml-${model}.bin`);
    return fs.existsSync(downloaded) || fs.existsSync(bundled);
  }

  /** Returns true only if the model was explicitly downloaded by the user */
  isModelDownloaded(model: string): boolean {
    return fs.existsSync(path.join(this.modelsDir, `ggml-${model}.bin`));
  }

  /** Returns the name of any available model, preferring the configured one */
  findAnyAvailableModel(preferred: string): string | null {
    if (this.isModelAvailable(preferred)) return preferred;
    // Fall back to any available model
    for (const name of ['tiny', 'base', 'small']) {
      if (this.isModelAvailable(name)) return name;
    }
    return null;
  }

  getAvailableModels(): { name: string; available: boolean; bundled: boolean; downloaded: boolean; size: string }[] {
    return Object.keys(MODEL_URLS).map(name => {
      const downloaded = this.isModelDownloaded(name);
      const bundled = fs.existsSync(path.join(this.bundledModelsDir, `ggml-${name}.bin`));
      return {
        name,
        available: downloaded || bundled,
        bundled,
        downloaded,
        size: MODEL_SIZES[name],
      };
    });
  }

  async downloadModel(model: string): Promise<string> {
    const mirrors = MODEL_MIRRORS[model];
    if (!mirrors || mirrors.length === 0) {
      throw new Error(`Unknown model: ${model}`);
    }

    const destPath = path.join(this.modelsDir, `ggml-${model}.bin`);
    if (fs.existsSync(destPath)) {
      return destPath;
    }

    // Try each mirror in order
    const errors: string[] = [];
    for (let i = 0; i < mirrors.length; i++) {
      const mirrorUrl = mirrors[i];
      const mirrorLabel = i === 0 ? '' : ` (mirror ${i + 1}/${mirrors.length})`;
      try {
        return await this.downloadFromUrl(model, mirrorUrl, destPath, mirrorLabel);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Mirror ${i + 1}: ${msg}`);
        // Continue to next mirror
      }
    }

    throw new Error(`All download mirrors failed for ${model} model:\n${errors.join('\n')}`);
  }

  private async downloadFromUrl(model: string, url: string, destPath: string, mirrorLabel: string): Promise<string> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `yapper: Downloading ${model} model (${MODEL_SIZES[model]})${mirrorLabel}...`,
        cancellable: true,
      },
      async (progress, token) => {
        return new Promise<string>((resolve, reject) => {
          const tmpPath = destPath + '.tmp';
          const file = fs.createWriteStream(tmpPath);

          const request = (urlStr: string) => {
            https.get(urlStr, { headers: { 'User-Agent': 'yapper' } }, (response) => {
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

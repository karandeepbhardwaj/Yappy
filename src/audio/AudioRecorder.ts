import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getBinaryPath } from '../binaries';

export class AudioRecorder {
  private process: ChildProcess | null = null;
  private outputPath: string | null = null;
  private _isRecording = false;
  private errorMessage: string | null = null;
  private extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  isRecording(): boolean {
    return this._isRecording;
  }

  start(): void {
    if (this._isRecording) return;

    this.errorMessage = null;
    this.outputPath = path.join(os.tmpdir(), `yapper_${Date.now()}.wav`);

    const isWin = process.platform === 'win32';
    const cmd = getBinaryPath(isWin ? 'sox' : 'rec', this.extensionPath);

    const args = isWin
      ? ['-d', '-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer', this.outputPath]
      : ['-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer', this.outputPath];

    this.process = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.process.on('error', (err) => {
      this._isRecording = false;
      this.errorMessage = err.message;
    });

    this._isRecording = true;
  }

  async stop(): Promise<string | null> {
    if (!this._isRecording || !this.process) return null;

    this._isRecording = false;
    const proc = this.process;
    const outPath = this.outputPath;
    this.process = null;
    this.outputPath = null;

    await new Promise<void>((resolve) => {
      proc.on('close', () => resolve());
      if (process.platform === 'win32') {
        proc.stdin?.end();
      } else {
        proc.kill('SIGINT');
      }
      setTimeout(() => resolve(), 3000);
    });

    if (this.errorMessage) {
      throw new Error(this.errorMessage);
    }

    if (outPath && fs.existsSync(outPath)) {
      const stats = fs.statSync(outPath);
      if (stats.size > 44) {
        return outPath;
      }
      try { fs.unlinkSync(outPath); } catch { /* ignore */ }
    }

    return null;
  }
}

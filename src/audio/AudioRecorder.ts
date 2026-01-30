import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class AudioRecorder {
  private process: ChildProcess | null = null;
  private outputPath: string | null = null;
  private _isRecording = false;
  private errorMessage: string | null = null;

  isRecording(): boolean {
    return this._isRecording;
  }

  start(): void {
    if (this._isRecording) return;

    this.errorMessage = null;
    this.outputPath = path.join(os.tmpdir(), `sunyapper_${Date.now()}.wav`);

    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'sox' : 'rec';
    const args = isWin
      ? ['-d', '-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer', this.outputPath]
      : ['-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer', this.outputPath];

    this.process = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.process.on('error', (err) => {
      this._isRecording = false;
      this.errorMessage = err.message.includes('ENOENT')
        ? 'sox not found. Install it: brew install sox (macOS) or choco install sox (Windows)'
        : err.message;
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
      proc.kill('SIGINT');
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

  /** Read a WAV file and return PCM Int16 samples as a number array */
  static readWavAsInt16(wavPath: string): number[] {
    const buf = fs.readFileSync(wavPath);
    // Skip 44-byte WAV header, read Int16LE samples
    const pcm: number[] = [];
    for (let i = 44; i < buf.length - 1; i += 2) {
      pcm.push(buf.readInt16LE(i));
    }
    return pcm;
  }
}

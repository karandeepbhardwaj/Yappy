import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface PortAudioStream {
  start(): void;
  quit(): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  read(): Buffer | null;
}

interface Naudiodon {
  AudioIO(opts: {
    inOptions: {
      channelCount: number;
      sampleFormat: number;
      sampleRate: number;
      deviceId: number;
    };
  }): PortAudioStream;
  SampleFormat16Bit: number;
  getDevices(): Array<{
    id: number;
    name: string;
    maxInputChannels: number;
    maxOutputChannels: number;
    defaultSampleRate: number;
  }>;
}

export class AudioRecorder {
  private portAudio: Naudiodon | null = null;
  private stream: PortAudioStream | null = null;
  private chunks: Buffer[] = [];
  private recording = false;
  private sampleRate = 16000;

  private getPortAudio(): Naudiodon {
    if (!this.portAudio) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.portAudio = require('naudiodon') as Naudiodon;
      } catch (err) {
        throw new Error(
          'Failed to load naudiodon. Ensure native dependencies are installed: npm install'
        );
      }
    }
    return this.portAudio;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getInputDevices(): Array<{ id: number; name: string }> {
    const pa = this.getPortAudio();
    return pa
      .getDevices()
      .filter((d) => d.maxInputChannels > 0)
      .map((d) => ({ id: d.id, name: d.name }));
  }

  start(): void {
    if (this.recording) return;

    const pa = this.getPortAudio();
    this.chunks = [];

    this.stream = pa.AudioIO({
      inOptions: {
        channelCount: 1,
        sampleFormat: pa.SampleFormat16Bit,
        sampleRate: this.sampleRate,
        deviceId: -1, // default device
      },
    });

    this.stream.on('data', (buf: unknown) => {
      if (Buffer.isBuffer(buf)) {
        this.chunks.push(buf);
      }
    });

    this.stream.on('error', (err: unknown) => {
      console.error('AudioRecorder error:', err);
    });

    this.stream.start();
    this.recording = true;
  }

  stop(): string | null {
    if (!this.recording || !this.stream) return null;

    this.stream.quit();
    this.recording = false;

    if (this.chunks.length === 0) return null;

    // Combine all PCM chunks
    const pcmData = Buffer.concat(this.chunks);
    this.chunks = [];

    // Write as WAV file
    const wavPath = path.join(os.tmpdir(), `sunyapper_${Date.now()}.wav`);
    const wavBuffer = this.pcmToWav(pcmData, this.sampleRate, 1, 16);
    fs.writeFileSync(wavPath, wavBuffer);

    this.stream = null;
    return wavPath;
  }

  /**
   * Convert raw PCM data to WAV format
   */
  private pcmToWav(
    pcmData: Buffer,
    sampleRate: number,
    channels: number,
    bitsPerSample: number
  ): Buffer {
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const dataSize = pcmData.length;
    const headerSize = 44;

    const buffer = Buffer.alloc(headerSize + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt sub-chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // sub-chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcmData.copy(buffer, headerSize);

    return buffer;
  }

  /**
   * Get audio level (RMS) from recent buffer for waveform visualization
   */
  getCurrentLevel(): number {
    if (this.chunks.length === 0) return 0;
    const lastChunk = this.chunks[this.chunks.length - 1];
    let sum = 0;
    const samples = lastChunk.length / 2; // 16-bit = 2 bytes per sample
    for (let i = 0; i < lastChunk.length; i += 2) {
      const sample = lastChunk.readInt16LE(i) / 32768;
      sum += sample * sample;
    }
    return Math.sqrt(sum / samples);
  }
}

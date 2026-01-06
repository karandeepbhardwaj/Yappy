import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

/** Resolves the path to a bundled or system binary */
export function getBinaryPath(name: string, extensionPath: string): string {
  // 1. Check bundled binary first
  const platform = process.platform;
  const arch = process.arch;
  const platformKey = `${platform}-${arch}`;
  const ext = platform === 'win32' ? '.exe' : '';
  const bundled = path.join(extensionPath, 'bin', platformKey, `${name}${ext}`);

  if (fs.existsSync(bundled)) {
    return bundled;
  }

  // 2. Fall back to system PATH
  try {
    const which = platform === 'win32' ? 'where' : 'which';
    const systemPath = execFileSync(which, [name], { encoding: 'utf-8' }).trim();
    if (systemPath) return systemPath;
  } catch {
    // not found on PATH
  }

  const installHint = platform === 'win32'
    ? `download from https://github.com/ggml-org/whisper.cpp/releases (whisper-cli) or https://sourceforge.net/projects/sox/ (sox)`
    : `brew install ${name === 'rec' ? 'sox' : 'whisper-cpp'}`;
  throw new Error(
    `"${name}" not found. Either bundle it (npm run download-binaries) or install: ${installHint}`
  );
}

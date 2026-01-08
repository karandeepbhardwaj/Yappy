#!/usr/bin/env node
// Bundles sox/rec and whisper-cli as Tauri sidecars + downloads the base model.
// Tauri sidecars must be named: <name>-<target-triple>[.exe]
// Run: node scripts/bundle-sidecars.js

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SIDECAR_DIR = path.join(__dirname, '..', 'src-tauri', 'binaries');
const RESOURCE_DIR = path.join(__dirname, '..', 'src-tauri', 'resources', 'models');
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

function getTargetTriple() {
  const out = execSync('rustc -vV', { encoding: 'utf-8' });
  const match = out.match(/host: (.+)/);
  return match ? match[1].trim() : null;
}

function which(cmd) {
  try { return execSync(`which ${cmd}`, { encoding: 'utf-8' }).trim(); }
  catch { return null; }
}

function copyBinary(src, dest) {
  const real = fs.realpathSync(src);
  fs.copyFileSync(real, dest);
  fs.chmodSync(dest, 0o755);
}

function bundleWhisper(triple) {
  const dest = path.join(SIDECAR_DIR, `whisper-cli-${triple}`);
  if (fs.existsSync(dest)) { console.log('  whisper-cli: already bundled'); return; }

  const src = which('whisper-cli');
  if (!src) { console.log('  WARNING: whisper-cli not found (brew install whisper-cpp)'); return; }

  copyBinary(src, dest);

  // Copy dylibs
  const libDir = path.join(SIDECAR_DIR, 'lib');
  if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });

  const otool = execSync(`otool -L "${dest}"`, { encoding: 'utf-8' });
  const rpathLibs = otool.match(/@rpath\/[^\s]+/g) || [];

  const brewPrefix = execSync('brew --prefix whisper-cpp', { encoding: 'utf-8' }).trim();
  const brewLib = path.join(brewPrefix, 'libexec', 'lib');

  for (const ref of rpathLibs) {
    const name = ref.replace('@rpath/', '');
    const srcLib = path.join(brewLib, name);
    if (fs.existsSync(srcLib)) {
      const destLib = path.join(libDir, name);
      fs.copyFileSync(fs.realpathSync(srcLib), destLib);
      fs.chmodSync(destLib, 0o755);
      execSync(`install_name_tool -change "${ref}" "@executable_path/lib/${name}" "${dest}"`, { stdio: 'pipe' });

      // Fix lib's own rpath references
      const libOtool = execSync(`otool -L "${destLib}"`, { encoding: 'utf-8' });
      for (const lr of (libOtool.match(/@rpath\/[^\s]+/g) || [])) {
        const ln = lr.replace('@rpath/', '');
        try { execSync(`install_name_tool -change "${lr}" "@executable_path/lib/${ln}" "${destLib}"`, { stdio: 'pipe' }); }
        catch {}
      }
    }
  }

  // Copy Metal resources
  for (const f of ['ggml-metal.metal', 'default.metallib']) {
    const src2 = path.join(brewLib, f);
    if (fs.existsSync(src2)) fs.copyFileSync(src2, path.join(libDir, f));
  }

  // Ad-hoc sign everything
  execSync(`codesign -f -s - "${dest}"`, { stdio: 'pipe' });
  for (const f of fs.readdirSync(libDir).filter(x => x.endsWith('.dylib'))) {
    execSync(`codesign -f -s - "${path.join(libDir, f)}"`, { stdio: 'pipe' });
  }

  console.log('  whisper-cli: bundled with ' + rpathLibs.length + ' dylibs');
}

function bundleSox(triple) {
  const dest = path.join(SIDECAR_DIR, `rec-${triple}`);
  if (fs.existsSync(dest)) { console.log('  rec: already bundled'); return; }

  const src = which('rec');
  if (!src) { console.log('  WARNING: rec not found (brew install sox)'); return; }

  copyBinary(src, dest);
  execSync(`codesign -f -s - "${dest}"`, { stdio: 'pipe' });
  console.log('  rec: bundled');
}

function downloadModel() {
  const dest = path.join(RESOURCE_DIR, 'ggml-base.bin');
  if (fs.existsSync(dest)) { console.log('  ggml-base.bin: already downloaded'); return; }

  if (!fs.existsSync(RESOURCE_DIR)) fs.mkdirSync(RESOURCE_DIR, { recursive: true });

  console.log('  Downloading ggml-base.bin (~142MB)...');
  try {
    execSync(`curl -L --progress-bar -o "${dest}" "${MODEL_URL}"`, { stdio: 'inherit', timeout: 600000 });
    const size = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`  ggml-base.bin: downloaded (${size} MB)`);
  } catch (err) {
    console.log('  WARNING: Model download failed. Users will need to download manually.');
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }
}

function downloadAndExtract(url, destDir, label) {
  const zipPath = path.join(destDir, '_download.zip');
  console.log(`  Downloading ${label}...`);
  try {
    execSync(`curl -L -o "${zipPath}" "${url}"`, { stdio: 'inherit', timeout: 180000 });
    // Use PowerShell on Windows for extraction
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`, { stdio: 'pipe' });
    } else {
      execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'pipe' });
    }
    fs.unlinkSync(zipPath);
    console.log(`  ${label} downloaded`);
    return true;
  } catch (err) {
    console.log(`  WARNING: Failed to download ${label}: ${err.message}`);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    return false;
  }
}

function bundleWhisperWindows(triple) {
  const dest = path.join(SIDECAR_DIR, `whisper-cli-${triple}.exe`);
  if (fs.existsSync(dest)) { console.log('  whisper-cli: already bundled'); return; }

  // Check pre-downloaded binaries first
  const BIN_DIR = path.join(__dirname, '..', '..', 'bin', 'win32-x64');
  let srcDir = BIN_DIR;

  if (!fs.existsSync(path.join(BIN_DIR, 'whisper-cli.exe'))) {
    // Download directly into sidecar dir
    console.log('  whisper-cli not pre-downloaded, fetching...');
    const tmpDir = path.join(SIDECAR_DIR, '_whisper_tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    if (!downloadAndExtract('https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip', tmpDir, 'whisper-cli')) return;
    srcDir = tmpDir;
  }

  // Find whisper-cli.exe (might be in a subdirectory)
  const candidates = [
    path.join(srcDir, 'whisper-cli.exe'),
    ...fs.readdirSync(srcDir).filter(f => fs.statSync(path.join(srcDir, f)).isDirectory()).map(d => path.join(srcDir, d, 'whisper-cli.exe'))
  ].filter(f => fs.existsSync(f));

  if (candidates.length === 0) {
    console.log('  WARNING: whisper-cli.exe not found after download');
    return;
  }

  const whisperDir = path.dirname(candidates[0]);
  fs.copyFileSync(candidates[0], dest);

  // Copy DLLs
  const dlls = fs.readdirSync(whisperDir).filter(f => f.endsWith('.dll'));
  for (const dll of dlls) {
    fs.copyFileSync(path.join(whisperDir, dll), path.join(SIDECAR_DIR, dll));
    console.log(`  copied DLL: ${dll}`);
  }

  // Cleanup tmp
  if (srcDir !== BIN_DIR) fs.rmSync(srcDir, { recursive: true, force: true });
  console.log('  whisper-cli: bundled');
}

function bundleSoxWindows(triple) {
  const dest = path.join(SIDECAR_DIR, `rec-${triple}.exe`);
  if (fs.existsSync(dest)) { console.log('  rec (sox): already bundled'); return; }

  const BIN_DIR = path.join(__dirname, '..', '..', 'bin', 'win32-x64');
  let srcDir = BIN_DIR;

  if (!fs.existsSync(path.join(BIN_DIR, 'sox.exe'))) {
    console.log('  sox not pre-downloaded, fetching...');
    const tmpDir = path.join(SIDECAR_DIR, '_sox_tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    if (!downloadAndExtract('https://sourceforge.net/projects/sox/files/sox/14.4.2/sox-14.4.2-win32.zip', tmpDir, 'sox')) return;
    srcDir = tmpDir;
  }

  // Find sox.exe (might be in sox-14.4.2/ subdirectory)
  const candidates = [
    path.join(srcDir, 'sox.exe'),
    ...fs.readdirSync(srcDir).filter(f => { try { return fs.statSync(path.join(srcDir, f)).isDirectory(); } catch { return false; } }).map(d => path.join(srcDir, d, 'sox.exe'))
  ].filter(f => fs.existsSync(f));

  if (candidates.length === 0) {
    console.log('  WARNING: sox.exe not found after download');
    return;
  }

  const soxDir = path.dirname(candidates[0]);
  // Copy sox.exe as rec (Tauri sidecar name)
  fs.copyFileSync(candidates[0], dest);

  // Copy DLLs
  const dlls = fs.readdirSync(soxDir).filter(f => f.endsWith('.dll'));
  for (const dll of dlls) {
    fs.copyFileSync(path.join(soxDir, dll), path.join(SIDECAR_DIR, dll));
  }

  // Cleanup tmp
  if (srcDir !== BIN_DIR) fs.rmSync(srcDir, { recursive: true, force: true });
  console.log('  rec (sox): bundled');
}

function main() {
  const triple = getTargetTriple();
  if (!triple) { console.error('Could not determine Rust target triple'); process.exit(1); }

  console.log(`Bundling sidecars for ${triple}...\n`);

  if (!fs.existsSync(SIDECAR_DIR)) fs.mkdirSync(SIDECAR_DIR, { recursive: true });

  // Ensure lib/ exists (Tauri requires binaries/lib/* glob to match something)
  const libDir = path.join(SIDECAR_DIR, 'lib');
  if (!fs.existsSync(libDir)) {
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, '.gitkeep'), '');
  }

  console.log('[binaries]');
  if (process.platform === 'win32') {
    bundleWhisperWindows(triple);
    bundleSoxWindows(triple);
  } else {
    bundleWhisper(triple);
    bundleSox(triple);
  }

  console.log('\n[model]');
  downloadModel();

  console.log('\nDone.');
}

main();

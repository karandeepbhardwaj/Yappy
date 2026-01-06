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

function bundleWhisperWindows(triple) {
  const dest = path.join(SIDECAR_DIR, `whisper-cli-${triple}.exe`);
  if (fs.existsSync(dest)) { console.log('  whisper-cli: already bundled'); return; }

  const BIN_DIR = path.join(__dirname, '..', '..', 'bin', 'win32-x64');
  const src = path.join(BIN_DIR, 'whisper-cli.exe');
  if (!fs.existsSync(src)) {
    console.log('  WARNING: whisper-cli.exe not found in bin/win32-x64/. Run: node scripts/download-binaries.js');
    return;
  }

  fs.copyFileSync(src, dest);

  // Copy DLLs alongside the sidecar
  const dlls = fs.readdirSync(BIN_DIR).filter(f => f.endsWith('.dll'));
  for (const dll of dlls) {
    const dllDest = path.join(SIDECAR_DIR, dll);
    if (!fs.existsSync(dllDest)) {
      fs.copyFileSync(path.join(BIN_DIR, dll), dllDest);
      console.log(`  copied DLL: ${dll}`);
    }
  }

  console.log('  whisper-cli: bundled');
}

function bundleSoxWindows(triple) {
  const dest = path.join(SIDECAR_DIR, `rec-${triple}.exe`);
  if (fs.existsSync(dest)) { console.log('  rec (sox): already bundled'); return; }

  const BIN_DIR = path.join(__dirname, '..', '..', 'bin', 'win32-x64');
  const src = path.join(BIN_DIR, 'sox.exe');
  if (!fs.existsSync(src)) {
    console.log('  WARNING: sox.exe not found in bin/win32-x64/. Run: node scripts/download-binaries.js');
    return;
  }

  fs.copyFileSync(src, dest);

  // Copy DLLs alongside the sidecar
  const dlls = fs.readdirSync(BIN_DIR).filter(f => f.endsWith('.dll'));
  for (const dll of dlls) {
    const dllDest = path.join(SIDECAR_DIR, dll);
    if (!fs.existsSync(dllDest)) {
      fs.copyFileSync(path.join(BIN_DIR, dll), dllDest);
    }
  }

  console.log('  rec (sox): bundled');
}

function main() {
  const triple = getTargetTriple();
  if (!triple) { console.error('Could not determine Rust target triple'); process.exit(1); }

  console.log(`Bundling sidecars for ${triple}...\n`);

  if (!fs.existsSync(SIDECAR_DIR)) fs.mkdirSync(SIDECAR_DIR, { recursive: true });

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

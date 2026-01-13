#!/usr/bin/env node
// Bundles sox (rec) and whisper-cli binaries for the current platform.
// On macOS: copies from Homebrew install + rewrites rpaths for portability.
// Run: node scripts/download-binaries.js

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');

function getPlatformKey() {
  return `${process.platform}-${process.arch}`;
}

function which(cmd) {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function copyBinary(src, dest) {
  const realSrc = fs.realpathSync(src);
  fs.copyFileSync(realSrc, dest);
  fs.chmodSync(dest, 0o755);
}

/** Copy whisper-cli + all its dylibs, rewrite rpaths for portability */
function bundleWhisperMacOS(destDir) {
  const destBin = path.join(destDir, 'whisper-cli');
  if (fs.existsSync(destBin)) {
    console.log('  whisper-cli already bundled');
    return;
  }

  const whisperPath = which('whisper-cli');
  if (!whisperPath) {
    console.log('  WARNING: whisper-cli not found. Install: brew install whisper-cpp');
    return;
  }

  // Copy the binary
  copyBinary(whisperPath, destBin);

  // Find and copy all dylibs it needs
  const libDir = path.join(destDir, 'lib');
  if (!fs.existsSync(libDir)) fs.mkdirSync(libDir);

  const otoolOutput = execSync(`otool -L "${destBin}"`, { encoding: 'utf-8' });
  const rpathLibs = otoolOutput.match(/@rpath\/[^\s]+/g) || [];

  // Find the actual lib directory from brew
  const brewPrefix = execSync('brew --prefix whisper-cpp', { encoding: 'utf-8' }).trim();
  const brewLibDir = path.join(brewPrefix, 'libexec', 'lib');

  for (const rpathRef of rpathLibs) {
    const libName = rpathRef.replace('@rpath/', '');
    const srcLib = path.join(brewLibDir, libName);

    if (fs.existsSync(srcLib)) {
      const realLib = fs.realpathSync(srcLib);
      const destLib = path.join(libDir, libName);
      fs.copyFileSync(realLib, destLib);
      fs.chmodSync(destLib, 0o755);

      // Rewrite the binary's reference to use @executable_path/lib/
      try {
        execSync(`install_name_tool -change "${rpathRef}" "@executable_path/lib/${libName}" "${destBin}"`, { stdio: 'pipe' });
      } catch { /* ignore if already changed */ }

      // Also rewrite the dylib's own references
      const libOtool = execSync(`otool -L "${destLib}"`, { encoding: 'utf-8' });
      const libRpathRefs = libOtool.match(/@rpath\/[^\s]+/g) || [];
      for (const ref of libRpathRefs) {
        const refName = ref.replace('@rpath/', '');
        try {
          execSync(`install_name_tool -change "${ref}" "@executable_path/lib/${refName}" "${destLib}"`, { stdio: 'pipe' });
        } catch { /* ignore */ }
      }

      console.log(`  copied lib: ${libName}`);
    }
  }

  // Also copy Metal shader if present
  const metalLib = path.join(brewLibDir, 'ggml-metal.metal');
  if (fs.existsSync(metalLib)) {
    fs.copyFileSync(metalLib, path.join(libDir, 'ggml-metal.metal'));
  }
  const defaultMetallib = path.join(brewLibDir, 'default.metallib');
  if (fs.existsSync(defaultMetallib)) {
    fs.copyFileSync(defaultMetallib, path.join(libDir, 'default.metallib'));
  }

  // Ad-hoc sign everything (required for macOS to run copied binaries)
  try {
    execSync(`codesign -f -s - "${destBin}"`, { stdio: 'pipe' });
    const libs = fs.readdirSync(libDir).filter(f => f.endsWith('.dylib'));
    for (const lib of libs) {
      execSync(`codesign -f -s - "${path.join(libDir, lib)}"`, { stdio: 'pipe' });
    }
    console.log('  ad-hoc signed all binaries');
  } catch (e) {
    console.log('  WARNING: codesign failed:', e.message);
  }

  console.log('  whisper-cli bundled with all dependencies');
}

/** Copy sox/rec binary */
function bundleSoxMacOS(destDir) {
  const destBin = path.join(destDir, 'rec');
  if (fs.existsSync(destBin)) {
    console.log('  sox/rec already bundled');
    return;
  }

  const recPath = which('rec');
  if (!recPath) {
    console.log('  WARNING: rec not found. Install: brew install sox');
    return;
  }

  // rec is usually a symlink to sox — copy the real binary
  copyBinary(recPath, destBin);

  // Check if rec has dylib dependencies
  const otoolOutput = execSync(`otool -L "${destBin}"`, { encoding: 'utf-8' });
  const hasBrewDeps = otoolOutput.includes('/opt/homebrew') || otoolOutput.includes('/usr/local');

  if (hasBrewDeps) {
    // sox from brew is usually statically linked enough, but let's check
    console.log('  sox/rec copied (may need dylibs if not statically linked)');
  } else {
    console.log('  sox/rec copied (system-linked)');
  }

  // Ad-hoc sign
  try {
    execSync(`codesign -f -s - "${destBin}"`, { stdio: 'pipe' });
    console.log('  sox/rec ad-hoc signed');
  } catch { /* ignore */ }
}

function main() {
  const platformKey = getPlatformKey();
  const destDir = path.join(BIN_DIR, platformKey);

  console.log(`Bundling binaries for ${platformKey}...`);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (process.platform === 'darwin') {
    bundleWhisperMacOS(destDir);
    bundleSoxMacOS(destDir);
  } else if (process.platform === 'win32') {
    console.log('  Windows: download whisper from https://github.com/ggml-org/whisper.cpp/releases');
    console.log('  Windows: download sox from https://sourceforge.net/projects/sox/');
    console.log('  Place binaries in bin/win32-x64/');
  } else {
    console.log('  Linux: install via package manager and copy binaries to bin/linux-x64/');
  }

  console.log('Done.');
}

main();

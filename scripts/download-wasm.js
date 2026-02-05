#!/usr/bin/env node
// Downloads pre-built whisper.cpp WASM (single-file build) from the ggml.ai GitHub Pages.
// The single-file build embeds the WASM binary as base64 inside the JS, so only one file is needed.
//
// Run: node scripts/download-wasm.js
// Artifact placed in media/wasm/main.js

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const DEST_DIR = path.join(__dirname, '..', 'media', 'wasm');

const FILES = [
  { url: 'https://ggml.ai/whisper.cpp/main.js', dest: path.join(DEST_DIR, 'main.js') },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      console.log(`  already exists: ${path.basename(dest)}`);
      resolve();
      return;
    }

    const tmp = dest + '.tmp';
    const file = fs.createWriteStream(tmp);

    function request(urlStr) {
      https.get(urlStr, { headers: { 'User-Agent': 'SunYapper-setup' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${urlStr}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.renameSync(tmp, dest);
          const size = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
          console.log(`  downloaded: ${path.basename(dest)} (${size} MB)`);
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        reject(err);
      });
    }

    request(url);
  });
}

async function main() {
  console.log('Downloading whisper.cpp WASM (single-file build)...');
  if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
  }
  for (const { url, dest } of FILES) {
    await download(url, dest);
  }
  console.log('Done. WASM artifact is in media/wasm/');
}

main().catch((err) => {
  console.error('Error:', err.message);
  // Don't fail the build — WASM can be downloaded later
  console.error('You can retry with: npm run download-wasm');
  process.exit(0);
});

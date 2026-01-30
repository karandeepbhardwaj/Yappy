// @ts-check
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const canvas = document.getElementById('waveform');
  const ctx = canvas.getContext('2d');
  const timerEl = document.getElementById('timer');
  const statusEl = document.getElementById('status');
  const btnRecord = document.getElementById('btn-record');
  const btnInsert = document.getElementById('btn-insert');
  const rawTextEl = document.getElementById('raw-text');
  const refinedTextEl = document.getElementById('refined-text');
  const cardRaw = document.getElementById('card-raw');
  const cardRefined = document.getElementById('card-refined');

  let startTime = 0;
  let timerInterval = null;
  let levelHistory = [];
  const MAX_LEVELS = 200;

  // Recording state (driven by extension host, not webview)
  let isRecording = false;

  // WASM state — loaded lazily on first transcription request

  // ---------- UI state ----------

  function setState(state) {
    statusEl.className = 'status-badge status-' + state;
    statusEl.textContent = state;
    btnRecord.disabled = state === 'processing';
    btnInsert.disabled = state !== 'done';

    // Toggle record button appearance
    if (state === 'recording') {
      btnRecord.classList.add('is-recording');
      btnRecord.title = 'Stop recording';
      timerEl.classList.add('active');
      startTimer();
      levelHistory = [];
    } else {
      btnRecord.classList.remove('is-recording');
      btnRecord.title = 'Start recording';
      timerEl.classList.remove('active');
      stopTimer();
    }

    if (state === 'idle') {
      drawIdleLine();
    }

    // Processing cursor on refined text
    if (state === 'processing') {
      refinedTextEl.classList.add('processing');
    } else {
      refinedTextEl.classList.remove('processing');
    }

    // Card highlight when content present
    if (rawTextEl.textContent) cardRaw.classList.add('has-content');
    if (refinedTextEl.textContent) cardRefined.classList.add('has-content');
  }

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const frac = Math.floor((ms % 1000) / 100);
    return m + ':' + String(sec).padStart(2, '0') + '.' + frac;
  }

  function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(function () {
      timerEl.textContent = formatTime(Date.now() - startTime);
    }, 100);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // ---------- Canvas / waveform ----------

  function resizeCanvas() {
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width - 16;
    canvas.height = 80;
  }

  function getBgColor() {
    return getComputedStyle(document.body).getPropertyValue('--vscode-editor-background') || '#1e1e1e';
  }

  function getMutedColor() {
    return getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground') || '#888';
  }

  function drawIdleLine() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var centerY = canvas.height / 2;
    // Draw subtle center dots
    ctx.fillStyle = getMutedColor();
    ctx.globalAlpha = 0.2;
    var dotCount = 40;
    var gap = canvas.width / dotCount;
    for (var i = 0; i < dotCount; i++) {
      ctx.beginPath();
      ctx.arc(gap * i + gap / 2, centerY, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawWaveform() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (levelHistory.length === 0) {
      drawIdleLine();
      return;
    }

    var barGap = 3;
    var barWidth = 2;
    var totalBarWidth = barWidth + barGap;
    var maxBars = Math.floor(canvas.width / totalBarWidth);
    var centerY = canvas.height / 2;
    var displayBars = Math.min(levelHistory.length, maxBars);
    var startIdx = Math.max(0, levelHistory.length - maxBars);
    var startX = (canvas.width - displayBars * totalBarWidth) / 2;

    for (var i = 0; i < displayBars; i++) {
      var level = levelHistory[startIdx + i];
      var barHeight = Math.max(3, level * canvas.height * 0.85);
      var x = startX + i * totalBarWidth;

      // Gradient from accent to red
      var intensity = Math.min(1, level * 3);
      var r = Math.round(59 + (239 - 59) * intensity);
      var g = Math.round(130 + (68 - 130) * intensity);
      var b = Math.round(246 + (68 - 246) * intensity);
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';

      // Rounded bar
      var radius = barWidth / 2;
      var y = centerY - barHeight / 2;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barWidth - radius, y);
      ctx.arcTo(x + barWidth, y, x + barWidth, y + radius, radius);
      ctx.lineTo(x + barWidth, y + barHeight - radius);
      ctx.arcTo(x + barWidth, y + barHeight, x + barWidth - radius, y + barHeight, radius);
      ctx.lineTo(x + radius, y + barHeight);
      ctx.arcTo(x, y + barHeight, x, y + barHeight - radius, radius);
      ctx.lineTo(x, y + radius);
      ctx.arcTo(x, y, x + radius, y, radius);
      ctx.fill();
    }
  }

  // Audio capture is handled by the extension host (sox/rec).
  // The webview only handles UI and WASM transcription.

  // ---------- WASM transcription ----------

  // The single-file whisper.cpp WASM build (main.js) sets window.Module
  // once loaded. It exposes a high-level API:
  //   Module.FS_createDataFile(parent, name, data, canRead, canWrite)
  //   Module.init(modelFileName) -> instance handle
  //   Module.full_default(instance, audioFloat32, language, nthreads, translate) -> text

  var whisperInstance = null;
  var wasmLoaded = false;
  var currentModelName = null;

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Failed to load WASM script: ' + url)); };
      document.head.appendChild(script);
    });
  }

  async function ensureWasmLoaded(wasmJsUrl) {
    if (wasmLoaded) return;
    await loadScript(wasmJsUrl);
    // The single-file build sets window.Module after the script loads.
    // Wait for it to be ready (the runtime initializes asynchronously).
    await new Promise(function (resolve) {
      if (window.Module && window.Module.calledRun) {
        resolve();
        return;
      }
      // Module.onRuntimeInitialized fires when WASM is ready
      var prev = window.Module && window.Module.onRuntimeInitialized;
      window.Module = window.Module || {};
      window.Module.onRuntimeInitialized = function () {
        if (prev) prev();
        resolve();
      };
    });
    wasmLoaded = true;
  }

  async function loadModelIntoWasm(modelUrl, modelFileName) {
    if (currentModelName === modelFileName) return; // already loaded

    // Fetch the .bin model file
    var response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch model: ' + response.statusText);
    }
    var buf = new Uint8Array(await response.arrayBuffer());

    // Remove old model if present
    if (currentModelName) {
      try { window.Module.FS_unlink(currentModelName); } catch (e) { /* ignore */ }
    }

    // Write model into WASM virtual filesystem
    window.Module.FS_createDataFile('/', modelFileName, buf, true, true);

    // Initialize whisper context
    whisperInstance = window.Module.init(modelFileName);
    if (!whisperInstance) {
      throw new Error('Failed to initialize whisper from model');
    }
    currentModelName = modelFileName;
  }

  // Run WASM transcription.
  // pcm16Array: number[] of Int16 samples at 16 kHz mono
  async function transcribeWithWasm(pcm16Array, language, modelUrl, wasmJsUrl) {
    await ensureWasmLoaded(wasmJsUrl);

    var modelFileName = 'whisper.bin';
    await loadModelIntoWasm(modelUrl, modelFileName);

    // Convert Int16 array to Float32 for whisper
    var float32 = new Float32Array(pcm16Array.length);
    for (var i = 0; i < pcm16Array.length; i++) {
      float32[i] = pcm16Array[i] / 32768.0;
    }

    // Run transcription: full_default(instance, audio, language, nthreads, translate)
    var result = window.Module.full_default(whisperInstance, float32, language || 'en', 0, false);
    if (!result) {
      throw new Error('Whisper transcription returned empty result');
    }

    return result.trim();
  }

  // ---------- Button handlers ----------

  btnRecord.addEventListener('click', function () {
    if (isRecording) {
      vscode.postMessage({ type: 'stop' });
    } else {
      rawTextEl.textContent = '';
      refinedTextEl.textContent = '';
      cardRaw.classList.remove('has-content');
      cardRefined.classList.remove('has-content');
      vscode.postMessage({ type: 'record' });
    }
  });

  btnInsert.addEventListener('click', function () {
    var text = refinedTextEl.textContent || rawTextEl.textContent || '';
    if (text) {
      vscode.postMessage({ type: 'insertText', text: text });
    }
  });

  // ---------- Messages from extension host ----------

  window.addEventListener('message', function (event) {
    var msg = event.data;
    switch (msg.type) {

      case 'setState':
        isRecording = msg.state === 'recording';
        setState(msg.state);
        break;

      case 'audioLevel':
        levelHistory.push(msg.level);
        if (levelHistory.length > MAX_LEVELS) {
          levelHistory.shift();
        }
        drawWaveform();
        break;

      // Extension host sends this back after receiving audioData.
      // The webview runs WASM transcription and sends the result back.
      case 'transcribeAudio':
        (async function () {
          try {
            const text = await transcribeWithWasm(
              msg.pcm16,
              msg.language,
              msg.modelUrl,
              msg.wasmJsUrl
            );
            // Send raw transcription back to extension host for refinement
            vscode.postMessage({ type: 'transcription', text: text });
          } catch (err) {
            vscode.postMessage({ type: 'error', message: 'Transcription failed: ' + err.message });
            setState('idle');
          }
        })();
        break;

      case 'transcription':
        rawTextEl.textContent = msg.text;
        cardRaw.classList.add('has-content');
        if (!msg.refining) {
          setState('done');
        }
        break;

      case 'refined':
        refinedTextEl.textContent = msg.text;
        cardRefined.classList.add('has-content');
        setState('done');
        break;

      case 'error':
        setState('idle');
        rawTextEl.textContent = 'Error: ' + msg.message;
        break;
    }
  });

  // ---------- Init ----------

  resizeCanvas();
  drawIdleLine();
  setState('idle');

  window.addEventListener('resize', function () {
    resizeCanvas();
    if (levelHistory.length === 0) {
      drawIdleLine();
    } else {
      drawWaveform();
    }
  });
})();

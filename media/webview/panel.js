// @ts-check
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const canvas = document.getElementById('waveform');
  const ctx = canvas.getContext('2d');
  const timerEl = document.getElementById('timer');
  const statusEl = document.getElementById('status');
  const btnRecord = document.getElementById('btn-record');
  const btnStop = document.getElementById('btn-stop');
  const btnInsert = document.getElementById('btn-insert');
  const rawTextEl = document.getElementById('raw-text');
  const refinedTextEl = document.getElementById('refined-text');

  let startTime = 0;
  let timerInterval = null;
  let levelHistory = [];
  const MAX_LEVELS = 200;

  // Audio capture state
  let audioContext = null;
  let mediaStream = null;
  let scriptProcessor = null;
  let sourceNode = null;
  let pcmChunks = [];
  let nativeSampleRate = 16000;
  let isRecording = false;

  // WASM state — loaded lazily on first transcription request

  // ---------- UI state ----------

  function setState(state) {
    statusEl.className = 'status-badge status-' + state;
    statusEl.textContent = state;
    btnRecord.disabled = state === 'recording' || state === 'processing';
    btnStop.disabled = state !== 'recording';
    btnInsert.disabled = state !== 'done';

    if (state === 'recording') {
      timerEl.classList.add('active');
      startTimer();
      levelHistory = [];
    } else {
      timerEl.classList.remove('active');
      stopTimer();
    }

    if (state === 'idle') {
      drawIdleLine();
    }
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
    ctx.fillStyle = getBgColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = getMutedColor();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  }

  function drawWaveform() {
    ctx.fillStyle = getBgColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (levelHistory.length === 0) {
      drawIdleLine();
      return;
    }

    var barWidth = canvas.width / MAX_LEVELS;
    var centerY = canvas.height / 2;
    ctx.fillStyle = '#c0392b';

    for (var i = 0; i < levelHistory.length; i++) {
      var level = levelHistory[i];
      var barHeight = Math.max(2, level * canvas.height * 0.9);
      var x = i * barWidth;
      ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
    }
  }

  // ---------- Audio capture (Phase 1) ----------

  async function startRecording() {
    if (isRecording) return;

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      vscode.postMessage({ type: 'error', message: 'Microphone access denied: ' + err.message });
      return;
    }

    audioContext = new AudioContext();
    nativeSampleRate = audioContext.sampleRate;
    pcmChunks = [];
    isRecording = true;

    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    // ScriptProcessorNode works on the main thread without a separate worker file,
    // so no worker-src blob: CSP directive is required.
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = function (e) {
      if (!isRecording) return;
      var inputData = e.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(inputData));

      // RMS level for waveform
      var sum = 0;
      for (var i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      var rms = Math.sqrt(sum / inputData.length);
      levelHistory.push(Math.min(1, rms * 4));
      if (levelHistory.length > MAX_LEVELS) {
        levelHistory.shift();
      }
      drawWaveform();
    };

    sourceNode.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    setState('recording');
  }

  function stopRecordingAndTransmit() {
    if (!isRecording || !audioContext) return;

    isRecording = false;
    scriptProcessor.disconnect();
    sourceNode.disconnect();
    mediaStream.getTracks().forEach(function (t) { t.stop(); });
    audioContext.close();

    const chunks = pcmChunks;
    audioContext = null;
    mediaStream = null;
    scriptProcessor = null;
    sourceNode = null;
    pcmChunks = [];

    var totalLength = 0;
    for (var i = 0; i < chunks.length; i++) { totalLength += chunks[i].length; }
    if (totalLength === 0) {
      vscode.postMessage({ type: 'error', message: 'No audio captured.' });
      setState('idle');
      return;
    }

    var merged = new Float32Array(totalLength);
    var offset = 0;
    for (var i = 0; i < chunks.length; i++) {
      merged.set(chunks[i], offset);
      offset += chunks[i].length;
    }

    var pcm16k = nativeSampleRate === 16000 ? merged : downsampleFloat32(merged, nativeSampleRate, 16000);
    var int16 = float32ToInt16(pcm16k);

    setState('processing');
    vscode.postMessage({
      type: 'audioData',
      pcm16: Array.from(int16),
      sampleRate: 16000,
    });
  }

  function downsampleFloat32(buffer, fromRate, toRate) {
    if (fromRate === toRate) return buffer;
    var ratio = fromRate / toRate;
    var newLength = Math.round(buffer.length / ratio);
    var result = new Float32Array(newLength);
    for (var i = 0; i < newLength; i++) {
      var srcIdx = Math.floor(i * ratio);
      result[i] = buffer[Math.min(srcIdx, buffer.length - 1)];
    }
    return result;
  }

  function float32ToInt16(float32) {
    var int16 = new Int16Array(float32.length);
    for (var i = 0; i < float32.length; i++) {
      var s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }

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
    rawTextEl.textContent = '';
    refinedTextEl.textContent = '';
    startRecording();
  });

  btnStop.addEventListener('click', function () {
    stopRecordingAndTransmit();
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

      case 'toggleRecording':
        if (isRecording) {
          stopRecordingAndTransmit();
        } else {
          rawTextEl.textContent = '';
          refinedTextEl.textContent = '';
          startRecording();
        }
        break;

      case 'setState':
        setState(msg.state);
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
        if (!msg.refining) {
          setState('done');
        }
        break;

      case 'refined':
        refinedTextEl.textContent = msg.text;
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

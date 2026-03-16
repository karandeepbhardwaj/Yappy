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

  // Canvas
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
      // Scale level (0-1) to bar height, with minimum visibility
      var barHeight = Math.max(2, level * canvas.height * 0.9);
      var x = i * barWidth;
      ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
    }
  }

  // Event listeners — buttons send messages to extension host
  btnRecord.addEventListener('click', function () {
    vscode.postMessage({ type: 'record' });
  });

  btnStop.addEventListener('click', function () {
    vscode.postMessage({ type: 'stop' });
  });

  btnInsert.addEventListener('click', function () {
    var text = refinedTextEl.textContent || rawTextEl.textContent || '';
    if (text) {
      vscode.postMessage({ type: 'insertText', text: text });
    }
  });

  // Messages from extension host
  window.addEventListener('message', function (event) {
    var msg = event.data;
    switch (msg.type) {
      case 'setState':
        setState(msg.state);
        break;
      case 'audioLevel':
        levelHistory.push(msg.level);
        if (levelHistory.length > MAX_LEVELS) {
          levelHistory.shift();
        }
        drawWaveform();
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

  // Init
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

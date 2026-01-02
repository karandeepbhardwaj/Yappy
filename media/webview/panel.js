// @ts-check
// SunYapper WebView — UI only (recording + transcription handled by extension host)
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
  let isRecording = false;

  // ---------- UI state ----------

  function setState(state) {
    statusEl.className = 'status-badge status-' + state;
    statusEl.textContent = state;
    btnRecord.disabled = state === 'processing';
    btnInsert.disabled = state !== 'done';

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

    if (state === 'idle') { drawIdleLine(); }
    if (state === 'processing') {
      refinedTextEl.classList.add('processing');
    } else {
      refinedTextEl.classList.remove('processing');
    }

    if (rawTextEl.textContent) cardRaw.classList.add('has-content');
    if (refinedTextEl.textContent) cardRefined.classList.add('has-content');
  }

  function formatTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    var frac = Math.floor((ms % 1000) / 100);
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

  function getMutedColor() {
    return getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground') || '#888';
  }

  function drawIdleLine() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var centerY = canvas.height / 2;
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

    if (levelHistory.length === 0) { drawIdleLine(); return; }

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

      var intensity = Math.min(1, level * 3);
      var r = Math.round(59 + (239 - 59) * intensity);
      var g = Math.round(130 + (68 - 130) * intensity);
      var b = Math.round(246 + (68 - 246) * intensity);
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';

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
        if (levelHistory.length > MAX_LEVELS) { levelHistory.shift(); }
        drawWaveform();
        break;

      case 'transcription':
        rawTextEl.textContent = msg.text;
        cardRaw.classList.add('has-content');
        if (!msg.refining) { setState('done'); }
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
    if (levelHistory.length === 0) { drawIdleLine(); } else { drawWaveform(); }
  });
})();

// @ts-check
// SunYapper VS Code WebView — two-column layout, settings bar
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const timerEl = document.getElementById('timer');
  const statusEl = document.getElementById('status');
  const btnRecord = document.getElementById('btn-record');
  const btnInsert = document.getElementById('btn-insert');
  const rawTextEl = document.getElementById('raw-text');
  const refinedTextEl = document.getElementById('refined-text');
  const selLang = document.getElementById('sel-lang');
  const selModel = document.getElementById('sel-model');

  let startTime = 0;
  let timerInterval = null;
  let isRecording = false;

  // Settings changes
  selLang.addEventListener('change', function () {
    vscode.postMessage({ type: 'settingChanged', key: 'language', value: selLang.value });
  });
  selModel.addEventListener('change', function () {
    vscode.postMessage({ type: 'settingChanged', key: 'whisperModel', value: selModel.value });
  });

  function setState(state) {
    statusEl.className = 'status-badge status-' + state;
    statusEl.textContent = state;
    btnRecord.disabled = state === 'processing';
    btnInsert.disabled = state !== 'done';

    if (state === 'recording') {
      btnRecord.classList.add('is-recording');
      timerEl.classList.add('active');
      startTimer();
    } else {
      btnRecord.classList.remove('is-recording');
      timerEl.classList.remove('active');
      stopTimer();
    }

    if (state === 'processing') {
      refinedTextEl.classList.add('processing');
    } else {
      refinedTextEl.classList.remove('processing');
    }
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
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  // Button handlers
  btnRecord.addEventListener('click', function () {
    if (isRecording) {
      vscode.postMessage({ type: 'stop' });
    } else {
      rawTextEl.textContent = '';
      refinedTextEl.textContent = '';
      vscode.postMessage({ type: 'record' });
    }
  });

  btnInsert.addEventListener('click', function () {
    var text = refinedTextEl.textContent || rawTextEl.textContent || '';
    if (text) { vscode.postMessage({ type: 'insertText', text: text }); }
  });

  // Messages from extension host
  window.addEventListener('message', function (event) {
    var msg = event.data;
    switch (msg.type) {
      case 'setState':
        isRecording = msg.state === 'recording';
        setState(msg.state);
        break;
      case 'transcription':
        rawTextEl.textContent = msg.text;
        if (!msg.refining) { setState('done'); }
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

  setState('idle');
})();

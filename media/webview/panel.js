// @ts-check
// yapper VS Code WebView — two-column layout, settings bar
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const timerEl = document.getElementById('timer');
  const statusEl = document.getElementById('status');
  const btnRecord = document.getElementById('btn-record');
  const btnInsert = document.getElementById('btn-insert');
  const rawTextEl = document.getElementById('raw-text');
  const refinedTextEl = document.getElementById('refined-text');
  const actionCardEl = document.getElementById('action-card');
  const outputLabelEl = document.getElementById('output-label');
  const selLang = document.getElementById('sel-lang');
  const selModel = document.getElementById('sel-model');
  const selMode = document.getElementById('sel-mode');

  let startTime = 0;
  let timerInterval = null;
  let isRecording = false;
  let pendingAction = null;

  // Settings changes
  selLang.addEventListener('change', function () {
    vscode.postMessage({ type: 'settingChanged', key: 'language', value: selLang.value });
  });
  selModel.addEventListener('change', function () {
    vscode.postMessage({ type: 'settingChanged', key: 'whisperModel', value: selModel.value });
  });
  selMode.addEventListener('change', function () {
    vscode.postMessage({ type: 'settingChanged', key: 'actionMode', value: selMode.value });
    updateModeUI(selMode.value);
  });

  function updateModeUI(mode) {
    if (outputLabelEl) {
      outputLabelEl.textContent = mode === 'actions' ? 'Action / Output' : 'Refined Output';
    }
  }

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

    // Hide action card on new state transitions (except done)
    if (state !== 'done') {
      hideActionCard();
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

  function hideActionCard() {
    if (actionCardEl) { actionCardEl.style.display = 'none'; actionCardEl.innerHTML = ''; }
    pendingAction = null;
  }

  function showActionCard(action) {
    pendingAction = action;
    refinedTextEl.textContent = '';

    var riskClass = action.risk === 'destructive' ? 'risk-destructive' : 'risk-safe';
    var riskLabel = action.risk === 'destructive' ? 'Destructive' : 'Safe';

    actionCardEl.innerHTML =
      '<div class="action-card-inner">' +
        '<div class="action-card-header">' +
          '<span class="action-kind-badge">' + escapeHtml(action.kind.replace('_', ' ')) + '</span>' +
          '<span class="risk-badge ' + riskClass + '">' + riskLabel + '</span>' +
        '</div>' +
        '<div class="action-description">' + escapeHtml(action.description) + '</div>' +
        '<div class="action-command">' + escapeHtml(action.command) + '</div>' +
        '<div class="action-buttons">' +
          '<button class="btn-execute" id="btn-execute">Execute</button>' +
          '<button class="btn-cancel-action" id="btn-cancel-action">Cancel</button>' +
        '</div>' +
      '</div>';

    actionCardEl.style.display = 'block';
    setState('done');

    document.getElementById('btn-execute').addEventListener('click', function () {
      if (pendingAction) {
        vscode.postMessage({ type: 'executeAction', action: pendingAction });
        hideActionCard();
        setState('processing');
      }
    });
    document.getElementById('btn-cancel-action').addEventListener('click', function () {
      vscode.postMessage({ type: 'cancelAction' });
      hideActionCard();
    });
  }

  function showActionResult(success, message, action) {
    hideActionCard();
    var resultClass = success ? 'action-result-success' : 'action-result-error';
    var icon = success ? '✓' : '✗';
    refinedTextEl.innerHTML =
      '<div class="action-result ' + resultClass + '">' +
        '<span class="action-result-icon">' + icon + '</span>' +
        '<span>' + escapeHtml(message) + '</span>' +
      '</div>';
    setState('done');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Button handlers
  btnRecord.addEventListener('click', function () {
    if (isRecording) {
      vscode.postMessage({ type: 'stop' });
    } else {
      rawTextEl.textContent = '';
      refinedTextEl.textContent = '';
      hideActionCard();
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
        hideActionCard();
        refinedTextEl.textContent = msg.text;
        setState('done');
        break;
      case 'showAction':
        showActionCard(msg.action);
        break;
      case 'actionResult':
        showActionResult(msg.success, msg.message, msg.action);
        break;
      case 'error':
        setState('idle');
        rawTextEl.textContent = 'Error: ' + msg.message;
        break;
    }
  });

  setState('idle');
})();

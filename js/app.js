/**
 * Weekly Responsibility Roulette
 * File-based SPA — no ES modules, works under file:// and http://
 */

/* ── Constants ─────────────────────────────────────────────────── */
var WHEEL_COLORS = [
  '#1e40af', '#0f766e', '#7c3aed', '#c2410c',
  '#be185d', '#0369a1', '#15803d', '#a16207',
  '#4338ca', '#0e7490', '#b45309', '#9d174d',
];

var WHEEL_COLOR_RESTING = '#94a3b8';
var COUNTDOWN_SECONDS = 3;

/* ── Application state ──────────────────────────────────────────── */
var state = {
  participants: [],
  history: [],
  loadedFileName: null,
  isSpinning: false,
  rotation: 0,
  idCounters: { participant: 0, history: 0 },
  hasUnsavedChanges: false,
  pendingWinner: null,
  countdownTimer: null,
};

/* ── DOM references ─────────────────────────────────────────────── */
var dom = {
  fileInput:            document.getElementById('file-input'),
  fileInputEmpty:       document.getElementById('file-input-empty'),
  saveBtn:              document.getElementById('save-btn'),
  statusBar:            document.getElementById('status-bar'),
  statusText:           document.getElementById('status-text'),
  dashboard:            document.getElementById('dashboard'),
  emptyState:           document.getElementById('empty-state'),
  startFreshBtn:        document.getElementById('start-fresh-btn'),
  participantCount:     document.getElementById('participant-count'),
  participantList:      document.getElementById('participant-list'),
  addForm:              document.getElementById('add-participant-form'),
  participantNameInput: document.getElementById('participant-name-input'),
  addParticipantBtn:    document.getElementById('add-participant-btn'),
  canvas:               document.getElementById('roulette-canvas'),
  spinBtn:              document.getElementById('spin-btn'),
  weekPreview:          document.getElementById('week-preview'),
  resultMessage:        document.getElementById('result-message'),
  historyCount:         document.getElementById('history-count'),
  historyList:          document.getElementById('history-list'),
  statsList:            document.getElementById('stats-list'),
  // Modal
  modalOverlay:         document.getElementById('modal-overlay'),
  modalWinnerName:      document.getElementById('modal-winner-name'),
  modalStartDate:       document.getElementById('modal-start-date'),
  modalEndDate:         document.getElementById('modal-end-date'),
  modalCancelBtn:       document.getElementById('modal-cancel-btn'),
  modalAcceptBtn:       document.getElementById('modal-accept-btn'),
  modalCountdown:       document.getElementById('modal-countdown'),
};

var ctx = dom.canvas.getContext('2d');

/* ── Initialisation ─────────────────────────────────────────────── */
function init() {
  bindEvents();
  updateWeekPreview();
  drawWheel();
  showEmptyState(true);
}

function bindEvents() {
  dom.fileInput.addEventListener('change', handleFileLoad);
  dom.fileInputEmpty.addEventListener('change', handleFileLoad);
  dom.saveBtn.addEventListener('click', function () { downloadJson(false); });
  dom.startFreshBtn.addEventListener('click', startFresh);
  dom.addForm.addEventListener('submit', handleAddParticipant);
  dom.spinBtn.addEventListener('click', handleSpin);
  dom.modalCancelBtn.addEventListener('click', handleModalCancel);
  dom.modalAcceptBtn.addEventListener('click', handleModalAccept);
  window.addEventListener('resize', drawWheel);
}

/* ── UI helpers ─────────────────────────────────────────────────── */
function showEmptyState(show) {
  dom.emptyState.classList.toggle('empty-state--hidden', !show);
  dom.dashboard.classList.toggle('dashboard--hidden', show);
}

function setStatus(message, variant) {
  dom.statusText.textContent = message;
  dom.statusBar.classList.remove('status-bar--success', 'status-bar--warning');
  if (variant === 'success') dom.statusBar.classList.add('status-bar--success');
  if (variant === 'warning')  dom.statusBar.classList.add('status-bar--warning');
}

function enableAppControls(enabled) {
  dom.saveBtn.disabled = !enabled;
  dom.participantNameInput.disabled = !enabled;
  dom.addParticipantBtn.disabled = !enabled;
  dom.spinBtn.disabled = !enabled || state.participants.length < 2 || state.isSpinning;
}

/* ── Unsaved-changes guard ──────────────────────────────────────── */
function handleBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = '';
}

function setUnsavedChanges(flag) {
  state.hasUnsavedChanges = flag;
  if (flag) {
    window.addEventListener('beforeunload', handleBeforeUnload);
  } else {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  }
}

/* ── Start fresh ────────────────────────────────────────────────── */
function startFresh() {
  state.participants = [];
  state.history = [];
  state.loadedFileName = 'team_data.json';
  state.idCounters = { participant: 0, history: 0 };
  showEmptyState(false);
  enableAppControls(true);
  setStatus('New roster started. Add participants and spin the wheel.', 'success');
  setUnsavedChanges(true);
  renderAll();
}

/* ── File loading ───────────────────────────────────────────────── */
function handleFileLoad(event) {
  var file = event.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function () {
    try {
      var data = JSON.parse(reader.result);
      validateAndLoadData(data);
      state.loadedFileName = file.name;
      showEmptyState(false);
      enableAppControls(true);
      setStatus(
        'Loaded ' + file.name + ' — ' + state.participants.length + ' participant(s), ' + state.history.length + ' record(s).',
        'success'
      );
      setUnsavedChanges(false);
      renderAll();
    } catch (error) {
      setStatus('Failed to load file: ' + error.message, 'warning');
    }
    event.target.value = '';
  };
  reader.onerror = function () {
    setStatus('Could not read the selected file.', 'warning');
    event.target.value = '';
  };
  reader.readAsText(file);
}

function validateAndLoadData(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid JSON structure.');
  if (!Array.isArray(data.participants))  throw new Error('Missing or invalid "participants" array.');
  if (!Array.isArray(data.history))       throw new Error('Missing or invalid "history" array.');

  var participants = data.participants.map(function (entry, index) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
      throw new Error('Participant at index ' + index + ' must have a non-empty name.');
    }
    return { id: entry.id || generateId('participant'), name: entry.name.trim() };
  });

  var history = data.history.map(function (entry, index) {
    if (!entry || typeof entry.winnerName !== 'string' || !entry.winnerName.trim()) {
      throw new Error('History entry at index ' + index + ' must have a winnerName.');
    }
    if (typeof entry.selectionDate !== 'string' || !entry.selectionDate) {
      throw new Error('History entry at index ' + index + ' must have a selectionDate.');
    }
    if (typeof entry.weekRange !== 'string' || !entry.weekRange) {
      throw new Error('History entry at index ' + index + ' must have a weekRange.');
    }
    return {
      id:            entry.id || generateId('history'),
      winnerName:    entry.winnerName.trim(),
      selectionDate: entry.selectionDate,
      weekRange:     entry.weekRange,
    };
  });

  state.participants = participants;
  state.history = history;
  syncIdCounters();
}

/* ── ID helpers ─────────────────────────────────────────────────── */
function syncIdCounters() {
  state.idCounters.participant = maxNumericSuffix(state.participants.map(function (p) { return p.id; }), 'p');
  state.idCounters.history     = maxNumericSuffix(state.history.map(function (h) { return h.id; }), 'h');
}

function maxNumericSuffix(items, prefix) {
  var max = 0;
  var re = new RegExp('^' + prefix + '(\\d+)$');
  for (var i = 0; i < items.length; i++) {
    var match = String(items[i]).match(re);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

function generateId(type) {
  var prefix = type === 'participant' ? 'p' : 'h';
  state.idCounters[type] += 1;
  return prefix + state.idCounters[type];
}

/* ── JSON export / download ─────────────────────────────────────── */
function exportData() {
  return {
    participants: state.participants.map(function (p) { return { id: p.id, name: p.name }; }),
    history: state.history.map(function (h) {
      return { id: h.id, winnerName: h.winnerName, selectionDate: h.selectionDate, weekRange: h.weekRange };
    }),
  };
}

function downloadJson(silent) {
  var payload = JSON.stringify(exportData(), null, 2);
  var blob    = new Blob([payload], { type: 'application/json' });
  var url     = URL.createObjectURL(blob);
  var anchor  = document.createElement('a');
  anchor.href     = url;
  anchor.download = state.loadedFileName || 'team_data.json';
  anchor.click();
  URL.revokeObjectURL(url);
  setUnsavedChanges(false);
  if (!silent) setStatus('Saved ' + anchor.download + ' to your downloads folder.', 'success');
}

/* ── Participants CRUD ──────────────────────────────────────────── */
function handleAddParticipant(event) {
  event.preventDefault();
  var name = dom.participantNameInput.value.trim();
  if (!name) return;

  var duplicate = state.participants.some(function (p) {
    return p.name.toLowerCase() === name.toLowerCase();
  });
  if (duplicate) {
    setStatus('"' + name + '" is already on the roster.', 'warning');
    return;
  }

  state.participants.push({ id: generateId('participant'), name: name });
  dom.participantNameInput.value = '';
  dom.participantNameInput.focus();
  setUnsavedChanges(true);
  renderParticipants();
  renderStats();
  drawWheel();
  dom.spinBtn.disabled = state.participants.length < 2 || state.isSpinning;
  setStatus('Added ' + name + '. Remember to save the JSON file.', 'success');
}

function removeParticipant(id) {
  if (state.isSpinning) return;
  state.participants = state.participants.filter(function (p) { return p.id !== id; });
  setUnsavedChanges(true);
  renderParticipants();
  renderStats();
  drawWheel();
  dom.spinBtn.disabled = state.participants.length < 2;
  setStatus('Participant removed. Remember to save the JSON file.', 'warning');
}

/* ── Latest winner helper ───────────────────────────────────────── */
function getLatestWinnerName() {
  if (state.history.length === 0) return null;
  return state.history[state.history.length - 1].winnerName;
}

/* ── Render: participants ───────────────────────────────────────── */
function renderParticipants() {
  dom.participantCount.textContent = String(state.participants.length);
  dom.participantList.innerHTML = '';

  if (state.participants.length === 0) {
    dom.participantList.innerHTML = '<li class="participant-list__empty">Add at least two participants to spin.</li>';
    return;
  }

  var latestWinner = getLatestWinnerName();
  var isResting    = function (name) { return name === latestWinner && state.participants.length > 2; };

  state.participants.forEach(function (participant) {
    var li = document.createElement('li');
    li.className = 'participant-item';
    if (isResting(participant.name)) {
      li.classList.add('participant-item--resting');
    }

    var info = document.createElement('div');
    info.className = 'participant-item__info';

    var nameRow = document.createElement('div');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    nameRow.style.gap = '0.5rem';
    nameRow.style.flexWrap = 'wrap';

    var nameEl = document.createElement('span');
    nameEl.className = 'participant-item__name';
    nameEl.textContent = participant.name;
    nameRow.appendChild(nameEl);

    if (isResting(participant.name)) {
      var badge = document.createElement('span');
      badge.className = 'participant-item__resting';
      badge.textContent = 'Resting this week';
      nameRow.appendChild(badge);
    }

    var meta = document.createElement('div');
    meta.className = 'participant-item__meta';
    meta.textContent = participant.id;

    info.appendChild(nameRow);
    info.appendChild(meta);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn--danger';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', 'Remove ' + participant.name);
    removeBtn.addEventListener('click', function () { removeParticipant(participant.id); });

    li.appendChild(info);
    li.appendChild(removeBtn);
    dom.participantList.appendChild(li);
  });
}

/* ── Render: history ────────────────────────────────────────────── */
function renderHistory() {
  dom.historyCount.textContent = String(state.history.length);
  dom.historyList.innerHTML = '';

  if (state.history.length === 0) {
    dom.historyList.innerHTML = '<div class="history-list__empty">No selections yet. Spin the wheel to assign this week\'s responsibility.</div>';
    return;
  }

  var sorted = state.history.slice().reverse();
  sorted.forEach(function (entry, index) {
    var item = document.createElement('article');
    item.className = 'history-item';
    if (index === 0) item.classList.add('history-item--latest');

    item.innerHTML =
      '<div class="history-item__winner">' + escapeHtml(entry.winnerName) + '</div>' +
      '<div class="history-item__week">'   + escapeHtml(entry.weekRange)  + '</div>' +
      '<div class="history-item__date">Selected on ' + formatDisplayDate(entry.selectionDate) + '</div>';

    dom.historyList.appendChild(item);
  });
}

/* ── Render: result message ─────────────────────────────────────── */
function renderResultMessage() {
  var latest = state.history[state.history.length - 1];
  if (!latest || state.isSpinning) {
    dom.resultMessage.textContent = state.participants.length < 2
      ? 'Add at least two participants to begin.'
      : 'Ready to assign this week\'s responsibility.';
    dom.resultMessage.classList.add('result-message--empty');
    return;
  }
  dom.resultMessage.classList.remove('result-message--empty');
  dom.resultMessage.textContent = latest.winnerName + ' is responsible for ' + latest.weekRange;
}

/* ── Render: stats panel ────────────────────────────────────────── */
function renderStats() {
  dom.statsList.innerHTML = '';

  if (state.history.length === 0 && state.participants.length === 0) {
    dom.statsList.innerHTML = '<div class="stats-list__empty">Spin the wheel to start building statistics.</div>';
    return;
  }

  // Build count map from history
  var countMap = {};
  state.history.forEach(function (h) {
    countMap[h.winnerName] = (countMap[h.winnerName] || 0) + 1;
  });

  // Ensure all current participants appear (even with 0 count)
  state.participants.forEach(function (p) {
    if (!(p.name in countMap)) countMap[p.name] = 0;
  });

  // Sort descending by count, then alphabetically
  var entries = Object.keys(countMap).map(function (name) {
    return { name: name, count: countMap[name] };
  });
  entries.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });

  if (entries.length === 0) {
    dom.statsList.innerHTML = '<div class="stats-list__empty">No data yet.</div>';
    return;
  }

  var maxCount = entries[0].count || 1;
  var rankClasses = ['stat-item__rank--gold', 'stat-item__rank--silver', 'stat-item__rank--bronze'];
  var rankLabels  = ['1st', '2nd', '3rd'];

  entries.forEach(function (entry, index) {
    var card = document.createElement('div');
    card.className = 'stat-item';

    var rankClass = index < 3 ? rankClasses[index] : '';
    var rankLabel = index < 3 ? rankLabels[index] : '#' + (index + 1);

    var pct = maxCount === 0 ? 0 : Math.round((entry.count / maxCount) * 100);

    card.innerHTML =
      '<div class="stat-item__header">' +
        '<span class="stat-item__rank ' + rankClass + '">' + escapeHtml(rankLabel) + '</span>' +
        '<span class="stat-item__name">'  + escapeHtml(entry.name)  + '</span>' +
        '<span class="stat-item__count">' + entry.count + (entry.count === 1 ? ' pick' : ' picks') + '</span>' +
      '</div>' +
      '<div class="stat-item__bar-track">' +
        '<div class="stat-item__bar-fill" style="width:' + pct + '%"></div>' +
      '</div>';

    dom.statsList.appendChild(card);
  });
}

/* ── Render: all ────────────────────────────────────────────────── */
function renderAll() {
  renderParticipants();
  renderHistory();
  renderResultMessage();
  renderStats();
  updateWeekPreview();
  drawWheel();
  dom.spinBtn.disabled = state.participants.length < 2 || state.isSpinning;
}

/* ── String / date helpers ──────────────────────────────────────── */
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDisplayDate(isoDate) {
  var date = parseIsoDate(isoDate);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function parseIsoDate(isoDate) {
  var parts = isoDate.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function padTwo(n) {
  return n < 10 ? '0' + n : String(n);
}

function toIsoDateSafe(date) {
  return date.getFullYear() + '-' + padTwo(date.getMonth() + 1) + '-' + padTwo(date.getDate());
}

function formatShortDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Returns the upcoming Friday (or today if today is Friday).
 * Responsibility week: start Friday → end the following Friday (7 days later).
 */
function getResponsibilityWeekRange(fromDate) {
  var base = fromDate || new Date();
  var date = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  var day  = date.getDay(); // 0=Sun … 5=Fri … 6=Sat

  var start = new Date(date);
  var daysToFriday = (5 - day + 7) % 7;
  start.setDate(date.getDate() + daysToFriday);

  var end = new Date(start);
  end.setDate(start.getDate() + 7);

  return { start: start, end: end, label: formatShortDate(start) + ' - ' + formatShortDate(end) };
}

function updateWeekPreview() {
  var range = getResponsibilityWeekRange();
  dom.weekPreview.textContent = 'Upcoming responsibility week: ' + range.label;
}

/* ── Wheel drawing ──────────────────────────────────────────────── */
function drawWheel() {
  var canvas       = dom.canvas;
  var size         = canvas.width;
  var center       = size / 2;
  var radius       = center - 8;
  var participants = state.participants;
  var latestWinner = getLatestWinnerName();
  var restingName  = (state.participants.length > 2) ? latestWinner : null;

  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(state.rotation);
  ctx.translate(-center, -center);

  if (participants.length === 0) {
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.font = '600 16px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Add participants', center, center);
    ctx.restore();
    return;
  }

  var sliceAngle = (Math.PI * 2) / participants.length;

  participants.forEach(function (participant, index) {
    var isResting  = participant.name === restingName;
    var startAngle = index * sliceAngle - Math.PI / 2;
    var endAngle   = startAngle + sliceAngle;

    // Slice fill
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = isResting ? WHEEL_COLOR_RESTING : WHEEL_COLORS[index % WHEEL_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Label
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(startAngle + sliceAngle / 2);
    ctx.textAlign    = 'right';
    ctx.fillStyle    = isResting ? '#ffffff' : '#ffffff';
    ctx.font         = '600 15px Segoe UI, system-ui, sans-serif';

    var label = isResting
      ? truncateLabel(participant.name, 10) + ' (Rest)'
      : truncateLabel(participant.name, 14);

    ctx.fillText(label, radius - 18, 4);
    ctx.restore();
  });

  // Centre hub
  ctx.beginPath();
  ctx.arc(center, center, 28, 0, Math.PI * 2);
  ctx.fillStyle   = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth   = 2;
  ctx.stroke();

  ctx.restore();
}

function truncateLabel(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '\u2026';
}

/* ── Spin logic ─────────────────────────────────────────────────── */
function pickEligibleIndex() {
  var latestWinner = getLatestWinnerName();
  var excludeLast  = state.participants.length > 2 && latestWinner;
  var eligible     = state.participants
    .map(function (p, i) { return { name: p.name, index: i }; })
    .filter(function (p) { return !excludeLast || p.name !== latestWinner; });

  if (eligible.length === 0) {
    return Math.floor(Math.random() * state.participants.length);
  }
  return eligible[Math.floor(Math.random() * eligible.length)].index;
}

function normalizeAngle(angle) {
  var tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

function handleSpin() {
  if (state.isSpinning || state.participants.length < 2) return;

  state.isSpinning = true;
  dom.spinBtn.disabled = true;
  dom.resultMessage.textContent = 'Spinning\u2026';
  dom.resultMessage.classList.add('result-message--empty');

  var winnerIndex = pickEligibleIndex();
  var winner      = state.participants[winnerIndex];

  var sliceAngle      = (Math.PI * 2) / state.participants.length;
  var targetSliceCenter = winnerIndex * sliceAngle + sliceAngle / 2;
  var pointerAngle    = -Math.PI / 2;
  var desiredRotation = pointerAngle - targetSliceCenter;
  var fullSpins       = 5 + Math.floor(Math.random() * 3);
  var startRotation   = state.rotation;
  var endRotation     = startRotation + fullSpins * Math.PI * 2 +
    normalizeAngle(desiredRotation - normalizeAngle(startRotation));

  var duration  = 4200;
  var startTime = performance.now();

  function animate(now) {
    var elapsed  = now - startTime;
    var progress = Math.min(elapsed / duration, 1);
    var eased    = 1 - Math.pow(1 - progress, 3);

    state.rotation = startRotation + (endRotation - startRotation) * eased;
    drawWheel();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      openCelebrationModal(winner);
    }
  }

  requestAnimationFrame(animate);
}

/* ── Celebration modal ──────────────────────────────────────────── */
function openCelebrationModal(winner) {
  state.pendingWinner = winner;

  // Populate winner name
  dom.modalWinnerName.textContent = winner.name;

  // Pre-fill date inputs
  var range = getResponsibilityWeekRange(new Date());
  dom.modalStartDate.value = toIsoDateSafe(range.start);
  dom.modalEndDate.value   = toIsoDateSafe(range.end);

  // Reset countdown
  dom.modalCountdown.textContent = String(COUNTDOWN_SECONDS);
  dom.modalAcceptBtn.disabled    = true;

  // Show modal
  dom.modalOverlay.hidden = false;

  // Fire confetti
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.5 },
    });
  }

  // Start countdown
  var remaining = COUNTDOWN_SECONDS;
  state.countdownTimer = setInterval(function () {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
      dom.modalCountdown.textContent = '';
      dom.modalAcceptBtn.textContent = 'Accept & Download';
      dom.modalAcceptBtn.disabled    = false;
    } else {
      dom.modalCountdown.textContent = String(remaining);
    }
  }, 1000);
}

function closeModal() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  dom.modalOverlay.hidden = true;
  // Restore accept button label for next open
  dom.modalAcceptBtn.innerHTML =
    'Accept &amp; Download (<span id="modal-countdown">' + COUNTDOWN_SECONDS + '</span>s)';
  dom.modalAcceptBtn.disabled = true;
  // Re-cache the countdown span after innerHTML replacement
  dom.modalCountdown = document.getElementById('modal-countdown');
}

function handleModalCancel() {
  closeModal();
  state.pendingWinner = null;
  state.isSpinning    = false;
  dom.spinBtn.disabled = state.participants.length < 2;
  renderResultMessage();
}

function handleModalAccept() {
  if (!state.pendingWinner) return;

  var startVal = dom.modalStartDate.value;
  var endVal   = dom.modalEndDate.value;

  if (!startVal || !endVal) {
    setStatus('Please select both start and end dates before confirming.', 'warning');
    return;
  }

  var startDate = parseIsoDate(startVal);
  var endDate   = parseIsoDate(endVal);
  var weekRange = formatShortDate(startDate) + ' - ' + formatShortDate(endDate);
  var today     = new Date();

  state.history.push({
    id:            generateId('history'),
    winnerName:    state.pendingWinner.name,
    selectionDate: toIsoDateSafe(today),
    weekRange:     weekRange,
  });

  closeModal();
  state.pendingWinner = null;
  state.isSpinning    = false;

  downloadJson(true);
  renderAll();
  setStatus(
    state.history[state.history.length - 1].winnerName + ' confirmed for ' + weekRange + '. File downloaded.',
    'success'
  );
}

/* ── Bootstrap ──────────────────────────────────────────────────── */
init();

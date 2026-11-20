// MISS-ME dashboard — wiring for the sentry demo.
// The triage itself lives in ai.js; this file only drives the page.

import { triageEvent } from './ai.js';
import { isFirebaseConfigured } from './firebase-config.js';
import {
  loadNameWatch,
  saveNameWatch,
  suggestCoverName,
  normalizeVariant,
  findWatchedName,
  COVER_NAMES,
} from './namewatch.js';

const $ = (id) => document.getElementById(id);

const SAMPLES = {
  phish:
    'URGENT: Your account will be closed in 24 hours. Verify your password and Social Security number now by clicking the link below to keep your account open.',
  legit:
    'Hi, your dentist appointment is confirmed for Tuesday at 10:30 AM. Reply C to confirm, or call us to reschedule.',
  grey:
    "Hello, this is your bank's security team. We noticed unusual activity and need you to confirm your identity. Please call the number on the back of your card.",
};

const LOG_KEY = 'missme.events.v1';
let events = [];
let sleepTimer = null;

try {
  events = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
} catch {
  events = [];
}

function saveEvents() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(events.slice(0, 100)));
  } catch {
    // Storage full or unavailable — the log is a nicety, not the product.
  }
}

function setStatus(word, detail, dotClass) {
  $('status-word').textContent = word;
  $('status-detail').textContent = detail;
  $('status-dot').className = 'dot ' + dotClass;
}

function goToSleep() {
  setStatus('SLEEPING', 'The sentry is quiet. Nothing has knocked.', 'sleeping');
}

function renderLog() {
  const list = $('event-log');
  list.innerHTML = '';
  if (events.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No events yet. Trip the sentry above, or load the extension and browse.';
    list.appendChild(li);
    return;
  }
  for (const ev of events) {
    const li = document.createElement('li');
    const verdictClass = ev.verdict.toLowerCase();
    li.innerHTML =
      `<strong>${escapeHtml(ev.verdict)}</strong>` +
      ` <span class="badge ${ev.route === 'CLOUD' ? 'cloud' : 'on-device'}">${escapeHtml(ev.route)}</span>` +
      ` <span class="muted">· ${escapeHtml(ev.kind)} · ${escapeHtml(ev.when)} · ${ev.ms} ms · tier: ${escapeHtml(ev.tier)}</span>` +
      `<div class="ev-text">${escapeHtml(ev.text)}</div>` +
      (ev.remedy ? `<div class="ev-text"><strong>What to do:</strong> ${escapeHtml(ev.remedy)}</div>` : '');
    void verdictClass;
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function showVerdict(result, sourceText, matchedName) {
  const box = $('verdict');
  const cls = result.verdict === 'SAFE' ? 'safe' : result.verdict === 'SUSPICIOUS' ? 'suspicious' : 'uncertain';
  const headline =
    result.verdict === 'SAFE'
      ? 'Looks safe.'
      : result.verdict === 'SUSPICIOUS'
        ? 'Stop — this looks like a trap.'
        : 'Uncertain — treat with care.';
  const reasons = result.reasons.length
    ? `<ul>${result.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '';
  // The alert is the product: a light in the dark, a sound that breaks
  // through Do Not Disturb, and the remedy — not a cloud report.
  const alert =
    result.verdict === 'SUSPICIOUS' || result.route === 'CLOUD'
      ? `<div class="alert-flash"><span class="alert-dot"></span>SENTRY ALERT — this breaks through Do Not Disturb. Only airplane mode silences it.</div>`
      : '';
  const nameWatchNote = matchedName
    ? `<div class="namewatch-note"><strong>Name Watch:</strong> the sentry spotted one of your watched names in this message — “${escapeHtml(matchedName)}”. It kept this message on-device and did not send it to the cloud.</div>`
    : '';
  box.className = 'verdict ' + cls;
  box.innerHTML =
    `<h3>${headline}<span class="badge ${result.route === 'CLOUD' ? 'cloud' : 'on-device'}">${result.route === 'CLOUD' ? 'CLOUD' : 'ON-DEVICE'}</span></h3>` +
    alert +
    nameWatchNote +
    reasons +
    `<p class="remedy"><strong>What to do:</strong> ${escapeHtml(result.remedy || '')}</p>` +
    `<p>${escapeHtml(result.note)}</p>` +
    `<p class="meta">Tier: ${escapeHtml(result.tier)} · score ${result.score}/100 · confidence ${result.confidence}% · ${result.ms} ms</p>`;
}

async function runTriage(kind, text) {
  const btn = $('analyze-btn');
  btn.disabled = true;
  clearTimeout(sleepTimer);
  setStatus('AWAKE', 'The sentry woke up. Triaging…', 'awake');
  $('engine-state').textContent = 'triaging on-device…';
  // Name Watch: if the message carries a watched name, the sentry flags
  // it as a name-watch event and forces on-device-only triage — the
  // variants list and the message never reach the cloud.
  const matchedName = findWatchedName(text, nameWatch.variants);
  const eventKind = matchedName ? 'name-watch' : kind;
  const keepLocal = Boolean(matchedName);
  try {
    const result = await triageEvent({ kind: eventKind, text, source: 'dashboard', keepLocal });
    events.unshift({
      kind: eventKind,
      text: text.length > 280 ? text.slice(0, 280) + '…' : text,
      verdict: result.verdict,
      route: result.route,
      tier: result.tier,
      remedy: result.remedy,
      ms: result.ms,
      when: new Date().toLocaleTimeString(),
    });
    saveEvents();
    renderLog();
    showVerdict(result, text, matchedName);
    if (result.route === 'CLOUD') {
      setStatus('ESCALATED', 'On-device checks could not settle it — the cloud sent back a notification and a suggested remedy.', 'escalated');
      $('engine-state').textContent = 'cloud check used (Firebase AI Logic) — verdict + remedy only';
      sleepTimer = setTimeout(goToSleep, 12000);
    } else {
      $('engine-state').textContent = 'settled on-device — nothing left the device';
      sleepTimer = setTimeout(goToSleep, 5000);
    }
    return result;
  } finally {
    btn.disabled = false;
  }
}

$('analyze-btn').addEventListener('click', () => {
  const text = $('probe-text').value.trim();
  if (!text) {
    $('probe-text').focus();
    return;
  }
  runTriage('pasted-message', text);
});

$('sample-phish').addEventListener('click', () => {
  $('probe-text').value = SAMPLES.phish;
  runTriage('pasted-message', SAMPLES.phish);
});
$('sample-legit').addEventListener('click', () => {
  $('probe-text').value = SAMPLES.legit;
  runTriage('pasted-message', SAMPLES.legit);
});
$('sample-grey').addEventListener('click', () => {
  $('probe-text').value = SAMPLES.grey;
  runTriage('pasted-message', SAMPLES.grey);
});

$('sim-password').addEventListener('click', () => {
  runTriage(
    'insecure-password-field',
    'Page is not using HTTPS and contains a password field. The page asks the visitor to type a password where anyone on the network could read it.',
  );
});
$('sim-form').addEventListener('click', () => {
  runTriage(
    'sensitive-form',
    'A form on this page asks for a card number, expiry date and CVV, and the page also asks for the account password.',
  );
});

$('clear-log').addEventListener('click', () => {
  events = [];
  saveEvents();
  renderLog();
  goToSleep();
});

// ---- Name Watch setup ---------------------------------------------------
// Variants and the cover name live in this browser only (localStorage).
// They are never sent anywhere — see namewatch.js.

let nameWatch = loadNameWatch();
// Index into COVER_NAMES for the suggestion on screen. Derived from the
// first variant when the list changes; "Suggest another" steps it along.
let coverIdx = null;

function currentSuggestion() {
  if (coverIdx === null) {
    coverIdx = COVER_NAMES.indexOf(suggestCoverName(nameWatch.variants[0] || ''));
    if (coverIdx < 0) coverIdx = 0;
  }
  return COVER_NAMES[coverIdx];
}

function renderNameWatch() {
  const list = $('variant-list');
  list.innerHTML = '';
  if (nameWatch.variants.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No watched names yet. Add a variation above.';
    list.appendChild(li);
  } else {
    for (const v of nameWatch.variants) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = v;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost';
      btn.textContent = 'Remove';
      btn.addEventListener('click', () => {
        nameWatch.variants = nameWatch.variants.filter((x) => x !== v);
        coverIdx = null;
        saveNameWatch(nameWatch);
        renderNameWatch();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }
  const coverBox = $('cover-box');
  if (nameWatch.variants.length === 0) {
    coverBox.classList.add('hidden');
  } else {
    coverBox.classList.remove('hidden');
    $('cover-suggestion').textContent = currentSuggestion();
    $('cover-status').textContent = nameWatch.coverName
      ? `Cover name in use: ${nameWatch.coverName}. The sentry safeguards everything under this name.`
      : 'No cover name set yet.';
  }
}

function addVariantFromInput() {
  const v = normalizeVariant($('variant-input').value);
  if (v.length < 2) {
    $('variant-input').focus();
    return;
  }
  if (!nameWatch.variants.includes(v)) {
    nameWatch.variants.push(v);
    coverIdx = null;
    saveNameWatch(nameWatch);
  }
  $('variant-input').value = '';
  renderNameWatch();
  $('variant-input').focus();
}

$('add-variant').addEventListener('click', addVariantFromInput);
$('variant-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addVariantFromInput();
});

$('use-cover').addEventListener('click', () => {
  nameWatch.coverName = currentSuggestion();
  saveNameWatch(nameWatch);
  renderNameWatch();
});
$('new-cover').addEventListener('click', () => {
  coverIdx = (coverIdx + 1) % COVER_NAMES.length;
  $('cover-suggestion').textContent = COVER_NAMES[coverIdx];
});
$('save-cover').addEventListener('click', () => {
  const v = normalizeVariant($('cover-input').value);
  if (v.length < 2) {
    $('cover-input').focus();
    return;
  }
  nameWatch.coverName = v;
  $('cover-input').value = '';
  saveNameWatch(nameWatch);
  renderNameWatch();
});

renderNameWatch();

// Cloud status line.
if (isFirebaseConfigured()) {
  $('cloud-state').textContent = 'configured — cloud check available';
} else {
  $('cloud-state').textContent = 'not configured — running fully on-device';
}

renderLog();
goToSleep();

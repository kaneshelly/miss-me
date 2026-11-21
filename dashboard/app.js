// MISS-ME dashboard — wiring for the sentry demo.
// The triage itself lives in ai.js; this file only drives the page.

import { triageEvent } from './ai.js';
import { isFirebaseConfigured } from './firebase-config.js';
import {
  loadWatch,
  saveNameWatch,
  suggestCoverName,
  normalizeVariant,
  findWatchedName,
  findWatchedPlace,
  findKnownPlaceWord,
  savePlaces,
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

function showVerdict(result, sourceText, matchedName, matchedPlace, placeUnknown) {
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
  const placeNote = matchedPlace
    ? `<div class="namewatch-note"><strong>My places:</strong> this message connects your name to one of your places — “${escapeHtml(matchedPlace)}”. It could be the real place, or someone pretending to be it. Open the real app yourself — never tap the link.</div>`
    : '';
  const placeUnknownNote = placeUnknown
    ? `<div class="namewatch-note"><strong>Low-risk flag:</strong> your name appeared next to “${escapeHtml(placeUnknown)}” — a place you do not use. Whoever wrote this does not know where you really are. Noted, nothing to do.</div>`
    : '';
  box.className = 'verdict ' + cls;
  box.innerHTML =
    `<h3>${headline}<span class="badge ${result.route === 'CLOUD' ? 'cloud' : 'on-device'}">${result.route === 'CLOUD' ? 'CLOUD' : 'ON-DEVICE'}</span></h3>` +
    alert +
    nameWatchNote +
    placeNote +
    placeUnknownNote +
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
  // My places: if the message carries a watched name AND one of the
  // user's places, it is a place-match event — any cue that puts your
  // name together with your bank gets flagged, and the combination never
  // reaches the cloud either.
  const matchedName = findWatchedName(text, nameWatch.variants);
  const matchedPlace = matchedName ? findWatchedPlace(text, places) : null;
  // Low-risk branch: a watched name next to a well-known place that is
  // NOT one of the user's places — the writer is looking for the user
  // somewhere they are not located.
  const placeUnknown = matchedName && !matchedPlace ? findKnownPlaceWord(text, places) : null;
  const eventKind = matchedPlace
    ? 'place-match'
    : placeUnknown
      ? 'place-low-risk'
      : matchedName
        ? 'name-watch'
        : kind;
  const keepLocal = Boolean(matchedName || matchedPlace);
  try {
    const result = await triageEvent({ kind: eventKind, text, source: 'dashboard', keepLocal, placeMatch: matchedPlace, placeUnknown });
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
    showVerdict(result, text, matchedName, matchedPlace, placeUnknown);
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

// ---- Storm the gate -----------------------------------------------------
// A thief probes the app and the page reports what it found — counted from
// what is actually stored, not from a script. Passwords, accounts and
// payment details are always zero: the app never asks for or stores them.
// Watched names and events are counted honestly, and shown as on-device
// only — never sent anywhere.
$('storm-btn').addEventListener('click', () => {
  const box = $('storm-result');
  const rows = [
    ['Passwords', 0, 'never asked for, never stored, never read'],
    ['Accounts', 0, 'there is no account to break into'],
    ['Payment details', 0, 'no card on file'],
    ['Names sent to the cloud', 0, 'watched names never leave this device'],
    ['Events kept in this browser', events.length, 'on this device only — clearable any time'],
    ['Watched names on this device', nameWatch.variants.length, 'on this device only — never sent anywhere'],
  ];
  box.classList.remove('hidden');
  box.innerHTML =
    `<h3>Storm report — what a thief would find: nothing.</h3>` +
    `<ul>${rows.map(([label, n, note]) => `<li><strong>${escapeHtml(label)}:</strong> ${n} <span class="muted">— ${escapeHtml(note)}</span></li>`).join('')}</ul>` +
    `<p><strong>Taken: nothing.</strong> The vault is empty by design — that is the protection.</p>`;
});

// ---- Name Watch setup ---------------------------------------------------
// Variants and the cover name live in this browser only (localStorage).
// They are never sent anywhere — see namewatch.js. The stored list is
// the Gray Code: your real names hidden among about a hundred decoy
// names, verifiable only on this device. `loadWatch` resolves the real
// ones at startup; the UI shows only your real list.
const watch = await loadWatch();
let nameWatch = { variants: watch.variants, coverName: watch.coverName };
let nameEntryCount = watch.nameEntryCount;
let places = watch.places;
let placeEntryCount = watch.placeEntryCount;
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
      btn.addEventListener('click', async () => {
        nameWatch.variants = nameWatch.variants.filter((x) => x !== v);
        coverIdx = null;
        nameEntryCount = await saveNameWatch(nameWatch);
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
  // The Gray Code, in plain sight: your names are hidden among the
  // mixed store's syllable fragments, and only this device can tell which are yours.
  $('nw-hidden-line').textContent =
    nameEntryCount > 0
      ? `Hidden among ${nameEntryCount} syllable fragments in the store — every fragment looks the same, and only this device can tell which are yours.`
      : '';
}

async function addVariantFromInput() {
  const v = normalizeVariant($('variant-input').value);
  if (v.length < 2) {
    $('variant-input').focus();
    return;
  }
  if (!nameWatch.variants.includes(v)) {
    nameWatch.variants.push(v);
    coverIdx = null;
    nameEntryCount = await saveNameWatch(nameWatch);
  }
  $('variant-input').value = '';
  renderNameWatch();
  $('variant-input').focus();
}

$('add-variant').addEventListener('click', addVariantFromInput);
$('variant-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addVariantFromInput();
});

$('use-cover').addEventListener('click', async () => {
  nameWatch.coverName = currentSuggestion();
  nameEntryCount = await saveNameWatch(nameWatch);
  renderNameWatch();
});
$('new-cover').addEventListener('click', () => {
  coverIdx = (coverIdx + 1) % COVER_NAMES.length;
  $('cover-suggestion').textContent = COVER_NAMES[coverIdx];
});
$('save-cover').addEventListener('click', async () => {
  const v = normalizeVariant($('cover-input').value);
  if (v.length < 2) {
    $('cover-input').focus();
    return;
  }
  nameWatch.coverName = v;
  $('cover-input').value = '';
  nameEntryCount = await saveNameWatch(nameWatch);
  renderNameWatch();
});

renderNameWatch();

// ---- My places ----------------------------------------------------------
// Where the user lives online — their bank, their email, anywhere their
// name and their money meet. Stored on this device only, never sent
// anywhere. Any cue that puts a watched name together with a watched
// place gets flagged as a place-match event. The stored list is the gray
// coat: your real places hidden among about a hundred decoy banks and
// portals, verifiable only on this device.
function renderPlaces() {
  const list = $('place-list');
  list.innerHTML = '';
  if (places.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No places yet. Add your bank, your email — anywhere your name and your money meet.';
    list.appendChild(li);
  } else {
    for (const p of places) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = p;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost';
      btn.textContent = 'Remove';
      btn.addEventListener('click', async () => {
        places = places.filter((x) => x !== p);
        placeEntryCount = await savePlaces(places);
        renderPlaces();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }
  $('pl-hidden-line').textContent =
    placeEntryCount > 0
      ? `Hidden among ${placeEntryCount} syllable fragments in the store — banks and portals, all random-looking, and only this device can tell which are yours.`
      : '';
}

async function addPlaceFromInput() {
  const v = normalizeVariant($('place-input').value);
  if (v.length < 2) {
    $('place-input').focus();
    return;
  }
  if (!places.includes(v)) {
    places.push(v);
    placeEntryCount = await savePlaces(places);
  }
  $('place-input').value = '';
  renderPlaces();
  $('place-input').focus();
}

$('add-place').addEventListener('click', addPlaceFromInput);
$('place-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addPlaceFromInput();
});

renderPlaces();

// Cloud status line.
if (isFirebaseConfigured()) {
  $('cloud-state').textContent = 'configured — cloud check available';
} else {
  $('cloud-state').textContent = 'not configured — running fully on-device';
}

renderLog();
goToSleep();

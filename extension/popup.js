// MISS-ME popup — shows what the sentry has caught, newest first.
// Reads only the extension's own local storage. Nothing leaves the device.

const STORE_KEY = 'missme.events.v1';
const list = document.getElementById('event-list');
const statusText = document.getElementById('status-text');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function render() {
  const stored = await chrome.storage.local.get(STORE_KEY);
  const events = stored[STORE_KEY] || [];
  if (events.length === 0) {
    list.innerHTML = '<li class="empty">No events yet. The sentry is asleep — it only wakes when something triggers it.</li>';
    statusText.textContent = 'SLEEPING — nothing has knocked.';
    return;
  }
  const latest = events[0];
  statusText.textContent =
    latest.verdict === 'SUSPICIOUS'
      ? 'AWAKE — caught something suspicious.'
      : latest.verdict === 'UNCERTAIN'
        ? 'AWAKE — one event is still uncertain.'
        : 'SLEEPING — last check was safe.';
  list.innerHTML = events
    .slice(0, 10)
    .map(
      (ev) =>
        `<li><strong>${escapeHtml(ev.verdict)}</strong>` +
        `<span class="badge ${ev.route === 'CLOUD' ? 'cloud' : 'on-device'}">${escapeHtml(ev.route)}</span>` +
        `<div>${escapeHtml(ev.kind)}</div>` +
        (ev.remedy ? `<div class="muted">What to do: ${escapeHtml(ev.remedy)}</div>` : '') +
        `<div class="muted">${escapeHtml(ev.when)} · ${ev.ms} ms · tier: ${escapeHtml(ev.tier)}</div></li>`,
    )
    .join('');
}

document.getElementById('clear-btn').addEventListener('click', async () => {
  await chrome.storage.local.set({ [STORE_KEY]: [] });
  chrome.action.setBadgeText({ text: '' });
  render();
});

document.getElementById('repo-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://github.com/kaneshelly/miss-me' });
});

render();

// ---- Name Watch setup -----------------------------------------------------
// Same storage key and shape as the dashboard (dashboard/namewatch.js).
// Variants live in this browser's local extension storage only — they are
// never sent anywhere. The stored list is the Gray Code: real variants
// hidden among about a hundred decoy names, verifiable only on this
// device. The popup shows only the real list.
const NW_KEY = 'missme.namewatch.v1';
const COVER_NAMES = [
  'Alex Rivers',
  'Sam Carter',
  'Jordan Lee',
  'Casey Morgan',
  'Taylor Brooks',
  'Jamie Hayes',
  'Robin Ellis',
  'Avery Stone',
  'Morgan Hale',
  'Riley Quinn',
];

function nwHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function nwSuggest(seed) {
  return COVER_NAMES[nwHash(String(seed || '')) % COVER_NAMES.length];
}

let nwState = { variants: [], coverName: '' };
let nwEntryCount = 0;

async function nwLoad() {
  const stored = await chrome.storage.local.get(NW_KEY);
  const data = stored[NW_KEY] || {};
  if (Array.isArray(data.entries)) {
    const key = await MissMeDecoys.getOrCreateDeviceKey();
    if (data.entries.length > 0 && Array.isArray(data.entries[0].p)) {
      nwState = {
        variants: await MissMeSyllables.reassembleSyllables(data.entries, key),
        coverName: typeof data.coverName === 'string' ? data.coverName : '',
      };
      nwEntryCount = data.entries.length;
    } else {
      // Old whole-word shape — migrate to syllables.
      nwState = {
        variants: data.entries.map((e) => (typeof e === 'string' ? e : e.v)),
        coverName: typeof data.coverName === 'string' ? data.coverName : '',
      };
      nwEntryCount = await nwSave();
    }
  } else if (Array.isArray(data.variants)) {
    nwState = {
      variants: data.variants,
      coverName: typeof data.coverName === 'string' ? data.coverName : '',
    };
    nwEntryCount = await nwSave();
  } else {
    nwState = { variants: [], coverName: '' };
    nwEntryCount = 0;
  }
}

async function nwSave() {
  const key = await MissMeDecoys.getOrCreateDeviceKey();
  const entries = await MissMeSyllables.mixSyllableStore(nwState.variants, MissMeDecoys.DECOY_NAMES, key);
  await chrome.storage.local.set({ [NW_KEY]: { entries, coverName: nwState.coverName } });
  return entries.length;
}

function nwRender() {
  const list = document.getElementById('nw-list');
  list.innerHTML = '';
  if (nwState.variants.length === 0) {
    list.innerHTML = '<li class="empty">No watched names yet.</li>';
  } else {
    for (const v of nwState.variants) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = v;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Remove';
      btn.addEventListener('click', async () => {
        nwState.variants = nwState.variants.filter((x) => x !== v);
        nwEntryCount = await nwSave();
        nwRender();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }
  const line = document.getElementById('nw-cover-line');
  const useBtn = document.getElementById('nw-use-cover');
  if (nwState.variants.length === 0) {
    line.textContent = '';
    useBtn.style.display = 'none';
  } else {
    useBtn.style.display = '';
    line.textContent = nwState.coverName
      ? `Cover name in use: ${nwState.coverName}.`
      : `Suggested cover name: ${nwSuggest(nwState.variants[0])}.`;
  }
  document.getElementById('nw-hidden-line').textContent =
    nwEntryCount > 0
      ? `Hidden among ${nwEntryCount} syllable fragments in the store — only this device can tell which are yours.`
      : '';
}

document.getElementById('nw-add').addEventListener('click', async () => {
  const input = document.getElementById('nw-input');
  const v = input.value.trim().replace(/\s+/g, ' ');
  if (v.length < 2) {
    input.focus();
    return;
  }
  if (!nwState.variants.includes(v)) {
    nwState.variants.push(v);
    nwEntryCount = await nwSave();
  }
  input.value = '';
  nwRender();
  input.focus();
});

document.getElementById('nw-use-cover').addEventListener('click', async () => {
  if (nwState.variants.length === 0) return;
  nwState.coverName = nwSuggest(nwState.variants[0]);
  nwEntryCount = await nwSave();
  nwRender();
});

nwLoad().then(nwRender);

// ---- My places setup ------------------------------------------------------
// Same storage key and shape as the dashboard (dashboard/namewatch.js).
// Places live in this browser's local extension storage only — they are
// never sent anywhere. The stored list is the Gray Code: real places
// hidden among about a hundred decoy banks and portals, verifiable only
// on this device. The popup shows only the real list.

const PL_KEY = 'missme.places.v1';

let plPlaces = [];
let plEntryCount = 0;

async function plLoad() {
  const stored = await chrome.storage.local.get(PL_KEY);
  const data = stored[PL_KEY];
  if (data && Array.isArray(data.entries)) {
    const key = await MissMeDecoys.getOrCreateDeviceKey();
    if (data.entries.length > 0 && Array.isArray(data.entries[0].p)) {
      plPlaces = await MissMeSyllables.reassembleSyllables(data.entries, key);
      plEntryCount = data.entries.length;
    } else {
      // Old whole-word shape — migrate to syllables.
      plPlaces = data.entries.map((e) => (typeof e === 'string' ? e : e.v));
      plEntryCount = await plSave();
    }
  } else if (Array.isArray(data)) {
    plPlaces = data;
    plEntryCount = await plSave();
  } else {
    plPlaces = [];
    plEntryCount = 0;
  }
}

async function plSave() {
  const key = await MissMeDecoys.getOrCreateDeviceKey();
  const entries = await MissMeSyllables.mixSyllableStore(plPlaces, MissMeDecoys.DECOY_PLACES, key);
  await chrome.storage.local.set({ [PL_KEY]: { entries } });
  return entries.length;
}

function plRender() {
  const list = document.getElementById('pl-list');
  list.innerHTML = '';
  if (plPlaces.length === 0) {
    list.innerHTML = '<li class="empty">No places yet.</li>';
  } else {
    for (const v of plPlaces) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = v;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Remove';
      btn.addEventListener('click', async () => {
        plPlaces = plPlaces.filter((x) => x !== v);
        plEntryCount = await plSave();
        plRender();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }
  document.getElementById('pl-hidden-line').textContent =
    plEntryCount > 0
      ? `Hidden among ${plEntryCount} syllable fragments in the store — only this device can tell which are yours.`
      : '';
}

document.getElementById('pl-add').addEventListener('click', async () => {
  const input = document.getElementById('pl-input');
  const v = input.value.trim().replace(/\s+/g, ' ');
  if (v.length < 2) {
    input.focus();
    return;
  }
  if (!plPlaces.includes(v)) {
    plPlaces.push(v);
    plEntryCount = await plSave();
  }
  input.value = '';
  plRender();
  input.focus();
});

plLoad().then(plRender);

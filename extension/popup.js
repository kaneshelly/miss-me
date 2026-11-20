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
// never sent anywhere. The cover-name list mirrors dashboard/namewatch.js;
// keep the two in sync.

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

async function nwLoad() {
  const stored = await chrome.storage.local.get(NW_KEY);
  const data = stored[NW_KEY] || {};
  nwState = {
    variants: Array.isArray(data.variants) ? data.variants : [],
    coverName: typeof data.coverName === 'string' ? data.coverName : '',
  };
}

async function nwSave() {
  await chrome.storage.local.set({ [NW_KEY]: nwState });
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
        await nwSave();
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
    await nwSave();
  }
  input.value = '';
  nwRender();
  input.focus();
});

document.getElementById('nw-use-cover').addEventListener('click', async () => {
  if (nwState.variants.length === 0) return;
  nwState.coverName = nwSuggest(nwState.variants[0]);
  await nwSave();
  nwRender();
});

nwLoad().then(nwRender);

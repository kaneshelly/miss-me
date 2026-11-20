// MISS-ME — background service worker.
// The sentry sleeps here. It wakes only when the content script reports a
// trigger, or when the user asks it to check selected text. Every event is
// triaged on-device (see triage.js). Nothing leaves the device from this
// extension — the cloud check lives in the dashboard only.

importScripts('triage.js');

const STORE_KEY = 'missme.events.v1';
const NAME_WATCH_KEY = 'missme.namewatch.v1';
const MAX_EVENTS = 50;

// Notification icon, embedded as a data URL so the repo stays text-only.
// Green shield, 48x48.
const ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAABe0lEQVR4nO2ZMQ7CMAxFW8TMgMRNKrGwcZXOHIaZq3RjQeJQDEVtcGzH30nVIPWPbWK/2mkTu+3hdGxq0m5tAKp9zuTL6ybdep7vPputI2UKRyyUDACCOGIZyaxALM37+pDGd0PvY0oDxSgKh4VMx0oAERoIRcFSmDSgkMaNImFJTOJ3qDgNsSO9IjyQg4ZdxQ4mJmUoDUFBp5DcaVtH0nQ39HFg2It2yzRCU3h0GkeCFCNhkH4iZPkWWwKADg798iljnwxCsUxkvZh2ex8HayS5LucIGVdPWU2+Ju/VHdBqBVolX8TjyFBrhOrRBpTSBpTSBpTSF2g6kRTZRyGRU1GtEdK1RNUhaQbSs5bPJB36iHegHTNadCwy6GH4lCle0VChDYkfIGPHxM5kHClWHY35/bd4ctRADBA7x+HPXdbx3Q+omkZLab0HwkcoHAfVxZk0IpCPKZ+m+bMOGsuEYhXuMSpYOtmCXVidya7CfepQtXTyY9Xyr2NRfQDOkdeg65AdpgAAAABJRU5ErkJggg==';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'miss-me-check',
    title: 'Ask MISS-ME about this text',
    contexts: ['selection'],
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'MISS_ME_EVENT' && message.event) {
    handleEvent(message.event, sender.tab && sender.tab.url);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'miss-me-check' && info.selectionText) {
    handleEvent(
      { kind: 'selected-text', text: info.selectionText, source: 'context-menu' },
      tab && tab.url,
    );
  }
});

// Does this text carry one of the watched names? Mirrors
// dashboard/namewatch.js. Reads only the extension's own local storage;
// the variants never leave the device.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function carriesWatchedName(text) {
  const stored = await chrome.storage.local.get(NAME_WATCH_KEY);
  const data = stored[NAME_WATCH_KEY];
  const variants = data && Array.isArray(data.variants) ? data.variants : [];
  const input = String(text || '');
  for (const raw of variants) {
    const v = String(raw || '').trim().replace(/\s+/g, ' ');
    if (v.length < 2) continue;
    if (v.length <= 3) {
      if (new RegExp(`\\b${escapeRegExp(v)}\\b`, 'i').test(input)) return true;
    } else if (input.toLowerCase().includes(v.toLowerCase())) {
      return true;
    }
  }
  return false;
}

async function handleEvent(event, url) {
  // Name Watch: if the text carries one of the watched names, the event
  // is a name-watch event. The name itself is never stored in the event
  // record — only the kind — and the extension never calls the cloud.
  if (event.kind !== 'name-watch' && (await carriesWatchedName(event.text))) {
    event = { ...event, kind: 'name-watch' };
  }
  const result = await MissMeTriage.triageEvent(event);
  const record = {
    kind: event.kind,
    text: String(event.text || '').slice(0, 280),
    url: url || '',
    verdict: result.verdict,
    route: result.route,
    tier: result.tier,
    remedy: result.remedy,
    ms: result.ms,
    when: new Date().toLocaleTimeString(),
  };
  const stored = await chrome.storage.local.get(STORE_KEY);
  const events = stored[STORE_KEY] || [];
  events.unshift(record);
  await chrome.storage.local.set({ [STORE_KEY]: events.slice(0, MAX_EVENTS) });

  // Badge + notification: the sentry only speaks when it has something to
  // say. The notification is the alert — it breaks through Do Not Disturb
  // while you sleep (only airplane mode silences it) — and it carries the
  // suggested remedy, not a report. High priority, stays until dismissed.
  if (result.verdict === 'SUSPICIOUS') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: ICON_DATA_URL,
      title: 'MISS-ME — sentry alert',
      message: (result.reasons[0] || 'Suspicious request detected.') + ' ' + (result.remedy || ''),
      priority: 2,
      requireInteraction: true,
    });
  } else if (result.verdict === 'UNCERTAIN') {
    chrome.action.setBadgeText({ text: '?' });
    chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: ICON_DATA_URL,
      title: 'MISS-ME — needs a second look',
      message: result.remedy || 'On-device checks could not settle this.',
      priority: 2,
      requireInteraction: true,
    });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

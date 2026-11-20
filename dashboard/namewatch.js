// MISS-ME — Name Watch.
// A setup step: the user lists every variation of their name — every
// spelling, every way someone could search for them — and the sentry
// watches for those names. It also suggests one neutral cover name to
// keep their information under, safeguarded by the sentry.
//
// THE PRIVACY RULE, in code: name variants live ON THIS DEVICE ONLY.
// They are stored in localStorage (dashboard) or chrome.storage.local
// (extension) and are NEVER sent anywhere. The cloud check never
// receives them — see triageEvent's keepLocal flag in ai.js, and the
// extension never calls the cloud at all. The variants list is never
// passed to ai.js; only the message being triaged is. When a message
// contains a watched name, triage is forced on-device-only.
//
// This module is deliberately small and self-contained: a built-in list
// of neutral cover names, a deterministic suggestion, and a matcher.
// Nothing beyond the sentry slice lives in this repo: no extra identity
// machinery of any kind.

export const NAME_WATCH_KEY = 'missme.namewatch.v1';

// Built-in neutral cover names. The suggestion is a pick from this list;
// the user can always type their own instead.
export const COVER_NAMES = [
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

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Suggest one cover name from the built-in list. Deterministic for a
// given seed (the first variant, or ''), so the suggestion is stable.
export function suggestCoverName(seed) {
  const list = COVER_NAMES;
  const idx = hashString(String(seed || '')) % list.length;
  return list[idx];
}

export function normalizeVariant(v) {
  return String(v || '').trim().replace(/\s+/g, ' ');
}

// Escape a string for use inside a RegExp.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Find the first watched variant that appears in `text`, or null.
// Matching is case-insensitive on the exact spelling as listed.
// Short variants (3 characters or fewer) must match on a word boundary
// so a name like "Al" does not fire on the word "also".
export function findWatchedName(text, variants) {
  const input = String(text || '');
  if (!input) return null;
  const list = (variants || []).map(normalizeVariant).filter((v) => v.length >= 2);
  for (const v of list) {
    if (v.length <= 3) {
      const re = new RegExp(`\\b${escapeRegExp(v)}\\b`, 'i');
      if (re.test(input)) return v;
    } else if (input.toLowerCase().includes(v.toLowerCase())) {
      return v;
    }
  }
  return null;
}

// ---- On-device storage (dashboard: localStorage) -----------------------
// These helpers never touch the network. They only read/write this
// browser's local storage.

export function loadNameWatch() {
  const empty = { variants: [], coverName: '' };
  if (typeof localStorage === 'undefined') return empty;
  try {
    const raw = localStorage.getItem(NAME_WATCH_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      variants: Array.isArray(parsed.variants)
        ? parsed.variants.map(normalizeVariant).filter((v) => v.length >= 2)
        : [],
      coverName: typeof parsed.coverName === 'string' ? parsed.coverName : '',
    };
  } catch {
    return empty;
  }
}

export function saveNameWatch(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      NAME_WATCH_KEY,
      JSON.stringify({
        variants: (state.variants || []).map(normalizeVariant).filter((v) => v.length >= 2).slice(0, 50),
        coverName: typeof state.coverName === 'string' ? state.coverName.slice(0, 80) : '',
      }),
    );
  } catch {
    // Storage full or unavailable — Name Watch is a setup nicety, not
    // the product. The sentry still works without it.
  }
}

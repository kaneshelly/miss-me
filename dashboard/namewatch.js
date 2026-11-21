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
// THE GRAY CODE (see decoys.js): the variants are not stored plain.
// At inception — the first save — the app mixes the real variants with
// about a hundred decoy names and saves the whole lot as one flat
// snapshot clone: every entry the same shape, no timestamps, no
// add-order. Only this device's key can tell real from decoy. The same
// rule covers My places. An intruder who opens the store sees a hundred
// people and a hundred places and cannot tell which are yours.
//
// This module is deliberately small and self-contained: a built-in list
// of neutral cover names, a deterministic suggestion, and a matcher.
// Nothing beyond the sentry slice lives in this repo: no extra identity
// machinery of any kind.

import {
  DECOY_NAMES,
  DECOY_PLACES,
  getOrCreateDeviceKey,
} from './decoys.js';
import {
  SYLLABLE_STORE_SIZE,
  mixSyllableStore,
  reassembleSyllables,
} from './syllables.js';

export const NAME_WATCH_KEY = 'missme.namewatch.v1';

// My places: where the user lives online — their bank, their email,
// anywhere their name and their money meet. The sentry watches for a
// watched name and a watched place appearing TOGETHER: any cue that puts
// the two together gets flagged. The sentry cannot defend the bank's
// front door — that door is the bank's, not ours — so it defends the
// cues instead. Same privacy rule as names: the places list lives ON
// THIS DEVICE ONLY and is never sent anywhere. A message that matches a
// name and a place is forced on-device-only (keepLocal), so the
// combination never reaches the cloud.
export const PLACES_KEY = 'missme.places.v1';

// The two halves of the match never sit in the same store: names live
// under NAME_WATCH_KEY, places live under PLACES_KEY, and the event log
// under its own key. One breach cannot hand over name-plus-place
// together — and the sentry itself holds nothing worth taking.

// KNOWN_PLACE_WORDS — well-known banks and financial words, built in.
// Used for the low-risk branch: if a message carries a watched name
// next to one of these, but the place is NOT one of the user's places,
// the writer is looking for the user somewhere they are not located —
// a low-risk flag. If the place IS one of the user's places, the writer
// is privy to real information about them — that is the high flag
// (place-match). Keep this list in sync with extension/triage.js and
// extension/content.js, which carry their own copies.
export const KNOWN_PLACE_WORDS = [
  'Capital One',
  'Chase',
  'Bank of America',
  'Wells Fargo',
  'Citibank',
  'Citi',
  'US Bank',
  'PNC',
  'Truist',
  'TD Bank',
  'American Express',
  'Amex',
  'Discover',
  'Navy Federal',
  'USAA',
  'Ally Bank',
  'Marcus',
  'SoFi',
  'PayPal',
  'Venmo',
  'Cash App',
  'Zelle',
  'credit union',
  'crypto exchange',
];

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

// Find the first watched place that appears in `text`, or null.
// Same matching rule as findWatchedName: short entries (3 characters or
// fewer) must match on a word boundary.
export function findWatchedPlace(text, places) {
  const input = String(text || '');
  if (!input) return null;
  const list = (places || []).map(normalizeVariant).filter((v) => v.length >= 2);
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

// Find the first built-in place word that appears in `text` and is NOT
// one of the user's own places, or null. The caller checks this only
// when a watched name matched but no watched place did — the writer is
// looking for the user somewhere they are not located.
export function findKnownPlaceWord(text, places) {
  const input = String(text || '');
  if (!input) return null;
  const own = (places || []).map((p) => normalizeVariant(p).toLowerCase());
  for (const w of KNOWN_PLACE_WORDS) {
    if (own.includes(w.toLowerCase())) continue;
    if (w.length <= 3) {
      const re = new RegExp(`\\b${escapeRegExp(w)}\\b`, 'i');
      if (re.test(input)) return w;
    } else if (input.toLowerCase().includes(w.toLowerCase())) {
      return w;
    }
  }
  return null;
}

// ---- On-device storage (dashboard: localStorage) -----------------------
// These helpers never touch the network. They only read/write this
// browser's local storage. The stored shape is the Gray Code: a flat
// snapshot of syllable entries ({v, s, p}), real syllables and decoy
// syllables together, each at its own binary lattice position — see
// syllables.js. Old shapes (whole-word entries, or plain strings from
// before the Gray Code) are migrated on load: read as real, re-saved
// as syllables.

function readStored(key) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — the setup is a nicety, not the
    // product. The sentry still works without it.
  }
}

// Load and verify both stores. Returns the real values only, plus how
// many entries each mixed store holds (so the UI can say "hidden among
// N fragments"). Migrates old stores to the syllable shape.
export async function loadWatch() {
  const key = getOrCreateDeviceKey();

  const nameParsed = readStored(NAME_WATCH_KEY);
  let variants = [];
  let coverName = '';
  let nameEntryCount = 0;
  if (nameParsed) {
    if (Array.isArray(nameParsed.entries)) {
      if (nameParsed.entries.length > 0 && Array.isArray(nameParsed.entries[0].p)) {
        variants = await reassembleSyllables(nameParsed.entries, key);
        nameEntryCount = nameParsed.entries.length;
      } else {
        // Old whole-word shape — migrate: values are real, re-save as syllables.
        variants = nameParsed.entries.map((e) => (typeof e === 'string' ? e : e.v)).map(normalizeVariant).filter((v) => v.length >= 2);
        coverName = typeof nameParsed.coverName === 'string' ? nameParsed.coverName : '';
        nameEntryCount = await saveNameWatch({ variants, coverName });
      }
      if (typeof nameParsed.coverName === 'string') coverName = nameParsed.coverName;
    } else if (Array.isArray(nameParsed.variants)) {
      variants = nameParsed.variants.map(normalizeVariant).filter((v) => v.length >= 2);
      coverName = typeof nameParsed.coverName === 'string' ? nameParsed.coverName : '';
      nameEntryCount = await saveNameWatch({ variants, coverName });
    }
  }

  const placeParsed = readStored(PLACES_KEY);
  let places = [];
  let placeEntryCount = 0;
  if (placeParsed) {
    if (Array.isArray(placeParsed.entries)) {
      if (placeParsed.entries.length > 0 && Array.isArray(placeParsed.entries[0].p)) {
        places = await reassembleSyllables(placeParsed.entries, key);
        placeEntryCount = placeParsed.entries.length;
      } else {
        places = placeParsed.entries.map((e) => (typeof e === 'string' ? e : e.v)).map(normalizeVariant).filter((v) => v.length >= 2);
        placeEntryCount = await savePlaces(places);
      }
    } else if (Array.isArray(placeParsed)) {
      places = placeParsed.map(normalizeVariant).filter((v) => v.length >= 2);
      placeEntryCount = await savePlaces(places);
    }
  }

  return { variants, coverName, places, nameEntryCount, placeEntryCount };
}

// Save Name Watch as a mixed snapshot clone of syllables: real names
// broken into syllables and hidden among decoy syllables, each at its
// own binary lattice position. Returns how many entries the mixed
// store now holds, for the "hidden among N" line.
export async function saveNameWatch(state) {
  const key = getOrCreateDeviceKey();
  const variants = (state.variants || []).map(normalizeVariant).filter((v) => v.length >= 2).slice(0, 50);
  const entries = await mixSyllableStore(variants, DECOY_NAMES, key);
  writeStored(NAME_WATCH_KEY, {
    entries,
    coverName: typeof state.coverName === 'string' ? state.coverName.slice(0, 80) : '',
  });
  return entries.length;
}

// Save My places as a mixed snapshot clone of syllables, same rule.
export async function savePlaces(places) {
  const key = getOrCreateDeviceKey();
  const real = (places || []).map(normalizeVariant).filter((v) => v.length >= 2).slice(0, 50);
  const entries = await mixSyllableStore(real, DECOY_PLACES, key);
  writeStored(PLACES_KEY, { entries });
  return entries.length;
}

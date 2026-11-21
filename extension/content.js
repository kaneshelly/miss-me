// MISS-ME — content script: the tripwire.
// Watches the page for the triggers the sentry cares about and reports each
// one exactly once per page load. It never reads passwords, never collects
// credentials, and never sends page content anywhere — it sends a short
// description of the trigger to the background worker, which triages it
// on-device.

(() => {
  const fired = new Set();

  // Watched names, loaded from the extension's own local storage.
  // The stored list is the Gray Code (see decoys.js): real variants
  // hidden among about a hundred decoy names. Only this device's key
  // can tell real from decoy, so the content script verifies the store
  // before matching — the name that matched is never reported, only the
  // trigger kind.
  const NAME_WATCH_KEY = 'missme.namewatch.v1';
  let watchedVariants = [];
  // My places, loaded the same way. The sentry watches for a watched
  // name and a watched place appearing TOGETHER — any cue that puts
  // your name together with your bank. The places list never leaves
  // this device; only the trigger kind is reported, never the name or
  // the place that matched.
  const PLACES_KEY = 'missme.places.v1';
  let watchedPlaces = [];

  async function loadWatch() {
    const key = await MissMeDecoys.getOrCreateDeviceKey();
    const stored = await chrome.storage.local.get([NAME_WATCH_KEY, PLACES_KEY]);
    const nameData = stored[NAME_WATCH_KEY];
    if (nameData && Array.isArray(nameData.entries)) {
      watchedVariants =
        nameData.entries.length > 0 && Array.isArray(nameData.entries[0].p)
          ? await MissMeSyllables.reassembleSyllables(nameData.entries, key)
          : nameData.entries.map((e) => (typeof e === 'string' ? e : e.v));
    } else if (nameData && Array.isArray(nameData.variants)) {
      watchedVariants = nameData.variants; // old plain shape — the popup migrates it on open
    }
    const placeData = stored[PLACES_KEY];
    if (placeData && Array.isArray(placeData.entries)) {
      watchedPlaces =
        placeData.entries.length > 0 && Array.isArray(placeData.entries[0].p)
          ? await MissMeSyllables.reassembleSyllables(placeData.entries, key)
          : placeData.entries.map((e) => (typeof e === 'string' ? e : e.v));
    } else if (Array.isArray(placeData)) {
      watchedPlaces = placeData; // old plain shape — the popup migrates it on open
    }
  }

  loadWatch();
  // If the user edits the lists in the popup while a page is open, the
  // sentry on this page reloads its watch.
  chrome.storage.onChanged.addListener(() => loadWatch());

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchesWatchedName(text) {
    const input = String(text || '');
    for (const raw of watchedVariants) {
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

  function matchesWatchedPlace(text) {
    const input = String(text || '');
    for (const raw of watchedPlaces) {
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

  // Well-known banks and financial words, built in. Mirrors
  // dashboard/namewatch.js and extension/triage.js — keep the three
  // copies in sync. A watched name next to one of these, where the
  // place is NOT one of the user's places, is a low-risk flag: the
  // writer is looking for the user somewhere they are not located.
  const KNOWN_PLACE_WORDS = [
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

  function matchesKnownPlaceWord(text) {
    const input = String(text || '');
    const own = watchedPlaces.map((p) => String(p || '').trim().toLowerCase());
    for (const w of KNOWN_PLACE_WORDS) {
      if (own.includes(w.toLowerCase())) continue;
      if (w.length <= 3) {
        if (new RegExp(`\\b${escapeRegExp(w)}\\b`, 'i').test(input)) return true;
      } else if (input.toLowerCase().includes(w.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  function report(kind, text) {
    if (fired.has(kind)) return;
    fired.add(kind);
    chrome.runtime.sendMessage({
      type: 'MISS_ME_EVENT',
      event: { kind, text, source: 'page-watch' },
    });
  }

  function checkTriggers() {
    // Trigger 1: a password field on a page that is not HTTPS.
    // Typing a password where anyone on the network can read it.
    const passwordField = document.querySelector('input[type="password"]');
    if (passwordField && window.location.protocol !== 'https:') {
      report(
        'insecure-password-field',
        'Page is not using HTTPS and contains a password field. The page asks the visitor to type a password where anyone on the network could read it.',
      );
    }

    // Trigger 2: a form asking for card or identity details together
    // with a password — the shape of a credential harvest.
    const forms = document.querySelectorAll('form');
    for (const form of forms) {
      const fields = Array.from(form.querySelectorAll('input, select, textarea'))
        .map((el) => `${el.name || ''} ${el.id || ''} ${el.type || ''} ${el.placeholder || ''}`.toLowerCase())
        .join(' ');
      const wantsCard = /card|cvv|cvc|expir/.test(fields);
      const wantsIdentity = /ssn|social security|sort code|routing number/.test(fields);
      const wantsPassword = /password/.test(fields);
      if ((wantsCard || wantsIdentity) && wantsPassword) {
        report(
          'sensitive-form',
          'A form on this page asks for card or identity details and also asks for the account password.',
        );
        break;
      }
    }

    // Trigger 3: the visible text of the page carries two or more strong
    // pressure / lure phrases at once.
    const bodyText = document.body ? document.body.innerText || '' : '';
    const pressurePhrases = [
      /account (will be )?(closed|suspended|locked)/i,
      /verify your (account|identity)/i,
      /urgent/i,
      /act (now|immediately)/i,
      /you('| a)?ve won/i,
      /claim your (prize|reward)/i,
      /confirm your (password|identity|details)/i,
    ];
    const hits = pressurePhrases.filter((p) => p.test(bodyText)).length;
    if (hits >= 2) {
      report(
        'suspicious-text',
        'This page carries several pressure phrases at once (urgency, account closure, verify identity). The sentry flagged the wording, not the site.',
      );
    }

    // Trigger 4: the page mentions one of the names the sentry is
    // watching for (Name Watch setup). Only the trigger is reported —
    // never the name itself, and never any page content.
    if (matchesWatchedName(bodyText)) {
      report(
        'name-watch',
        'This page mentions one of the names the sentry is watching for.',
      );
    }

    // Trigger 5: the page mentions one of the watched names TOGETHER
    // with one of the user's places (My places setup) — any cue that
    // puts your name together with your bank. Only the trigger is
    // reported — never the name, never the place, and never any page
    // content.
    if (matchesWatchedName(bodyText) && matchesWatchedPlace(bodyText)) {
      report(
        'place-match',
        'This page connects one of the names the sentry watches for with one of the places where your name and your money meet. Check it through the real app — never tap a link here.',
      );
    }

    // Trigger 6: the page mentions a watched name next to a well-known
    // place that is NOT one of the user's places — the writer is
    // looking for the user somewhere they are not located. Low-risk
    // flag: logged, no alarm. Only the trigger is reported — never the
    // name, never the place, and never any page content.
    if (
      matchesWatchedName(bodyText) &&
      !matchesWatchedPlace(bodyText) &&
      matchesKnownPlaceWord(bodyText)
    ) {
      report(
        'place-low-risk',
        'This page mentions one of the names the sentry watches for next to a place you do not use. Low risk — whoever wrote this does not know where you really are.',
      );
    }
  }

  // Run once the page has settled, and once more after late content loads.
  if (document.readyState === 'complete') {
    checkTriggers();
  } else {
    window.addEventListener('load', checkTriggers);
  }
  setTimeout(checkTriggers, 4000);
})();

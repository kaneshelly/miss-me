// MISS-ME — content script: the tripwire.
// Watches the page for the triggers the sentry cares about and reports each
// one exactly once per page load. It never reads passwords, never collects
// credentials, and never sends page content anywhere — it sends a short
// description of the trigger to the background worker, which triages it
// on-device.

(() => {
  const fired = new Set();

  // Watched names, loaded from the extension's own local storage.
  // Mirrors dashboard/namewatch.js — the matching rule is the same.
  // The variants never leave this device; only the trigger kind is
  // reported, never the name that matched.
  const NAME_WATCH_KEY = 'missme.namewatch.v1';
  let watchedVariants = [];
  chrome.storage.local.get(NAME_WATCH_KEY).then((stored) => {
    const data = stored[NAME_WATCH_KEY];
    if (data && Array.isArray(data.variants)) watchedVariants = data.variants;
  });

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
  }

  // Run once the page has settled, and once more after late content loads.
  if (document.readyState === 'complete') {
    checkTriggers();
  } else {
    window.addEventListener('load', checkTriggers);
  }
  setTimeout(checkTriggers, 4000);
})();

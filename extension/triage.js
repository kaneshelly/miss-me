// MISS-ME — on-device triage for the extension (classic script, loaded with
// importScripts in background.js).
// This mirrors shared/heuristic.js — the same signals, the same thresholds.
// If you change a signal here, change it there too.
// Pure functions, no network. Nothing leaves the device in this file.

const MissMeTriage = (() => {
  const THRESHOLDS = { SUSPICIOUS: 70, SAFE: 20 };

  const SIGNALS = [
    { pattern: /\b(password|passcode|pin\b)/i, weight: 30, label: 'Asks for a password or PIN' },
    { pattern: /\b(social security|ssn|national insurance)\b/i, weight: 30, label: 'Asks for a Social Security number' },
    { pattern: /\b(card number|credit card|debit card|cvv|cvc|expir(y|ation) date)\b/i, weight: 30, label: 'Asks for card details' },
    { pattern: /\b(bank account|routing number|sort code)\b/i, weight: 25, label: 'Asks for bank details' },
    { pattern: /\b(one[- ]time (code|passcode)|otp|verification code)\b/i, weight: 25, label: 'Asks for a one-time code' },
    { pattern: /\b(urgent|immediately|act now|within 24 hours|account (will be )?(closed|suspended|locked))\b/i, weight: 20, label: 'Urgency or threat language' },
    { pattern: /\b(you('| a)?ve won|congratulations.*won|claim your (prize|reward)|free (money|gift|iphone))\b/i, weight: 20, label: 'Prize or free-money lure' },
    { pattern: /\b(verify your (account|identity)|confirm your (account|identity|details)|update your (payment|billing))\b/i, weight: 15, label: 'Asks you to verify identity' },
    { pattern: /\b(click (here|the link)|follow (this )?link)\b/i, weight: 10, label: 'Pushes you to click a link' },
    { pattern: /\b(bank('| i)?s security|security (team|department)|fraud department|it (department|support))\b/i, weight: 10, label: 'Claims to be security or IT' },
    { pattern: /https?:\/\/\S+|bit\.ly|tinyurl|t\.co/i, weight: 10, label: 'Contains a link' },
    { pattern: /\b(dear customer|dear user|dear valued)\b/i, weight: 5, label: 'Generic greeting, no name' },
  ];

  const SAFE_SIGNALS = [
    { pattern: /\b(appointment|confirmed|reminder|reschedule)\b/i, weight: -15, label: 'Reads like an ordinary reminder' },
    { pattern: /\b(no action (needed|required)|no reply (needed|necessary))\b/i, weight: -10, label: 'Says no action is needed' },
    { pattern: /\b(thank you for (your|shopping|visiting))\b/i, weight: -5, label: 'Ordinary thank-you' },
  ];

  function scoreEvent(text) {
    const input = String(text || '');
    let score = 0;
    const signals = [];
    for (const s of SIGNALS) {
      if (s.pattern.test(input)) {
        score += s.weight;
        signals.push({ label: s.label, weight: s.weight });
      }
    }
    for (const s of SAFE_SIGNALS) {
      if (s.pattern.test(input)) {
        score += s.weight;
        signals.push({ label: s.label, weight: s.weight });
      }
    }
    score = Math.max(0, Math.min(100, score));
    return { score, signals };
  }

  function heuristicVerdict(score) {
    if (score >= THRESHOLDS.SUSPICIOUS) return 'SUSPICIOUS';
    if (score <= THRESHOLDS.SAFE) return 'SAFE';
    return 'UNCERTAIN';
  }

  function parseVerdict(text) {
    if (!text) return null;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      const verdict = String(obj.verdict || '').toUpperCase();
      if (!['SAFE', 'SUSPICIOUS', 'UNCERTAIN'].includes(verdict)) return null;
      return {
        verdict,
        confidence: Math.max(0, Math.min(100, Number(obj.confidence) || 50)),
        reason: String(obj.reason || ''),
      };
    } catch {
      return null;
    }
  }

  // The suggested remedy: what the person should do. This is what the
  // notification carries — the alert plus the remedy, nothing more.
  function remedyFor(verdict) {
    if (verdict === 'SUSPICIOUS') {
      return 'Do not click, reply, or send anything. Delete the message. If you already clicked, change your password from the real site or app — never from the link.';
    }
    if (verdict === 'UNCERTAIN') {
      return 'Do not reply yet. Check the sender through a channel you trust, and let the sentry take a second look.';
    }
    return 'Nothing to do. The sentry goes back to sleep.';
  }

  const NANO_PROMPT = `You are a careful security triage helper. Read the message below and reply with ONLY a JSON object, no other text:
{"verdict": "SAFE" | "SUSPICIOUS" | "UNCERTAIN", "confidence": 0-100, "reason": "one short sentence"}
A message is SUSPICIOUS if it asks for passwords, account numbers, card details, one-time codes, or pressures the reader to act fast. SAFE if it is an ordinary message with no request for sensitive information.
Message:
"""`;

  async function askNano(text) {
    if (typeof LanguageModel === 'undefined') return null;
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') return null;
    const session = await LanguageModel.create();
    try {
      const out = await session.prompt(NANO_PROMPT + text + '\n"""');
      return parseVerdict(out);
    } finally {
      session.destroy();
    }
  }

  // Triage one event on-device. The extension never calls the cloud:
  // an UNCERTAIN result is flagged for the user, who can open the
  // dashboard for a cloud check.
  // `event.placeMatch` is set by background.js when the text carries a
  // watched name AND one of the user's places: any cue that puts your
  // name together with your bank. A real message from your bank matches
  // too, so the verdict is UNCERTAIN, not SUSPICIOUS — with one remedy:
  // open the real app yourself, never tap the link.
  async function triageEvent(event) {
    const started = Date.now();
    const text = String(event.text || '');
    const { score, signals } = scoreEvent(text);
    const first = heuristicVerdict(score);
    // Place match — checked BEFORE any SAFE verdict: a cue that puts
    // your name together with one of your places is never waved
    // through as safe. A real message from your bank matches too, so
    // this is UNCERTAIN, not SUSPICIOUS — flagged, forced on-device,
    // never sent to the cloud.
    if (event.placeMatch && first !== 'SUSPICIOUS') {
      return {
        verdict: 'UNCERTAIN',
        route: 'ON-DEVICE',
        tier: 'place-match',
        confidence: 50,
        score,
        signals,
        reasons: [
          'This connects your name to one of your places. It could be your bank — or someone pretending to be it.',
        ],
        remedy:
          'Do not tap any link in it. Open the real app — or type the real address yourself — and check there.',
        note: 'Kept on-device because it connects your name to one of your places. Verify through the real app.',
        ms: Date.now() - started,
      };
    }
    // Low-risk flag — checked before any plain SAFE verdict: a watched
    // name next to a place you do NOT use. The writer is looking for
    // you somewhere you are not located, so they are not privy to real
    // information about you. Flagged and logged, but low risk.
    if (event.placeUnknown && first === 'SAFE') {
      return {
        verdict: 'SAFE',
        route: 'ON-DEVICE',
        tier: 'place-low-risk',
        confidence: 80,
        score,
        signals,
        reasons: [
          `Your name appeared next to ${event.placeUnknown} — a place you do not use. Whoever wrote this does not know where you really are.`,
        ],
        remedy: 'Nothing to do. Noted — the sentry keeps watching.',
        note: 'Low-risk flag: your name was seen with a place you are not located at.',
        ms: Date.now() - started,
      };
    }
    if (first !== 'UNCERTAIN') {
      const reasons = signals.filter((s) => s.weight > 0).map((s) => s.label);
      if (first === 'SUSPICIOUS' && event.placeMatch) {
        reasons.unshift(
          'This connects your name to one of your places — verify through the real app, never the link.',
        );
      }
      if (first === 'SUSPICIOUS' && event.placeUnknown) {
        reasons.unshift(
          `Your name appeared next to ${event.placeUnknown} — a place you do not use. Whoever wrote this does not know where you really are.`,
        );
      }
      return {
        verdict: first,
        route: 'ON-DEVICE',
        tier: 'heuristic',
        confidence: first === 'SUSPICIOUS' ? Math.min(99, score) : Math.max(70, 100 - score),
        score,
        signals,
        reasons,
        remedy: remedyFor(first),
        note: 'Settled on-device. Nothing left the device.',
        ms: Date.now() - started,
      };
    }
    try {
      const nano = await askNano(text);
      if (nano && nano.verdict !== 'UNCERTAIN' && nano.confidence >= 70) {
        return {
          verdict: nano.verdict,
          route: 'ON-DEVICE',
          tier: 'nano',
          confidence: nano.confidence,
          score,
          signals,
          reasons: [nano.reason || 'On-device model verdict.'],
          remedy: remedyFor(nano.verdict),
          note: 'Settled on-device by Gemini Nano. Nothing left the device.',
          ms: Date.now() - started,
        };
      }
    } catch (err) {
      console.warn('MISS-ME: on-device model unavailable:', err);
    }
    return {
      verdict: 'UNCERTAIN',
      route: 'ON-DEVICE',
      tier: 'unresolved',
      confidence: 50,
      score,
      signals,
      reasons: ['On-device checks could not settle this.'],
      remedy: remedyFor('UNCERTAIN'),
      note: 'Uncertain. Open the dashboard for a cloud check.',
      ms: Date.now() - started,
    };
  }

  // KNOWN_PLACE_WORDS — well-known banks and financial words, built in.
  // Mirrors dashboard/namewatch.js. Low-risk branch: a watched name next
  // to one of these, where the place is NOT one of the user's places,
  // means the writer is looking for the user somewhere they are not
  // located. Keep the three copies in sync (dashboard, here, content.js).
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

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizePlace(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
  }

  // First built-in place word in `text` that is NOT one of the user's
  // own places, or null.
  function findKnownPlaceWord(text, places) {
    const input = String(text || '');
    if (!input) return null;
    const own = (places || []).map((p) => normalizePlace(p).toLowerCase());
    for (const w of KNOWN_PLACE_WORDS) {
      if (own.includes(w.toLowerCase())) continue;
      if (w.length <= 3) {
        if (new RegExp(`\\b${escapeRegExp(w)}\\b`, 'i').test(input)) return w;
      } else if (input.toLowerCase().includes(w.toLowerCase())) {
        return w;
      }
    }
    return null;
  }

  return { scoreEvent, heuristicVerdict, triageEvent, findKnownPlaceWord, THRESHOLDS };
})();

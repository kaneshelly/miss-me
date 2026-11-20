// MISS-ME — deterministic on-device triage scorer.
// Pure functions, no network, no dependencies. Runs instantly on the device,
// costs nothing, and never sends anything anywhere.
// Mirrored in extension/triage.js (classic-script build of the same logic).
// If you change a signal here, change it there too.

export const THRESHOLDS = {
  // Score 70+ : clearly a threat — on-device verdict, no cloud needed.
  SUSPICIOUS: 70,
  // Score 20 or less : clearly benign — on-device verdict, no cloud needed.
  // (Threshold kept deliberately low: anything claiming to be a bank or
  // asking you to confirm your identity must not be waved through.)
  SAFE: 20,
  // Anything between is UNCERTAIN and is escalated to the next tier.
};

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

// Score a piece of text. Returns { score, signals }.
export function scoreEvent(text) {
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

// Tier 1 verdict from the deterministic score alone.
// Returns 'SAFE' | 'SUSPICIOUS' | 'UNCERTAIN'.
export function heuristicVerdict(score) {
  if (score >= THRESHOLDS.SUSPICIOUS) return 'SUSPICIOUS';
  if (score <= THRESHOLDS.SAFE) return 'SAFE';
  return 'UNCERTAIN';
}

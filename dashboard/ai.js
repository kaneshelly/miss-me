// MISS-ME — hybrid inference layer.
// The routing, in order, for every event the sentry wakes up for:
//
//   Tier 1 — On-device deterministic scorer (shared/heuristic.js).
//            Instant, free, private. Clear scores settle here:
//            70+ = SUSPICIOUS, 20 or less = SAFE. Nothing leaves the device.
//
//   Tier 2 — On-device model (Gemini Nano via Chrome's built-in Prompt API,
//            `LanguageModel`). Used ONLY when Tier 1 is UNCERTAIN.
//            If Nano is available and returns a confident verdict, we stop
//            here — still on-device, still private, still free.
//
//   Tier 3 — Cloud check (Firebase AI Logic, Gemini in the cloud).
//            Used ONLY when the on-device verdict is still UNCERTAIN, and
//            ONLY when a Firebase config has been supplied (see
//            firebase-config.js). The cloud does NO heavy lifting: it sends
//            back a short verdict and a suggested remedy — that is all.
//            What reaches you is a notification and the remedy, the way a
//            sentry wakes you in the night. Then it goes back to sleep.
//
// The alert is the product: MISS-ME notifies regardless of status —
// through Do Not Disturb, while you sleep. Only airplane mode silences it.
//
// If no Firebase config is present, Tier 3 is skipped and the event stays
// UNCERTAIN with a plain note: cloud not configured — treat with care.
// The app works fully on-device with no config at all.
//
// Firebase AI Logic is imported and actually called at runtime in Tier 3
// (getAI, getGenerativeModel, GoogleAIBackend, InferenceMode from
// "firebase/ai") — it is not just named in the README.

import { scoreEvent, heuristicVerdict, THRESHOLDS } from '../shared/heuristic.js';
import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

const NANO_PROMPT = `You are a careful security triage helper. Read the message below and reply with ONLY a JSON object, no other text:
{"verdict": "SAFE" | "SUSPICIOUS" | "UNCERTAIN", "confidence": 0-100, "reason": "one short sentence"}
A message is SUSPICIOUS if it asks for passwords, account numbers, card details, one-time codes, or pressures the reader to act fast. SAFE if it is an ordinary message with no request for sensitive information.
Message:
"""`;

const CLOUD_PROMPT = `You are a careful security triage helper doing a light cloud check on a message that on-device checks could not settle. Read the message below and reply with ONLY a JSON object, no other text:
{"verdict": "SAFE" | "SUSPICIOUS" | "UNCERTAIN", "confidence": 0-100, "reason": "one short sentence", "remedy": "one short sentence telling the person what to do"}
A message is SUSPICIOUS if it asks for passwords, account numbers, card details, one-time codes, or pressures the reader to act fast, or if it impersonates a bank, a security team, or a delivery company. SAFE if it is an ordinary message with no request for sensitive information.
Message:
"""`;

// The suggested remedy: what the person should do. This is what the
// notification carries — the alert plus the remedy, nothing more.
export function remedyFor(verdict) {
  if (verdict === 'SUSPICIOUS') {
    return 'Do not click, reply, or send anything. Delete the message. If you already clicked, change your password from the real site or app — never from the link.';
  }
  if (verdict === 'UNCERTAIN') {
    return 'Do not reply yet. Check the sender through a channel you trust, and let the sentry take a second look.';
  }
  return 'Nothing to do. The sentry goes back to sleep.';
}

// Pull a {"verdict": ...} object out of model output, defensively.
function parseVerdict(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const verdict = String(obj.verdict || '').toUpperCase();
    if (!['SAFE', 'SUSPICIOUS', 'UNCERTAIN'].includes(verdict)) return null;
    const confidence = Math.max(0, Math.min(100, Number(obj.confidence) || 50));
    return {
      verdict,
      confidence,
      reason: String(obj.reason || ''),
      remedy: String(obj.remedy || ''),
    };
  } catch {
    return null;
  }
}

async function askNano(text) {
  // Chrome's built-in Prompt API (Gemini Nano), Chrome 139+ on desktop.
  // Needs the Prompt API flag enabled — see README.
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

let cloudModel = null;
async function askCloud(text) {
  // Firebase AI Logic — Gemini in the cloud. Only called from Tier 3.
  const { initializeApp } = await import('firebase/app');
  const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
  const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } = await import('firebase/ai');
  if (!cloudModel) {
    const app = initializeApp(firebaseConfig);
    // App Check — required by the hackathon, and Firebase AI Logic
    // enforces it on this project, so the cloud check would be blocked
    // without it. The reCAPTCHA v3 site key is public by design (it
    // ships in client code); the secret key lives only in the console.
    // Local testing uses a debug token: the SDK prints it to the
    // console — register it in the Firebase console under App Check.
    // The hosted app uses real reCAPTCHA v3 attestation.
    if (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('6Lcz3CouAAAAAGqqa8nDsTJ_KguJ5LzGoU5f4TNl'),
      isTokenAutoRefreshEnabled: true,
    });
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    // Hybrid mode: the model name lives inside inCloudParams, not at the
    // top level — the SDK ignores a top-level `model` here and throws
    // "Must provide a model name" (caught by the live test, 2026-11-20).
    cloudModel = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_IN_CLOUD,
      inCloudParams: {
        model: 'gemini-3.8-flash',
        generationConfig: { responseMimeType: 'application/json' },
      },
    });
  }
  // The cloud check must never leave the user staring at a stale verdict.
  // Live test 2026-11-20: with App Check's token exchange unreachable the
  // call hung 90s+ and the grey sample never resolved. 20s, then the
  // sentry falls back to UNCERTAIN on-device.
  const CLOUD_TIMEOUT_MS = 20000;
  const call = cloudModel.generateContent(CLOUD_PROMPT + text + '\n"""');
  call.catch(() => {}); // no unhandled rejection if the timeout wins first
  const result = await Promise.race([
    call,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Cloud check timed out after 20s')), CLOUD_TIMEOUT_MS)
    ),
  ]);
  return parseVerdict(result.response.text());
}

// Triage one event. `event` is { kind, text, source, keepLocal?, placeMatch? }.
// `keepLocal` is set by the caller when the message contains one of
// the user's watched names (see namewatch.js): the cloud tier is then
// skipped entirely — a watched name never leaves the device.
// `placeMatch` is set by the caller when the message contains a watched
// name AND one of the user's places (see "My places" in namewatch.js):
// any cue that puts your name together with your bank gets flagged.
// A real message from your bank matches too — so the verdict is
// UNCERTAIN, not SUSPICIOUS, with one remedy: open the real app or type
// the real address yourself, never tap the link. A place match also
// forces on-device-only triage, so the name-plus-place combination
// never reaches the cloud.
// ai.js never receives the watched-names or places lists itself, only
// the message being triaged, and only the message text is ever sent to
// the cloud.
// Returns {
//   verdict: 'SAFE' | 'SUSPICIOUS' | 'UNCERTAIN',
//   route: 'ON-DEVICE' | 'CLOUD',
//   tier: 'heuristic' | 'nano' | 'cloud' | 'unresolved',
//   confidence, score, signals, reasons[], remedy, note, ms
// }
export async function triageEvent(event) {
  const started = performance.now();
  const text = String(event.text || '');
  const { score, signals } = scoreEvent(text);
  const first = heuristicVerdict(score);

  // Tier 1 — deterministic on-device scorer settles clear cases.
  // Place match — checked BEFORE any SAFE verdict: a cue that puts
  // your name together with one of your places is never waved through
  // as safe. A real message from your bank matches too, so this is
  // UNCERTAIN, not SUSPICIOUS — but it is flagged, forced on-device,
  // and never sent to the cloud. The remedy is the whole point: go to
  // the real app yourself.
  if (event.placeMatch && first !== 'SUSPICIOUS') {
    return {
      verdict: 'UNCERTAIN',
      route: 'ON-DEVICE',
      tier: 'place-match',
      confidence: 50,
      score,
      signals,
      reasons: [
        `This connects your name to one of your places (${event.placeMatch}). It could be your bank — or someone pretending to be it.`,
      ],
      remedy:
        'Do not tap any link in it. Open the real app — or type the real address yourself — and check there.',
      note: 'Kept on-device because it connects your name to one of your places. Verify through the real app.',
      ms: Math.round(performance.now() - started),
    };
  }

  // Low-risk flag — checked before any plain SAFE verdict: a watched
  // name next to a place you do NOT use. The writer is looking for you
  // somewhere you are not located, so they are not privy to real
  // information about you. Flagged and logged, but low risk: nothing
  // to do.
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
      ms: Math.round(performance.now() - started),
    };
  }

  if (first !== 'UNCERTAIN') {
    const reasons = signals.filter((s) => s.weight > 0).map((s) => s.label);
    // A clear threat that also names one of your places keeps its
    // verdict — and gains the place note, so you know what it was
    // reaching for.
    if (first === 'SUSPICIOUS' && event.placeMatch) {
      reasons.unshift(
        `This connects your name to one of your places (${event.placeMatch}) — verify through the real app, never the link.`,
      );
    }
    // A clear threat that names a place you do NOT use gains the
    // low-risk note instead: whoever wrote this does not know where
    // you really are — but the threat itself is still real.
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
      note: 'Settled on-device by the deterministic scorer. Nothing left the device.',
      ms: Math.round(performance.now() - started),
    };
  }

  // Tier 2 — on-device model, only for uncertain events.

  // Tier 2 — on-device model, only for uncertain events.
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
        ms: Math.round(performance.now() - started),
      };
    }
  } catch (err) {
    console.warn('MISS-ME: on-device model unavailable, escalating:', err);
  }

  // Tier 3 — cloud check, only when still uncertain and configured.
  // Light by design: a short verdict and a suggested remedy, nothing more.
  // What reaches you is the notification and the remedy.
  // Skipped when keepLocal is set: a message carrying a watched name
  // never leaves the device, so it stays UNCERTAIN on-device instead.
  if (event.keepLocal) {
    return {
      verdict: 'UNCERTAIN',
      route: 'ON-DEVICE',
      tier: 'unresolved',
      confidence: 50,
      score,
      signals,
      reasons: ['This message carries one of your watched names, so the sentry kept it on-device and did not send it to the cloud.'],
      remedy: remedyFor('UNCERTAIN'),
      note: 'Kept on-device because it contains a watched name. Treat with care.',
      ms: Math.round(performance.now() - started),
    };
  }
  if (isFirebaseConfigured()) {
    try {
      const cloud = await askCloud(text);
      if (cloud) {
        return {
          verdict: cloud.verdict,
          route: 'CLOUD',
          tier: 'cloud',
          confidence: cloud.confidence,
          score,
          signals,
          reasons: [cloud.reason || 'Cloud check verdict.'],
          remedy: cloud.remedy || remedyFor(cloud.verdict),
          note: 'On-device checks could not settle this, so the cloud sent back a short verdict and a suggested remedy.',
          ms: Math.round(performance.now() - started),
        };
      }
    } catch (err) {
      console.warn('MISS-ME: cloud check failed:', err);
    }
  }

  // No confident verdict anywhere — stay UNCERTAIN, say so plainly.
  return {
    verdict: 'UNCERTAIN',
    route: 'ON-DEVICE',
    tier: 'unresolved',
    confidence: 50,
    score,
    signals,
    reasons: ['On-device checks could not settle this.'],
    remedy: remedyFor('UNCERTAIN'),
    note: isFirebaseConfigured()
      ? 'The cloud could not settle this either. Treat with care.'
      : 'Cloud check is not configured, so this stays uncertain. Treat with care.',
    ms: Math.round(performance.now() - started),
  };
}

export { THRESHOLDS };

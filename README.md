# MISS-ME — My Intelligent Sentry Secures Me

**MISS-ME is an offline-first, event-triggered personal sentry.** It sits quiet and does its best work offline, watching browser interactions — and it doesn't even work until something triggers it. When something knocks, it triages on-device first (private, instant, free). Only when the on-device verdict is uncertain does the cloud send back a short verdict and a suggested remedy. Then it goes back to sleep.

Built for **#BuildHybridAI 2026** (Firebase AI Logic hybrid inference). Submissions close November 30, 2026.

## The two rules

1. **MISS-ME notifies regardless of status.** Through Do Not Disturb, while you sleep — a light in the dark, a sound of its own. Only airplane mode silences it.
2. **It stays offline until it gets pinged — and then there is no heavy lifting from the cloud.** Just a notification and maybe a suggested remedy. On-device does the triage; the cloud only carries the alert and the remedy.

## The hybrid split, in plain words

Every event the sentry wakes for goes through three tiers, in order:

1. **On-device scorer** — a small deterministic checker that runs instantly on your machine. It looks for the known shapes of trouble: requests for passwords, card numbers, Social Security numbers, one-time codes, urgency and threat language, prize lures. A clear score settles here: **70+ is a trap, 20 or less is safe.** Nothing leaves the device.
2. **On-device model** — Gemini Nano, running in Chrome through the built-in Prompt API. Used only when the score lands in between and the first tier cannot settle it. A confident verdict here still never leaves the device.
3. **Cloud check** — Firebase AI Logic (Gemini in the cloud). Used only when the on-device verdict is still uncertain, and only when a Firebase config has been filled in (see below). The cloud does no heavy lifting: it sends back a short verdict and a suggested remedy. What reaches you is the notification and the remedy — a light in the dark, a sound that breaks through Do Not Disturb. Then it sleeps again.

No Firebase config? MISS-ME still works fully on-device. Uncertain events stay uncertain and are flagged for you — never silently passed.

## What's in this repo

```
miss-me/
├── dashboard/            Web dashboard (static, no build step)
│   ├── index.html        Status, "Trip the sentry" demo panel, event log
│   ├── styles.css
│   ├── app.js            Page wiring
│   ├── ai.js             The hybrid inference layer (the three tiers)
│   ├── namewatch.js      Name Watch: watched names + cover-name suggestion
│   └── firebase-config.js  Placeholder config — fill in yours (see below)
├── extension/            Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js     The sentry: sleeps until a trigger arrives
│   ├── content.js        The tripwire: watches pages for triggers
│   ├── triage.js         On-device triage (scorer + Nano), extension build
│   ├── popup.html / popup.js   What the sentry has caught
├── shared/
│   └── heuristic.js      The deterministic scorer (dashboard build)
└── README.md / LICENSE / .gitignore
```

**What the extension watches for** (each reported once per page, and only as a short description of the trigger — never passwords, never credentials, never page contents sent anywhere):

- A password field on a page that is not using HTTPS
- A form asking for card or identity details together with a password
- Page text carrying two or more strong pressure phrases at once (urgency, account closure, "verify your identity")
- Text you select and right-click → **Ask MISS-ME about this text**

## Name Watch (setup)

On the dashboard, **Name Watch** is the first setup step. List every variation of your name — every spelling, every way someone could search for you — and the sentry will watch for those names. The sentry will also suggest a cover name to keep your information under, picked from a small built-in list (or type your own instead).

**Name Watch lives on this device only.** Your variants are stored in the browser (dashboard) or the extension's local storage, and never leave the device. They are never sent to the cloud, and a message carrying a watched name is never sent to the cloud either — the sentry keeps it on-device and flags it there. In the extension, a page mentioning a watched name fires a `name-watch` trigger; the name itself is never put in the event record.

The same setup lives in the extension popup, so the extension watches with the same list.

## Run the dashboard

The dashboard is plain HTML/JS/CSS with no build step. Because it uses ES modules, serve it over HTTP — don't just double-click the file:

```bash
cd miss-me
python3 -m http.server 8000
```

Then open http://localhost:8000/dashboard/ in Chrome.

**For the on-device model (Gemini Nano):** use Chrome 139+ on desktop, and enable the Prompt API in `chrome://flags` (search for "Prompt API"). Without Nano, the scorer still runs and uncertain events go to Tier 3 or stay flagged.

## Load the extension

1. Open `chrome://extensions`
2. Switch on **Developer mode** (top right)
3. Click **Load unpacked** and choose the `extension/` folder
4. Browse normally. The sentry sleeps until something triggers it. Click the MISS-ME icon to see what it has caught.

## Switch on the cloud check (optional)

1. Go to the [Firebase console](https://console.firebase.google.com) and create a project.
2. In the project, open **Build → AI Logic** and enable the Gemini API.
3. Add a **Web app** (Project settings → Your apps) and copy the `firebaseConfig` object.
4. Paste it into `dashboard/firebase-config.js`, replacing the `YOUR_...` placeholders.
5. Reload the dashboard. The status line will read "configured — cloud check available".

The dashboard calls Firebase AI Logic at runtime (`getAI`, `getGenerativeModel`, `GoogleAIBackend`, `InferenceMode` from `firebase/ai`) only for Tier 3 checks. Never commit real keys for a production project to a public repo; keep App Check on and restrict the key to your own domains when you ship.

## Demo script (for the video, about 90 seconds)

The opening is the scene, and it can be generated footage with narration — it doesn't have to feature anyone. The rest is real screen footage of MISS-ME working (the rules require footage of the project functioning).

1. **0:00 — Night.** A person goes to bed, puts the phone on Do Not Disturb, the light goes out.
2. **0:10 — A light flashes in the darkness.** A special ringtone sounds. They get up and look — and it's the sentry.
3. **0:25 — Dashboard open. Status reads SLEEPING.** "The sentry is asleep. It costs nothing and sends nothing."
4. **0:35 — Click Sample: ordinary text.** Verdict: SAFE, badge **ON-DEVICE**. "A dentist reminder settles on-device in milliseconds."
5. **0:50 — Click Sample: phishing text.** Verdict: SUSPICIOUS, badge **ON-DEVICE**, and the alert appears with what to do. "A password-and-SSN demand with a 24-hour threat is caught on-device. Nothing left the machine — and the alert breaks through Do Not Disturb."
6. **1:05 — Click Sample: hard to call.** The scorer cannot settle it — watch it wake the on-device model, and (if Firebase is configured) send one light check to the cloud. Badge **CLOUD**. What comes back is not an analysis: a notification and a suggested remedy. "Only the uncertain ones go to the cloud — and the cloud only carries the alert."
7. **1:20 — The event log.** "Idle until triggered. Private by default. The cloud only carries the alert and the remedy."
8. **1:35 — Name Watch.** In the setup card, add a name variation, then paste a message that mentions it. The verdict shows the **Name Watch** note: the sentry spotted a watched name and kept the message on-device — it never went to the cloud. "Your name is yours. The sentry watches for it, and it never sends it out."

## Scope note

This repo is the sentry slice only: the watcher, the tripwire, on-device triage, and cloud escalation. That is the whole product here, and it is the whole entry.

## License

Apache-2.0 — see [LICENSE](LICENSE).

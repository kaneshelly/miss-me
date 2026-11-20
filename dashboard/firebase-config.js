// MISS-ME — Firebase config.
// ---------------------------------------------------------------------------
// TODO: fill this in with YOUR Firebase project's web config to switch on
// the cloud check (Tier 3). Until then MISS-ME works fully on-device
// and says so plainly on the dashboard.
//
// How to get these values (about 5 minutes, free):
//   1. Go to https://console.firebase.google.com and create a project.
//   2. In the project, open Build > AI Logic and enable the Gemini API.
//   3. Add a Web app to the project (Project settings > Your apps).
//   4. Copy the firebaseConfig object Firebase shows you and paste it below.
//   5. Run the dashboard from a local server (see README) and reload.
//
// NEVER commit real keys for a production project to a public repo.
// These are web client keys for a demo project; keep your Firebase
// security rules and App Check switched on, and restrict the key in
// Google Cloud Console to your own domains when you ship.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// True only when every field above has been replaced with real values.
export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every(
    (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('YOUR_'),
  );
}

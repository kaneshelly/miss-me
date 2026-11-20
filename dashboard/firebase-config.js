// MISS-ME — Firebase config. Configured 2026-11-20 for project
// miss-me-1ed3d (Spark, no-cost). The cloud check (Tier 3) is on.
// These are web client keys for a demo project; keep App Check
// switched on, and restrict the key in Google Cloud Console to your
// own domains when you ship.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: 'AIzaSyCfvnzud5PVsam7OwaoHdIfgcfuG2b3mv0',
  authDomain: 'miss-me-1ed3d.firebaseapp.com',
  projectId: 'miss-me-1ed3d',
  storageBucket: 'miss-me-1ed3d.firebasestorage.app',
  messagingSenderId: '427757369746',
  appId: '1:427757369746:web:ef61bba8a53bf01137694b',
};

// True only when every field above has been replaced with real values.
export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every(
    (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('YOUR_'),
  );
}

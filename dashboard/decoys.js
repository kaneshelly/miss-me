// MISS-ME — the Gray Code.
// At setup (inception), the user tells the sentry their real names and
// places. The app then auto-generates decoys — about a hundred entries
// that look exactly like the real ones — and stores everything together
// as one flat snapshot. The real entries are hidden in there, gray
// coated: every entry has the same shape, the same kind of salt, no
// timestamp, no add-order. An intruder who opens the store cannot tell
// which entries are real, which are decoys, or which was added first.
//
// How the sentry itself tells them apart: each real entry carries a
// salt that is a keyed hash of the entry (SHA-256 of device-key +
// entry). Each decoy carries a random salt. Only this device holds the
// key, so only this device can run the check. The key lives in its own
// store, separate from the entries — one breach cannot hand over both
// halves. This is camouflage, not encryption: it makes the real entries
// indistinguishable at a glance and breaks any chain back to how the
// store was built. It does not protect the store if the device itself
// is fully compromised and both stores are taken together.
//
// The store is then CLONED as a snapshot: one key, one JSON array, no
// history, no per-entry timestamps, no insertion order (the entries are
// shuffled with a cryptographic random shuffle). There is no chain of
// command to run down — no log of what was added when, or what came
// from the user and what the app generated.

export const DEVICE_KEY_KEY = 'missme.device.key.v1';

export async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeEntry(v) {
  return String(v || '').trim().replace(/\s+/g, ' ');
}

// Fisher-Yates shuffle with a cryptographic random source, so the order
// of the entries carries no information about which are real.
export function shuffle(entries) {
  const arr = [...entries];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- Decoy pools --------------------------------------------------------
// Built-in look-alikes. Banks and portals for the places store, people
// for the names store. The pools are public by design — the protection
// is that the store does not say which entries came from the pool.

export const DECOY_BANKS = [
  'Capital One', 'Chase', 'Bank of America', 'Wells Fargo', 'Citibank', 'Citi',
  'US Bank', 'PNC', 'Truist', 'TD Bank', 'American Express', 'Amex', 'Discover',
  'Navy Federal', 'USAA', 'Ally Bank', 'Marcus', 'SoFi', 'PayPal', 'Venmo',
  'Cash App', 'Zelle', 'Barclays', 'HSBC', 'Santander', 'Fifth Third', 'KeyBank',
  'M&T Bank', 'Citizens Bank', 'Regions Bank', 'Huntington', 'BMO', 'RBC',
  'Scotiabank', 'BNP Paribas', 'Deutsche Bank', 'UBS', 'Lloyds', 'NatWest',
  'ANZ', 'Commonwealth Bank', 'NAB', 'Westpac', 'DBS', 'OCBC', 'UOB', 'ICICI',
  'HDFC', 'State Bank of India', 'BBVA', 'ING', 'Rabobank', 'Nordea',
  'Danske Bank', 'SEB', 'Swedbank', 'Standard Chartered', 'Bank of China',
  'Mitsubishi UFJ', 'Sumitomo Mitsui', 'Mizuho',
];

export const DECOY_PORTALS = [
  'Facebook', 'Instagram', 'X', 'Twitter', 'TikTok', 'YouTube', 'LinkedIn',
  'Reddit', 'Snapchat', 'Pinterest', 'WhatsApp', 'Telegram', 'Signal',
  'Discord', 'Twitch', 'Netflix', 'Spotify', 'Amazon', 'eBay', 'Etsy',
  'Gmail', 'Outlook', 'Yahoo Mail', 'iCloud', 'Google Drive', 'Dropbox',
  'OneDrive', 'Zoom', 'Slack', 'Microsoft Teams', 'Skype', 'Viber', 'WeChat',
  'Line', 'KakaoTalk', 'Tumblr', 'Medium', 'Quora', 'GitHub', 'GitLab',
  'Stack Overflow', 'Airbnb', 'Uber', 'Lyft', 'DoorDash', 'Grubhub',
  'Instacart', 'Shopify', 'Stripe', 'Square', 'Robinhood', 'Coinbase',
  'Binance', 'Kraken',
];

export const DECOY_PLACES = [...DECOY_BANKS, ...DECOY_PORTALS];

export const DECOY_NAMES = [
  'James Smith', 'Mary Johnson', 'Robert Williams', 'Patricia Brown',
  'John Jones', 'Jennifer Garcia', 'Michael Miller', 'Linda Davis',
  'William Rodriguez', 'Elizabeth Martinez', 'David Hernandez', 'Barbara Lopez',
  'Richard Gonzalez', 'Susan Wilson', 'Joseph Anderson', 'Jessica Thomas',
  'Thomas Taylor', 'Sarah Moore', 'Charles Jackson', 'Karen Martin',
  'Daniel Lee', 'Nancy Perez', 'Matthew Thompson', 'Lisa White',
  'Anthony Harris', 'Betty Sanchez', 'Mark Clark', 'Margaret Ramirez',
  'Donald Lewis', 'Sandra Robinson', 'Steven Walker', 'Ashley Young',
  'Paul Allen', 'Kimberly King', 'Andrew Wright', 'Emily Scott',
  'Joshua Torres', 'Michelle Nguyen', 'Kevin Hill', 'Dorothy Flores',
  'Brian Green', 'Amanda Adams', 'George Nelson', 'Deborah Baker',
  'Edward Hall', 'Stephanie Rivera', 'Ronald Campbell', 'Rebecca Mitchell',
  'Timothy Carter', 'Catherine Roberts',
  'Andrew Johnson', 'Olivia Williams', 'Christopher Jones', 'Sophia Brown',
  'Ryan Davis', 'Isabella Miller', 'Nicholas Wilson', 'Mia Moore',
  'Jacob Taylor', 'Charlotte Anderson', 'Ethan Thomas', 'Amelia Jackson',
  'Mason White', 'Harper Harris', 'Logan Martin', 'Evelyn Thompson',
  'Lucas Garcia', 'Abigail Martinez', 'Jack Robinson', 'Ella Clark',
  'Owen Rodriguez', 'Scarlett Lewis', 'Henry Walker', 'Grace Hall',
  'Gabriel Young', 'Chloe Allen', 'Caleb King', 'Victoria Wright',
  'Isaac Scott', 'Riley Green', 'Nathan Adams', 'Aria Baker',
  'Adam Nelson', 'Lily Hill', 'Samuel Rivera', 'Aubrey Campbell',
  'Benjamin Mitchell', 'Zoey Carter', 'Luke Roberts', 'Penelope Turner',
  'Alexander Phillips', 'Layla Parker', 'Daniel Evans', 'Nora Edwards',
  'Joseph Collins', 'Ellie Stewart',
];

// ---- Device key (dashboard: localStorage) -------------------------------
// Generated once, at inception, and never rotated: rotating it would
// orphan the salts. It lives in its own store, separate from the
// entries.

export function getOrCreateDeviceKey() {
  if (typeof localStorage === 'undefined') return randomHex(32);
  let key = null;
  try {
    key = localStorage.getItem(DEVICE_KEY_KEY);
  } catch {
    key = null;
  }
  if (!key) {
    key = randomHex(32);
    try {
      localStorage.setItem(DEVICE_KEY_KEY, key);
    } catch {
      // Storage unavailable — the key lives in memory only for this
      // session, and the store cannot be verified after reload.
    }
  }
  return key;
}

// MISS-ME — the Gray Code (extension, classic script).
// Mirrors dashboard/decoys.js — same lists, same keyed-salt rule, same
// snapshot clone. If you change one, change the other too.
// At setup (inception), the user's real names and places are mixed with
// about a hundred decoy entries that look exactly like them, and stored
// as one flat snapshot: no timestamps, no add-order, no history. Only
// this device holds the key that tells real from decoy.

const MissMeDecoys = (() => {
  const DEVICE_KEY_KEY = 'missme.device.key.v1';

  async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function randomHex(bytes = 32) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function normalizeEntry(v) {
    return String(v || '').trim().replace(/\s+/g, ' ');
  }

  function shuffle(entries) {
    const arr = [...entries];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const DECOY_BANKS = [
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

  const DECOY_PORTALS = [
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

  const DECOY_PLACES = [...DECOY_BANKS, ...DECOY_PORTALS];

  const DECOY_NAMES = [
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

  // Device key (extension: chrome.storage.local). Generated once, at
  // inception, in its own store — separate from the entries.
  async function getOrCreateDeviceKey() {
    const stored = await chrome.storage.local.get(DEVICE_KEY_KEY);
    let key = stored[DEVICE_KEY_KEY];
    if (!key) {
      key = randomHex(32);
      await chrome.storage.local.set({ [DEVICE_KEY_KEY]: key });
    }
    return key;
  }

  return {
    DEVICE_KEY_KEY,
    sha256Hex,
    randomHex,
    normalizeEntry,
    shuffle,
    DECOY_BANKS,
    DECOY_PORTALS,
    DECOY_PLACES,
    DECOY_NAMES,
    getOrCreateDeviceKey,
  };
})();

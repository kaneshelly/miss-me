// MISS-ME — syllables on the lattice (Gray Code, second layer).
// A real name or place is not stored whole. It is broken into
// syllables, and each syllable lives at its own binary position on the
// lattice — a tuple like (1,0,1,1,0,0,1,0,1,0). Only the device key
// knows which syllables belong together and in what order.
//
// How it works, in order:
// 1. Split: each real entry is split into syllables (heuristic,
//    deterministic, reversible — see splitSyllables). A multi-word
//    name keeps its spaces: the space rides on the last syllable of
//    each word but the last, so joining the syllables restores the
//    name exactly.
// 2. Number: syllables are numbered sequentially across the roster —
//    id = nameIndex * 16 + syllableIndex (up to 16 syllables per name,
//    up to 64 names; the roster caps at 50).
// 3. Place: the id is mapped through a keyed permutation (seeded by
//    the device key) to a lattice position. The position is stored as
//    a binary tuple. Without the key, the positions look random and
//    carry no grouping information — there is no map stored anywhere.
// 4. Salt: each syllable entry carries a keyed salt,
//    SHA-256(key + syllable + position). Decoys carry random salts and
//    random unused positions. Only this device can verify an entry.
// 5. Reassemble: at load, the sentry verifies the salts, inverts the
//    keyed permutation to recover each syllable's id, groups by name,
//    orders, and joins. A name with a gap (a tampered or missing
//    syllable) is dropped rather than guessed.

import { sha256Hex, randomHex, shuffle, normalizeEntry } from './decoys.js';

export const LATTICE_BITS = 10;
export const LATTICE_SIZE = 1024; // 2^10 binary positions
export const MAX_SYLLABLES_PER_NAME = 16;
export const SYLLABLE_STORE_SIZE = 256;

const VOWEL = /[aeiouy]/i;

// Split one word into syllables. Heuristic but deterministic: each
// syllable holds one vowel group; a single consonant between vowel
// groups starts the next syllable; two or more split between the
// first and the rest. "Michael" -> ["Mic", "hael"], "Kelley" ->
// ["Kel", "ley"], "Capital" -> ["Ca", "pi", "tal"]. Pronunciation
// purists may disagree; the sentry only needs it deterministic and
// reversible.
export function splitWord(word) {
  const w = String(word || '');
  if (!w) return [];
  const groups = [];
  let i = 0;
  while (i < w.length) {
    if (VOWEL.test(w[i])) {
      const start = i;
      while (i < w.length && VOWEL.test(w[i])) i++;
      groups.push([start, i]);
    } else {
      i++;
    }
  }
  if (groups.length <= 1) return [w];
  const cuts = [];
  for (let g = 1; g < groups.length; g++) {
    const prevEnd = groups[g - 1][1];
    const nextStart = groups[g][0];
    const between = nextStart - prevEnd;
    cuts.push(between <= 1 ? prevEnd : prevEnd + 1);
  }
  const out = [];
  let at = 0;
  for (const cut of cuts) {
    out.push(w.slice(at, cut));
    at = cut;
  }
  out.push(w.slice(at));
  return out.filter(Boolean);
}

// Split a full name or place into syllables, keeping word spaces.
export function splitName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  words.forEach((w, wi) => {
    const syls = splitWord(w);
    syls.forEach((s, si) => {
      out.push(si === syls.length - 1 && wi < words.length - 1 ? s + ' ' : s);
    });
  });
  return out.slice(0, MAX_SYLLABLES_PER_NAME);
}

// id -> binary tuple, most-significant bit first.
export function bitsOf(id, bits = LATTICE_BITS) {
  const out = [];
  for (let i = bits - 1; i >= 0; i--) out.push((id >> i) & 1);
  return out;
}

// Binary tuple -> id.
export function idOf(bits) {
  return bits.reduce((acc, b) => (acc << 1) | (b & 1), 0);
}

// Keyed permutation of 0..n-1: a Fisher-Yates shuffle driven by a
// PRNG seeded from the device key. Same key, same shuffle — so the
// sentry can invert it, and nobody without the key can.
export async function keyedPermutation(key, n) {
  const seedHex = (await sha256Hex(String(key))).slice(0, 8);
  let seed = parseInt(seedHex, 16) >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Build the syllable store: real entries split into syllables and
// placed by the keyed permutation; decoys split the same way and
// placed at random unused positions. The result is the snapshot clone
// that gets saved — one flat array, no history.
export async function mixSyllableStore(realValues, decoyPool, key) {
  const real = [...new Set((realValues || []).map(normalizeEntry))].filter((v) => v.length >= 2).slice(0, 50);
  const perm = await keyedPermutation(key, LATTICE_SIZE);
  const usedPositions = new Set();
  const entries = [];
  const realSyllables = [];
  real.forEach((name, ni) => {
    splitName(name).forEach((syl, si) => {
      const id = ni * MAX_SYLLABLES_PER_NAME + si;
      const pos = perm[id];
      usedPositions.add(pos);
      realSyllables.push({ syl, pos });
    });
  });
  for (const { syl, pos } of realSyllables) {
    entries.push({ v: syl, s: await sha256Hex(`${key}|${syl}|${pos}`), p: bitsOf(pos) });
  }
  const need = Math.max(0, SYLLABLE_STORE_SIZE - entries.length);
  const poolSyls = [...new Set(decoyPool.flatMap((d) => splitName(d)))].map((s) => s.trim()).filter((s) => s.length >= 2);
  // Recombination decoys: cross real syllables with pool syllables, so
  // a real syllable's shape also appears in decoys — an attacker who
  // knows the public pool cannot spot the real syllables by elimination.
  const realSylSet = new Set(realSyllables.map(({ syl }) => syl.trim()));
  const crossSyls = [];
  for (const { syl } of realSyllables) {
    const t = syl.trim();
    if (t.length < 2) continue;
    for (const p of poolSyls) {
      if (p === t) continue;
      crossSyls.push(t + p);
      crossSyls.push(p + t);
    }
  }
  const candidates = shuffle([...poolSyls, ...crossSyls]).filter((s) => !realSylSet.has(s));
  const decoys = [...new Set(candidates)].slice(0, need);
  const freePositions = shuffle(
    Array.from({ length: LATTICE_SIZE }, (_, i) => i).filter((i) => !usedPositions.has(i)),
  );
  for (let i = 0; i < decoys.length && i < freePositions.length; i++) {
    entries.push({ v: decoys[i], s: randomHex(32), p: bitsOf(freePositions[i]) });
  }
  return shuffle(entries);
}

// Reassemble the real names from a mixed syllable store. Returns only
// complete names; a name with a gap is dropped, never guessed.
export async function reassembleSyllables(entries, key) {
  const perm = await keyedPermutation(key, LATTICE_SIZE);
  const inverse = new Array(LATTICE_SIZE);
  perm.forEach((pos, id) => {
    inverse[pos] = id;
  });
  const byName = new Map();
  for (const e of entries || []) {
    if (!e || typeof e.v !== 'string' || typeof e.s !== 'string' || !Array.isArray(e.p)) continue;
    const pos = idOf(e.p);
    if (pos < 0 || pos >= LATTICE_SIZE) continue;
    const expect = await sha256Hex(`${key}|${e.v}|${pos}`);
    if (expect !== e.s) continue; // decoy or tampered
    const id = inverse[pos];
    if (id === undefined) continue;
    const ni = Math.floor(id / MAX_SYLLABLES_PER_NAME);
    const si = id % MAX_SYLLABLES_PER_NAME;
    if (!byName.has(ni)) byName.set(ni, []);
    byName.get(ni)[si] = e.v;
  }
  const names = [];
  for (const ni of [...byName.keys()].sort((a, b) => a - b)) {
    const syls = byName.get(ni);
    let complete = true;
    for (let i = 0; i < syls.length; i++) {
      if (syls[i] === undefined) {
        complete = false;
        break;
      }
    }
    if (complete) names.push(syls.join(''));
  }
  return names;
}

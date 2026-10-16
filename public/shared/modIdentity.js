// shared/modIdentity.js — the identity of a mod set (DESIGN §28.2): what a pack IS, on the wire and in the spec.
//
// Why this is its own module and not a block inside shared/protocol.js: `jsconfig.json` EXCLUDES that file from the
// typecheck slice (`jsconfig.json:26`), so a validator written there is never machine-checked. The wire shape stays
// declared in `shared/protocol.js` (that file is the normative protocol contract, docs/design/network.md:5) by
// re-exporting from here — one implementation, and it is inside the slice (`shared/**/*.js`).
//
// A mod's identity is `{ id, hash, layer, combat, api? }`:
//   id      the pack id (the directory name, shared/workshop.js PACK_ID_RE)
//   hash    sha256 of the pack's OWN bytes — the normalized manifest, its declared content files after normalization,
//           every `kits/*.js` source text and every `assets/**` file (shared/modIdentity canonicalJson + modManifestDigest)
//   layer   'A' content / 'B' server logic / 'C' client UI
//   combat  the DECLARED intent: may this pack change a battle result (DESIGN §28.2 — the switch the verification gate
//           keys on; it is not the same thing as the layer)
//   api     the declared mod-layer API range (`shared/packs.js` isVersionRange syntax), optional
//
// A room's identity is the DIGEST of its sorted list. The digest is a sha256 computed here, in pure JS, because the
// BROWSER must be able to recompute it: a client that is handed a (list, digest) pair can check the pair is consistent
// before it echoes the digest back to enter a modded room (DESIGN §28.2, §28.9). A pack's own `hash` is computed by the
// server loader with `node:crypto` — the client never has to re-hash a pack's bytes, only the list it is told about.

/** Limits of the wire shape. Small on purpose: a room runs a handful of packs, not a catalogue. */
export const MOD_LIMITS = Object.freeze({ packs: 64, id: 64, hash: 64, api: 60 });

/** The three layers (DESIGN §28.1). */
export const MOD_LAYERS = Object.freeze(['A', 'B', 'C']);

/** A pack id: the same charset `shared/workshop.js PACK_ID_RE` enforces on the directory name. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
/** A lowercase hex sha256. */
const HASH_RE = /^[0-9a-f]{64}$/;
/** A digest of a mod list: the same shape, shorter — it names a set, it is not a pack's content hash. */
const DIGEST_RE = /^[0-9a-f]{16,64}$/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether `v` is a pack id this layer accepts. @param {unknown} v */
export const isModId = (v) => typeof v === 'string' && ID_RE.test(v);

/**
 * One identity entry as it travels on the wire (`welcome.mods.packs`, `spec.mods.packs`).
 *
 * `api` is optional (a pack that declares nothing is a pack whose author did not say; §28.5 decides what that means).
 * `layer` and `combat` are REQUIRED: an entry without them would be an identity that cannot be acted on.
 * @param {unknown} v
 */
export function isModEntry(v) {
  if (!isObj(v)) return false;
  const e = /** @type {Record<string, unknown>} */ (v);
  if (!isModId(e.id)) return false;
  if (typeof e.hash !== 'string' || !HASH_RE.test(e.hash)) return false;
  if (!MOD_LAYERS.includes(/** @type {string} */ (e.layer))) return false;
  if (typeof e.combat !== 'boolean') return false;
  if (e.api !== undefined && e.api !== null && (typeof e.api !== 'string' || e.api.length > MOD_LIMITS.api)) return false;
  return true;
}

/**
 * A whole mod list: an array of entries, no duplicate ids, within `MOD_LIMITS.packs`. An empty array is a valid list
 * (it means "no mods"), and `null`/`undefined` are NOT — the caller says "none" by sending an empty array.
 * @param {unknown} v
 */
export function isModList(v) {
  if (!Array.isArray(v) || v.length > MOD_LIMITS.packs) return false;
  const seen = new Set();
  for (const e of v) {
    if (!isModEntry(e)) return false;
    if (seen.has(e.id)) return false;
    seen.add(e.id);
  }
  return true;
}

/** Whether `v` is a digest this layer produced. @param {unknown} v */
export const isModDigest = (v) => typeof v === 'string' && DIGEST_RE.test(v);

// ---------------------------------------------------------------------------------------------------------------
// pure sha256 (no node:crypto: the browser recomputes the digest of a list, see the header)

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

/**
 * UTF-8 bytes of a string, without `TextEncoder`.
 *
 * Not for purity's sake: the typecheck slice has `"lib": ["ES2022"]` and `"types": []` (`jsconfig.json:14-15`), so
 * `TextEncoder` is not a known name there (and it is a DOM/Node global rather than an ECMAScript one). Encoding by hand
 * keeps the module inside the declared environment and works identically in the browser and in Node.
 * @param {string} str
 * @returns {Uint8Array}
 */
function utf8Bytes(str) {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.codePointAt(i);
    if (cp === undefined) continue;
    if (cp > 0xffff) i++; // a surrogate pair was consumed: step over the low half
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

/**
 * sha256 of a string (UTF-8) or of bytes, lowercase hex.
 * @param {string|Uint8Array} input
 * @returns {string}
 */
export function sha256Hex(input) {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : input;
  const len = bytes.length;
  // 1 byte 0x80 + 8 bytes of bit length, then pad to a 64-byte block boundary
  const buf = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = len * 8;
  view.setUint32(buf.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(buf.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3];
    let e = h[4]; let f = h[5]; let g = h[6]; let hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * JSON with sorted object keys and no whitespace, so the same value always hashes the same bytes on every machine
 * (JSON.stringify keeps insertion order, which is exactly the thing a content hash must not depend on).
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const rec = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`;
}

/**
 * The content hash of a pack: sha256 over the canonical list of `[path, sha256]` pairs the loader built (sorted by
 * path). The pairs are the pack's OWN bytes — see the header for what is in and what is out.
 * @param {Array<{ path: string, hash: string }>} manifest
 * @returns {string} lowercase hex
 */
export function modManifestDigest(manifest) {
  const pairs = (Array.isArray(manifest) ? manifest : [])
    .filter((e) => isObj(e) && typeof e.path === 'string' && typeof e.hash === 'string')
    .map((e) => [e.path, e.hash])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(canonicalJson(pairs));
}

/**
 * The digest of a mod set: sha256 over the canonical `[[id, hash], …]` pairs, sorted by id. Order-independent by
 * construction, so two servers with the same packs agree no matter how they discovered them.
 * @param {Array<{ id: string, hash: string }>} list entries of a mod list (`isModList`)
 * @returns {string} lowercase hex
 */
export function modDigest(list) {
  const pairs = (Array.isArray(list) ? list : [])
    .filter((e) => isObj(e) && isModId(e.id) && typeof e.hash === 'string' && HASH_RE.test(e.hash))
    .map((e) => [e.id, e.hash])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(canonicalJson(pairs));
}

/** The wire/`welcome`/spec body of a mod set: `{ digest, packs }`, or `null` when there are no mods at all. */
export function modSetOf(packs) {
  const list = Array.isArray(packs) ? packs.filter(isModEntry) : [];
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { digest: modDigest(sorted), packs: sorted };
}

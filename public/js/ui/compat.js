// Small polyfills for the older browsers the client supports (Safari / iOS 15.0–15.3, Firefox ESR, older Chromium on
// Android tablets). Imported first by main.js (and the dev harnesses), so every later module — including the ones
// loaded on demand (render engine, battle sim) — sees them. Each one is installed only when the browser lacks it
// (feature detection, never UA sniffing) and is a faithful subset of the standard behaviour:
//   Object.hasOwn                       Safari < 15.4, Firefox < 92
//   Array/String/TypedArray .at()       Safari < 15.4, Firefox < 90
//   Array .findLast / .findLastIndex    Safari < 15.4, Firefox < 104
//   structuredClone                     Safari < 15.4, Firefox < 94 (JSON-safe values + Map/Set/Date; enough for
//                                       the plain state objects the client clones)
//   globalThis.queueMicrotask           very old WebViews
// `installCompat(target)` is exported for tests (it patches the given global object instead).

/**
 * Install the polyfills on `g` (default globalThis). Returns the names that were missing and got installed.
 * @param {any} [g]
 * @returns {string[]}
 */
export function installCompat(g = globalThis) {
  const added = [];
  const def = (obj, name, fn) => {
    if (!obj || typeof obj[name] === 'function') return;
    try {
      Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true, enumerable: false });
      added.push(name);
    } catch { /* frozen: leave it */ }
  };
  const O = g.Object || Object;
  def(O, 'hasOwn', function hasOwn(obj, key) {
    if (obj == null) throw new TypeError('Cannot convert undefined or null to object');
    return Object.prototype.hasOwnProperty.call(Object(obj), key);
  });
  function at(i) {
    const len = this.length >>> 0;
    let k = Math.trunc(Number(i)) || 0;
    if (k < 0) k += len;
    if (k < 0 || k >= len) return undefined;
    return typeof this === 'string' || this instanceof String ? String(this).charAt(k) : this[k];
  }
  def((g.Array || Array).prototype, 'at', at);
  def((g.String || String).prototype, 'at', at);
  const TA = g.Int8Array ? Object.getPrototypeOf(g.Int8Array.prototype) : null;
  if (TA) def(TA, 'at', at);
  def((g.Array || Array).prototype, 'findLast', function findLast(fn, thisArg) {
    for (let i = (this.length >>> 0) - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i];
    return undefined;
  });
  def((g.Array || Array).prototype, 'findLastIndex', function findLastIndex(fn, thisArg) {
    for (let i = (this.length >>> 0) - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i;
    return -1;
  });
  def((g.String || String).prototype, 'replaceAll', function replaceAll(searchValue, replaceValue) {
    if (searchValue instanceof RegExp) {
      if (!searchValue.global) throw new TypeError('String.prototype.replaceAll called with a non-global RegExp argument');
      return this.replace(searchValue, replaceValue);
    }
    const needle = String(searchValue);
    if (!needle) return this.replace(new RegExp('(?:)', 'g'), replaceValue);
    return this.split(needle).join(typeof replaceValue === 'function' ? '' : String(replaceValue));
  });
  const P = g.Promise || Promise;
  def(P, 'any', function any(iterable) {
    return new P((resolve, reject) => {
      const items = Array.from(iterable || []);
      if (!items.length) {
        const agg = typeof g.AggregateError === 'function' ? new g.AggregateError([], 'All promises were rejected') : new Error('All promises were rejected');
        agg.errors = [];
        reject(agg);
        return;
      }
      const errors = new Array(items.length);
      let rejectedCount = 0;
      items.forEach((p, i) => {
        P.resolve(p).then(resolve, (err) => {
          errors[i] = err;
          rejectedCount += 1;
          if (rejectedCount === items.length) {
            const agg = typeof g.AggregateError === 'function' ? new g.AggregateError(errors, 'All promises were rejected') : new Error('All promises were rejected');
            agg.errors = errors;
            reject(agg);
          }
        });
      });
    });
  });
  def(g, 'structuredClone', function structuredClone(value) { return cloneValue(value, new Map()); });
  def(g, 'queueMicrotask', function queueMicrotask(fn) { Promise.resolve().then(fn).catch((err) => setTimeout(() => { throw err; })); });
  return added;
}

/** Deep clone of plain data (objects, arrays, Map, Set, Date, RegExp, typed arrays), cycles preserved. */
function cloneValue(v, seen) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'function' || typeof v === 'symbol') throw new TypeError('structuredClone: value could not be cloned');
    return v;
  }
  if (seen.has(v)) return seen.get(v);
  let out;
  if (v instanceof Date) out = new Date(v.getTime());
  else if (v instanceof RegExp) out = new RegExp(v.source, v.flags);
  else if (ArrayBuffer.isView(v)) out = new v.constructor(v);
  else if (v instanceof ArrayBuffer) out = v.slice(0);
  else if (v instanceof Map) {
    out = new Map();
    seen.set(v, out);
    for (const [k, x] of v) out.set(cloneValue(k, seen), cloneValue(x, seen));
    return out;
  } else if (v instanceof Set) {
    out = new Set();
    seen.set(v, out);
    for (const x of v) out.add(cloneValue(x, seen));
    return out;
  } else if (Array.isArray(v)) {
    out = new Array(v.length);
    seen.set(v, out);
    for (let i = 0; i < v.length; i++) out[i] = cloneValue(v[i], seen);
    return out;
  } else {
    out = {};
    seen.set(v, out);
    for (const k of Object.keys(v)) out[k] = cloneValue(v[k], seen);
    return out;
  }
  seen.set(v, out);
  return out;
}

export const installedPolyfills = installCompat();

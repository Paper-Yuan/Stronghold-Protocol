// Pace large field resends and keep only the latest unsent watch target.
// No gameplay mutations are queued here: buying, moving and readying use their normal path.
export function createWatchQueue(send, { intervalMs = 650, now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let pending = null;
  let current = null;
  let draining = false;
  let nextAt = 0;
  let epoch = 0;

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (pending) {
        const delay = Math.max(0, nextAt - now());
        if (delay) await wait(delay);
        if (!pending) break;
        const entry = pending;
        pending = null;
        current = entry;
        nextAt = now() + intervalMs;
        let ok = false;
        try { ok = (await send(entry.fieldId)) !== false; } catch { /* sender owns error feedback */ }
        entry.resolve(entry.epoch === epoch && ok);
        current = null;
      }
    } finally {
      draining = false;
      if (pending) void drain();
    }
  }

  function request(fieldId) {
    if (pending?.fieldId === fieldId) return pending.promise;
    if (!pending && current?.epoch === epoch && current.fieldId === fieldId) return current.promise;
    if (pending) pending.resolve(false);
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    pending = { fieldId, promise, resolve, epoch };
    void drain();
    return promise;
  }

  function cancel() {
    epoch += 1;
    if (pending) pending.resolve(false);
    pending = null;
    nextAt = 0;
  }

  return { request, cancel };
}

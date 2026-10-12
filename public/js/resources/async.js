/** Bound pending browser/network operations; Pause also interrupts an unresponsive Cache API call. */
export function resourceStep(task, { signal, timeoutMs = 15000, label = '资源操作' } = {}) {
  const controller = new AbortController();
  let timer, onAbort;
  return new Promise((resolve, reject) => {
    const stop = reason => { controller.abort(reason); reject(reason); };
    onAbort = () => stop(signal.reason || new DOMException('预载已暂停', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { const err = new Error(`${label}超时，请点击“重试 / 继续”`); err.name = 'TimeoutError'; stop(err); }, timeoutMs);
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return task(controller.signal);
    }).then(resolve, reject);
    if (signal?.aborted) onAbort();
  }).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); });
}

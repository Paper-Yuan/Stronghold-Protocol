// Port probing for the desktop build (handoff/desktop-electron/packaging.md §2.2): the local card promises
// 127.0.0.1:3000, so 3000 is tried first, then 3001…3010, then port 0 (any free port) as the last resort.
// `startServer()` does not tell us in advance whether a bind will fail, so this probe is advisory only: `main.mjs`
// still falls through to the next port when its own listen throws (a race with another program is possible).
import net from 'node:net';

/**
 * Whether `port` can be bound on `host` right now.
 * @param {number} port
 * @param {string} [host] loopback by default — the desktop local server is a single-machine server
 * @returns {Promise<boolean>}
 */
export function isFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

/**
 * The first free port of the sequence the local card advertises.
 * @param {{ start?: number, tries?: number }} [opts]
 * @returns {Promise<number>} the port, or 0 when none of them is free (the OS then picks one)
 */
export async function pickPort({ start = 3000, tries = 11 } = {}) {
  for (let port = start; port < start + tries; port++) {
    if (await isFree(port)) return port;
  }
  return 0;
}

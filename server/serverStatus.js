import os from 'node:os';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pressureLevel } from '../shared/serverSelection.js';

let previousCpu, previousAt = performance.now(), cpuPercent = null, loopLagMs = null;
let policyAt = -Infinity, policy = {};
export function nodePolicy() {
  if (performance.now() - policyAt < 2000) return policy;
  policyAt = performance.now();
  try { policy = JSON.parse(fs.readFileSync(process.env.SP_NODE_CONFIG || new URL('../config/server-node.json', import.meta.url), 'utf8')); }
  catch { policy = {}; }
  return policy;
}
export const isVoiceEnabled = () => nodePolicy().voice !== false;
export function readCpu() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) { idle += c.times.idle; for (const n of Object.values(c.times)) total += n; }
  return { idle, total };
}
function sample() {
  const at = performance.now(), current = readCpu();
  if (previousCpu && current.total > previousCpu.total)
    cpuPercent = Math.round(Math.max(0, Math.min(100, 100 * (1 - (current.idle - previousCpu.idle) / (current.total - previousCpu.total)))));
  loopLagMs = Math.round(Math.max(0, at - previousAt - 2000));
  previousAt = at; previousCpu = current;
}
previousCpu = readCpu();
const timer = setInterval(sample, 2000);timer.unref();
export function getNodeStatus() {
  let available = os.freemem(), total = os.totalmem();
  try {
    const mem = fs.readFileSync('/proc/meminfo', 'utf8');
    const a = /^MemAvailable:\s+(\d+)/m.exec(mem), t = /^MemTotal:\s+(\d+)/m.exec(mem);
    if (a && t) { available = Number(a[1]) * 1024; total = Number(t[1]) * 1024; }
  } catch {}
  const memoryPercent = total ? Math.round(Math.max(0, Math.min(100, 100 * (1 - available / total)))) : null;
  return { observedAt: Date.now(), cpuPercent, memoryPercent, loopLagMs,
    pressure: pressureLevel({ cpuPercent, memoryPercent, loopLagMs }), voice: isVoiceEnabled() };
}

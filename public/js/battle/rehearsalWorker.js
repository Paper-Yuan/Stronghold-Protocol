// public/js/battle/rehearsalWorker.js — the host's side of a delegated bot layout rehearsal (DESIGN §14), a module
// Worker so whole simulated battles never touch the page's frame budget (the main thread keeps rendering the prep).
//
// battle/rehearsal.js (the page) sends the simulation data once and then one task per bot prep; this worker builds
// every candidate from its BattleSpec, runs them with the very comparison the server uses — server/sim/rehearsal.js
// (the same tick cap, early stop and score) — and answers the index of the winner. Nothing but that index leaves here;
// the layouts, the scoring and the placement stay on the server, so a rehearsal can never put a layout of its own on a
// board.
//
//   postMessage → { t: 'ready' }                                        once, when this script has been evaluated
//   onmessage ← { t: 'data', raw }                                      the page's /data/*.json (once, before any task)
//             ← { t: 'rehearsal', taskId, playerId, cap, specs }         one bot prep's candidates
//   postMessage → { t: 'done', taskId, choice } | { t: 'error', taskId, message }
//
// A candidate whose Battle cannot be built is skipped: the server's own rehearsal gets a finished stand-in for it and
// never scores it either (server/sim/rehearsal.js), so both sides compare the same candidates. A task that throws is
// answered as an error and the server runs the candidates itself. The page drops a task the server no longer waits for
// by terminating this worker (battle/rehearsal.js), so a stale simulation never holds it.

// The simulation modules are loaded the way the page loads them (`/sim/` is served from server/sim/, so it is no
// public/ path a static import could resolve — public/js/battle/runner.js imports them dynamically too).
const { createBattleFromSpec } = await import('/sim/spec.js');
const { DataSource, setSimData } = await import('/sim/simdata.js');
const { RehearsalRun } = await import('/sim/rehearsal.js');
const { loadModuleKits } = await import('./modKits.js');

/** The page's simulation data as a DataSource (null before the data frame arrives). */
let ds = null;

/**
 * Run one task and return the winning candidate index.
 * @param {{ taskId: string, playerId: string, cap: number, specs: object[] }} task
 */
async function rehearse(task) {
  if (!ds) throw new Error('simulation data not loaded');
  // this worker has only the official data the page posted. A spec that names a content set (plugin data or scripts)
  // is the server's rehearsal, never this one.
  if ((task.specs || []).some((s) => s && typeof s.cs === 'string' && s.cs !== '')) throw new Error('content set is not rehearsed here');
  // 房间模组的 kit 表 (W-C)：每个候选的规格各自点名 `modules`，先把它们 import 成表再建战斗 —— 少一个 kit 就意味着
  // 这个候选建不起来（被 run 跳过），模组房里的排练会静默退化成「只有官方干员」。
  const kitMaps = await Promise.all((task.specs || []).map((s) => loadModuleKits(s && s.modules)));
  // a candidate is built when the run reaches it (server/sim/rehearsal.js): a spec that does not build is skipped
  const run = new RehearsalRun(task.specs.map((spec, i) => () => createBattleFromSpec(spec, ds, { quiet: true, recordEvents: false, ...kitMaps[i] })), task.playerId, task.cap);
  run.run();
  return run.score.index;
}

self.onmessage = async (ev) => {
  const msg = ev && ev.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'data') {
    setSimData(msg.raw);
    ds = new DataSource(msg.raw, null);
    return;
  }
  if (msg.t !== 'rehearsal') return;
  try {
    self.postMessage({ t: 'done', taskId: msg.taskId, choice: await rehearse(msg) });
  } catch (e) {
    self.postMessage({ t: 'error', taskId: msg.taskId, message: String((e && e.message) || e) });
  }
};

// The page holds its first task until this arrives: a message posted to a module Worker before its graph is evaluated
// (the page's data frame would be) never reaches onmessage.
self.postMessage({ t: 'ready' });

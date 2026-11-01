// _annbuild/check-pairs.mjs — disposable: run the tightened data validator over a *built* data directory (data/ cannot be
// written from this session, so the repo test suite has to wait for the promotion). Same entry point contentSet uses:
// shared/plugins/validate.js validateData → PLUGIN_DATA_PAIR (line ~268).
//   node _annbuild/check-pairs.mjs _annbuild/out5
import { loadData } from '../server/data.js';
import { validateData } from '../shared/plugins/validate.js';
import { GameData } from '../server/match/gamedata.js';

const dir = process.argv[2] || '_annbuild/out5';
const QUIET = { info() {}, warn() {}, debug() {}, error() {} };
const data = loadData(dir, { log: QUIET });

const out = validateData(data, {});
const problems = Array.isArray(out) ? out : (out?.problems ?? []);
const pair = problems.filter((p) => String(p.code ?? '').includes('PAIR') || /pair/i.test(String(p.zh ?? '')));
console.log(`problems: ${problems.length} (pair-related: ${pair.length})`);
for (const p of problems.slice(0, 10)) console.log('  •', JSON.stringify(p).slice(0, 220));

// rosters must not move
const official = new GameData(data, 'mode_single_funny');
const zj = new GameData(data, 'mode_single_zhajing');
const ann = new GameData(data, 'mode_single_annihilation');
const base = new GameData(loadData('data', { log: QUIET }), 'mode_single_funny');
const zjBase = new GameData(loadData('data', { log: QUIET }), 'mode_single_zhajing');
console.log(`chess records: built ${Object.keys(data.chess).length} / data ${Object.keys(base.raw.chess).length}`);
console.log(`official visibleChess: built ${official.visibleChess.length} / data ${base.visibleChess.length}`);
console.log(`zhajing visibleChess: built ${zj.visibleChess.length} / data ${zjBase.visibleChess.length}`);
console.log(`annihilation visibleChess: built ${ann.visibleChess.length} / data ${new GameData(loadData('data', { log: QUIET }), 'mode_single_annihilation').visibleChess.length}`);
console.log(`bonds: built ${Object.keys(data.bonds).length} / data ${Object.keys(base.raw.bonds).length}`);
const synthetic = data.chess.chess_zj_pure_a;
console.log('synthetic pure_a:', synthetic ? JSON.stringify({ zhajing: synthetic.zhajing, visible: synthetic.visible, baseId: synthetic.baseId, goldenId: synthetic.goldenId, inOfficial: official.visibleChess.includes('chess_zj_pure_a'), inZj: zj.visibleChess.includes('chess_zj_pure_a'), inAnn: ann.visibleChess.includes('chess_zj_pure_a') }) : 'MISSING');
process.exitCode = problems.length ? 1 : 0;

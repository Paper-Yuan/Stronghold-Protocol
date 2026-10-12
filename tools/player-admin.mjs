import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentials, atomicJson } from '../server/playerAdmin.js';

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
if (args[0] !== 'init' || !args.includes('--origin')) throw new Error('Usage: node tools/player-admin.mjs init --origin https://your-game-host [--config file] [--username admin]');
const origin = new URL(value('--origin'));
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('管理页需要 HTTPS');
const file = path.resolve(args.includes('--config') ? value('--config') : fileURLToPath(new URL('../config/player-admin/config.json', import.meta.url)));
try { await stat(file); throw new Error('管理配置已存在；请在管理页修改密码，不会覆盖原配置'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const username = args.includes('--username') ? value('--username') : 'admin';
if (!/^[A-Za-z0-9_-]{1,32}$/.test(username)) throw new Error('Invalid admin username');
const password = randomBytes(18).toString('base64url');
await atomicJson(file, { version: 1, username, publicOrigin: origin.origin, ...await credentials(password) });
// Print the generated password once for the operator; deployment must capture this to a private file, not logs.
console.log(JSON.stringify({ url: origin.origin + '/admin/', username, password, configFile: file }));

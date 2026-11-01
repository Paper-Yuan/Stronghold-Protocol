import fs from 'node:fs';

const src = 'C:/Users/J1825/.dsh/storages/session_projcache/sessions/session-84b5f503-4a47-4df6-8b30-f6853f2b3544.json';
const raw = fs.readFileSync(src, 'utf8');
const start = raw.indexOf('"id": "task-22"');
if (start < 0) throw new Error('task-22 not found');
// find the description value by locating "description": " after start and decoding the JSON string
const descKey = raw.indexOf('"description": "', start);
const valueStart = descKey + '"description": "'.length;
let i = valueStart;
let out = '';
while (i < raw.length) {
  const ch = raw[i];
  if (ch === '\\') {
    const next = raw[i + 1];
    if (next === 'n') { out += '\n'; i += 2; continue; }
    if (next === 't') { out += '\t'; i += 2; continue; }
    if (next === '"') { out += '"'; i += 2; continue; }
    if (next === '\\') { out += '\\'; i += 2; continue; }
    out += next; i += 2; continue;
  }
  if (ch === '"') break;
  out += ch;
  i += 1;
}
fs.writeFileSync('tmp/task-22.txt', out, 'utf8');
console.log('extracted chars:', out.length);

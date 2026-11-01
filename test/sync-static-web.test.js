// `data/` 与 `public/data/` 必须逐文件一致。
//
// 为什么要有这条：客户端读的是 **`public/data/assets.json`**（`public/js/data.js` 的 `data.get('assets')`），而生成链与
// 手工工具（`tools/patch-assets-local.mjs`）写的是 **`data/assets.json`**。两者之间靠 `tools/sync-static-web.mjs` 拷贝。
// 2026-10-28 曾漏跑一次：`public/data/assets.json` 停在旧版本，新补的 30 个图标 key 客户端一条都看不到、界面继续回退
// 文字，而两份**只差 4.7 KB**（2,692,298 vs 2,697,006），肉眼和体积都发现不了 —— 是靠巡检脚本量 manifest 才对出来。
//
// 只比 `data/` 里真实存在、且属于「站点数据」的文件；`public/data/` 允许多出文件（生成物/缓存），但**同名文件必须逐字节相同**。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, 'data');
const PUBLIC_DATA = join(ROOT, 'public', 'data');

/** 递归列出 relPath 下的所有文件（相对 root）。 */
function listFiles(root, rel = '') {
  const out = [];
  for (const name of readdirSync(join(root, rel), { withFileTypes: true })) {
    const next = rel ? join(rel, name.name) : name.name;
    if (name.isDirectory()) out.push(...listFiles(root, next));
    else out.push(next);
  }
  return out;
}

test('public/data 与 data 逐文件一致（漏同步会让客户端读到旧清单）', () => {
  const files = listFiles(DATA);
  assert.ok(files.length > 10, `data/ 里应当有十余个站点数据文件，实际 ${files.length}`);

  const missing = [];
  const differ = [];
  for (const rel of files) {
    const inSource = join(DATA, rel);
    const inPublic = join(PUBLIC_DATA, rel);
    let st;
    try {
      st = statSync(inPublic);
    } catch {
      missing.push(rel);
      continue;
    }
    if (!st.isFile()) {
      missing.push(rel);
      continue;
    }
    if (!readFileSync(inSource).equals(readFileSync(inPublic))) differ.push(rel);
  }

  assert.deepEqual(missing, [], `public/data 缺少：${missing.join(', ')} —— 跑 node tools/sync-static-web.mjs`);
  assert.deepEqual(differ, [], `public/data 与 data 内容不同：${differ.join(', ')} —— 跑 node tools/sync-static-web.mjs`);
});

test('assets.json 的两份拷贝必须是同一份（客户端用它解析图标 key）', () => {
  const source = join(DATA, 'assets.json');
  const published = join(PUBLIC_DATA, 'assets.json');
  assert.ok(statSync(source).isFile(), 'data/assets.json 不存在');
  assert.ok(statSync(published).isFile(), 'public/data/assets.json 不存在');
  const a = JSON.parse(readFileSync(source, 'utf8'));
  const b = JSON.parse(readFileSync(published, 'utf8'));
  for (const group of ['bondIcon', 'bandIcon', 'itemIcon', 'chars', 'ui', 'namecards']) {
    const count = (m) => (m && m[group] ? Object.keys(m[group]).length : 0);
    assert.equal(count(b), count(a), `${group} 的条目数在 public/data 里不一致（${count(b)} vs ${count(a)}）`);
  }
  assert.equal(relative(ROOT, published).replace(/\\/g, '/'), 'public/data/assets.json');
});

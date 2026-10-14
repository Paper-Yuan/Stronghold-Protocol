// server/packFiles.js — 一个工坊包「有哪些文件」的**唯一**枚举器：包身份哈希与客户端下载清单都读它。
//
// 为什么要抽成一份（业主裁决 B，DESIGN §28.2）：包摘要必须恰好描述「客户端会下载、会执行的那一份」。
// 两份清单各用一条规则生成就会漂移，而漂移的后果不是「摘要差一点」，是：一个**被声明模块 import 的**文件
// （同目录的 helper、没被声明的 `server/rules.mjs` / `client/helper.js`）两份清单里都没有 —— 干净的客户端
// 根本不会下它，服务端跑得好的包在浏览器里连 import 都解析不出来。
//
// 规则：包目录下的**全部普通文件**，递归，按路径排序。
//
// 刻意**没有**任何按名字或目录的排除项：被声明的模块可以 `import` 同目录的兄弟文件、可以在运行时 `fs.readFileSync`
// 一个数据文件或模板，而 Node 的解析是原生的 —— 所以「这个包会执行/读到哪些文件」不存在可判定的答案，除了一整个
// 目录。任何例外（`README.md`、`test/`、`*.bak`）都会把本模块要堵的那个洞重新打开。作者承担的一个后果：放在包
// 目录里的散文件**就是这个包的一部分**（它会改哈希、也会被列进下载清单）—— 别把编辑器备份、构建产物或版本库
// 元数据留在待分发的包目录里。
//
// 顺序是**确定性**的：递归 + 全局按路径排序，不依赖 `readdir` 的顺序，所以同一份包在任何机器上哈希相同。

import fs from 'node:fs';
import path from 'node:path';

/**
 * 身份清单里那条**合成**路径：声明的资源容器的 sha256（`pack.json.assets`，DESIGN §28.13.5）。
 *
 * 它没有自己的字节 —— 它的贡献就是容器的 sha256（装载期 `assetsIssues` 已与容器的真实字节核对过），所以它**不在**
 * `listPackFiles` 的结果里，也永远不会与一个真实文件混淆（真实路径里带 `assets.` 的只有 `assets/` 目录下的文件，
 * 即 `assets/<name>`）。
 */
export const ASSETS_DIGEST_PATH = 'assets.container.sha256';

/** `sort()` 在 UTF-16 码元上做字典序；哈希需要一份任何机器都同意的固定顺序（与 `identifyPack` 的清单排序同一条）。 */
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 包目录下的全部普通文件，`rel` 路径（`/` 分隔、无前导 `./`），**按路径排序**。
 *
 * 目录不在（例如一个没有 `kits/` 的普通数据包）不是错误，返回 `[]`。符号链接既不跟随也不列出：`Dirent` 对链接
 * 既不给 `isFile()` 也不给 `isDirectory()`，所以一个指向包外的链接既不进哈希、也不出现在下载清单里 ——
 * 「清单里的每一个路径都在包目录之内」这条保证不会被链接绕过。
 * @param {string} packDir 包的目录（绝对或相对都可）
 * @returns {string[]}
 */
export function listPackFiles(packDir) {
  /** @type {string[]} */
  const out = [];
  walk(packDir, '');
  return out.sort(byPath);

  /**
   * @param {string} dir
   * @param {string} prefix
   */
  function walk(dir, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.isFile()) out.push(rel);
    }
  }
}

/**
 * 那条合成路径**服务的字节**：摘要本身的 64 个 ASCII 十六进制字符。
 *
 * 为什么它要有字节（B 的收口）：客户端重建包摘要时，这一条贡献必须拿到手，而下载清单里每一行都得是可下载、可核对
 * 的（`public/js/mods/sync.js` 会逐行取回并与 `sha256` 对账）。所以这一行的载荷就是摘要文本本身 —— 64 字节，
 * 内容由装载期核对过的容器摘要唯一决定，客户端下载后能用两种方式验它：它自己的 `sha256`，以及同一份清单里那份
 * 容器文件的真实字节。
 * @param {string} digest 容器摘要（64 位小写十六进制）
 * @returns {Buffer}
 */
export function containerDigestBytes(digest) {
  return Buffer.from(String(digest), 'utf8');
}

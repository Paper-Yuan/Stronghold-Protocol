// scripts/pack/_lib.mjs — 三端发布管线共用的小工具（无第三方依赖）。
//
// 这里放的是三条管线（server / desktop / mobile）都要用的东西：路径常量、子进程封装、体积格式化，
// 以及一个纯 Node 的 ZIP 写入器（zipDir）。ZIP 写入器取代了原来的三个 Python 打包脚本
// （pack-server-zip.py / pack-windows-release.py / build-windows-zip.py），关键是保留它们的 UTF-8
// 文件名标记（general purpose bit 11），否则 Windows 资源管理器 / 7-Zip 打开带中文名的条目会乱码。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** 三条管线的统一产物根目录（已进 .gitignore）。 */
export const DIST = path.join(ROOT, 'dist');

export const IS_WIN = process.platform === 'win32';

/** 人类可读体积。 */
export const human = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** 段落标题，三条管线的输出保持同一形状。 */
export function banner(title) {
  console.log(`\n=== ${title} ===`);
}

/** 跑一个子进程；失败即抛（带上退出码，便于定位是构建还是打包挂了）。 */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.error) throw new Error(`${cmd} 启动失败: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} 退出码 ${r.status}`);
  return r;
}

export function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** 逐项断言存在，缺哪个报哪个（打包前的前置检查）。 */
export function assertExists(paths) {
  const missing = paths.filter((p) => !fs.existsSync(p));
  if (missing.length) throw new Error(`缺少前置产物/文件:\n  ${missing.join('\n  ')}`);
}

/** 递归统计目录的文件数与字节数。 */
export function dirSize(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(d, e.name);
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      if (st.isDirectory()) walk(f);
      else { files++; bytes += st.size; }
    }
  };
  walk(dir);
  return { files, bytes };
}

/** `git ls-files` 的列表（打包只收被跟踪的文件，避免把本地垃圾带进包）。 */
export function gitTrackedFiles(cwd = ROOT) {
  const r = spawnSync('git', ['-C', cwd, 'ls-files', '-z'], { maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error('git ls-files 失败：必须在 git 仓库中运行');
  return r.stdout.toString('utf8').split('\0').filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------
// 整树复制

/**
 * 整目录复制（素材 / 依赖），跳过点开头的条目。
 *
 * 目录型符号链接与 NTFS junction 会被**跟随**：本仓库工作树里的 `public/assets/*` 就是指向素材仓库的
 * junction，按「符号链接一律跳过」处理会让发布包静默丢掉全部美术与音频（桌面包只剩 271 个皮肤头像，
 * 服务器包同理）。指向**文件**的链接仍然跳过——那类链接的目标可能在仓库之外。
 *
 * 用 realpath 的祖先链去重，防止链接成环时无限递归。
 *
 * @param {string} src 源目录
 * @param {string} dst 目标目录
 * @returns {Promise<{ files: number, bytes: number }>}
 */
export async function copyDir(src, dst) {
  let files = 0;
  let bytes = 0;

  const walk = async (d, out, chain) => {
    let real;
    try { real = await fsp.realpath(d); } catch { return; }
    if (chain.has(real)) return;               // 环：这个目录是自己的祖先，停下
    const nextChain = new Set(chain).add(real);

    await fsp.mkdir(out, { recursive: true });
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }

    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const from = path.join(d, e.name);
      const to = path.join(out, e.name);

      if (e.isSymbolicLink()) {
        let st;
        try { st = await fsp.stat(from); } catch { continue; }   // 断链：跳过
        if (st.isDirectory()) await walk(from, to, nextChain);
        continue;
      }
      if (e.isDirectory()) {
        await walk(from, to, nextChain);
        continue;
      }
      if (!e.isFile()) continue;

      await fsp.copyFile(from, to);
      files++;
      try { bytes += (await fsp.stat(to)).size; } catch { /* 统计失败不影响复制 */ }
    }
  };

  await walk(src, dst, new Set());
  return { files, bytes };
}

// ---------------------------------------------------------------------------------------------------
// ZIP 写入器

const crc32 = typeof zlib.crc32 === 'function'
  ? (buf) => zlib.crc32(buf) >>> 0
  : (() => {
    // 老 Node 的兜底实现（Node 20.15 起有 zlib.crc32；本仓库要求 22+，这里只是防御）。
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return (buf) => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
  })();

/** DOS 时间/日期（ZIP 头用的本地时间）。 */
function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * 把一个目录压成 ZIP。条目名以 `rootName` 开头（默认取目录名），这样解压出来是一层干净的同名目录；
 * 传 `null`（或空串）表示不要顶层目录，条目直接从源目录的内容开始 —— 安卓的 app_bundle.zip 就是这种，
 * 它解压到 filesDir/bundle 后要求 `public/`、`server/` 直接躺在根下。
 *
 * 与原来的 Python 打包脚本对齐的行为：条目按名称排序（产物可复现）、UTF-8 标记位置 1、目录条目也写进去
 * （空目录不丢）、Unix 权限位（目录 755 / 文件 644）。压缩用 deflate level 6。
 *
 * @param {string} srcDir 源目录
 * @param {string} outZip 目标 .zip
 * @param {{ rootName?: string | null, onProgress?: (n: number, bytes: number) => void }} [opts]
 * @returns {{ files: number, bytes: number, zipBytes: number }}
 */
export function zipDir(srcDir, outZip, opts = {}) {
  const rootName = opts.rootName === undefined ? path.basename(srcDir) : opts.rootName;
  const prefix = rootName ? `${rootName}/` : '';
  const onProgress = opts.onProgress;

  /** @type {{ name: string, abs: string, isDir: boolean }[]} */
  const entries = [];
  const walk = (dir, rel) => {
    const names = fs.readdirSync(dir).sort();
    for (const name of names) {
      const abs = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        entries.push({ name: `${relPath}/`, abs, isDir: true });
        walk(abs, relPath);
      } else {
        entries.push({ name: relPath, abs, isDir: false });
      }
    }
  };
  walk(srcDir, '');

  ensureDir(path.dirname(outZip));
  const tmp = `${outZip}.tmp`;
  rmrf(tmp);
  const fd = fs.openSync(tmp, 'w');

  const central = [];
  let offset = 0;
  let files = 0;
  let bytes = 0;
  let done = 0;

  try {
    for (const e of entries) {
      const nameBuf = Buffer.from(`${prefix}${e.name}`, 'utf8');
      const st = fs.statSync(e.abs);
      const { time, date } = dosDateTime(st.mtime);
      let method = 0;
      let comp = Buffer.alloc(0);
      let raw = Buffer.alloc(0);
      let crc = 0;
      let uncompSize = 0;

      if (!e.isDir) {
        raw = fs.readFileSync(e.abs);
        uncompSize = raw.length;
        crc = crc32(raw);
        const deflated = zlib.deflateRawSync(raw, { level: 6 });
        // 只有真压缩了才用 deflate，否则按存储（小文件/已压缩内容反而更大）。
        if (deflated.length < raw.length) { method = 8; comp = deflated; }
        else { method = 0; comp = raw; }
        files++;
        bytes += uncompSize;
      }

      const extAttr = e.isDir ? ((0o755 << 16) | 0x10) >>> 0 : ((0o644 << 16) >>> 0);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);           // version needed
      local.writeUInt16LE(0x800, 6);        // UTF-8 flag
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(comp.length, 18);
      local.writeUInt32LE(uncompSize, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);

      fs.writeSync(fd, local);
      fs.writeSync(fd, nameBuf);
      if (comp.length) fs.writeSync(fd, comp);

      central.push({ nameBuf, method, time, date, crc, compSize: comp.length, uncompSize, offset, extAttr });
      offset += local.length + nameBuf.length + comp.length;

      if (onProgress && ++done % 2000 === 0) onProgress(files, bytes);
    }

    const cdStart = offset;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(0x031e, 4);           // version made by: unix, 3.0
      h.writeUInt16LE(20, 6);               // version needed
      h.writeUInt16LE(0x800, 8);            // UTF-8 flag
      h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(c.time, 12);
      h.writeUInt16LE(c.date, 14);
      h.writeUInt32LE(c.crc, 16);
      h.writeUInt32LE(c.compSize, 20);
      h.writeUInt32LE(c.uncompSize, 24);
      h.writeUInt16LE(c.nameBuf.length, 28);
      h.writeUInt16LE(0, 30);               // extra len
      h.writeUInt16LE(0, 32);               // comment len
      h.writeUInt16LE(0, 34);               // disk start
      h.writeUInt16LE(0, 36);               // internal attrs
      h.writeUInt32LE(c.extAttr, 38);
      h.writeUInt32LE(c.offset, 42);
      fs.writeSync(fd, h);
      fs.writeSync(fd, c.nameBuf);
      offset += h.length + c.nameBuf.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(offset - cdStart, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    fs.writeSync(fd, eocd);
  } finally {
    fs.closeSync(fd);
  }

  rmrf(outZip);
  fs.renameSync(tmp, outZip);
  return { files, bytes, zipBytes: fs.statSync(outZip).size };
}

/** 读 ZIP 的中央目录（只读目录，不解压）：条目名 + 各自的 general purpose flags。 */
function readCentralDirectory(zipPath) {
  const buf = fs.readFileSync(zipPath);
  // 从尾部找 EOCD（注释最长 65535，所以最多回退 65557 字节）。
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${path.basename(zipPath)}: 找不到 EOCD，不是合法 ZIP`);
  const total = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('中央目录结构异常');
    const flags = buf.readUInt16LE(cd + 8);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    entries.push({ name: buf.subarray(cd + 46, cd + 46 + nameLen).toString('utf8'), flags });
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * ZIP 里所有条目名（含以 `/` 结尾的目录条目）。打包后的门禁自检用，不需要解压、不依赖 unzip/python。
 * @returns {string[]}
 */
export function zipEntryNames(zipPath) {
  return readCentralDirectory(zipPath).map((e) => e.name);
}

/**
 * 自检：ZIP 里所有非 ASCII 条目都带 UTF-8 标记位（build-windows-zip.py 原来的自检，保留）。
 * @returns {{ total: number, nonAscii: number }}
 */
export function verifyZipUtf8(zipPath) {
  const entries = readCentralDirectory(zipPath);
  let nonAscii = 0;
  for (const e of entries) {
    if (/[^\x00-\x7f]/.test(e.name)) {
      nonAscii++;
      if (!(e.flags & 0x800)) throw new Error(`${path.basename(zipPath)}: 条目 ${e.name} 缺少 UTF-8 标记位`);
    }
  }
  return { total: entries.length, nonAscii };
}

// 交付前的确定性检查：只读 PNG 头与解压后的字节分布，判断尺寸与是否空白。
// 用法：node docs/mockups/png-gate.cjs docs/mockups/mod-ui-equipment-web.png ...
const fs = require('fs');
const zlib = require('zlib');

function probe(p) {
  let b;
  try {
    b = fs.readFileSync(p);
  } catch (e) {
    return { path: p, exists: false };
  }
  if (b.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return { path: p, exists: true, err: 'not a png' };
  let off = 8;
  let w = 0;
  let h = 0;
  const idat = [];
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.slice(off + 4, off + 8).toString('latin1');
    const data = b.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  let inkStd = -1;
  try {
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const step = Math.max(1, Math.floor(raw.length / 200000));
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let i = 0; i < raw.length; i += step) {
      const v = raw[i];
      sum += v;
      sum2 += v * v;
      n++;
    }
    const mean = sum / n;
    inkStd = Number(Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2));
  } catch (e) {
    /* 解压失败就留 -1 */
  }
  return { path: p, exists: true, bytes: b.length, w, h, inkStd };
}

const out = [];
for (let i = 2; i < process.argv.length; i++) out.push(probe(process.argv[i]));
console.log(JSON.stringify(out, null, 2));

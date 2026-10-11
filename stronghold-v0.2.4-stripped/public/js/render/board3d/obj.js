// render/board3d/obj.js — minimal Wavefront OBJ reader for the meshes exported by tools/local-extract (UnityPy:
// `v x y z [r g b [a]]`, `vt u v`, `vn x y z`, `f v/vt/vn …`, `g name`, `usemtl name`). Pure (Node-testable).
//
//   parseObj(text) → { position: Float32Array, normal: Float32Array|null, uv: Float32Array|null,
//                      color: Float32Array|null, index: Uint16Array|Uint32Array, groups: [{ name, start, count }],
//                      bounds: { min: [x,y,z], max: [x,y,z] } } | null (no geometry)
// Faces with more than 3 corners are fanned; negative (relative) indices are honoured; unknown statements are
// ignored. Vertices are de-duplicated per (v, vt, vn) corner triplet.

export function parseObj(text) {
  if (typeof text !== 'string' || !text) return null;
  const v = [], vt = [], vn = [], vc = [];
  const outPos = [], outNrm = [], outUv = [], outCol = [], idx = [];
  const groups = [];
  const map = new Map();
  let group = { name: 'default', start: 0, count: 0 };
  let hasColor = false;
  const lines = text.split(/\r?\n/);
  const ref = (s, len) => {
    if (s === undefined || s === '') return -1;
    const n = parseInt(s, 10);
    if (!Number.isFinite(n) || n === 0) return -1;
    return n > 0 ? n - 1 : len + n;
  };
  const corner = (tok) => {
    const [a, b, c] = tok.split('/');
    const iv = ref(a, v.length / 3), it = ref(b, vt.length / 2), inn = ref(c, vn.length / 3);
    if (iv < 0 || iv * 3 + 2 >= v.length) return -1;
    const key = `${iv}/${it}/${inn}`;
    let id = map.get(key);
    if (id !== undefined) return id;
    id = outPos.length / 3;
    outPos.push(v[iv * 3], v[iv * 3 + 1], v[iv * 3 + 2]);
    outCol.push(vc[iv * 3] ?? 1, vc[iv * 3 + 1] ?? 1, vc[iv * 3 + 2] ?? 1);
    if (it >= 0 && it * 2 + 1 < vt.length) outUv.push(vt[it * 2], vt[it * 2 + 1]); else outUv.push(0, 0);
    if (inn >= 0 && inn * 3 + 2 < vn.length) outNrm.push(vn[inn * 3], vn[inn * 3 + 1], vn[inn * 3 + 2]); else outNrm.push(NaN, NaN, NaN);
    map.set(key, id);
    return id;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    switch (parts[0]) {
      case 'v': {
        const x = +parts[1], y = +parts[2], z = +parts[3];
        v.push(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0);
        if (parts.length >= 7) { hasColor = true; vc[v.length - 3] = +parts[4]; vc[v.length - 2] = +parts[5]; vc[v.length - 1] = +parts[6]; }
        break;
      }
      case 'vt': vt.push(+parts[1] || 0, +parts[2] || 0); break;
      case 'vn': vn.push(+parts[1] || 0, +parts[2] || 0, +parts[3] || 0); break;
      case 'g': case 'o': case 'usemtl': {
        if (group.count > 0) groups.push(group);
        group = { name: parts.slice(1).join(' ') || 'default', start: idx.length, count: 0 };
        break;
      }
      case 'f': {
        const ids = parts.slice(1).map(corner);
        if (ids.some((i) => i < 0) || ids.length < 3) break;
        for (let k = 1; k + 1 < ids.length; k++) { idx.push(ids[0], ids[k], ids[k + 1]); group.count += 3; }
        break;
      }
      default: break;
    }
  }
  if (group.count > 0) groups.push(group);
  if (!idx.length) return null;
  const position = new Float32Array(outPos);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], position[i + a]); max[a] = Math.max(max[a], position[i + a]); }
  const haveNormals = outNrm.every((x) => Number.isFinite(x));
  return {
    position,
    normal: haveNormals ? new Float32Array(outNrm) : null,
    uv: vt.length ? new Float32Array(outUv) : null,
    color: hasColor ? new Float32Array(outCol) : null,
    index: position.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    groups,
    bounds: { min, max },
  };
}

/** Uniformly transform a parsed mesh: `fn(x, y, z) → [x, y, z]` for positions, `nfn` for normals (optional). */
export function mapMesh(mesh, fn, nfn) {
  const p = mesh.position, pos = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) { const q = fn(p[i], p[i + 1], p[i + 2]); pos[i] = q[0]; pos[i + 1] = q[1]; pos[i + 2] = q[2]; }
  let normal = mesh.normal;
  if (normal && nfn) {
    const n = mesh.normal; normal = new Float32Array(n.length);
    for (let i = 0; i < n.length; i += 3) { const q = nfn(n[i], n[i + 1], n[i + 2]); normal[i] = q[0]; normal[i + 1] = q[1]; normal[i + 2] = q[2]; }
  }
  return { ...mesh, position: pos, normal };
}

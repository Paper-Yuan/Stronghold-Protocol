// Fetch every module reachable from /js/main.js over HTTP and report non-200 responses.
// This is what the browser does on boot: a 404 here is a blank screen.
const base = process.env.SP_BASE || 'http://127.0.0.1:3000';
const seen = new Set();
const bad = [];

function specsOf(text) {
  const out = [];
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

async function walk(url) {
  if (seen.has(url)) return;
  seen.add(url);
  let res;
  try {
    res = await fetch(base + url);
  } catch (e) {
    bad.push(`${url} FETCH FAIL ${e.message}`);
    return;
  }
  if (!res.ok) {
    bad.push(`${url} -> ${res.status}`);
    return;
  }
  const text = await res.text();
  for (const s of specsOf(text)) {
    if (!s.startsWith('.') && !s.startsWith('/')) continue;
    const u = new URL(s, base + url).pathname;
    await walk(u);
  }
}

await walk('/js/main.js');
console.log('modules fetched:', seen.size);
console.log('failures:', bad.length);
for (const b of bad.slice(0, 20)) console.log('  ' + b);

// also the stylesheets the page links
const html = await (await fetch(base + '/')).text();
const sheets = [...html.matchAll(/href="(\/css\/[^"]+)"/g)].map((m) => m[1]);
const missingSheets = [];
for (const s of sheets) {
  const r = await fetch(base + s);
  if (!r.ok) missingSheets.push(`${s} -> ${r.status}`);
}
console.log('stylesheets:', sheets.length, 'missing:', missingSheets.length);
for (const m of missingSheets) console.log('  ' + m);

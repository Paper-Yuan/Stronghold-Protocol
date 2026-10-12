// server/http/common.js — what every HTTP answer shares:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * the security headers, set on every response before any route runs (routes.js);
//   * splitUrl (raw path + query, also from absolute-form URLs), the bilingual error page (sendError) and JSON replies
//     (sendJson) — both `Cache-Control: no-store`, without a body for HEAD;
//   * the bare `400 Bad Request` for a request node:http cannot parse (answerClientError).

/** Headers on every HTTP response. @param {import('node:http').ServerResponse} res */
export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function errorPage(status, title, detail = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} · 卫戍协议：盟约</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111614;color:#d8e3de;font:16px/1.6 "Noto Sans SC",system-ui,sans-serif}
main{border:1px solid #2c3a35;padding:32px 40px;max-width:520px;text-align:center}h1{margin:0;color:#4ed8af;font-size:56px;letter-spacing:4px}
p{margin:8px 0}a{color:#4ed8af}</style></head><body><main><h1>${status}</h1><p>${escapeHtml(title)}</p>
${detail ? `<p style="opacity:.6">${escapeHtml(detail)}</p>` : ''}<p><a href="/">返回首页 · Back to home</a></p></main></body></html>`;
}

export function sendError(req, res, status, title, detail) {
  if (res.headersSent) { res.destroy(); return; }
  const body = Buffer.from(errorPage(status, title, detail));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function sendJson(req, res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Split an absolute request URL into raw path + query (also accepts absolute-form URLs). */
export function splitUrl(url) {
  let u = url || '/';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    try { const parsed = new URL(u); u = parsed.pathname + parsed.search; } catch { return null; }
  }
  const q = u.indexOf('?');
  const hashless = (s) => { const h = s.indexOf('#'); return h >= 0 ? s.slice(0, h) : s; };
  return q >= 0 ? { rawPath: hashless(u.slice(0, q)), query: hashless(u.slice(q + 1)) } : { rawPath: hashless(u), query: '' };
}

/** node:http 'clientError' listener: a reset socket is dropped, any other unparseable request gets a bare 400. */
export function answerClientError(err, socket) {
  if (err && err.code === 'ECONNRESET') { socket.destroy(); return; }
  try {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    else socket.destroy();
  } catch { /* ignore */ }
}

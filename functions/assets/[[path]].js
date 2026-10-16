/**
 * Cloudflare Pages Function: Hybrid Asset Resolver
 * 1. Checks if asset exists locally on Cloudflare Pages (e.g. skin_avatar png).
 * 2. If missing, checks Render backend for base art/voices.
 * 3. If still missing and is a skin spine model, fetches on-demand from jsdelivr CDN.
 */
export async function onRequest(context) {
  // 1. Try local Pages asset first
  const localRes = await context.next();
  const ctype = localRes.headers.get('content-type') || '';

  // If local asset exists and is a real asset (not SPA fallback to index.html)
  if (localRes.status === 200 && !ctype.includes('text/html')) {
    return localRes;
  }

  const url = new URL(context.request.url);

  // 2. Fallback to CDNs and Primary Production server (101.37.150.107:3000) for full art/voices/portraits/spines
  const weishuOrigin = 'https://weishucdn.jiangjiangze.icu';
  const speedOrigin = 'https://speedcdn.jiangjiangze.icu';
  const primaryOrigin = 'http://101.37.150.107:3000';
  const renderOrigin = 'https://stronghold-protocol-see7.onrender.com';
  const originCandidates = [
    `${weishuOrigin}${url.pathname}${url.search}`,
    `${speedOrigin}${url.pathname}${url.search}`,
    `${primaryOrigin}${url.pathname}${url.search}`,
    `${renderOrigin}${url.pathname}${url.search}`
  ];

  for (const originUrl of originCandidates) {
    try {
      const upstreamRes = await fetch(originUrl, {
        method: context.request.method,
        headers: {
          ...Object.fromEntries(context.request.headers.entries()),
          'Host': new URL(originUrl).host,
        },
        cf: {
          cacheEverything: true,
          cacheTtl: 86400 * 30, // 30 days CDN cache
        },
      });

      if (upstreamRes.status === 200 && !upstreamRes.headers.get('content-type')?.includes('text/html')) {
        const headers = new Headers(upstreamRes.headers);
        headers.set('Cache-Control', 'public, max-age=2592000, immutable');
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag, X-SP-Resource, X-SP-Resource-Hash');
        return new Response(upstreamRes.body, {
          status: 200,
          headers,
        });
      }
    } catch (err) {
      console.warn('[assets-proxy] Upstream fetch failed for', originUrl, err);
    }
  }

  // 3. Fallback to jsdelivr CDN for skin spine models (/assets/spine/op/char_*/stem/front|back/...)
  const spineMatch = url.pathname.match(/^\/assets\/spine\/op\/([^/]+)\/([^/]+)\/(front|back)\/(.+)$/i);
  if (spineMatch) {
    const [, charId, stem, side, file] = spineMatch;
    const sideCap = side.charAt(0).toUpperCase() + side.slice(1).toLowerCase();
    const jsdUrl = `https://cdn.jsdelivr.net/gh/fexli/ArknightsResource@main/spine/${charId}/${stem}/${sideCap}/${file}`;

    try {
      const jsdRes = await fetch(jsdUrl, {
        cf: {
          cacheEverything: true,
          cacheTtl: 86400 * 30,
        },
      });

      if (jsdRes.ok) {
        const headers = new Headers(jsdRes.headers);
        headers.set('Cache-Control', 'public, max-age=2592000, immutable');
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(jsdRes.body, {
          status: 200,
          headers,
        });
      }
    } catch (err) {
      console.warn('[assets-proxy] jsdelivr fetch failed:', err);
    }
  }

  return localRes;
}

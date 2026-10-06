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

  // 2. Fallback to Render backend for character art/voices
  const renderUrl = `https://stronghold-protocol-see7.onrender.com${url.pathname}${url.search}`;
  try {
    const renderRes = await fetch(renderUrl, {
      method: context.request.method,
      headers: context.request.headers,
      cf: {
        cacheEverything: true,
        cacheTtl: 86400 * 30, // 30 days CDN cache
      },
    });

    if (renderRes.status === 200 && !renderRes.headers.get('content-type')?.includes('text/html')) {
      const headers = new Headers(renderRes.headers);
      headers.set('Cache-Control', 'public, max-age=2592000, immutable');
      return new Response(renderRes.body, {
        status: 200,
        headers,
      });
    }
  } catch (err) {
    console.warn('[assets-proxy] Render fetch failed:', err);
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

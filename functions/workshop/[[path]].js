/**
 * Cloudflare Pages Function: Workshop & Mod Assets CDN Proxy
 * Proxies /workshop/* to primary production server and caches at edge.
 */
export async function onRequest(context) {
  const localRes = await context.next();
  const ctype = localRes.headers.get('content-type') || '';
  if (localRes.status === 200 && !ctype.includes('text/html')) {
    return localRes;
  }

  const url = new URL(context.request.url);
  const primaryOrigin = 'http://101.37.150.107:3000';
  const targetUrl = `${primaryOrigin}${url.pathname}${url.search}`;

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: context.request.method,
      headers: {
        ...Object.fromEntries(context.request.headers.entries()),
        'Host': '101.37.150.107:3000',
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 86400 * 7, // 7 days CDN edge cache
      },
    });

    if (upstreamRes.status === 200 && !upstreamRes.headers.get('content-type')?.includes('text/html')) {
      const headers = new Headers(upstreamRes.headers);
      headers.set('Cache-Control', 'public, max-age=604800, immutable');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      return new Response(upstreamRes.body, {
        status: 200,
        headers,
      });
    }
  } catch (err) {
    console.warn('[workshop-cdn] Upstream fetch failed for', targetUrl, err);
  }

  return localRes;
}

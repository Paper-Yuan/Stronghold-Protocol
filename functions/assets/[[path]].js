/**
 * Cloudflare Pages Function: Hybrid Asset Resolver
 * 1. Checks if asset exists locally on Cloudflare Pages (e.g. skin_avatar).
 * 2. If 404, transparently fetches from Render backend and caches on Cloudflare CDN.
 */
export async function onRequest(context) {
  // 1. Try local Pages asset first
  const localRes = await context.next();
  if (localRes.status === 200) {
    return localRes;
  }

  // 2. Fallback to Render backend for large character art/voices
  const url = new URL(context.request.url);
  const targetUrl = `https://stronghold-protocol-see7.onrender.com${url.pathname}${url.search}`;

  try {
    const renderRes = await fetch(targetUrl, {
      method: context.request.method,
      headers: context.request.headers,
      cf: {
        cacheEverything: true,
        cacheTtl: 86400 * 30, // 30 days
      },
    });

    if (renderRes.status === 200) {
      const headers = new Headers(renderRes.headers);
      headers.set('Cache-Control', 'public, max-age=2592000, immutable');
      return new Response(renderRes.body, {
        status: 200,
        headers,
      });
    }
  } catch (err) {
    console.warn('[assets-proxy] Fetch failed:', err);
  }

  return localRes;
}

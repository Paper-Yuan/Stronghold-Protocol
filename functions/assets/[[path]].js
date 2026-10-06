/**
 * Cloudflare Pages Function: Proxy /assets/* to Render server
 * Cloudflare Edge will cache images & audio so Render doesn't get flooded.
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetUrl = `https://stronghold-protocol-see7.onrender.com${url.pathname}${url.search}`;

  const res = await fetch(targetUrl, {
    method: context.request.method,
    headers: context.request.headers,
    cf: {
      cacheEverything: true,
      cacheTtl: 86400 * 30, // Cache on Cloudflare edge for 30 days
    },
  });

  // Ensure CDN cache-control headers
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'public, max-age=2592000, immutable');

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

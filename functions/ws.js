/**
 * Cloudflare Pages Function: WebSocket Reverse Proxy to Backend
 * Proxies /ws to the dedicated game server backend over Cloudflare's Anycast backbone.
 */
export async function onRequest(context) {
  const request = context.request;
  const upgradeHeader = request.headers.get('Upgrade');

  // Fallback to Codespaces or configured backend
  const backend = context.env?.BACKEND_WS_URL || 'https://literate-space-trout-wv9vr47jg794f94qp-3000.app.github.dev/ws';

  if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
    const backendUrl = new URL(backend);
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', backendUrl.hostname);

    return fetch(backendUrl.toString(), {
      method: request.method,
      headers: newHeaders,
    });
  }

  return new Response('Stronghold Protocol WSS Edge Gateway: Please connect via WebSocket.', {
    status: 426,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

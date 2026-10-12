# v0.2.4 compatibility candidate

## Status

This is an isolated compatibility build. Producing this archive does not activate it on either live server.
Upstream commit: bc50cac01ff447eff3ab6c35f69d934bbc23b48f. Game version: v0.2.4.
The custom mode remains 无限火力 1.0, with the current solo/co-op balancing and 9/13-round variants.

## Resources

Pack version: f3216bd82a48, 13,889 files. The application does not contain the artwork itself.
data/resource-manifest-frozen.json is the exact manifest embedded in the distributed .spresources file.
data/cdn-resource-config.json pins the CDN file sizes, SHA-1 cache identities and SHA-256 transport checks.
The catalog is served by the application; large artwork remains on the existing verified CDN.
Old verified 02a466edd43d and 223156dea277 imports reuse unchanged files. Changed or added files are fetched on demand and verified.
The f3216bd82a48 local pack is also supported without a full repeated verification on each visit.
Resource proofs compare current per-file hashes before reusing cached bytes.

## Runtime adapters

runtime/relay/ is a snapshot of this node's live WebSocket compression, heartbeat forwarding,
opt-in skin deltas and resource admission modules. Its admission-files.json is updated for the new resource pack.
Install dependencies with `npm ci --omit=dev --ignore-scripts`. The relay below runtime/relay/ resolves ws from the app node_modules. If moved outside the app, provide NODE_PATH explicitly.
The core and relay must use unused loopback ports in staging. Set `UPSTREAM=ws://127.0.0.1:<new-core-port>/ws` and a separate `PORT=<new-relay-port>` before running the relay; the CLI supports those environment settings.
Do not blindly use the archived live defaults (3035 for Guangzhou, 3033 for Hong Kong 2).

The new browser WebSocket build discriminator is `fp100-upstream024-20261011`. Keep `fp10020261010` routed to the old instance until its players have drained. Do not assume the old proxy build map already handles the new tag.

## Activation

1. Validate an isolated candidate with separate ports, sessions and administration/announcement files.
2. Save current code, Nginx routes, service definitions and rollback references.
3. Keep the old core, relay and static module tree available for already open pages and running matches.
4. Switch new connections only after the new frontend, root shared modules, resource manifest/catalog,
   resource admission relay and federation routes all point to a coherent version.
5. Offer manual refresh; do not push reloads. Do not stop old processes until their matches/sessions have drained.

Updating old files in place or restarting the running Node/container is not a player-preserving hot update.
An active match is stored in its original Node process and cannot be moved by copying its files.
This archive retains the owner-specific integrations; the proxy/service activation requires a separate verified cutover.

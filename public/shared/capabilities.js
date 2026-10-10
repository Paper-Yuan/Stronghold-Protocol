// shared/capabilities.js — build-time capability switch (CF_MOD_TRI_PLAN.md §2-B3).
//
// The packaging layer rewrites THIS FILE IN THE STAGED COPY, never the source:
//   desktop/mobile  → { mods: true }
//   无限/ variant   → { mods: false, multiplayer: false }   (pure single-player, docs/ANDROID.md §9)
// So "this build has no mods entry" is a physical property of the shipped bytes, not a
// runtime platform probe — the plan forbids hiding an entry the client can still download.
//
// Read a capability at RENDER time (a guard inside the component), never to pick a module
// at load time: the repo has no bundler, so every module is served either way. The server may
// read one at request time (server/lobby.js refuses what the build does not host).

export const LOCAL_FEATURES = Object.freeze({
  /** Mod entries (the mod manager screen, host pack picker). Mods are fetched from the CDN at boot. */
  mods: true,
  /** Co-op / multiplayer surfaces: the lobby entry, matchmaking, join-by-key. `false` (the 无限/ variant)
   * makes the server refuse every multi-seat room (room.create / match.queue → ERR.BAD_MSG). */
  multiplayer: true,
});

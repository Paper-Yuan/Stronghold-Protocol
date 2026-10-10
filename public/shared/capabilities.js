// shared/capabilities.js — build-time capability switch (CF_MOD_TRI_PLAN.md §2-B3;
// GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md D6).
//
// The packaging layer rewrites THIS FILE IN THE STAGED COPY, never the source:
//   server package  → { endless: false, mods: true }   (its browser assets cannot render the endless entry)
//   desktop/mobile  → { endless: true,  mods: true }
// So "this build has no endless entry" is a physical property of the shipped bytes, not a
// runtime platform probe — the plan forbids hiding an entry the client can still download.
//
// Read a capability at RENDER time (a guard inside the component), never to pick a module
// at load time: the repo has no bundler, so every module is served either way.

export const LOCAL_FEATURES = Object.freeze({
  /** Single-player endless mode entry (lobby card, title button, endless leaderboard). */
  endless: true,
  /** Mod entries (the mod manager screen, host pack picker). Mods are fetched from the CDN at boot. */
  mods: true,
});

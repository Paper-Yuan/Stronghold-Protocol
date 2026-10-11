# Custom deployment contract

This candidate adapts upstream v0.2.4 (bc50cac01ff447eff3ab6c35f69d934bbc23b48f) to the two maintained game nodes.
The upstream architecture, simulation, metadata, data and translation rules still apply.
The owner's later requests override the old v0.2.1-fusion deployment notes.

- Preserve 无限火力 1.0, both round variants, dual strategies, mystery boxes and uncapped random-mode milestones.
- Preserve private rooms, invite-code access, unified cross-node room discovery, session identity and reconnection.
- Preserve skins, mobile layout/fullscreen, damage/DPS, chat/danmaku and the node's current voice features.
- Preserve authenticated administration, announcements, browser presence, matchmaking and network pacing.
- Resource admission remains required. Players may connect to the verified CDN or import the full local pack.
  Reuse verified receipts and unchanged file hashes; do not repeatedly scan every resource or open an import dialog.
- Updates require a player-initiated refresh. Never restart/stop a process hosting active player matches.
- Keep root shared/ and the synchronized public/shared/, public/data/ and public/sim/ complete when mirroring files.
- Do not port the prohibited bond-collapse upstream change (ede8e7e7 / PR 149). See .agents/rules/upstream-sync.md for the operator blacklist.
- Do not put private administration/announcement state, passwords or art assets into version control or release archives.

See docs/CUSTOM-DEPLOYMENT.md for this candidate's state and safe activation requirements.

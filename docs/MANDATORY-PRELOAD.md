# Optional browser preload

The owner disabled the mandatory entry gate on 2026-10-08 after Cache Storage checks repeatedly timed out for an already preloaded player. Entering the title, lobby, invitation, room or restored match never waits for caching. Boot does not start cache scans or downloads and never opens the preload dialog automatically.

The title's optional preload center retains both core and full packages, hash verification, original fusion cache migration and retry deadlines. Close, Escape and backdrop immediately dismiss the window and request a pause, even during a cache scan or a download. Stored files and the saved hash index remain available for a later retry. A cache failure does not mean the player has never preloaded and cannot lock them out.

Resource requests still use Hong Kong static hosting; game/API traffic stays on Guangzhou. Android bundled assets and the existing Service Worker remain supported. No cache is cleared as part of disabling the gate.

Regression checks cover unrestricted navigation despite missing, stale or unresponsive caches, no automatic scans/downloads, and the existing cache preservation/transfer tests. Browser QA uses tiny fixture resources to verify closing during a scan/download and immediately entering the lobby.

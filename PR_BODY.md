# perf: content-hash incremental asset install

## Motivation

Asset extraction in the Android shell was keyed on the app `versionName` (the `.bundle_version`
marker). Every app update — including code-only fixes that did not touch a single texture or
sound — invalidated that marker, so the shell deleted `filesDir/bundle` and re-extracted the
full ~280 MB asset set on first launch. On slow storage this cost players minutes of loading
after each update and doubled the write wear on the device flash for content that had not
changed at all.

This PR splits the shipped bundle into two content-hashed archives and makes the shell
re-extract only the archives whose SHA-256 actually changed. A code-only update now extracts a
few MB (`core.zip`) and skips the 280 MB media archive entirely.

## Bundle format

`tools/bundle-android.mjs` now produces three files in `android/app/src/main/assets/`
(replacing the single `app_bundle.zip` + `bundle.sha256` pair):

| File | Contents | Compression |
|---|---|---|
| `core.zip` | `server/`, `shared/`, `data/`, `node_modules/ws/`, `package.json` (engines pinned to Node >=18), `public/` excluding `public/assets` + `public/fonts`, `licenses/` + `public/licenses/` notices | DEFLATE for text/data; STORE for media extensions (`.png .jpg .webp .ogg .mp3 .skel .atlas .otf .ttf .woff2 .zip`) |
| `assets.zip` | `public/assets/**` + `public/fonts/**` | STORE only — media is already compressed by its own codecs, so on-device extraction is a pure copy |
| `pack.json` | `{ "version", "coreSha", "assetsSha", "coreEntries", "assetsEntries" }` | SHA-256 of each archive plus entry counts |

The previous build shelled out to Python's `zipfile`; the bundler now embeds a minimal ZIP
writer (local headers + central directory + EOCD, CRC-32 table, UTF-8 name flag, fixed
timestamp) written directly in Node. Output is deterministic — identical inputs produce a
byte-identical archive and therefore a stable `pack.json` hash. A read-back gate parses the
written central directory and fails the build if any required license notice
(`licenses/LICENSE.txt`, `licenses/NOTICE.txt`, `licenses/THIRD-PARTY-NOTICES.txt`,
`public/licenses/THIRD-PARTY-NOTICES.txt`, `node_modules/ws/LICENSE`) is missing from
`core.zip`; the licensing/notice behaviour of the old bundler is otherwise unchanged. Only
`node_modules/ws` ships now: the client libraries (pixi, preact, htm, three, pixi-spine) were
already served from `public/vendor/`, and their license texts are reproduced in
`THIRD-PARTY-NOTICES.md`, which ships in `licenses/`. The assets whitelist gate (and
`.gitignore`) now covers `core.zip`, `assets.zip` and `pack.json`, and the bundler deletes
stale `app_bundle.zip` / `bundle.sha256` artifacts if present.

## Shell behaviour

`AssetManagerHelper` keeps its public shape (`ensureAssetsExtracted(context, onProgress)`,
`getBundleDir(context)`) but its internals follow the pack metadata now:

1. Read `pack.json` from APK assets. If it is missing or unreadable, return `false` (the
   server-start path then reports the failure as before).
2. **core.zip** — extracted whenever the marker `filesDir/bundle/.core.sha` differs from
   `coreSha`. Before extracting, everything core owns is wiped (`server/ shared/ data/
   node_modules/ package.json licenses/`, and every `public/` child except `assets` and
   `fonts`), so removed files do not linger; `public/assets` + `public/fonts` survive.
3. **assets.zip** — applied only when `.assets.sha` differs from `assetsSha`. It extracts into
   `filesDir/stage-assets` first, then the staged `assets/` / `fonts/` roots replace their
   targets under `public/`, and only after the swap completes is the marker written. A crash at
   any point leaves the old marker in place, so the next launch simply retries the whole phase —
   a half-installed asset set is impossible.
4. Extraction uses a 1 MB buffer and rejects entries escaping the target directory via a
   canonical-path (`zip-slip`) check.
5. Progress is reported per phase with entry counts:
   `Progress(phase /* "core" | "assets" | "done" */, entriesDone, entriesTotal)`. The only call
   site (`MainActivity.startLocalFlow`) was updated to render these counts into the loading
   label; `NodeServerService` consumes `getBundleDir()` unchanged.

## Upgrade notes

- Existing installs carry no `.core.sha` / `.assets.sha` markers, so the first launch after
  updating re-extracts everything once. After that, extraction is skipped until the relevant
  archive's content actually changes — i.e. never again for asset-only-stable code updates.
- The legacy `.bundle_version` file is deleted during the next core wipe.
- `scripts/build-android.mjs` needs no changes to its flow: step 1 still invokes
  `node tools/bundle-android.mjs`, which now emits the three files instead of one. Python is no
  longer a dependency of the bundling step.

## Verification

- `node --check` passes for both modified `.mjs` files.
- The ZIP writer was dry-tested against a tiny temp tree (nested dirs, a UTF-8 filename,
  binary fixtures): mixed STORE/DEFLATE selection, determinism (two builds → identical
  SHA-256), CRC-32 known-answer check, and `readZipNames` round-trip all pass.
- The produced archives were independently validated with Python's `zipfile`:
  `testzip()` clean, per-entry compression methods correct (DEFLATE for text, STORE for media),
  and every entry's content byte-identical to its source file.
- No Gradle build was run in this environment; Kotlin changes are call-site-compatible by
  inspection (`AssetManagerHelper` is referenced only from `MainActivity` and
  `NodeServerService`, both shown above).

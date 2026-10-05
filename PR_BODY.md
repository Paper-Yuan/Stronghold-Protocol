# build: fetch native deps instead of committing them

## Motivation

The Android shell currently commits its native dependencies to git:

- `android/app/src/main/jniLibs/{arm64-v8a,x86_64}/libnode.so` (62 MB + 65 MB)
- `android/app/src/main/jniLibs/{arm64-v8a,x86_64}/libc++_shared.so`
- `android/app/src/main/cpp/include/**` (634 Node headers)

That is ~135 MB of binaries in every clone, bloating history and every fetch, and making the build non-reproducible from source: the files in the repo cannot be re-derived, and their provenance is only documented in `android/NATIVE_DEPS.json` rather than enforced at acquisition time.

## What changed

- **`scripts/fetch-native-deps.mjs` (new)** — plain Node ESM (no npm dependencies, Node 18+), Windows/macOS/Linux friendly. It:
  - downloads `nodejs-mobile-v18.20.4-android.zip` from the official nodejs-mobile GitHub release into `android/third_party/` (skipped if already present), extracting it with `unzip` (macOS/Linux) or PowerShell `Expand-Archive` (Windows) and handling the zip's nested top-level directory. Downloads go to a `.part` sibling that is renamed into place only on success (a truncated transfer can never poison the cache), interrupted downloads are resumed via HTTP ranges, and the existing zip is sanity-checked (End-of-Central-Directory) before reuse;
  - copies `bin/<abi>/libnode.so` for `arm64-v8a` and `x86_64` into `android/app/src/main/jniLibs/<abi>/` and verifies each file's SHA-256 against `android/NATIVE_DEPS.json`, printing the hash and a `WARN` on mismatch;
  - copies the zip's `include/node/*` into `android/app/src/main/cpp/include/node/` (same path the committed headers used, so the JNI glue's `#include <node.h>` keeps resolving);
  - copies `libc++_shared.so` for both ABIs from the **local** Android NDK (`$ANDROID_HOME/ndk/<latest>/toolchains/llvm/prebuilt/<host-tag>/sysroot/usr/lib/<triple>/`) — `libnode.so` links the NDK's shared C++ runtime, so it must ship next to it; a clear error is printed if `ANDROID_HOME` is not set;
  - is idempotent: it exits immediately when all outputs already exist and match, unless `--force` is passed.
- **`scripts/build-android.mjs`** — runs the fetch step automatically before packaging (and before its existing SHA-256 gate), so a fresh clone builds with `npm run build:android` and no manual setup beyond the Android SDK/NDK. Header comment updated.
- **`package.json`** — adds `npm run fetch:native` for running the fetcher standalone.
- **`android/.gitignore`** — ignores `third_party/`, `app/src/main/jniLibs/`, and `app/src/main/cpp/include/`.
- **Untracked (kept on disk locally):** all files under `android/app/src/main/jniLibs/` and `android/app/src/main/cpp/include/` (~642 files, ~140 MB).

## Building after this PR

Requirements: Node 18+, an Android SDK with an NDK installed, and `ANDROID_HOME` pointing at the SDK.

```sh
npm run build:android   # fetches native deps automatically, then bundles + gradle + signs
# or, to only fetch the native deps:
npm run fetch:native    # add --force to re-download/re-copy
```

The nodejs-mobile zip (~130 MB) is downloaded once into `android/third_party/` and reused afterwards.

## Verification

1. `git rm`-ed paths: confirm `android/app/src/main/jniLibs/**` and `android/app/src/main/cpp/include/**` are no longer in `git ls-files`, while the files remain on a working machine.
2. Delete `android/third_party/`, `android/app/src/main/jniLibs/`, and `android/app/src/main/cpp/include/` in a scratch clone, then run `npm run fetch:native` — the script downloads, extracts, copies, and verifies both `libnode.so` hashes against `NATIVE_DEPS.json`.
3. Run it a second time — it should report "all native deps already present and matching" and exit 0 without network access.
4. `npm run build:android` end-to-end; the existing SHA-256 checksum gate in step 0 must pass.

## Notes / risks

- `scripts/build-android.mjs`'s checksum gate still pins `libc++_shared.so` to the NDK r25b hashes recorded in `NATIVE_DEPS.json`. Building with a different NDK version will copy a byte-different `libc++_shared.so` and fail that gate; if that becomes a problem, the gate should be relaxed for `libc++_shared.so` (it is now locally sourced) or `NATIVE_DEPS.json` updated per-NDK.
- If TLS is intercepted on the build machine (corporate/security software), the fetcher still works: it downloads via `curl` (system cert store) and only falls back to Node's built-in `fetch` when `curl` is unavailable.

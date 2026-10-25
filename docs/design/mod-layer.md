# DESIGN §37 — the workshop (工坊) layer: identity, assets, declarations

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 37. The workshop (工坊) layer

The workshop layer shipped with 0.3.0 (§32 there: the plugin system, its phases and the studio) and kept growing
afterwards. §32 records *when* each piece landed; this section is the consolidated rule set for the layer as it
stands, so a module can cite one heading per rule instead of a paragraph in a release note. The behaviour layer's
kits, the pack format's declarations and the loader's refusals are all here.

> Naming note: several modules still carry comments of the form `DESIGN §28.x`, from the draft numbering this
> section replaces. Those numbers are being migrated to §37.x; where a `§28.x` citation remains it refers to the
> matching rule below, not to the 0.2.3 release notes that hold §28 in this document.

---

### 37.1 Behaviour-layer kit imports: one whitelist that resolves in both worlds

A kit (`<pack>/kits/<chessId>.js`) is one file loaded twice from two roots: the server imports it by real path
(`server/workshop.js loadWorkshopKits`), the browser by URL (`public/js/battle/runner.js loadSpecKits`). A relative
specifier cannot be right for both, so a kit imports through a whitelist of prefixes that resolve in both worlds —
`@kit/…` (the kit SDK) and `@sim/…` (the pure engine helpers) — plus downward sibling specifiers (`./lib/util.js`),
which work because the browser URL keeps the pack root even though the `kits/` segment is dropped
(`server/http/static.js` maps it back). A `..` specifier can never agree the same way and stays refused.

One table (`shared/kitImports.js KIT_IMPORT_FILES`) feeds the server's rewrite, the browser's import map and the
authoring check, so the two ends cannot drift; `test/kitImports.test.js` requires `public/index.html` to agree with
the table. The loader and the validator share one scanner, so the editor cannot pass a kit the loader then refuses.

### 37.2 A pack that can change the match declares `combat: true` — a hard gate

A pack whose declarations reach the match result is admitted only with `"combat": true`. The rule is structural, not
advisory: such a pack enters the room digest gate and the golden corpus, otherwise "a pack that does not declare
`combat` cannot change results" degrades from a guarantee to a slogan. It covers the middle layer's capability
declarations (`assets` / `client` / `server` / `routes`: a `server` module whose `uses` includes `matchClass` wraps
the match itself), `variants` (§37.9), `form` (§37.11) and `behaviour` (§37.12). A missing `true` is a named refusal
(`…_NEED_COMBAT`), reported after the type errors so the author is told to fix the type first.

### 37.3 Load-time asset refusals

`pack.json.assets` may name a container (`.spresources`), a manifest, a server policy and a verify algorithm. Two
refusals happen at **load** time rather than at request time: the container is absent, or its digest does not match
the declared one (`shared/workshop.js`, the B3a paragraph). `assets.verify` is a closed enum (`sha256` only) so a
second algorithm has to be added here deliberately instead of letting the verifier silently compare an md5 against a
sha256.

### 37.4 Pack identity carries the asset digest, and `welcome.modAssets` names the declared manifest

`identifyPack` folds the declared asset container's sha256 into the pack's identity (`server/packFiles.js`), so a
client that cannot fetch a row still knows which bytes it is looking at. `welcome.modAssets` hands the client the
declared manifest of every pack that declares `assets` (`server/http/workshop.js`).

### 37.5 `forms` (clip sets) and `fx.silentPhases`: additive declarations, never replacements

Both are behaviour declarations rather than assets. `forms` says which extra forms a spine id has and which clips
each form uses; `fx.silentPhases` says the model already shows these phase kinds so no generic effect should be
emitted on top. The first-party `FORMS` / `SILENT_PHASES` tables are frozen: a pack only adds. A pack that tried to
redefine them would fail silently, so the parser refuses rather than merging.

### 37.6 `server.transport`: startup transport declared, not scripted

`pack.json.server.transport` is a declarative startup transport configuration: the shape is checked at load and the
server applies it before serving, so no pack ships code that runs at boot.

### 37.7 Author-hosted CDN voice assets

An entry in a pack's voice table may point at the author's own CDN; the client resolves the URL as declared. This is
the voice equivalent of §37.10 — the pack carries the pointer, not the file.

### 37.8 Routes: the core answers first

`server/http/static.js` asks the pack route table **before** the core mounts, so a declaration could answer a path the
engine itself serves. It must not: `coreRouteShadow` (the same table the dynamic `host.route` channel judges with)
decides whether a declared path is one the engine really serves, and such a declaration is **dropped from the map** —
the core mount answers as if nothing had been declared. The pack is **not** refused (a published pack keeps installing
and running, only that declaration stops taking effect), and the drop is named in `errors` plus a `log.warn` line,
never silently. A declaration that merely sits inside a core namespace without a core file occupying it is kept and
reported as a pre-announced displacement.

### 37.9 `variants` (口径): a closed enum of choices, not a data file

A variant declares which 口径 (training level, deploy slots, …) this pack plays with. The axes and their option names
are a closed enum with a single implementation (`shared/variants.js`); the parser here does not judge them a second
time, because two implementations of one axis table is a "which one counts" question. A variant is deliberately **not**
a `WORKSHOP_CONTENT_FILES` entry: a `{ id: record }` file would open a "a pack may override any number" channel, i.e.
an installer inside the engine. Another module that reads the same axes must import them, not restate them; and because
`deploy: "max"` or `training` changes the result, the pack needs `combat: true` (§37.2).

### 37.10 `assets.mirrors[]`: an author CDN carries **this pack's own container**

This is the only entrance to "where do these bytes come from", and its boundary is one pack. It does **not** repoint
the `/assets` tree: `data/assets.json` carries per-file hashes for the manifest but the manifest is manifest-level, so
handing a whole art tree to a third-party host is exactly the shape the "do not redistribute the official art" line
blocks. A bad mirror's blast radius is therefore one pack's own container. `base` must be an absolute `https://` URL
with a trailing slash; each declared mirror's `sha256` must match what it serves.

### 37.11 `form: "elite"`: a read-time projection, not a value override

`form: "elite"` makes every ordinary operator fight with the elite form's role. It is a projection at read time
(`shared/formProjection.js`): the values come from the engine's own `_b` records, and identity and price do not move.
It changes the match result, so it needs `combat: true` (§37.2).

### 37.12 `behaviour`: switches shaped like `variants`, with their own table

A behaviour switch has the same declaration shape as a variant but a different table (`shared/behaviour.js`); the
closed enum lives there and nowhere else. The table today holds four slots — `shopBias`, `prepLoadout`,
`morphPairing` (§37.13) and `unequip` — each landing together with its engine implementation point. A name outside
the table is refused by name. A switch is a declaration, never a numeric or file override: the action is constructed by
the engine, and the whole declaration needs `combat: true` (§37.2).

### 37.13 `morphPairing`: the 变形同构体's pairing rule, one judgement in three read points

The official rule reads as two lines: the pair occupies one equipment slot (`items.length >= 2`), and every paired
`giveBondId` item grants its bond. The submission `19ea65909cf6` asked for the reverse (no slot used, one per
operator, the leftmost granting item only). Both are folded into one closed enum (`official` / `plus`) and one pure
function (`shared/morph.js`), because the three read points (`server/match/bondsMeta.js pieceBonds`,
`server/sim/content/support/index.js unitBonds`, `public/js/ui/gameLogic/bonds.js grantedBonds`) each carried their
own loop and that is exactly where this rule used to fork. The slot half is a policy object (`morphSlotPolicy`) whose
`official` value is a frozen singleton reproducing the old arithmetic byte for byte, so the default path needs no
golden update.

### 37.14 `target`: `forge` (this engine installs it) or `stardust` (recognised, not installed)

`pack.json.target` is a closed enum. `forge` is the default: this engine loads the pack. `stardust` marks a declarative
pack for the Stardust host — this engine **recognises** it, does **not** refuse it, and keeps it out of the data overlay,
so one `pack.json` is readable by both ends. Such a pack may also carry the Stardust profile's own spellings
(`STARDUST_TARGET_FIELDS`: `type`, `capabilities`, and the aliases of `name` / `author` / `gameVersion`).

### 37.15 `mod-registry.json`: what this manager installed, and what the operator disabled

The registry is a state file under the state root (`server/modModules.js stateRootFor`), **never** inside
`workshop/` — that is where the loader scans, so a state file there would be read as a pack. Its one hard rule: a pack
the operator disabled must be **wholly absent**, exactly like a pack that failed to load — no hooks, no
subscriptions, no panels, no bytes in the overlay — while its files stay on disk and one `enable` brings it back.
A pack **not** listed is enabled: installing a pack must make it work immediately, and a lost registry must not make
every pack vanish. The file is the single source of truth for the CLI, the editor and the server.

### 37.16 `dependencies` / `conflicts`: shape here, adjudication at load

Both are arrays of `{ id, range? }` over other workshop packs, using the same id charset and the same version-range
syntax as `shared/packs.js`. This layer judges the **shape** only; the semantics are decided at load
(`adjudicatePackGraph`: missing dependency, version outside the range, conflict, cascade, cycle — each a named
refusal). Same discipline as `target`: the keys enter the normalised record only when written, so a pack that
declares neither hashes byte for byte as before.

### 37.17 `trait.grantsBonds`: a trait that counts as a bond membership

A chess record may write `trait.grantsBonds: ["<bondId>", …]`: a piece carrying that trait counts as a member of those
bonds, so it enters the de-duplicated member set in `server/match/bondsMeta.js` and the layer count rises naturally.
No module, no `server.meta`, no script. The shape judgement lives in one place (`shared/morph.js`, shared by the read
path `grantedBondsByTrait` and the refusal `traitGrantIssues`), and the merge itself (`memberBonds`) is shared by the
three read points so a new membership source does not have to touch three files. A record without the key behaves byte
for byte as before.

### 37.18 `enabled`: installed is not active

`pack.json.enabled: false` means "skip at load", judged by one function (`shared/enabled.js parseEnabledDecl` on the
authoring side, `packEnabled` on the server side) so the loader, the editor and the CLI cannot disagree. It is a
declaration, not a contribution: it never enters the overlay, and the registry (§37.15) remains the operator's own
switch.

### 37.19 `skins[]`: the declaration is data, the behaviour is one appearance provider

A pack may declare `pack.json.skins[] = { id, charId, name, series?, desc?, art?, voices? }`. Three anchors pin it:
the closed field set (`SKIN_FIELDS` — a misspelled key is refused by name), the top-level key (`PACK_FIELDS` carries
`skins`, otherwise `PACK_UNKNOWN_FIELD` refuses it) and the landing point (the merged `assets.skins` record). `art` has
the same shape as `art.chars` and reuses the same parser (pack-relative paths; a spine needs both `skel` and `atlas`),
and the engine does not understand "a skin": only the shape is judged here. Which set is in force is behaviour, and it
lives in a registered appearance provider (`client.panels[].appearance`). A process has at most one appearance
provider, and the player can switch 工坊外观 off in the settings — with it off the resolution chain is byte for byte
what it is without the pack.

### 37.20 `/healthz` and `onBoot`: what the host reports

`/healthz` answers `ok: true` and HTTP 200 unconditionally: "503 when not ok" cannot be honoured by this host (a pack
module that fails does not take the process down), so the field says what it can actually promise. The `onBoot`
readings follow the same rule — a pack's boot hook is reported, never allowed to decide the process's health.

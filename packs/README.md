# packs/ — content packs

Put a content pack here as its own folder: `packs/<id>/pack.json` (the manifest) next to the files it names. The
server lists every pack it finds at `/packs/index.json` and picks up a new or changed pack on the next page load — no
restart, no build step. `node tools/packs.mjs list` shows what was found, what was skipped and why.

In this version one type loads: **`lang`**, a language for the interface (and, optionally, the game texts):

```json
{
  "id": "ja",
  "type": "lang",
  "lang": "ja",
  "name": "日本語",
  "englishName": "Japanese",
  "version": "1.0.0",
  "app": ">=0.2.0",
  "authors": ["your name"],
  "fallback": ["en"],
  "files": { "ui": "ui.json", "data": "data.json" }
}
```

A language can also be one file, `public/i18n/<code>.json`, with the same fields in its `_meta` block — that is how
English ships. Types `assets` (art, audio, fonts) and `data` (data patches) are planned; this version lists such a pack
as not supported and does not load it.

The format, the rules and how later types plug in: [docs/PACKS.md](../docs/PACKS.md). Translating: [docs/I18N.md](../docs/I18N.md).

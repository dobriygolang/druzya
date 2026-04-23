# kz/ — Kazakh locale (STRATEGIC SCAFFOLD)

Phase 1 scaffold for `docs/strategic/i18n.md`.

Every JSON in this directory is currently a byte-identical copy of the
corresponding `ru/` namespace. **No content translation has been done.**
This is deliberate: scaffolding is engineering work; translation is content
team work and is explicitly out of scope.

## Fallback chain

`kz` → `ru` → `en`. Untranslated keys resolve via i18next's fallback so
the UI is always rendered without missing-key markers.

## When the content team picks this up

1. Translate one namespace at a time (start with `common`, `errors`).
2. Keep keys identical to ru/ — never add or rename.
3. Do NOT translate brand terms (`druz9`, `Sanctum`, `Atlas`, `kata`,
   `ELO`, `LP`).
4. PR per namespace; CI will diff key-sets to flag drift.

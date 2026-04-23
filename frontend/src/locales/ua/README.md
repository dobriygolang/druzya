# ua/ — Ukrainian locale (STRATEGIC SCAFFOLD)

Phase 1 scaffold for `docs/strategic/i18n.md`.

Every JSON in this directory is currently a byte-identical copy of the
corresponding `ru/` namespace. **No content translation has been done.**
Translation is content team work, out of scope for the scaffold sprint.

## Fallback chain

`ua` → `ru` → `en`. Documented in i18n.md §11 — once UA strings start
shipping the fallback path stays viable for partial translations.

## Sensitivity note

Per i18n.md §11 risk row: never auto-publish LLM-translated UA strings.
A native UA reviewer is required.

## When the content team picks this up

1. Translate one namespace at a time (start with `common`, `errors`).
2. Keep keys identical to ru/.
3. Do NOT translate brand terms.

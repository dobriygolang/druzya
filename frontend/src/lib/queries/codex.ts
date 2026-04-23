// queries/codex.ts — intentionally empty.
//
// /codex moved to static content (см. src/content/codex.ts). The previous
// `usePodcastCatalogQuery` hook lived here as an `enabled: false` shim for
// backward-compat with MSW handlers. Anti-fallback policy: a hook that
// never fires is dead code that confuses readers and obscures intent.
//
// Real podcast queries now live in src/lib/queries/podcasts.ts (consumed
// by /podcasts page). The MSW handler at src/mocks/handlers/podcast.ts is
// driven by that file, not this one.
export {}

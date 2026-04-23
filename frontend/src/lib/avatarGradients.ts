// Canonical avatar gradients — single source of truth for user-avatar
// fills across the product. Replaces ad-hoc `style="background: linear-
// gradient(...)"` strings sprinkled in pages, which was a Wave-9 design-
// review finding (cohorts.html had 4 different stacks all tilting toward
// pink+accent and losing per-user readability).
//
// Pick is deterministic: hash(username) % 5. The same @username always
// renders with the same gradient across the app — meaningful continuity
// for leaderboards, friend lists, chat, etc.
//
// Order matches design-snapshots/_rules.md cheat-sheet (idx 0..4) so the
// numbering in design discussions stays stable.

export const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #F472B6 0%, #582CFF 100%)', // 0 pink → accent
  'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)', // 1 cyan → accent
  'linear-gradient(135deg, #FBBF24 0%, #EF4444 100%)', // 2 warn → danger
  'linear-gradient(135deg, #10B981 0%, #22D3EE 100%)', // 3 success → cyan
  'linear-gradient(135deg, #FBBF24 0%, #F472B6 100%)', // 4 warn → pink
] as const

/**
 * gradientForUser — deterministic gradient pick by username hash.
 *
 * Hashing is intentionally trivial (sum of char codes) — collisions are
 * fine because we only need *visual variety*, not cryptographic
 * uniqueness. A small change in username flips the bucket, which is
 * exactly what we want for "@anna" vs "@anna2".
 *
 * Empty / missing username falls into bucket 0 deterministically rather
 * than throwing, because avatar code paths often deal with skeleton
 * states where the username hasn't loaded yet.
 */
export function gradientForUser(username: string | null | undefined): string {
  if (!username) {
    return AVATAR_GRADIENTS[0]
  }
  let sum = 0
  for (let i = 0; i < username.length; i++) {
    sum += username.charCodeAt(i)
  }
  return AVATAR_GRADIENTS[sum % AVATAR_GRADIENTS.length]
}

/**
 * gradientStyleForUser — convenience wrapper that returns a React style
 * object. Exists so callers don't have to repeat `{ background: … }` at
 * every site.
 */
export function gradientStyleForUser(username: string | null | undefined): { background: string } {
  return { background: gradientForUser(username) }
}

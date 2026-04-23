// Юнит-тесты на чистые selector'ы из queries/achievements (используются
// AchievementsPage). React-тесты heavy — не оправдывают нагрузки в этом
// PR (см. testing-strategy в bible).
import { describe, expect, it } from 'vitest';
import { isUnlocked, progressLabel, summarise } from '../lib/queries/achievements';
const mk = (over = {}) => ({
    code: 'x', title: 't', description: '', category: 'combat', tier: 'common',
    icon_url: '', requirements: '', reward: '', hidden: false,
    unlocked_at: null, progress: 0, target: 1, ...over,
});
describe('isUnlocked', () => {
    it('true when unlocked_at present', () => {
        expect(isUnlocked(mk({ unlocked_at: '2026-01-01T00:00:00Z' }))).toBe(true);
    });
    it('false when null', () => {
        expect(isUnlocked(mk())).toBe(false);
    });
});
describe('progressLabel', () => {
    it('binary unlocked', () => {
        expect(progressLabel(mk({ unlocked_at: '2026-01-01T00:00:00Z', target: 1 }))).toBe('1 / 1');
    });
    it('binary locked', () => {
        expect(progressLabel(mk({ target: 1 }))).toBe('0 / 1');
    });
    it('multi-step', () => {
        expect(progressLabel(mk({ progress: 3, target: 10 }))).toBe('3 / 10');
    });
});
describe('summarise', () => {
    it('counts unlocked, rare and tiers', () => {
        const items = [
            mk({ tier: 'common' }),
            mk({ tier: 'rare', unlocked_at: '2026-01-01T00:00:00Z' }),
            mk({ tier: 'legendary', unlocked_at: '2026-01-01T00:00:00Z' }),
            mk({ tier: 'rare', hidden: true }),
        ];
        const s = summarise(items);
        expect(s.total).toBe(4);
        expect(s.unlocked).toBe(2);
        expect(s.rareUnlocked).toBe(2); // rare unlocked + legendary unlocked
        expect(s.byTier.common).toBe(1);
        expect(s.byTier.rare).toBe(2);
        expect(s.byTier.legendary).toBe(1);
        expect(s.hiddenLocked).toBe(1);
    });
});

import { useReducedMotion } from 'framer-motion';
/**
 * Возвращает motion-пропсы, уважающие предпочтение пользователя reduced-motion.
 * Когда пользователь выбрал reduced motion, анимации отключаются (no-op).
 */
export function useMotionSafe(props) {
    const reduced = useReducedMotion();
    if (!reduced)
        return props;
    // Срезаем анимационные пропсы, когда включён reduced motion.
    const safe = { ...props };
    safe.initial = false;
    safe.animate = undefined;
    safe.exit = undefined;
    safe.whileHover = undefined;
    safe.whileTap = undefined;
    safe.transition = { duration: 0 };
    return safe;
}
/** Варианты stagger-контейнера для списков, где каждый ребёнок появляется с fade + slide-up. */
export const staggerContainer = {
    hidden: { opacity: 1 },
    show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
export const staggerItem = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};
export const pageTransition = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -12 },
    transition: { duration: 0.25, ease: 'easeOut' },
};
export const interactiveHover = {
    whileHover: { scale: 1.02 },
    whileTap: { scale: 0.98 },
};
export const pulseAnim = {
    animate: { opacity: [1, 0.3, 1] },
    transition: { duration: 1.5, repeat: Infinity },
};

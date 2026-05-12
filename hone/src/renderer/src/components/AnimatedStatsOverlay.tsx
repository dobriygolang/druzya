// AnimatedStatsOverlay — обёртка вокруг <StatsOverlay/>, которая откладывает
// unmount на длительность slide-to-right анимации, чтобы юзер видел плавный
// уход карточек вправо вместо мгновенного снятия.
import { Suspense, lazy, useEffect, useState } from 'react';

const StatsOverlay = lazy(() =>
  import('./StatsOverlay').then((m) => ({ default: m.StatsOverlay })),
);

export function AnimatedStatsOverlay({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 360); // slide-to-right (220ms) + max delay (120ms) + buffer
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <StatsOverlay onClose={onClose} closing={closing} />
    </Suspense>
  );
}

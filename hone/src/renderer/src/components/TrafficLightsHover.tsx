// TrafficLightsHover — невидимая горячая зона в левом верхнем углу.
// Mouseenter показывает macOS traffic-light кнопки (close / minimise / zoom),
// mouseleave прячет. Главное окно стартует с setWindowButtonVisibility(false).
//
// Зона должна перекрывать весь блок Wordmark + traffic-light позицию
// (≈ 96×40 px), чтобы при движении мышью к Wordmark кнопки тоже всплывали
// и не мешали кликнуть. Не перехватывает клики (pointerEvents = 'auto'
// нужно только для onMouseEnter/Leave — но события в детях работают
// потому что zIndex у Wordmark выше).
import { useEffect } from 'react';

const HIDE_DELAY_MS = 250;

export function TrafficLightsHover() {
  useEffect(() => {
    // На non-macOS IPC всё равно no-op в main, но мы экономим IPC вызов.
    return () => {
      void window.hone?.window.setTrafficLights(false);
    };
  }, []);

  let hideTimer: number | null = null;

  return (
    <div
      onMouseEnter={() => {
        if (hideTimer !== null) {
          window.clearTimeout(hideTimer);
          hideTimer = null;
        }
        void window.hone?.window.setTrafficLights(true);
      }}
      onMouseLeave={() => {
        // Маленькая задержка перед сокрытием — не дёргаемся когда мышь
        // прошла транзитом через зону, и даём время кликнуть на саму
        // кнопку (она физически ниже на ~10px).
        hideTimer = window.setTimeout(() => {
          void window.hone?.window.setTrafficLights(false);
        }, HIDE_DELAY_MS);
      }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 140,
        height: 56,
        zIndex: 5,
      }}
    />
  );
}

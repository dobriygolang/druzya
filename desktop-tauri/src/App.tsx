// Tauri 2.0 POC — minimal one-window app that proves macOS vibrancy
// works on the host's macOS version. The answer settles the Electron
// → Tauri migration decision: if blur shows here, it's purely an
// Electron/Chromium regression on Tahoe and Tauri gets us the feature
// back. If it doesn't show, the problem is deeper (OS/driver) and
// migrating won't help.

import { useEffect, useState } from 'react';

export function App() {
  // Slider drives the alpha of a translucent card overlaid on the
  // vibrancy layer — lets the tester see "plain color + blur" at low
  // values and "solid card + no visible blur" at high values in one
  // window, without rebuilding. Same pattern we used in the Electron
  // version.
  // Default opacity tuned to match reference products (Cluely et al):
  // ~50% alpha over HudWindow vibrancy is where the "frosted glass"
  // look hits — video / bright content behind shows softly blurred,
  // card text stays readable. Below 30% the alpha dominates over the
  // blur and it looks like a plain darkened window. Above 70% the
  // vibrancy is barely visible. 50% is the sweet spot.
  const [opacity, setOpacity] = useState(35);
  const alpha = 0.1 + (opacity / 100) * 0.9;

  useEffect(() => {
    document.title = `Druz9 Tauri POC · opacity ${opacity}%`;
  }, [opacity]);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 20,
        padding: 40,
      }}
    >
      <div
        style={{
          maxWidth: 520,
          padding: '32px 36px',
          borderRadius: 18,
          // Plain tinted-glass look: just RGBA over the transparent
          // window. No vibrancy, no backdrop-filter. Desktop content
          // behind shows crisply through the card — you can see
          // icons / text as-is, just dimmed by the dark tint. Card
          // alpha slider controls how visible the back content is.
          background: `rgba(20, 20, 28, ${alpha})`,
          border: '1px solid rgba(255, 255, 255, 0.14)',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.35)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
          Druz9 Copilot · Tauri POC
        </h1>
        <p style={{ marginTop: 10, fontSize: 13, color: '#bbb', lineHeight: 1.5 }}>
          Проверяем что macOS vibrancy (HUDWindow material) работает на
          твоей Tahoe 26.4 под Tauri 2.0. Двигай слайдер — ниже = больше
          прозрачности; если за окном видно размытый рабочий стол → blur
          работает, миграция имеет смысл. Если только alpha-затемнение
          без блюра → проблема глубже Electron'a, миграция не поможет.
        </p>

        <div
          style={{
            marginTop: 24,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <label style={{ fontSize: 13 }}>Прозрачность фона карточки</label>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#888' }}>
            {opacity}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          style={{ width: '100%', marginTop: 8 }}
        />

        <div
          style={{
            marginTop: 16,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.04)',
            fontSize: 11.5,
            color: '#aaa',
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: '#eee' }}>Что искать:</strong> помести
          под окном что-то контрастное — например, веб-страницу или
          Finder с файлами. На 0–20% слайдера сквозь карточку должен
          быть виден их <em>размытый</em> силуэт (не резкая картинка и
          не просто светло-серый фон). Если виден чёткий размытый контур —
          vibrancy работает.
        </div>
      </div>
    </div>
  );
}

// QuotaMeterMini — 44px bar + tabular-numerics "used/cap". Sits in
// compact + expanded input footers. Hidden via Settings → Appearance.
//
// Pre-emptive warning: при ≥80% использовании цвет → amber, при ≥95% →
// red-pulsing + tooltip предупреждает что лимит close. Раньше юзер
// узнавал об лимите только когда он реально вылетел (paywall pop). Теперь
// видит в footer'е amber-цвет за 5+ запросов до cap'а — успеет планомерно
// апгрейднуться или подождать reset'а.

import { usePaywallStore } from '../../stores/paywall';

interface Props {
  used: number;
  cap: number;
  width?: number;
}

export function QuotaMeterMini({ used, cap, width = 44 }: Props) {
  const showPaywall = usePaywallStore((s) => s.show);
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const remaining = Math.max(0, cap - used);

  // Threshold-based color escalation. Amber/red — universal "осторожно/
  // критично" semantic. На макс — interactive (открывает paywall hint).
  const danger = pct >= 95;
  const warn = pct >= 80;
  const fillColor = danger
    ? 'oklch(0.65 0.22 25)' // red
    : warn
      ? 'oklch(0.7 0.18 65)' // amber
      : undefined; // default gradient
  const textColor = danger
    ? 'oklch(0.75 0.18 25)'
    : warn
      ? 'oklch(0.78 0.16 65)'
      : 'var(--d9-ink-mute)';

  const tooltip = danger
    ? `Осталось ${remaining} запросов из ${cap}. Кликни чтобы посмотреть upgrade-план.`
    : warn
      ? `Осталось ${remaining} запросов из ${cap}. Скоро лимит — рекомендуем upgrade.`
      : `Использовано ${used} из ${cap} запросов в день.`;

  const onClick = warn || danger ? () => showPaywall({ reason: tooltip }) : undefined;

  return (
    <span
      title={tooltip}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          width,
          height: 3,
          borderRadius: 2,
          background: 'oklch(1 0 0 / 0.08)',
          overflow: 'hidden',
          display: 'inline-block',
        }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${pct}%`,
            background: fillColor ?? 'linear-gradient(90deg, var(--d9-accent-lo), var(--d9-accent-hi))',
            transition: 'width 240ms var(--d9-ease), background 240ms',
            animation: danger ? 'd9-pulse 1.4s ease-in-out infinite' : undefined,
          }}
        />
      </span>
      <span
        style={{
          fontFamily: 'var(--d9-font-mono)',
          fontSize: 10,
          color: textColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {used}
        <span style={{ color: 'var(--d9-ink-ghost)' }}>/{cap}</span>
      </span>
    </span>
  );
}

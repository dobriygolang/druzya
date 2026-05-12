// QuotaMeterMini — 44px bar + tabular-numerics "used/cap". Sits in
// compact + expanded input footers. Hidden via Settings → Appearance.
//
// Pre-emptive warning: при ≥80% использовании цвет → amber, при ≥95% →
// red-pulsing + tooltip предупреждает что лимит close. Раньше юзер
// узнавал об лимите только когда он реально вылетел (paywall pop). Теперь
// видит в footer'е amber-цвет за 5+ запросов до cap'а — успеет планомерно
// апгрейднуться или подождать reset'а.

import { requestUpgrade } from '../UpgradeModal';

interface Props {
  used: number;
  cap: number;
  width?: number;
}

export function QuotaMeterMini({ used, cap, width = 44 }: Props) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const ratio = cap > 0 ? used / cap : 0;
  const remaining = Math.max(0, cap - used);

  // B/W rule: danger → #FF3B30 (signal accent), warn → bright white-alpha.
  // Severity escalation через ink-ramp + pulse-animation, не hue.
  const danger = pct >= 95;
  const warn = pct >= 80;
  // Polish — 1.5px red stripe at leading edge when ratio ≥ 0.85 (between
  // warn and danger thresholds, гарантированно покрывает оба).
  const showNearLimitStripe = ratio >= 0.85;
  const fillColor = danger
    ? 'var(--d9-accent)'
    : warn
      ? 'rgba(255,255,255,0.55)'
      : undefined;
  const textColor = danger
    ? 'var(--d9-accent)'
    : warn
      ? 'rgba(255,255,255,0.85)'
      : 'var(--d9-ink-mute)';

  const tooltip = danger
    ? `Осталось ${remaining} запросов из ${cap}. Кликни чтобы посмотреть Pro.`
    : warn
      ? `Осталось ${remaining} запросов из ${cap}. Скоро лимит — рекомендуем Pro.`
      : `Использовано ${used} из ${cap} запросов в день.`;

  // X2 (P0) — переключили с server-driven PaywallModal на context-aware
  // UpgradeModal. PaywallModal остаётся для stream rate_limited auto-pop
  // (см. conversation.ts), а тут click на meter — explicit user intent,
  // даём structured pre-filled context «вы near LLM cap, Pro removes cap».
  const onClick =
    warn || danger
      ? () => {
          requestUpgrade({
            feature: 'llm_unlimited',
            label: 'your daily LLM cap',
            benefit:
              'Pro removes the 20-call daily cap and prioritises you on Cerebras/Groq for sharper, faster responses.',
          });
        }
      : undefined;

  return (
    <span
      title={tooltip}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: onClick ? 'pointer' : 'default',
        // Polish — 1.5px red leading stripe surfaces "near-limit" даже когда
        // юзер не видит мелкую bar/число. Conforms feedback_color_rule.md:
        // #FF3B30 как stripe, не fill.
        borderLeft: showNearLimitStripe ? '1.5px solid #FF3B30' : '1.5px solid transparent',
        paddingLeft: 5,
      }}
    >
      <span
        style={{
          width,
          height: 3,
          borderRadius: 2,
          background: 'var(--d9-hairline)',
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
            transition:
              'width var(--motion-dur-medium) var(--motion-ease-standard), background var(--motion-dur-medium) var(--motion-ease-standard)',
            animation: danger ? 'd9-pulse 1.4s ease-in-out infinite' : undefined,
          }}
        />
      </span>
      <span
        style={{
          fontFamily: 'var(--d9-font-mono)',
          fontSize: 11,
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

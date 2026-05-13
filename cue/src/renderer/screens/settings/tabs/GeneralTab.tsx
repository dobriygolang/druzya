// General tab — account, subscription, prep, stealth, analytics consent,
// history retention, locale, transcription language, masquerade.

import { useEffect, useState } from 'react';

import { Button } from '../../../components/primitives';
import { Seg } from '../../../components/d9';
import { useLocaleStore, useT } from '@d9-i18n';
import { useConfig } from '../../../hooks/use-config';
import {
  getHistoryRetentionDays,
  setHistoryRetentionDays,
} from '../../../lib/local-history';
import { useAuthStore } from '../../../stores/auth';
import { useInterviewPrepStore } from '../../../stores/interview-prep';
import { useQuotaStore } from '../../../stores/quota';
import {
  useTranscriptionLangStore,
  TRANSCRIPTION_LANG_LABELS,
  type TranscriptionLang,
} from '../../../stores/transcription-lang';
import type {
  MasqueradePreset,
  MasqueradePresetInfo,
} from '@shared/ipc';
import { Row, SectionTitle, Toggle, selectStyle } from '../lib/shared';

export function GeneralTab({
  session,
  quota,
}: {
  session: ReturnType<typeof useAuthStore.getState>['session'];
  quota: ReturnType<typeof useQuotaStore.getState>['quota'];
}) {
  const t = useT();
  const logout = useAuthStore((s) => s.logout);
  return (
    <>
      <SectionTitle
        title={t('cue.settings.general.section.title')}
        subtitle={t('cue.settings.general.section.subtitle')}
      />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Row
          title={
            session
              ? t('cue.settings.general.account.title')
              : t('cue.settings.general.account.signed_out_title')
          }
          hint={
            session ? session.userId : t('cue.settings.general.account.signed_out_hint')
          }
          control={
            session ? (
              <Button variant="secondary" size="sm" onClick={() => void logout()}>
                {t('cue.settings.general.account.cta.sign_out')}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void window.druz9.windows.show('onboarding')}
              >
                {t('cue.settings.general.account.cta.sign_in')}
              </Button>
            )
          }
        />
        <SubscriptionCard quota={quota} />
        <InterviewPrepRow />
        <StealthRow />
        <AnalyticsConsentRow />
        <HistoryRetentionRow />

        <LocaleRow />
        <TranscriptionLangRow />
        <MasqueradeRow />
      </div>
    </>
  );
}

// InterviewPrepRow — Phase J / C6 settings entry point. Shows the
// current active prep status (company · role · since-when) and exposes
// "Открыть мастер" / "Завершить" actions. Polls active state on mount
// so the panel reflects truth when the wizard runs in another window.
function InterviewPrepRow() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const active = useInterviewPrepStore((s) => s.active);
  const bootstrap = useInterviewPrepStore((s) => s.bootstrap);
  const endPrep = useInterviewPrepStore((s) => s.end);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const sinceLabel = active.active && active.startedAt
    ? new Date(active.startedAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  const hint = active.active
    ? `${t('cue.settings.general.prep.hint_active_prefix')}${
        sinceLabel ? ` · ${t('cue.settings.general.prep.hint_active_since', { since: sinceLabel })}` : ''
      }${
        active.company ? ` · ${active.company}` : ''
      }${active.role ? ` · ${active.role}` : ''}`
    : t('cue.settings.general.prep.hint_default');

  return (
    <Row
      title={t('cue.settings.general.prep.title')}
      hint={hint}
      control={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void window.druz9.interviewPrep.open()}
          >
            {active.active
              ? t('cue.settings.general.prep.cta.open')
              : t('cue.settings.general.prep.cta.start')}
          </Button>
          {active.active && (
            <Button variant="ghost" size="sm" onClick={() => void endPrep()}>
              {t('cue.settings.general.prep.cta.end')}
            </Button>
          )}
        </div>
      }
    />
  );
}
// VoiceSourceRow удалён — теперь два источника (системный звук и
// микрофон) доступны параллельно через две независимые кнопки в
// header'е expanded-окна. Глобального preference больше нет.

// TranscriptionLangRow (2026-05-12 polish) — preferred language для
// нативного audio-capture binary. Применяется при следующем старте
// сессии (binary читает preference через IPC payload в audio-capture:start).
// 'auto' — binary сам детектит по первой фразе.
function TranscriptionLangRow() {
  const t = useT();
  const lang = useTranscriptionLangStore((s) => s.lang);
  const setLang = useTranscriptionLangStore((s) => s.setLang);
  const OPTIONS: TranscriptionLang[] = ['auto', 'ru-RU', 'en-US', 'en-GB'];
  const labelForOption = (opt: TranscriptionLang): string => {
    switch (opt) {
      case 'ru-RU':
        return t('cue.settings.general.transcription.label.ru');
      case 'en-US':
        return t('cue.settings.general.transcription.label.en_us');
      case 'en-GB':
        return t('cue.settings.general.transcription.label.en_gb');
      case 'auto':
        return t('cue.settings.general.transcription.label.auto');
      default:
        return TRANSCRIPTION_LANG_LABELS[opt];
    }
  };
  return (
    <Row
      title={t('cue.settings.general.transcription.title')}
      hint={t('cue.settings.general.transcription.hint')}
      control={
        <select
          value={lang}
          onChange={(e) => setLang(e.currentTarget.value as TranscriptionLang)}
          style={selectStyle}
        >
          {OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {labelForOption(opt)}
            </option>
          ))}
        </select>
      }
    />
  );
}

/**
 * SubscriptionCard — visual plan overview in the General tab.
 *
 * Shows:
 *   • plan badge (free / pro / max)
 *   • progress bar for quota (hidden when unlimited)
 *   • reset date + "Я уже оплатил" inline refresh
 *   • CTA: "Обновить план" (free) or "Boosty →" (paid)
 */
function SubscriptionCard({
  quota,
}: {
  quota: ReturnType<typeof useQuotaStore.getState>['quota'];
}) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const { config } = useConfig();
  // X2 (P0) — старый showPaywall (Boosty server-driven copy) больше не
  // wire'аем в Settings → Subscription CTA. CTA теперь ведёт в context-aware
  // UpgradeModal (общий с palette / quota-meter triggers). PaywallStore
  // остаётся для conversation.ts rate_limited auto-pop'а.
  const refreshQuota = useQuotaStore((s) => s.refresh);
  const [refreshing, setRefreshing] = useState(false);

  const plan = quota?.plan ?? '';
  const isPaid = plan !== 'free' && plan !== '';

  // Resolve display name and manage-URL from server paywall copy.
  const planCopy = config?.paywall.find((p) => p.planId === plan);
  const upgradeCopy = config?.paywall.find((p) => p.planId !== 'free' && p.subscribeUrl);
  const manageUrl =
    planCopy?.subscribeUrl || upgradeCopy?.subscribeUrl || 'https://boosty.to/druz9';

  const used = quota?.requestsUsed ?? 0;
  const cap = quota?.requestsCap ?? 0;
  const unlimited = cap < 0;
  const pct = unlimited || cap === 0 ? 0 : Math.min(100, (used / cap) * 100);
  const nearLimit = pct >= 85;

  const resetDate = quota?.resetsAt
    ? new Date(quota.resetsAt).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' })
    : null;

  const planLabel = planCopy?.displayName ?? (plan ? plan : 'Free');

  return (
    <div
      style={{
        padding: 'var(--pad-container) 18px',
        borderRadius: 12,
        background: 'rgba(255, 255, 255, 0.03)',
        border: '0.5px solid var(--d9-hairline)',
        margin: '4px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* ── Header: plan badge + CTA ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pad-inline)' }}>
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--d9-font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 999,
              background: isPaid ? 'var(--d9-accent-glow)' : 'rgba(255,255,255,0.06)',
              color: isPaid ? 'var(--d9-accent-hi)' : 'var(--d9-ink-mute)',
              border: `0.5px solid ${isPaid ? 'rgba(255,59,48,0.35)' : 'var(--d9-hairline)'}`,
            }}
          >
            {planLabel}
          </span>
          {isPaid && (
            <span
              style={{ fontSize: 12, color: 'var(--d9-accent)', lineHeight: 1 }}
              title={t('cue.settings.general.subscription.plan_active_title')}
            >
              ✦
            </span>
          )}
        </div>
        {isPaid ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void window.druz9.shell.openExternal(manageUrl)}
          >
            {t('cue.settings.general.subscription.manage_boosty')}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              // X2 (P0) — explicit user intent (clicked Pro в Settings) →
              // unified UpgradeModal с general context. Boosty PaywallModal
              // оставлен для rate_limited auto-pop'а и для тех кому нужен
              // server-driven copy.
              void import('../../../components/UpgradeModal').then(({ requestUpgrade }) => {
                requestUpgrade({
                  feature: 'general',
                  label: 'an overview of Pro',
                  benefit:
                    'Pro unlocks unlimited LLM calls, 8h sessions, premium personas, Cerebras/Groq priority cascade and deep readiness analytics.',
                });
              });
            }}
          >
            {t('cue.settings.general.subscription.upgrade')}
          </Button>
        )}
      </div>

      {/* ── Usage bar + meta ── */}
      {quota ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {!unlimited && (
            <div
              style={{
                height: 3,
                borderRadius: 2,
                background: 'rgba(255, 255, 255, 0.08)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  borderRadius: 2,
                  background: nearLimit
                    ? 'var(--d9-accent)'
                    : isPaid
                      ? 'var(--d9-accent)'
                      : 'var(--d9-ink-dim)',
                  transition: 'width var(--motion-dur-xlarge) var(--motion-ease-standard)',
                }}
              />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{ fontSize: 11.5, color: 'var(--d9-ink-mute)', letterSpacing: '-0.005em' }}
            >
              {unlimited
                ? t('cue.settings.general.subscription.requests_unlimited')
                : t('cue.settings.general.subscription.requests_used', { used, cap })}
              {resetDate && (
                <span style={{ color: 'var(--d9-ink-ghost)', marginLeft: 8 }}>
                  {t('cue.settings.general.subscription.reset_prefix', { date: resetDate })}
                </span>
              )}
            </span>
            <button
              type="button"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await refreshQuota();
                setRefreshing(false);
              }}
              style={{
                background: 'transparent',
                border: 0,
                padding: '2px 6px',
                cursor: refreshing ? 'wait' : 'pointer',
                fontSize: 11,
                color: 'var(--d9-ink-ghost)',
                fontFamily: 'inherit',
                letterSpacing: '-0.005em',
                borderRadius: 'var(--radius-inner)',
                opacity: refreshing ? 0.45 : 1,
                transition:
                  'color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard)',
              }}
              title={t('cue.settings.general.subscription.refresh_title')}
            >
              {refreshing ? '…' : t('cue.settings.general.subscription.paid_already')}
            </button>
          </div>
        </div>
      ) : (
        <span style={{ fontSize: 11.5, color: 'var(--d9-ink-ghost)' }}>
          {t('cue.settings.general.subscription.loading')}
        </span>
      )}
    </div>
  );
}

function HistoryRetentionRow() {
  const t = useT();
  const [days, setDays] = useState(() => getHistoryRetentionDays());
  return (
    <Row
      title={t('cue.settings.general.history.title')}
      hint={t('cue.settings.general.history.hint')}
      control={
        <select
          value={days}
          onChange={(e) => {
            const next = Number(e.target.value);
            setDays(next);
            setHistoryRetentionDays(next);
          }}
          style={selectStyle}
        >
          <option value={1}>{t('cue.settings.general.history.option_day_one')}</option>
          <option value={7}>{t('cue.settings.general.history.option_day_seven')}</option>
          <option value={30}>{t('cue.settings.general.history.option_day_thirty')}</option>
          <option value={90}>{t('cue.settings.general.history.option_day_ninety')}</option>
          <option value={365}>{t('cue.settings.general.history.option_year_one')}</option>
        </select>
      }
    />
  );
}

/**
 * StealthRow — toggles setContentProtection on compact + expanded windows.
 * Stealth on (default): окна невидимы в Zoom/Meet/screenshot.
 * Stealth off: можно заскринить для отладки / чтобы прислать разработчику.
 */
function StealthRow() {
  const t = useT();
  // Прежде useState(true) показывал «ON» при каждом открытии Settings,
  // даже если юзер до этого выключил stealth. После toggle OFF + reopen
  // settings UI снова рисовал ON, и юзер видел рассинхрон. Тянем
  // персистентное значение из main process на mount.
  const [on, setOn] = useState(true);
  useEffect(() => {
    void window.druz9.windows.getStealth().then(setOn).catch(() => {
      /* leave default true if IPC fails */
    });
  }, []);
  return (
    <Row
      title={t('cue.settings.general.stealth.title')}
      hint={
        on
          ? t('cue.settings.general.stealth.hint_on')
          : t('cue.settings.general.stealth.hint_off')
      }
      control={
        <Toggle
          on={on}
          onChange={async (next) => {
            setOn(next);
            try {
              await window.druz9.windows.toggleStealth(next);
            } catch {
              // Revert UI if IPC fails.
              setOn(!next);
            }
          }}
        />
      }
    />
  );
}

// AnalyticsConsentRow — Phase J / X3 (P1).
// Stealth-first default: opted-OUT. Toggle persists through analytics
// SDK (localStorage + best-effort backend SetConsent). Hint copy makes
// the trust-on-user posture explicit — Cue keeps quiet by default.
function AnalyticsConsentRow() {
  const t = useT();
  const [on, setOn] = useState(false);
  // Lazy-load the SDK to keep this row a pure presentational helper —
  // and avoid forcing the analytics module into the settings bundle
  // before the user even opens Settings.
  useEffect(() => {
    let cancelled = false;
    void import('../../../lib/analytics').then(({ analytics }) => {
      if (!cancelled) setOn(analytics.isOptedIn());
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Row
      title={t('cue.settings.general.analytics.title')}
      hint={t('cue.settings.general.analytics.hint')}
      control={
        <Toggle
          on={on}
          onChange={(next) => {
            setOn(next);
            void import('../../../lib/analytics').then(({ analytics }) => {
              analytics.setOptedIn(next);
            });
          }}
        />
      }
    />
  );
}

function LocaleRow() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const labelRu = t('cue.settings.general.locale.ru');
  const labelEn = t('cue.settings.general.locale.en');
  return (
    <Row
      title={t('cue.settings.general.locale.title')}
      hint={t('cue.settings.general.locale.hint')}
      control={
        <Seg
          options={[labelRu, labelEn] as const}
          value={locale === 'ru' ? labelRu : labelEn}
          onChange={(v) => setLocale(v === labelRu ? 'ru' : 'en')}
        />
      }
    />
  );
}

/**
 * MasqueradeRow — lets the user swap the Dock icon and window titles.
 * The process name in Activity Monitor is pinned by the bundle; we
 * surface that caveat inline so users aren't surprised.
 */
function MasqueradeRow() {
  const t = useT();
  const [presets, setPresets] = useState<MasqueradePresetInfo[]>([]);
  const [current, setCurrent] = useState<MasqueradePreset>('druz9');

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [list, got] = await Promise.all([
          window.druz9.masquerade.list(),
          window.druz9.masquerade.get(),
        ]);
        if (disposed) return;
        setPresets(list);
        setCurrent(got);
      } catch {
        /* feature flag may be off; row stays hidden via presets.length === 0 */
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  if (presets.length === 0) return null;

  return (
    <Row
      title={t('cue.settings.general.masquerade.title')}
      hint={t('cue.settings.general.masquerade.hint')}
      control={
        <select
          value={current}
          onChange={async (e) => {
            const next = e.target.value as MasqueradePreset;
            setCurrent(next);
            await window.druz9.masquerade.apply(next);
          }}
          style={selectStyle}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      }
    />
  );
}

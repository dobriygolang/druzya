// Expanded chat window — streaming assistant output with markdown-ish
// rendering (code fences highlighted via flat monospace blocks + copy).
//
// Messages come from the conversation store which subscribes to IPC
// streaming events. Follow-up input calls analyze.chat with the current
// conversation id.
//
// Visual: Midnight-velvet design system. The window uses `transparent:
// true` at the OS level + an rgba scrim inside so the desktop shows
// through at whatever alpha the Appearance slider sets. No OS vibrancy
// (Tahoe 26.x regressions). The header/input use hairlines; messages
// use the MessageBubble pattern from windows.jsx.

import { useEffect, useRef, useState } from 'react';

import { eventChannels } from '@shared/ipc';
import { CommandPalette } from '../../components/CommandPalette';
import {
  CompactLogo,
  D9IconCamera,
  D9IconClose,
  D9IconSettings,
  IconButton,
  QuotaMeterMini,
  StatusDot,
  StreamingHairline,
} from '../../components/d9';
import { IconHistory, IconSend } from '../../components/icons';
import { ProviderPicker } from '../../components/ProviderPicker';
import { useConfig } from '../../hooks/use-config';
import { useHotkeyEvents } from '../../hooks/use-hotkey-events';
// Appearance slider now writes --d9-window-alpha globally via app.tsx —
// we just consume that var below, no need to hook the store here.
import { useConversationStore } from '../../stores/conversation';
import { usePersonaStore } from '../../stores/persona';
import { usePersonaHotkeys } from '../../hooks/use-persona-hotkeys';
import { useQuotaStore } from '../../stores/quota';
import { usePaywallStore } from '../../stores/paywall';
import { useSelectedModelStore } from '../../stores/selected-model';
import { useSessionStore } from '../../stores/session';
import { useAudioCaptureStore } from '../../stores/audio-capture';
import { useCoachStore } from '../../stores/coach';
import { SummaryModal } from '../summary/SummaryModal';
import { AutoSuggestPill } from './components/AutoSuggestPill';
import { EmptyState } from './components/EmptyState';
import { ChatActionsOverflow, ChatKbd, AttachedDocsBadge, InterviewPrepChip } from './components/HeaderChips';
import { LiveTranscriptStrip, SpeakerLabelsBar } from './components/LiveTranscriptStrip';
import { MessageBubble } from './components/MessageBubble';
import {
  CompactionGhostNotice,
  ContextMeter,
  SessionEndingBanner,
  ThinkingIndicator,
} from './components/StatusIndicators';
import { VoiceToggleCombined } from './components/VoiceToggleCombined';
import { captureAndSend } from './lib/captureAndSend';
import { buildPaletteActions } from './lib/paletteActions';

export function ExpandedScreen() {
  const { config } = useConfig();
  const bootstrap = useConversationStore((s) => s.bootstrap);
  const messages = useConversationStore((s) => s.messages);
  const streaming = useConversationStore((s) => s.streaming);
  const conversationId = useConversationStore((s) => s.conversationId);
  const contextWindow = useConversationStore((s) => s.contextWindow);
  const compactionNoticeAt = useConversationStore((s) => s.compactionNoticeAt);

  const selectedModel = useSelectedModelStore((s) => s.modelId);
  const modelBootstrap = useSelectedModelStore((s) => s.bootstrap);
  useEffect(() => modelBootstrap(), [modelBootstrap]);
  const sessionBootstrap = useSessionStore((s) => s.bootstrap);
  const audioCaptureBootstrap = useAudioCaptureStore((s) => s.bootstrap);
  const coachBootstrap = useCoachStore((s) => s.bootstrap);

  const activePersona = usePersonaStore((s) => s.active);
  const personaBootstrap = usePersonaStore((s) => s.bootstrap);
  useEffect(() => { void personaBootstrap(); }, [personaBootstrap]);
  // ⌥1..⌥9 quick-switch persona — hint виден в EmptyState.
  usePersonaHotkeys();

  // ⌘K opens command palette — единая точка входа для всех actions
  // (история, persona, model, экспорт, voice toggle, settings). Cluely-
  // style discoverability: юзер не должен помнить что где спрятано.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const quota = useQuotaStore((s) => s.quota);
  const refreshQuota = useQuotaStore((s) => s.refresh);
  const bootstrapQuota = useQuotaStore((s) => s.bootstrap);
  const showPaywall = usePaywallStore((s) => s.show);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    void bootstrapQuota().then((u) => { unsub = u; });
    return () => { if (unsub) unsub(); };
  }, [bootstrapQuota]);

  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // saveChatStatus — visible feedback для кнопки «Сохранить в Hone».
  // 'idle' → notebook icon, 'saving' → notebook icon (title hint),
  // 'ok' → green ✓ на 2.4s, 'err' → red ✕ на 2.4s. Auto-revert
  // в idle через setTimeout. Без этого состояния юзер кликает,
  // ничего не происходит визуально и думает что app сломан.
  const [saveChatStatus, setSaveChatStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle');
  const lastAnalysis = useSessionStore((s) => s.lastAnalysis);
  const notesFilePath = useSessionStore((s) => s.notesFilePath);
  // Auto-open the Summary modal the first time a report lands while
  // the window is visible. The user can close + re-open via the header
  // button (rendered only when lastAnalysis is non-null).
  useEffect(() => {
    if (lastAnalysis && lastAnalysis.status === 'ready') setSummaryOpen(true);
  }, [lastAnalysis]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef<HTMLInputElement>(null);

  // Pending-open handoff из HistoryScreen. История и expanded — разные
  // BrowserWindow'ы (отдельные renderer processes), zustand stores не
  // share'ятся. История кладёт в localStorage 'cue.pendingOpenConversation'
  // — мы читаем тут на mount'е, hydrate'им свой store, marker стираем.
  // Должно сработать ДО bootstrap'а / window.druz9.on subscriptions —
  // иначе race с broadcast'ами компакта.
  useEffect(() => {
    try {
      const pendingId = window.localStorage.getItem('cue.pendingOpenConversation');
      if (!pendingId) return;
      window.localStorage.removeItem('cue.pendingOpenConversation');
      void import('../../lib/local-history').then(({ getLocalConversation }) => {
        const detail = getLocalConversation(pendingId);
        if (!detail) return;
        useConversationStore
          .getState()
          .hydrate(detail.conversation.id, detail.conversation.model, detail.messages);
      });
    } catch {
      /* localStorage недоступен / corrupt — silent, store остаётся empty */
    }
  }, []);

  useEffect(() => {
    const unsubConv = bootstrap();
    const unsubSession = sessionBootstrap();
    const unsubAudio = audioCaptureBootstrap();
    const unsubCoach = coachBootstrap();
    // Compact broadcasts this when the user clicks the model label —
    // expanded is the right place for the 440×520 picker modal.
    const unsubPicker = window.druz9.on(eventChannels.openProviderPicker, () => {
      setPickerOpen(true);
    });
    // Compact and expanded live in separate renderer processes, so they
    // can't share the conversation store directly. Main broadcasts a
    // userTurnStarted event so this window can paint the optimistic
    // user bubble (with screenshot preview) the instant the turn begins.
    // LRU set с cap: предотвращает unbounded memory growth у юзера
    // который держит expanded окно открытым неделями. Раньше Set<string>
    // рос на каждый turn и никогда не GC'ился — после нескольких сотен
    // turns это десятки KB, после тысяч — MB. Cap 200 entries по сути
    // безлимитный для нормального use, но capped формально.
    const SEEN_CAP = 200;
    const seenTurns: string[] = []; // FIFO insertion order
    const seenSet = new Set<string>();
    const applyTurn = (ev: import('@shared/ipc').UserTurnStartedEvent) => {
      // Dedupe: both the live broadcast (fires before this window
      // mounted) and the getLastUserTurn replay can deliver the same
      // turn. streamId is the key.
      if (seenSet.has(ev.streamId)) return;
      seenSet.add(ev.streamId);
      seenTurns.push(ev.streamId);
      if (seenTurns.length > SEEN_CAP) {
        const evicted = seenTurns.shift();
        if (evicted) seenSet.delete(evicted);
      }
      const { getState } = useConversationStore;
      if (getState().streamId === ev.streamId) return; // local begin already ran
      getState().beginTurn({
        promptText: ev.promptText,
        hasScreenshot: ev.hasScreenshot,
        screenshotDataUrl: ev.screenshotDataUrl || undefined,
        streamId: ev.streamId,
      });
    };
    const unsubTurn = window.druz9.on<import('@shared/ipc').UserTurnStartedEvent>(
      eventChannels.userTurnStarted,
      applyTurn,
    );
    // Race fix: compact broadcasts userTurnStarted *before* this window
    // exists. Pull the cached snapshot from main so we still draw the
    // optimistic bubble on first paint.
    void window.druz9.ui.getLastUserTurn().then((ev) => {
      if (ev) applyTurn(ev);
    });
    return () => {
      unsubConv();
      unsubSession();
      unsubAudio();
      unsubCoach();
      unsubPicker();
      unsubTurn();
    };
  }, [bootstrap, sessionBootstrap, audioCaptureBootstrap, coachBootstrap]);

  useEffect(() => {
    // Pin to bottom while streaming. Manual scroll-away handling is out
    // of scope for MVP.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // Footer hints (⌘↵ SEND · ⌘⇧S SCREENSHOT) — показываем первым 5 sends,
  // потом скрываем: юзер выучил shortcut, hint становится noise. Counter
  // в localStorage чтобы persist между сессиями.
  const FOOTER_HINTS_THRESHOLD = 5;
  const [sendCount, setSendCount] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const saved = Number(window.localStorage.getItem('cue.sendCount') ?? 0);
    return Number.isFinite(saved) ? saved : 0;
  });
  const showFooterHints = sendCount < FOOTER_HINTS_THRESHOLD;
  const bumpSendCount = () => {
    setSendCount((prev) => {
      const next = prev + 1;
      try { window.localStorage.setItem('cue.sendCount', String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const send = async () => {
    // Учитываем voice-buffer (объединённый system + mic) на момент send'а:
    // если юзер жмёт Enter во время recording, отправляем распознанное +
    // любой ручной draft. fullText() merge'ит оба source хронологически
    // и добавляет «Я:»/«Они:» префиксы когда оба активны.
    const voiceText = useAudioCaptureStore.getState().fullText().trim();
    const draftText = draft.trim();
    const text = draftText && voiceText
      ? `${draftText}\n${voiceText}`
      : draftText || voiceText;
    if (!text || streaming) return;
    setDraft('');
    if (voiceText) useAudioCaptureStore.getState().clear();
    bumpSendCount();
    // First message in this window session: analyze.start creates the
    // conversation; subsequent turns use analyze.chat.
    //
    // Why no direct beginTurn here: main broadcasts `userTurnStarted`
    // inside the ipc handler BEFORE returning. applyTurn (above, with
    // seenTurns dedupe) paints the optimistic bubble on broadcast
    // arrival. A direct call here raced the broadcast and doubled the
    // message when the event handler ran first.
    const ipc = conversationId ? window.druz9.analyze.chat : window.druz9.analyze.start;
    try {
      await ipc({
        conversationId,
        promptText: text,
        model: selectedModel || config?.defaultModelId || '',
        attachments: [],
        triggerAction: voiceText ? 'voice_input' : 'quick_prompt',
        focusedAppHint: '',
        personaSystemPrompt: activePersona.system_prompt,
      });
    } catch (err) {
      // Silent fail во время real interview = trust break. Restore draft
      // (юзер видит свой текст + retry — не теряет prompt), surface
      // toast через main (приоритетней inline-banner: окно может быть
      // компактным и не видеть встраиваемое сообщение).
      setDraft(text);
      const msg = (err as Error)?.message || 'send failed';
      void window.druz9.toast.show(`AI: ${msg}`, 'error').catch(() => {});
    }
  };

  // ─── Voice → Draft realtime stream + auto-send-on-silence ───────────
  //
  // 1) Realtime live preview: пока recording идёт, partial-фразы Apple
  //    speech reactively приходят через store.partialText, плюс уже
  //    закоммиченные finals в store.chunks. Display value input'а
  //    показывает draft + voice-text.
  // 2) Auto-send: после 3s тишины (нет ни partials, ни finals) если
  //    тогл включён — отправляет полный текст в чат. По умолчанию
  //    включено, юзер может выключить чекбоксом.
  // 3) Когда recording останавливается (юзер ручками или через
  //    auto-send), скопить voice-fullText в draft чтобы юзер мог его
  //    отредактировать перед manual send.
  // Reactive subscribe на оба source: мы зависим от их chunks/partial/state
  // потому что voiceLive объединяет их и auto-send timer должен
  // перезапускаться на любой новый partial из любого source.
  const sysState = useAudioCaptureStore((s) => s.system.state);
  const sysPartial = useAudioCaptureStore((s) => s.system.partialText);
  const sysFinalSeq = useAudioCaptureStore((s) => s.system.finalSeq);
  const sysChunksLen = useAudioCaptureStore((s) => s.system.chunks.length);
  const micState = useAudioCaptureStore((s) => s.mic.state);
  const micPartial = useAudioCaptureStore((s) => s.mic.partialText);
  const micFinalSeq = useAudioCaptureStore((s) => s.mic.finalSeq);
  const micChunksLen = useAudioCaptureStore((s) => s.mic.chunks.length);
  const audioFullText = useAudioCaptureStore((s) => s.fullText);
  const audioLiveText = useAudioCaptureStore((s) => s.liveText);
  const audioClear = useAudioCaptureStore((s) => s.clear);

  // Auto-send toggle: localStorage'd. Default ON.
  const [autoSendEnabled, setAutoSendEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = window.localStorage.getItem('cue.autoSendOnSilence');
    return saved === null ? true : saved === '1';
  });
  useEffect(() => {
    window.localStorage.setItem('cue.autoSendOnSilence', autoSendEnabled ? '1' : '0');
  }, [autoSendEnabled]);

  // recording=true если ХОТЯ БЫ ОДИН source активен. Используется как
  // флаг «показывай live transcript в input» и «ставь readOnly hint».
  const recording =
    sysState === 'running' || sysState === 'starting' ||
    micState === 'running' || micState === 'starting';

  // Live voice text — объединённый system+mic с лейблами «Я:»/«Они:»
  // если оба активны. liveText() читает store актуально, реактивно
  // пересчитывается на любой sysPartial/sysChunksLen/micPartial/micChunksLen.
  const voiceLive = audioLiveText();
  const anyPartial = sysPartial || micPartial;
  const haveVoiceText = sysChunksLen > 0 || sysPartial || micChunksLen > 0 || micPartial;

  // Show voice в input ВСЕГДА когда есть buffered transcript — даже когда
  // recording уже остановлен (chunks могут прилететь чуть после stop'а из
  // SFSpeechRecognizer.endAudio() flush'а). Это убивает race «текст
  // появился только после повторного нажатия Слушать»: chunks теперь
  // видны мгновенно как только store их получает.
  const inputValue = haveVoiceText
    ? (draft.trim() ? `${draft.trim()}\n${voiceLive}` : voiceLive)
    : draft;

  // Auto-send timer.
  const autoSendTimerRef = useRef<number | null>(null);
  const SILENCE_AUTOSEND_MS = 3000;
  useEffect(() => {
    if (autoSendTimerRef.current !== null) {
      window.clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
    if (!autoSendEnabled || !recording || streaming) return;
    // Ничего ещё не распознано ни в одном source → таймер вооружать
    // нечего, ждём первого partial'а.
    const haveSomething =
      sysChunksLen > 0 || sysPartial || micChunksLen > 0 || micPartial;
    if (!haveSomething) return;

    autoSendTimerRef.current = window.setTimeout(() => {
      if (useConversationStore.getState().streaming) return;
      const voiceText = audioFullText().trim();
      if (!voiceText) return;
      const joined = draft.trim() ? `${draft.trim()}\n${voiceText}` : voiceText;
      audioClear();
      setDraft('');
      const ipc = conversationId ? window.druz9.analyze.chat : window.druz9.analyze.start;
      const personaPrompt = usePersonaStore.getState().active.system_prompt;
      void ipc({
        conversationId,
        promptText: joined,
        model: selectedModel || config?.defaultModelId || '',
        attachments: [],
        triggerAction: 'voice_input',
        focusedAppHint: '',
        personaSystemPrompt: personaPrompt,
      }).catch((err: Error) => {
        // Auto-send fail во время recording: восстанавливаем draft
        // (юзер видит «не отправилось — нажми Enter»), показываем тост
        // через main. Тихие фейлы во время real interview = trust break.
        setDraft(joined);
        const msg = err?.message || 'auto-send failed';
        void window.druz9.toast.show(`AI: ${msg}`, 'error').catch(() => {});
      });
    }, SILENCE_AUTOSEND_MS);

    return () => {
      if (autoSendTimerRef.current !== null) {
        window.clearTimeout(autoSendTimerRef.current);
        autoSendTimerRef.current = null;
      }
    };
  // depend на partial+finalSeq+chunksLen каждого source — любой из них
  // (новый partial / commit / start фразы) перезапускает 3s таймер
  // тишины.
  }, [
    sysPartial, sysFinalSeq, sysChunksLen,
    micPartial, micFinalSeq, micChunksLen,
    recording, streaming, draft, conversationId, selectedModel,
    config?.defaultModelId, autoSendEnabled, audioFullText, audioClear,
  ]);

  useHotkeyEvents((action) => {
    if (action !== 'instant_assist') return;
    if (draft.trim()) {
      void send();
    } else {
      draftInputRef.current?.focus();
    }
  });

  const activeModelId = selectedModel || config?.defaultModelId || '';
  const modelLabelText = config?.models.find((m) => m.id === activeModelId)?.displayName ?? 'AI';

  return (
    <div
      className="d9-root"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // Hone-aligned scrim + Cluely-style backdrop-filter blur. Window
        // в Electron — `transparent: true`; backdrop-filter blur'ит то
        // что под окном (desktop / IDE / Zoom). Эффект «жидкое стекло»:
        // юзер видит свою рабоtu сквозь Cue, но размыто. Раньше было
        // pure-solid scrim — выглядело как opaque overlay. Теперь
        // 0.55 alpha + blur(28px) = visible through, но contrast OK.
        // Reuse того же `--d9-glass-blur` токена что и в compact/picker —
        // визуальная consistency между всеми floating windows. На macOS
        // Tahoe (26.x) NSVisualEffectView был сломан с custom frame,
        // поэтому используем CSS backdrop-filter (рендерит Chromium):
        // тот же эффект, без OS quirks.
        background: 'rgba(10, 10, 10, calc(var(--d9-window-alpha) * 0.85))',
        backdropFilter: 'var(--d9-glass-blur)',
        WebkitBackdropFilter: 'var(--d9-glass-blur)' as unknown as string,
        border: '0.5px solid var(--d9-hairline-b)',
        borderRadius: 'var(--d9-r-xl)',
        boxShadow: 'var(--d9-shadow-win)',
        color: 'var(--d9-ink)',
        overflow: 'hidden',
        position: 'relative',
      } as React.CSSProperties}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--pad-inline)',
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          WebkitAppRegion: 'drag',
          flexShrink: 0,
        } as React.CSSProperties}
      >
        {/* Logo pill */}
        <div style={{ WebkitAppRegion: 'no-drag', flexShrink: 0 } as React.CSSProperties}>
          <CompactLogo size={28} />
        </div>

        {/* Combined Persona·Model chip. Раньше две отдельные pills
            занимали 2× места; теперь одна compact-pill «{persona} ·
            {model}» с двумя clickable зонами. Левая (persona) → native
            picker window, правая (model + chevron) → in-window
            ProviderPicker modal. Это паттерн из Linear/Notion: один
            chip несёт связанные опции, клик попадает в нужную зону. */}
        <div style={{ WebkitAppRegion: 'no-drag', display: 'inline-flex' } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => void window.druz9.windows.showPicker('persona')}
            title="Сменить persona"
            aria-haspopup="dialog"
            aria-label={`Сменить persona — текущая: ${activePersona.label}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 8px 5px 9px',
              borderRadius: '6px 0 0 6px',
              background: 'rgba(255,255,255,0.04)',
              border: 0,
              borderRight: '0.5px solid var(--d9-hairline-b)',
              fontFamily: 'var(--d9-font-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              color: 'var(--d9-ink)',
              cursor: 'pointer',
              transition: 'background var(--motion-dur-small) var(--motion-ease-standard)',
            } as React.CSSProperties}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d9-accent)', flexShrink: 0 }} />
            {activePersona.label}
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            title="Сменить модель"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            aria-label={`Сменить модель — текущая: ${modelLabelText}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 9px 5px 8px',
              borderRadius: '0 6px 6px 0',
              background: 'rgba(255,255,255,0.04)',
              border: 0,
              fontFamily: 'var(--d9-font-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              color: 'var(--d9-ink-dim)',
              cursor: 'pointer',
              transition: 'background var(--motion-dur-small) var(--motion-ease-standard)',
            } as React.CSSProperties}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          >
            {modelLabelText}
            <span style={{ fontSize: 8, color: 'var(--d9-ink-ghost)' }}>▾</span>
          </button>
        </div>

        <div style={{ flex: 1 }} />

        {/* Action buttons. Primary visible (voice + history + settings +
            close), secondary actions (Save/Export/Summary) — в overflow
            «⋯» menu чтобы header не превращался в 13-кнопочный stack. */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <VoiceToggleCombined />
          <AttachedDocsBadge />
          {/* Phase J / C6 — Interview Prep entry point. Subtle hairline
              button; the chip lights up via the active-prep store when
              the user has loaded CV+JD. */}
          <InterviewPrepChip />
          <ChatActionsOverflow
            messages={messages}
            saveChatStatus={saveChatStatus}
            setSaveChatStatus={setSaveChatStatus}
            hasSummary={Boolean(lastAnalysis && lastAnalysis.status === 'ready')}
            onOpenSummary={() => setSummaryOpen(true)}
          />
          <IconButton title="История" onClick={() => void window.druz9.windows.show('history')}>
            <IconHistory size={14} />
          </IconButton>
          <IconButton title="Настройки" onClick={() => void window.druz9.windows.show('settings')}>
            <D9IconSettings size={14} />
          </IconButton>
          <IconButton
            title="Свернуть / закрыть (⌘W)"
            onClick={() => void window.druz9.windows.hide('expanded')}
          >
            <D9IconClose size={12} />
          </IconButton>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 22px 20px',
          position: 'relative',
        }}
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} persona={activePersona.id} />
            ))}
            {streaming && <ThinkingIndicator />}
            {compactionNoticeAt && Date.now() - compactionNoticeAt < 10_000 && (
              <CompactionGhostNotice />
            )}
          </>
        )}
      </div>

      {/* Session-ending interim banner. session.end() flips `ending` to
          true; analysis event with terminal status flips it back. While
          ending=true we show a spinner + "Analyzing…" так что юзер
          понимает что backend ещё работает над transcript'ом. */}
      <SessionEndingBanner />

      {/* Live transcript ticker — visible only when macOS system-
          audio capture is running or has accumulated chunks. */}
      <LiveTranscriptStrip draft={draft} setDraft={setDraft} />

      {/* C4 speaker labels bar — visible when diarizer found 2+ distinct
          system speakers. Allows user to relabel ("Recruiter", "Engineer",
          ...) which propagates через composeMerged в LLM context. */}
      <SpeakerLabelsBar />

      {/* Auto-suggest pill — скрыт во время recording: AI-suggestion
          релевантен когда юзер слушает (после паузы), но во время
          активной записи добавляет визуальный шум поверх Live transcript
          strip'а. Юзер увидит suggestion на следующей паузе. */}
      {!recording && <AutoSuggestPill draft={draft} setDraft={setDraft} />}

      {/* Follow-up input */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--pad-inline)',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${focused ? 'rgba(255,255,255,0.4)' : 'transparent'}`,
            borderRadius: 'var(--radius-outer)',
            padding: 'var(--pad-inline) var(--pad-inline) var(--pad-inline) 14px',
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          <input
            ref={draftInputRef}
            // Input всегда показывает draft + voice live (если есть
            // chunks/partials в любом source). Это работает и во время
            // recording (live preview как Apple speech распознаёт), и
            // сразу после stop (final chunk прилетает в store асинхронно).
            // При ручном вводе voice-state снапшотится в draft и
            // audioClear() — иначе следующий partial перетёр бы набранное.
            value={inputValue}
            onChange={(e) => {
              if (haveVoiceText) {
                setDraft(e.target.value);
                audioClear();
                return;
              }
              setDraft(e.target.value);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={recording ? 'Слушаю…' : 'Продолжить диалог…'}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: recording ? 'var(--d9-ink-mute)' : 'var(--d9-ink)',
              fontStyle: recording && anyPartial ? 'italic' : 'normal',
              fontFamily: 'var(--d9-font-sans)',
              fontSize: 14,
              letterSpacing: '0.01em',
              outline: 'none',
              caretColor: 'var(--d9-accent)',
            }}
          />
          {/* Auto-send toggle. Видим только когда есть voice-pipeline
              (binary доступен и юзер хоть раз начинал запись). По
              умолчанию ON — auto-send после 3s тишины. */}
          <label
            title="Авто-отправка после 3 сек тишины"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--gap-row)',
              fontSize: 10,
              color: 'var(--d9-ink-mute)',
              cursor: 'pointer',
              userSelect: 'none',
              padding: '4px 6px',
              borderRadius: 'var(--radius-inner)',
              background: autoSendEnabled ? 'rgba(255,255,255,0.10)' : 'transparent',
              border: `1px solid ${autoSendEnabled ? 'rgba(255,255,255,0.35)' : 'var(--d9-hairline)'}`,
            }}
          >
            <input
              type="checkbox"
              checked={autoSendEnabled}
              onChange={(e) => setAutoSendEnabled(e.target.checked)}
              style={{ accentColor: 'var(--d9-accent)', margin: 0 }}
            />
            Auto-send
          </label>
          <IconButton
            title="Скриншот (⌘⇧S)"
            onClick={() => void captureAndSend(conversationId, draft, setDraft, selectedModel || config?.defaultModelId || '')}
          >
            <D9IconCamera size={14} />
          </IconButton>
          {/* Send button — red signal circle (B/W rule). */}
          <button
            type="button"
            title="Отправить (Enter)"
            aria-label="Send message"
            onClick={() => void send()}
            disabled={streaming || (!draft.trim() && !haveVoiceText)}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: 0,
              cursor: streaming || (!draft.trim() && !haveVoiceText) ? 'not-allowed' : 'pointer',
              background: streaming || (!draft.trim() && !haveVoiceText) ? 'rgba(255,255,255,0.20)' : 'var(--d9-accent)',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition:
                'transform var(--motion-dur-small) var(--motion-ease-standard), filter var(--motion-dur-small) var(--motion-ease-standard), background var(--motion-dur-small) var(--motion-ease-standard)',
              boxShadow: !streaming && (draft.trim() || haveVoiceText) ? '0 0 12px rgba(255,255,255,0.35)' : 'none',
            }}
          >
            <IconSend size={14} />
          </button>
        </div>
        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginTop: 8,
            paddingLeft: 2,
            fontFamily: 'var(--d9-font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--d9-ink-ghost)',
          }}
        >
          {showFooterHints && (
            <>
              <ChatKbd>⌘</ChatKbd><ChatKbd>↵</ChatKbd>
              <span style={{ marginLeft: -10 }}>SEND</span>
              <span style={{ color: 'var(--d9-hairline-b)' }}>·</span>
              <ChatKbd>⌘</ChatKbd><ChatKbd>⇧</ChatKbd><ChatKbd>S</ChatKbd>
              <span style={{ marginLeft: -20 }}>SCREENSHOT</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          {contextWindow && contextWindow.compactionThreshold > 0 && (
            <ContextMeter ctx={contextWindow} />
          )}
          {streaming ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusDot state="streaming" size={6} />
              <span>streaming</span>
            </span>
          ) : quota && (
            quota.requestsCap > 0
              ? <QuotaMeterMini used={quota.requestsUsed} cap={quota.requestsCap} />
              : quota.plan && quota.plan !== 'free'
                ? (
                  <span
                    title={`План: ${quota.plan}`}
                    style={{
                      fontSize: 9,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--d9-accent-hi)',
                      opacity: 0.7,
                      userSelect: 'none',
                    }}
                  >
                    ✦ {quota.plan}
                  </span>
                )
                : null
          )}
        </div>
      </div>

      {streaming && <StreamingHairline inset={18} />}

      {pickerOpen && (
        <ProviderPicker
          models={config?.models ?? []}
          defaultModelId={config?.defaultModelId ?? ''}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {summaryOpen && lastAnalysis && (
        <SummaryModal
          analysis={lastAnalysis}
          modelLabel={activeModelId}
          notesFilePath={notesFilePath}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={buildPaletteActions({
          hasMessages: messages.length > 0,
          hasSummary: Boolean(lastAnalysis && lastAnalysis.status === 'ready'),
          isFreePlan: !quota || quota.plan === 'free' || quota.plan === '',
          openHistory: () => void window.druz9.windows.show('history'),
          openSettings: () => void window.druz9.windows.show('settings'),
          openPersonaPicker: () => void window.druz9.windows.showPicker('persona'),
          openModelPicker: () => setPickerOpen(true),
          openSummary: () => setSummaryOpen(true),
          showPaywall: () => showPaywall(),
          refreshQuota: () => void refreshQuota(),
          exportMarkdown: () => {
            void window.druz9.notes.exportChatMarkdown({
              title: '',
              messages: messages
                .filter((m) => !m.pending && m.content.trim().length > 0)
                .map((m) => ({ role: m.role, content: m.content })),
            }).catch(() => { /* save dialog cancel — silent */ });
          },
          saveToHone: () => {
            void window.druz9.notes.saveChatToHone({
              title: '',
              messages: messages
                .filter((m) => !m.pending && m.content.trim().length > 0)
                .map((m) => ({ role: m.role, content: m.content })),
            }).catch((err) => {
              // eslint-disable-next-line no-console
              console.error('saveChatToHone failed', err);
            });
          },
          screenshot: () => void captureAndSend(
            conversationId,
            draft,
            setDraft,
            selectedModel || config?.defaultModelId || '',
          ),
          clearChat: () => useConversationStore.getState().reset(),
          quitApp: () => void window.druz9.app.quit(),
        })}
      />
    </div>
  );
}

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
import { CommandPalette, type Action } from '../../components/CommandPalette';
import {
  BrandMark,
  CompactLogo,
  D9IconCamera,
  D9IconClose,
  D9IconCopy,
  D9IconSettings,
  IconButton,
  Kbds,
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
import { useConversationStore, type UIMessage } from '../../stores/conversation';
import { usePersonaStore } from '../../stores/persona';
import { usePersonaHotkeys } from '../../hooks/use-persona-hotkeys';
import { useQuotaStore } from '../../stores/quota';
import { usePaywallStore } from '../../stores/paywall';
import { useSelectedModelStore } from '../../stores/selected-model';
import { useSessionStore } from '../../stores/session';
import { useAudioCaptureStore } from '../../stores/audio-capture';
import { useCoachStore } from '../../stores/coach';
import { SummaryModal } from '../summary/SummaryModal';

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
    await ipc({
      conversationId,
      promptText: text,
      model: selectedModel || config?.defaultModelId || '',
      attachments: [],
      triggerAction: voiceText ? 'voice_input' : 'quick_prompt',
      focusedAppHint: '',
      personaSystemPrompt: activePersona.system_prompt,
    });
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
      }).catch(() => {
        /* network/quota — silent, юзер заговорит снова */
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
        // юзер видит свою rаботу сквозь Cue, но размыто. Раньше было
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
          gap: 8,
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
              transition: 'background 120ms',
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
              transition: 'background 120ms',
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

      {/* Live transcript ticker — visible only when macOS system-
          audio capture is running or has accumulated chunks. */}
      <LiveTranscriptStrip draft={draft} setDraft={setDraft} />

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
            gap: 8,
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${focused ? 'rgba(255,255,255,0.4)' : 'transparent'}`,
            borderRadius: 10,
            padding: '8px 8px 8px 14px',
            transition: 'border-color 150ms',
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
            placeholder={recording ? 'Слушаю…' : 'Continue dialog…'}
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
              gap: 4,
              fontSize: 10,
              color: 'var(--d9-ink-mute)',
              cursor: 'pointer',
              userSelect: 'none',
              padding: '4px 6px',
              borderRadius: 6,
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
              transition: 'transform 120ms, filter 120ms, background 120ms',
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

// ─────────────────────────────────────────────────────────────────────────

/**
 * buildPaletteActions — собирает list of Action'ов для ⌘K palette из
 * текущего контекста (messages.length, hasSummary, callback'и которые
 * замыкают actual store/window manipulation). Conditional actions
 * (Export / Save / Summary) скрываются когда не релевантны (нет
 * messages / нет ready report).
 */
function buildPaletteActions(ctx: {
  hasMessages: boolean;
  hasSummary: boolean;
  isFreePlan: boolean;
  openHistory: () => void;
  openSettings: () => void;
  openPersonaPicker: () => void;
  openModelPicker: () => void;
  openSummary: () => void;
  showPaywall: () => void;
  refreshQuota: () => void;
  exportMarkdown: () => void;
  saveToHone: () => void;
  screenshot: () => void;
  clearChat: () => void;
  quitApp: () => void;
}): Action[] {
  const list: Action[] = [
    { id: 'history', label: 'История чатов', hint: 'Открыть список прошлых разговоров', run: ctx.openHistory },
    { id: 'persona', label: 'Сменить persona', hint: '⌥1..⌥9 — быстрый switch', run: ctx.openPersonaPicker },
    { id: 'model', label: 'Сменить модель', run: ctx.openModelPicker },
    { id: 'screenshot', label: 'Сделать скриншот области', shortcut: '⌘⇧S', run: ctx.screenshot },
    { id: 'settings', label: 'Открыть настройки', run: ctx.openSettings },
  ];
  if (ctx.hasSummary) {
    list.push({ id: 'summary', label: 'Открыть Summary', hint: 'Отчёт по сессии', run: ctx.openSummary });
  }
  if (ctx.hasMessages) {
    list.push(
      { id: 'export-md', label: 'Экспорт в Markdown', hint: 'Сохранить чат в .md файл', run: ctx.exportMarkdown },
      { id: 'save-hone', label: 'Сохранить в Hone', hint: 'Перенести как заметку', run: ctx.saveToHone },
      { id: 'clear-chat', label: 'Очистить чат', hint: 'Начать новый разговор', run: ctx.clearChat },
    );
  }
  // Subscription actions — always surfaced so users can find them via search.
  if (ctx.isFreePlan) {
    list.push({
      id: 'upgrade',
      label: 'Обновить план',
      hint: 'Pro / Max на Boosty',
      run: ctx.showPaywall,
    });
  }
  list.push({
    id: 'refresh-quota',
    label: 'Проверить подписку',
    hint: 'Обновить статус плана с сервера',
    run: ctx.refreshQuota,
  });
  list.push({ id: 'quit', label: 'Выйти из Cue', shortcut: '⌘Q', run: ctx.quitApp });
  return list;
}

function EmptyState() {
  // The hero BrandMark is now always black (post-Cue rebrand), so we
  // only need the persona label for the subtitle — no gradient lookup.
  const persona = usePersonaStore((s) => s.active);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: '0 20px',
      }}
    >
      <BrandMark
        size={76}
        style={{
          borderRadius: 22,
          boxShadow:
            'inset 0 0.5px 0 rgba(255,255,255,0.3), ' +
            '0 4px 20px -2px rgba(0,0,0,0.4), ' +
            '0 0 40px -8px rgba(0,0,0,0.4)',
        }}
      />
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--d9-font-display)',
            fontStyle: 'italic',
            fontSize: 26,
            color: 'var(--d9-ink)',
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
          }}
        >
          Незаметно. Точно.
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--d9-ink-mute)',
            marginTop: 6,
            letterSpacing: '-0.005em',
          }}
        >
          {persona.label} · невидимо для screen-sharing
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 320 }}>
        {([
          ['Все команды', ['⌘', 'K']],
          ['Объяснить что я вижу', ['⌘', '⏎']],
          ['Заскринить область + спросить', ['⌘', '⇧', 'S']],
          ['Сменить персону', ['⌥', '1']],
          ['Скрыть окно', ['⌘', '⇧', 'D']],
        ] as Array<[string, string[]]>).map(([label, keys]) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 9,
              background: 'oklch(1 0 0 / 0.03)',
              border: '0.5px solid var(--d9-hairline)',
            }}
          >
            <span
              style={{
                fontSize: 12.5,
                color: 'var(--d9-ink-dim)',
                letterSpacing: '-0.005em',
                flex: 1,
              }}
            >
              {label}
            </span>
            <Kbds keys={keys} size="sm" sep="" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--d9-ink-mute)',
        fontSize: 12,
        marginBottom: 16,
      }}
    >
      <StatusDot state="thinking" size={6} />
      <span style={{ letterSpacing: '-0.005em' }}>думаю…</span>
    </div>
  );
}

/**
 * ContextMeter — мини-индикатор использования context window в footer'е.
 * Показывает progress bar `messagesTotal / compactionThreshold`. После
 * порога ставит иконку «сжимается» и подсвечивает оранжевым. Tooltip
 * раскрывает детали (turns в окне, длина summary).
 *
 * Backend (sliding-window компакция в shared/pkg/compaction): после
 * `threshold` turns старые сообщения сжимаются в RunningSummary, в LLM
 * шлются только последние `WindowSize` (default 10). Юзер видел
 * деградацию точности после ~15 turns без объяснения — теперь видит
 * прогресс и ghost-message при триггере компакции.
 */
function ContextMeter({ ctx }: { ctx: { messagesInWindow: number; messagesTotal: number; compactionThreshold: number; runningSummaryChars: number } }) {
  const total = Math.max(0, ctx.messagesTotal);
  const threshold = Math.max(1, ctx.compactionThreshold);
  const pct = Math.min(100, Math.round((total / threshold) * 100));
  const overThreshold = total >= threshold;
  const color = overThreshold
    ? 'oklch(0.7 0.18 65)' // amber
    : pct >= 80
      ? 'var(--d9-accent-hi)'
      : 'var(--d9-ink-ghost)';
  const tooltip = [
    `Контекст: ${total} turns`,
    `В LLM сейчас: ${ctx.messagesInWindow}`,
    `Порог компакции: ${threshold}`,
    ctx.runningSummaryChars > 0 ? `Summary: ${ctx.runningSummaryChars} симв.` : 'Summary пуст',
  ].join('\n');
  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'help',
      }}
    >
      <span style={{ color, letterSpacing: '0.04em' }}>CTX</span>
      <span
        aria-hidden
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
          display: 'inline-block',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${pct}%`,
            height: '100%',
            background: color,
            transition: 'width 200ms ease-out',
          }}
        />
      </span>
      <span style={{ color, fontFamily: 'var(--d9-font-mono)' }}>
        {total}/{threshold}
      </span>
    </span>
  );
}

/**
 * CompactionGhostNotice — лёгкое сообщение в чате о том что backend
 * только что сжал старые turns в summary. Появляется на ~10 секунд после
 * Done event с compaction_triggered=true, потом исчезает (рендеринг
 * gated через `Date.now() - compactionNoticeAt < 10_000`).
 */
function CompactionGhostNotice() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
        padding: '6px 10px',
        background: 'oklch(0.7 0.18 65 / 0.08)',
        border: '0.5px solid oklch(0.7 0.18 65 / 0.25)',
        borderRadius: 8,
        color: 'var(--d9-ink-mute)',
        fontSize: 11,
        letterSpacing: '-0.005em',
        fontStyle: 'italic',
      }}
    >
      <span aria-hidden>📜</span>
      <span>
        Старые сообщения сжаты в summary. AI продолжает диалог с учётом
        ключевых моментов из истории.
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Message bubbles — user (right, violet tint) / assistant (left, prose)
// ─────────────────────────────────────────────────────────────────────────

function MessageBubble({ m, persona: _persona }: { m: UIMessage; persona: string }) {
  if (m.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div
          style={{
            maxWidth: '78%',
            padding: '10px 14px',
            borderRadius: '12px 12px 4px 12px',
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--d9-ink)',
            fontSize: 14,
            lineHeight: 1.5,
            letterSpacing: '0.01em',
          }}
        >
          {m.hasScreenshot && m.screenshotDataUrl && (
            <a
              href={m.screenshotDataUrl}
              target="_blank"
              rel="noreferrer"
              title="Открыть в полном размере"
              style={{
                display: 'block',
                marginBottom: m.content ? 8 : 0,
                padding: 2,
                borderRadius: 8,
                background: 'rgba(0,0,0,0.25)',
                cursor: 'zoom-in',
              }}
            >
              <img
                src={m.screenshotDataUrl}
                alt="скриншот"
                style={{
                  display: 'block',
                  width: '100%',
                  maxHeight: 240,
                  objectFit: 'cover',
                  borderRadius: 6,
                }}
              />
            </a>
          )}
          {m.hasScreenshot && !m.screenshotDataUrl && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                fontSize: 11,
                opacity: 0.85,
              }}
            >
              <D9IconCamera size={12} />
              скриншот
            </div>
          )}
          {m.content || (!m.hasScreenshot && <span style={{ opacity: 0.6 }}>(пусто)</span>)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', marginBottom: 20, gap: 12, maxWidth: '92%' }}>
      {/* Star glyph — cyan sparkle matching prototype */}
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none" style={{ color: 'var(--d9-accent)' }}>
          <path d="M9 1l1.5 5.5L16 8l-5.5 1.5L9 15l-1.5-5.5L2 8l5.5-1.5L9 1z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
        </svg>
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 14.5,
          lineHeight: 1.6,
          letterSpacing: '-0.002em',
          color: 'var(--d9-ink)',
        }}
      >
        {m.errorCode ? (
          <ErrorCard code={m.errorCode} message={m.errorMessage ?? 'Unknown error'} />
        ) : (
          <AssistantContent text={m.content} pending={m.pending} />
        )}
      </div>
    </div>
  );
}

function ErrorCard({ code, message }: { code: string; message: string }) {
  // A 401 Unauthenticated often ends up in the transport bucket because
  // the Connect error surfaces without a specific code string. Detect via
  // the message; everything else keeps its human label.
  const is401 =
    code === 'transport' &&
    /401|unauthenticated|unauthorized|no handler|not authenticated/i.test(message);

  if (is401) {
    return (
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--d9-accent-glow)',
          border: '0.5px solid rgba(255, 59, 48, 0.4)',
          borderRadius: 9,
          color: 'var(--d9-accent-hi)',
          fontSize: 12.5,
          letterSpacing: '-0.005em',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Нужен вход</div>
        <div style={{ opacity: 0.85 }}>
          Открой Настройки → Общее → Войти и авторизуйся через Telegram.
        </div>
      </div>
    );
  }

  const label: Record<string, string> = {
    rate_limited: 'Лимит запросов исчерпан',
    model_unavailable: 'Модель недоступна на вашем плане',
    invalid_input: 'Неверный ввод',
    internal: 'Ошибка сервера',
    transport: 'Потеряно соединение с сервером',
  };
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'oklch(0.68 0.22 25 / 0.08)',
        border: '0.5px solid oklch(0.68 0.22 25 / 0.3)',
        borderRadius: 9,
        color: 'var(--d9-err)',
        fontSize: 12.5,
        letterSpacing: '-0.005em',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{label[code] ?? code}</div>
      <div style={{ opacity: 0.85 }}>{message}</div>
    </div>
  );
}

/**
 * AssistantContent renders the streaming text with a minimal markdown pass:
 *  - triple-backtick fences → code blocks
 *  - single backticks → inline code
 *
 * We deliberately avoid a full markdown lib until UX demands it; this
 * covers 90% of LLM outputs for MVP.
 */
function AssistantContent({ text, pending }: { text: string; pending: boolean }) {
  return (
    <>
      {renderMiniMarkdown(text)}
      {pending && (
        <span
          style={{
            display: 'inline-block',
            width: '0.55em',
            height: '1em',
            marginLeft: 1,
            verticalAlign: '-0.15em',
            background: 'var(--d9-accent-hi)',
            borderRadius: 1,
            opacity: 0.8,
            animation: 'druz9-pulse 1s ease-in-out infinite',
          }}
        />
      )}
    </>
  );
}

function renderMiniMarkdown(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(```[\s\S]*?```)/g);
  parts.forEach((part, i) => {
    if (part.startsWith('```')) {
      const closed = part.endsWith('```') && part.length > 6;
      const body = closed ? part.slice(3, -3) : part.slice(3);
      const firstNl = body.indexOf('\n');
      const lang = firstNl >= 0 ? body.slice(0, firstNl).trim() : '';
      const code = firstNl >= 0 ? body.slice(firstNl + 1) : body;
      nodes.push(<CodeBlock key={i} lang={lang} code={code.trimEnd()} />);
    } else {
      nodes.push(<InlineText key={i} text={part} />);
    }
  });
  return nodes;
}

function InlineText({ text }: { text: string }) {
  const segments = text.split(/(`[^`]+`)/g);
  return (
    <>
      {segments.map((s, i) =>
        s.startsWith('`') && s.endsWith('`') && s.length > 2 ? (
          <code
            key={i}
            style={{
              fontFamily: 'var(--d9-font-mono)',
              fontSize: 12,
              padding: '1px 5px',
              background: 'oklch(1 0 0 / 0.06)',
              borderRadius: 4,
              color: 'var(--d9-ink)',
            }}
          >
            {s.slice(1, -1)}
          </code>
        ) : (
          <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {s}
          </span>
        ),
      )}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        margin: '8px 0 12px',
        borderRadius: 10,
        // Code-block shell — deeper than the surrounding surface.
        // Pure black 75% alpha lets the scrim show through slightly.
        background: 'rgba(0, 0, 0, 0.6)',
        border: '0.5px solid var(--d9-hairline)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 8px 6px 12px',
          borderBottom: '0.5px solid var(--d9-hairline)',
          background: 'oklch(1 0 0 / 0.02)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--d9-font-mono)',
            fontSize: 10.5,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--d9-ink-ghost)',
          }}
        >
          {lang || 'code'}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard denied — silent */
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 7px',
            borderRadius: 5,
            color: 'var(--d9-ink-mute)',
            fontSize: 10.5,
            letterSpacing: '0.02em',
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'oklch(1 0 0 / 0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <D9IconCopy size={11} />
          {copied ? 'Скопировано' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px 12px',
          overflowX: 'auto',
          fontFamily: 'var(--d9-font-mono)',
          fontSize: 12,
          lineHeight: 1.65,
          color: 'var(--d9-ink-dim)',
          whiteSpace: 'pre',
        }}
      >
        {code}
      </pre>
    </div>
  );
}

async function captureAndSend(
  conversationId: string,
  promptText: string,
  setDraft: (s: string) => void,
  model: string,
) {
  try {
    const shot = await window.druz9.capture.screenshotArea();
    if (!shot) return; // user cancelled
    const ipc = conversationId ? window.druz9.analyze.chat : window.druz9.analyze.start;
    const handle = await ipc({
      conversationId,
      promptText,
      model,
      attachments: [
        {
          kind: 'screenshot',
          dataBase64: shot.dataBase64,
          mimeType: shot.mimeType,
          width: shot.width,
          height: shot.height,
        },
      ],
      triggerAction: 'screenshot_area',
      focusedAppHint: '',
      personaSystemPrompt: usePersonaStore.getState().active.system_prompt,
    });
    // Main broadcasts `userTurnStarted` before the handle returns, but
    // push and invoke-response travel independently — the push can lose
    // the race on some Electron builds. If the broadcast already ran
    // applyTurn, streamId will match; skip. Otherwise paint here.
    if (useConversationStore.getState().streamId !== handle.streamId) {
      useConversationStore.getState().beginTurn({
        promptText,
        hasScreenshot: true,
        screenshotDataUrl: `data:${shot.mimeType};base64,${shot.dataBase64}`,
        streamId: handle.streamId,
      });
    }
    setDraft('');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('screenshot failed', err);
  }
}

/**
 * AutoSuggestPill — floating suggestion strip above the input row.
 * Shows the most recent /copilot/suggestion result, the question
 * that triggered it, and an action to splice into the draft.
 * Dismissable; auto-replaced on the next trigger.
 *
 * Accent glow differentiates it from the transcript strip so the
 * user instantly reads "this is AI" vs "this is raw transcript".
 */
function AutoSuggestPill({
  draft,
  setDraft,
}: {
  draft: string;
  setDraft: (s: string) => void;
}) {
  const suggestion = useCoachStore((s) => s.suggestion);
  const thinking = useCoachStore((s) => s.thinking);
  const enabled = useCoachStore((s) => s.enabled);
  const error = useCoachStore((s) => s.error);
  const dismiss = useCoachStore((s) => s.dismiss);

  // Render only when there's something to say. Toggle off + no
  // active suggestion + no error = stay invisible.
  if (!suggestion && !thinking && !error) return null;
  if (!enabled && !suggestion) return null;

  const insert = () => {
    if (!suggestion) return;
    const joiner = draft.length === 0 || /\s$/.test(draft) ? '' : '\n';
    setDraft(draft + joiner + suggestion.text);
    dismiss();
  };

  return (
    <div
      style={{
        padding: '6px 12px 0',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 10,
          background: error
            ? 'oklch(0.6 0.2 25 / 0.1)'
            : 'linear-gradient(135deg, rgba(255, 59, 48, 0.1), rgba(255, 107, 96, 0.08))',
          border: `0.5px solid ${error ? 'oklch(0.6 0.2 25 / 0.35)' : 'rgba(255, 59, 48, 0.3)'}`,
          boxShadow: error ? 'none' : '0 0 14px -4px var(--d9-accent-glow)',
        }}
      >
        <span
          aria-hidden
          style={{
            flex: 'none',
            fontSize: 13,
            lineHeight: '1.5em',
          }}
        >
          {error ? '⚠️' : thinking ? '💭' : '💡'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {error ? (
            <div
              style={{
                fontSize: 11.5,
                color: 'oklch(0.75 0.18 25)',
                letterSpacing: '-0.005em',
              }}
            >
              {error}
            </div>
          ) : thinking && !suggestion ? (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--d9-accent-hi)',
                letterSpacing: '-0.005em',
                fontStyle: 'italic',
              }}
            >
              AI формулирует ответ на вопрос собеседника…
            </div>
          ) : suggestion ? (
            <>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--d9-ink-ghost)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontFamily: 'var(--d9-font-mono)',
                  marginBottom: 3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Q: {suggestion.question}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--d9-ink)',
                  lineHeight: 1.45,
                  letterSpacing: '-0.005em',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {suggestion.text}
              </div>
            </>
          ) : null}
        </div>
        {suggestion && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 'none' }}>
            <button
              type="button"
              onClick={insert}
              title="Вставить в поле ввода"
              style={{
                padding: '3px 8px',
                fontSize: 10.5,
                fontFamily: 'inherit',
                background: 'var(--d9-accent)',
                color: 'white',
                border: 0,
                borderRadius: 5,
                cursor: 'pointer',
                letterSpacing: '-0.005em',
              }}
            >
              в ввод
            </button>
            <button
              type="button"
              onClick={dismiss}
              title="Скрыть"
              style={{
                padding: '3px 8px',
                fontSize: 10.5,
                fontFamily: 'inherit',
                background: 'transparent',
                color: 'var(--d9-ink-ghost)',
                border: '0.5px solid var(--d9-hairline)',
                borderRadius: 5,
                cursor: 'pointer',
                letterSpacing: '-0.005em',
              }}
            >
              закрыть
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * LiveTranscriptStrip — компактный status-indicator. ТЕКСТ распознавания
 * НЕ дублируется тут (он живёт в input field), показываем только что
 * сейчас активно: «● Слушаем» / «● Микрофон» + ошибки если есть.
 *
 * Раньше strip полноценно повторял transcript, что путало юзера: текст
 * в strip есть, а в input нет. Унифицировано: input — единственная
 * точка где live-transcript видим.
 */
function LiveTranscriptStrip(_props: { draft: string; setDraft: (s: string) => void }) {
  const sys = useAudioCaptureStore((s) => s.system);
  const mic = useAudioCaptureStore((s) => s.mic);

  const sysActive = sys.state === 'running' || sys.state === 'starting';
  const micActive = mic.state === 'running' || mic.state === 'starting';

  if (!sysActive && !micActive && !sys.error && !mic.error) return null;

  return (
    <div
      style={{
        padding: '6px 12px 0',
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {sysActive && <ActivePill label="Слушаем (звук)" />}
      {micActive && <ActivePill label="Микрофон" />}
      {sys.error && <ErrorPill label="Слушать" message={sys.error} />}
      {mic.error && <ErrorPill label="Микрофон" message={mic.error} />}
    </div>
  );
}

function ActivePill({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        background: 'rgba(255, 59, 48, 0.08)',
        border: '0.5px solid rgba(255, 59, 48, 0.3)',
        color: 'var(--d9-ink-mute)',
        fontSize: 11,
        letterSpacing: '-0.005em',
      }}
    >
      <span
        aria-hidden
        style={{
          flex: 'none',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'oklch(0.65 0.22 25)',
          animation: 'd9-pulse 1s ease-in-out infinite',
        }}
      />
      {label}
    </div>
  );
}

function ErrorPill({ label, message }: { label: string; message: string }) {
  return (
    <div
      title={message}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        background: 'oklch(0.6 0.2 25 / 0.12)',
        border: '0.5px solid oklch(0.6 0.2 25 / 0.35)',
        color: 'oklch(0.75 0.18 25)',
        fontSize: 11,
        letterSpacing: '-0.005em',
        maxWidth: 280,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      ⚠ {label}: {message}
    </div>
  );
}


/**
 * VoiceToggleCombined — single combined trigger вместо двух отдельных
 * кнопок (system/mic). Click открывает popover с двумя radio-style
 * row'ами. Обе source'а независимы, могут быть оба ON одновременно.
 * Compact UX: 90% юзеров используют один source, две отдельных
 * кнопки confused «какую нажать».
 */
function VoiceToggleCombined() {
  const sysState = useAudioCaptureStore((s) => s.system.state);
  const micState = useAudioCaptureStore((s) => s.mic.state);
  const sysStartedAt = useAudioCaptureStore((s) => s.system.startedAt);
  const micStartedAt = useAudioCaptureStore((s) => s.mic.startedAt);
  const available = useAudioCaptureStore((s) => s.available);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const anyActive = sysState === 'running' || sysState === 'starting'
    || micState === 'running' || micState === 'starting';
  useEffect(() => {
    if (!anyActive) return;
    const h = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(h);
  }, [anyActive]);

  if (!available) return null;

  const earliest = (() => {
    const ts: number[] = [];
    if (sysStartedAt) ts.push(sysStartedAt);
    if (micStartedAt) ts.push(micStartedAt);
    return ts.length ? Math.min(...ts) : null;
  })();
  const elapsed = earliest ? Math.max(0, Math.floor((Date.now() - earliest) / 1000)) : 0;
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const elapsedLabel = `${mm}:${ss.toString().padStart(2, '0')}`;
  const label = anyActive ? `● ${elapsedLabel}` : 'Слушать';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        title={anyActive ? 'Управление voice capture' : 'Включить транскрипцию'}
        style={{
          padding: '4px 10px',
          marginRight: 4,
          borderRadius: 7,
          background: anyActive ? 'oklch(0.6 0.2 25 / 0.15)' : 'oklch(1 0 0 / 0.04)',
          border: `0.5px solid ${anyActive ? 'oklch(0.6 0.2 25 / 0.5)' : 'var(--d9-hairline)'}`,
          color: anyActive ? 'oklch(0.75 0.18 25)' : 'var(--d9-ink-mute)',
          fontSize: 11.5,
          fontFamily: anyActive ? 'var(--d9-font-mono)' : 'inherit',
          letterSpacing: '-0.005em',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          transition: 'background 120ms var(--d9-ease), color 120ms var(--d9-ease)',
        }}
      >
        <span style={{ display: 'none' }}>{tick}</span>
        {label}
        <span style={{ fontSize: 8, color: anyActive ? 'oklch(0.75 0.18 25 / 0.6)' : 'var(--d9-ink-ghost)' }}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            minWidth: 240,
            background: 'oklch(0.18 0 0 / 0.96)',
            border: '0.5px solid var(--d9-hairline-b)',
            borderRadius: 8,
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 24px -4px rgba(0,0,0,0.5)',
            padding: 4,
            zIndex: 1000,
          }}
        >
          <SourceMenuItem source="system" label="Системный звук" hint="Звонки, видео в браузере" onAction={() => setOpen(false)} />
          <SourceMenuItem source="mic" label="Микрофон" hint="Твой голос" onAction={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function SourceMenuItem({
  source,
  label,
  hint,
  onAction,
}: {
  source: 'system' | 'mic';
  label: string;
  hint: string;
  onAction: () => void;
}) {
  const slice = useAudioCaptureStore((s) => (source === 'system' ? s.system : s.mic));
  const start = useAudioCaptureStore((s) => s.start);
  const stop = useAudioCaptureStore((s) => s.stop);
  const setCoachEnabled = useCoachStore((s) => s.setEnabled);
  const recording = slice.state === 'running';
  const busy = slice.state === 'starting' || slice.state === 'stopping';

  const beginListening = () => {
    if (source === 'system') void setCoachEnabled(true);
    void start(source);
  };

  const onClick = () => {
    if (busy) return;
    if (recording) {
      const other = source === 'system' ? useAudioCaptureStore.getState().mic : useAudioCaptureStore.getState().system;
      const otherActive = other.state === 'running' || other.state === 'starting';
      if (!otherActive && source === 'system') void setCoachEnabled(false);
      void stop(source);
      onAction();
      return;
    }
    if (!hasVoiceConsent()) {
      requestVoiceConsent(beginListening);
      onAction();
      return;
    }
    beginListening();
    onAction();
  };

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={recording}
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '7px 10px',
        background: 'transparent',
        border: 0,
        color: 'var(--d9-ink)',
        textAlign: 'left',
        cursor: busy ? 'wait' : 'pointer',
        borderRadius: 4,
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'oklch(1 0 0 / 0.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flex: 'none',
          background: recording ? 'oklch(0.65 0.22 25)' : 'transparent',
          border: recording ? 'none' : '1px solid var(--d9-ink-ghost)',
          animation: recording ? 'd9-pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--d9-ink)' }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--d9-ink-mute)', letterSpacing: '-0.005em' }}>{hint}</div>
      </div>
      <span
        style={{
          fontSize: 10,
          fontFamily: 'var(--d9-font-mono)',
          color: recording ? 'oklch(0.75 0.18 25)' : 'var(--d9-ink-ghost)',
        }}
      >
        {busy ? '…' : recording ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

/**
 * AttachedDocsBadge — compact pill in the expanded header that tells the
 * user how many documents feed the current turn's RAG context. Hidden
 * when there's no live session OR when the user hasn't attached
 * anything. Clicking opens the Settings → Documents tab where the user
 * can toggle attachments.
 *
 * This is informational-only here; full management (attach/detach,
 * upload) lives in Settings where there's room for a drop-zone and
 * list. Keeping the badge simple avoids a second picker-panel to own.
 */
function AttachedDocsBadge() {
  const current = useSessionStore((s) => s.current);
  const attached = useSessionStore((s) => s.attachedDocIds);
  if (!current || current.finishedAt || attached.length === 0) return null;
  const plural = attached.length === 1 ? 'документ' : attached.length < 5 ? 'документа' : 'документов';
  return (
    <button
      type="button"
      onClick={() => void window.druz9.windows.show('settings')}
      title={`Copilot учитывает ${attached.length} ${plural} в контексте. Открыть Настройки → Документы.`}
      style={{
        padding: '4px 10px',
        marginRight: 4,
        borderRadius: 7,
        background: 'oklch(0.8 0.17 150 / 0.12)',
        border: '0.5px solid oklch(0.8 0.17 150 / 0.28)',
        color: 'var(--d9-ok)',
        fontSize: 11.5,
        fontFamily: 'inherit',
        letterSpacing: '-0.005em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      📎 {attached.length} {plural}
    </button>
  );
}

// ─── Chat-specific helpers ────────────────────────────────────────────────

// ChatHeadPill удалён: после consolidation persona+model в один combined
// pill (см. header), отдельный pill helper больше не нужен. Inline styles
// в новом combined chip покрывают тот же visual idiom.

/** Tiny kbd chip for the chat footer shortcut hints. */
function ChatKbd({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      border: '1px solid var(--d9-hairline-b)',
      background: 'rgba(255,255,255,0.03)',
      padding: '2px 6px',
      borderRadius: 4,
      fontFamily: 'var(--d9-font-mono)',
      fontSize: 10,
      color: 'var(--d9-ink)',
      margin: '0 1px',
    }}>
      {children}
    </span>
  );
}

// CheckmarkIcon / ErrorIcon — visual feedback для save-button после
// клика. Зелёный ✓ → ok, красный ✕ → fail. Auto-revert через 2.4s.
/**
 * ChatActionsOverflow — «⋯» dropdown с secondary actions: Summary
 * (если ready), Save-to-Hone, Export Markdown. До рефактора эти кнопки
 * стояли отдельно в header'е → 13 видимых элементов; теперь header
 * compact (8-9 элементов), редкие actions — за один клик в menu.
 *
 * Click outside closes (ref-attached useEffect). Esc — closes тоже.
 */
function ChatActionsOverflow({
  messages,
  saveChatStatus,
  setSaveChatStatus,
  hasSummary,
  onOpenSummary,
}: {
  messages: UIMessage[];
  saveChatStatus: 'idle' | 'saving' | 'ok' | 'err';
  setSaveChatStatus: (s: 'idle' | 'saving' | 'ok' | 'err') => void;
  hasSummary: boolean;
  onOpenSummary: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Если нет ни одного применимого action'а — кнопку не показываем
  // (избегаем «пустого» menu с placeholder'ом).
  const hasMessages = messages.length > 0;
  if (!hasMessages && !hasSummary) return null;

  const cleanMessages = messages
    .filter((m) => !m.pending && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  const onSaveToHone = () => {
    setOpen(false);
    void (async () => {
      setSaveChatStatus('saving');
      try {
        await window.druz9.notes.saveChatToHone({ title: '', messages: cleanMessages });
        setSaveChatStatus('ok');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('saveChatToHone failed', err);
        setSaveChatStatus('err');
      }
      window.setTimeout(() => setSaveChatStatus('idle'), 2400);
    })();
  };
  const onExport = () => {
    setOpen(false);
    void (async () => {
      try {
        await window.druz9.notes.exportChatMarkdown({ title: '', messages: cleanMessages });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('exportChatMarkdown failed', err);
      }
    })();
  };

  // Trigger icon: если save-to-Hone сейчас в результирующем state'е
  // (ok/err) — вместо обычной «⋯» показываем cheсkmark/error,
  // чтобы юзер видел feedback от своего предыдущего действия.
  const triggerIcon =
    saveChatStatus === 'ok' ? <CheckmarkIcon />
      : saveChatStatus === 'err' ? <ErrorIcon />
        : <DotsIcon />;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <IconButton
        title="Дополнительные действия"
        onClick={() => setOpen((s) => !s)}
      >
        {triggerIcon}
      </IconButton>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            minWidth: 200,
            background: 'oklch(0.18 0 0 / 0.96)',
            border: '0.5px solid var(--d9-hairline-b)',
            borderRadius: 8,
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 24px -4px rgba(0,0,0,0.5)',
            padding: 4,
            zIndex: 1000,
          }}
        >
          {hasSummary && (
            <OverflowItem
              label="Открыть Summary"
              onClick={() => {
                setOpen(false);
                onOpenSummary();
              }}
            />
          )}
          {hasMessages && <OverflowItem label="Сохранить в Hone" onClick={onSaveToHone} />}
          {hasMessages && <OverflowItem label="Экспорт в Markdown" onClick={onExport} />}
        </div>
      )}
    </div>
  );
}

function OverflowItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '7px 10px',
        background: 'transparent',
        border: 0,
        color: 'var(--d9-ink)',
        fontSize: 12,
        fontFamily: 'var(--d9-font-sans)',
        textAlign: 'left',
        cursor: 'pointer',
        borderRadius: 4,
        letterSpacing: '-0.005em',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'oklch(1 0 0 / 0.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  );
}

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function CheckmarkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// SaveToHoneIcon / DownloadIcon удалены: после consolidation в
// ChatActionsOverflow («⋯» menu) обе actions имеют только text labels,
// отдельные glyph'ы перестали использоваться.

// ─── Voice consent gate ─────────────────────────────────────────────────
//
// При первом нажатии «Слушать»/«Микрофон» показываем юзеру disclaimer
// что аудио уйдёт на сервер (Groq Whisper) для транскрипции и что
// записывать собеседников по Zoom/Meet без их согласия — на его
// ответственности (legal risk: GDPR EU, two-party consent в CA/IL).
// После accept — флаг в localStorage, больше не показываем.
//
// Используем native window.confirm (Electron показывает OS-modal),
// чтобы не плодить React-state для одноразового вопроса. Confirm
// блокирующий — запись стартует только после OK; на Cancel — no-op.

const VOICE_CONSENT_KEY = 'cue.voiceConsent.granted.v1';

function hasVoiceConsent(): boolean {
  try {
    return window.localStorage.getItem(VOICE_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

function requestVoiceConsent(onAccept: () => void): void {
  const ok = window.confirm(
    'Cue будет передавать аудио на сервер для транскрипции (Groq Whisper).\n\n' +
    'Если ты записываешь созвон с другими людьми (Zoom, Meet, Teams) — ' +
    'предупреди их и получи согласие. В некоторых странах (ЕС, Калифорния, ' +
    'Иллинойс) запись разговора без согласия всех участников — нарушение закона.\n\n' +
    'Продолжить?',
  );
  if (!ok) return;
  try {
    window.localStorage.setItem(VOICE_CONSENT_KEY, '1');
  } catch { /* localStorage недоступен — пользователь увидит prompt снова в следующий раз */ }
  onAccept();
}

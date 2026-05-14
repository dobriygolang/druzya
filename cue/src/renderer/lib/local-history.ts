import type { Conversation, ConversationMemory, Message } from '@shared/types';

import { translate } from '@d9-i18n';
import type { UIMessage } from '../stores/conversation';

const STORE_KEY = 'cue.localHistory.v1';
const RETENTION_KEY = 'cue.localHistory.retentionDays';
const DEFAULT_RETENTION_DAYS = 30;
// Hard caps для localStorage: количество (LRU) + размер (защита от
// раздутых code-block conversations). localStorage обычно ~5-10MB.
// Без этих cap'ов при ~50KB/conversation × 250 entries = 12MB →
// QuotaExceededError на следующий save → silent corruption.
const MAX_CONVERSATIONS = 100;
const MAX_BYTES = 4 * 1024 * 1024; // 4MB safe budget

interface LocalEntry {
  conversation: Conversation;
  messages: Message[];
  memory: ConversationMemory;
}

export interface LocalHistoryPage {
  conversations: Conversation[];
  nextCursor: string;
}

export function getHistoryRetentionDays(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_RETENTION_DAYS;
  const raw = Number(localStorage.getItem(RETENTION_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RETENTION_DAYS;
  return Math.max(1, Math.min(365, Math.floor(raw)));
}

export function setHistoryRetentionDays(days: number): void {
  if (typeof localStorage === 'undefined') return;
  const next = Math.max(1, Math.min(365, Math.floor(days)));
  localStorage.setItem(RETENTION_KEY, String(next));
  pruneLocalHistory();
}

export function listLocalHistory(cursor: string, limit: number): LocalHistoryPage {
  pruneLocalHistory();
  const start = Math.max(0, Number(cursor || 0) || 0);
  const safeLimit = Math.max(1, Math.min(100, limit));
  const entries = readEntries();
  const slice = entries.slice(start, start + safeLimit);
  const next = start + safeLimit < entries.length ? String(start + safeLimit) : '';
  return {
    conversations: slice.map((e) => e.conversation),
    nextCursor: next,
  };
}

export function getLocalConversation(id: string): LocalEntry | null {
  pruneLocalHistory();
  const entry = readEntries().find((e) => e.conversation.id === id) ?? null;
  if (!entry) return null;
  // Sanity filter: messages с binary garbage в content (corruption из
  // прежнего streaming-bug'а, обрезанного JSON.stringify при quota
  // exceeded, encoding leak с backend'а) → дропаем эти message'ы.
  // Без фильтра рендер показывает мохибаку «äÆÕZú∑Äëhst…» которая
  // не parsable ни визуально, ни logically.
  const cleanMessages = entry.messages.filter((m) => !looksBinary(m.content));
  if (cleanMessages.length !== entry.messages.length) {
    // eslint-disable-next-line no-console
    console.warn(
      '[local-history] dropped',
      entry.messages.length - cleanMessages.length,
      'corrupted messages from conversation',
      id,
    );
  }
  return { ...entry, messages: cleanMessages };
}

// looksBinary возвращает true когда text похож на binary mojibake:
// высокая доля non-printable / control characters (>10%) или явный
// контрольный байт в первых 100 символах. Для нормальной речи
// (русский / английский / эмодзи / code) ratio = 0.
function looksBinary(text: string): boolean {
  if (!text || text.length < 4) return false;
  // Quick test: контрольные байты (0x00-0x08, 0x0B, 0x0E-0x1F, 0x7F)
  // в первых 100 char'ах — гарантированно binary garbage.
  const sample = text.slice(0, 100);
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (
      c === 0x00 ||
      (c >= 0x01 && c <= 0x08) ||
      c === 0x0b ||
      (c >= 0x0e && c <= 0x1f) ||
      c === 0x7f
    ) {
      return true;
    }
  }
  // Slow test: считаем «странные» Unicode chars (Private Use Area
  // 0xE000-0xF8FF, surrogates 0xD800-0xDFFF, обрывки UTF-16). Если их
  // >10% — это garbage (нормальные тексты содержат 0).
  let weird = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0xd800 && c <= 0xdfff) ||
      (c >= 0xe000 && c <= 0xf8ff) ||
      (c >= 0xfff0 && c <= 0xffff)
    ) {
      weird += 1;
    }
  }
  return weird / text.length > 0.1;
}

// clearLocalHistory — destructive: full wipe. Используется кнопкой
// «Clear history» в HistoryScreen когда юзер видит corrupted data
// и хочет начать с чистого листа. Не trash'ит retentionDays setting.
export function clearLocalHistory(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORE_KEY);
}

export function deleteLocalConversation(id: string): void {
  writeEntries(readEntries().filter((e) => e.conversation.id !== id));
}

/** Renames the conversation. Custom title overrides the auto-generated
 *  one (first 80 chars of first user message). Empty string resets to
 *  auto-title. Returns true if the conversation was found. */
export function renameLocalConversation(id: string, customTitle: string): boolean {
  const entries = readEntries();
  const idx = entries.findIndex((e) => e.conversation.id === id);
  if (idx === -1) return false;
  const trimmed = customTitle.trim().slice(0, 120);
  entries[idx] = {
    ...entries[idx],
    conversation: {
      ...entries[idx].conversation,
      // Записываем в title напрямую — единственное поле в Conversation
      // type. Auto-title (первые 80 chars first user message) более не
      // регенерируется при saveLocalConversation если title уже custom.
      title: trimmed || autoTitleFromMessages(entries[idx].messages),
    },
  };
  writeEntries(entries);
  return true;
}

function autoTitleFromMessages(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const fallback = translate('cue.store.history.default_title');
  return (firstUser?.content || fallback).trim().slice(0, 80) || fallback;
}

/** Full-text search across all locally-stored conversations. Matches
 *  case-insensitively in title or message content (limited to first
 *  ~2KB per message to keep search fast on long code-block answers).
 *  Returns conversations sorted by `updatedAt DESC` (same as listing). */
export function searchLocalHistory(query: string, limit = 50): Conversation[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const entries = readEntries();
  const results: Conversation[] = [];
  for (const e of entries) {
    if (results.length >= limit) break;
    const title = (e.conversation.title || '').toLowerCase();
    if (title.includes(q)) {
      results.push(e.conversation);
      continue;
    }
    // Search в message content. Slice до 2KB per message — иначе
    // 10K-токенные code blocks с copy-paste'ом сделают поиск медленным
    // на 100 conversations.
    const matched = e.messages.some((m) => {
      const text = (m.content || '').slice(0, 2000).toLowerCase();
      return text.includes(q);
    });
    if (matched) results.push(e.conversation);
  }
  return results;
}

export function saveLocalConversation(args: {
  conversationId: string;
  model: string;
  messages: UIMessage[];
}): ConversationMemory | null {
  if (!args.conversationId || args.messages.length === 0) return null;
  const now = new Date().toISOString();
  const entries = readEntries().filter((e) => e.conversation.id !== args.conversationId);
  const existing = readEntries().find((e) => e.conversation.id === args.conversationId);
  // Preserve custom title if user renamed conversation. Auto-title
  // (первые 80 chars first user message) генерится только когда existing
  // title пуст ИЛИ совпадает со старым auto-title (юзер не переименовал).
  const firstUser = args.messages.find((m) => m.role === 'user');
  const fallbackTitle = translate('cue.store.history.default_title');
  const autoTitle = (firstUser?.content || fallbackTitle).trim().slice(0, 80) || fallbackTitle;
  const existingTitle = existing?.conversation.title?.trim() ?? '';
  // Auto-regenerate title when:
  //   1. Нет existing title (новый conversation)
  //   2. Existing title — это predecessor of current first user message
  //      (= auto-titled, юзер не custom'ил). Эвристика: existing совпадает
  //      со старым auto-title для прежнего первого user message.
  // Иначе считаем что title custom — НЕ перезаписываем.
  const prevAutoTitle = existing
    ? (existing.messages.find((m) => m.role === 'user')?.content || fallbackTitle)
        .trim()
        .slice(0, 80) || fallbackTitle
    : '';
  const isAutoTitled = !existingTitle || existingTitle === prevAutoTitle;
  const title = isAutoTitled ? autoTitle : existingTitle;
  // Pre-filter: НЕ сохраняем message'ы с binary garbage в content.
  // Лучше потерять одну битую реплику чем закрепить corruption в
  // localStorage и при следующем open показать юзеру моhибаку.
  const messages: Message[] = args.messages
    .filter((m) => !m.pending)
    .filter((m) => !looksBinary(m.content))
    .map((m) => ({
      id: m.id,
      conversationId: args.conversationId,
      role: m.role,
      content: m.content,
      hasScreenshot: m.hasScreenshot,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      rating: 0,
      createdAt: now,
    }));
  const memory = buildConversationMemory({
    model: args.model || 'AI',
    messages: args.messages.filter((m) => !m.pending),
    now,
  });

  const entry: LocalEntry = {
    conversation: {
      id: args.conversationId,
      title,
      model: args.model || 'AI',
      messageCount: messages.length,
      createdAt: existing?.conversation.createdAt ?? now,
      updatedAt: now,
    },
    messages,
    memory,
  };

  writeEntries([entry, ...entries].slice(0, MAX_CONVERSATIONS));
  pruneLocalHistory();
  return memory;
}

export function pruneLocalHistory(): void {
  const days = getHistoryRetentionDays();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  writeEntries(
    readEntries().filter((e) => {
      const ts = Date.parse(e.conversation.updatedAt || e.conversation.createdAt);
      return Number.isFinite(ts) && ts >= cutoff;
    }),
  );
}

function readEntries(): LocalEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: LocalEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  // Size-budget pre-check + retry-on-QuotaExceeded loop. Раньше
  // localStorage.setItem мог throw'ать QuotaExceededError (превышение
  // ~5-10MB бюджета браузера) и save'ы переставали работать молча —
  // ничего не catch'ил эту ошибку. Теперь: отрезаем oldest 10% и
  // retry'ем пока не fit'нем (или останется одна запись — дальше
  // save current).
  let toWrite = entries;
  for (let attempt = 0; attempt < 8 && toWrite.length > 0; attempt++) {
    const serialized = JSON.stringify(toWrite);
    if (serialized.length > MAX_BYTES) {
      toWrite = toWrite.slice(0, Math.max(1, Math.floor(toWrite.length * 0.9)));
      continue;
    }
    try {
      localStorage.setItem(STORE_KEY, serialized);
      return;
    } catch {
      // Браузер сказал "no" (QuotaExceeded или disabled). Срезаем 10%
      // и пробуем снова. После 8 попыток ≈ -57% размера; этого должно
      // хватить чтобы fit'нуться в любой реалистичный budget.
      toWrite = toWrite.slice(0, Math.max(1, Math.floor(toWrite.length * 0.9)));
    }
  }
}

function buildConversationMemory(args: {
  model: string;
  messages: UIMessage[];
  now: string;
}): ConversationMemory {
  const turns: ConversationMemory['turns'] = [];
  for (let i = 0; i < args.messages.length; i++) {
    const m = args.messages[i];
    if (m.role !== 'user') continue;
    const answer = args.messages.slice(i + 1).find((x) => x.role === 'assistant')?.content ?? '';
    turns.push({
      question: trimForMemory(m.content || (m.hasScreenshot ? '[screenshot question]' : ''), 800),
      answer: trimForMemory(answer, 1200),
      has_screenshot: m.hasScreenshot,
      timestamp: args.now,
      model: args.model,
    });
  }

  const text = turns.map((t) => `${t.question} ${t.answer}`).join(' ');
  const screenshotCount = turns.filter((t) => t.has_screenshot).length;
  return {
    turns,
    screenshot_summary: screenshotCount > 0
      ? `${screenshotCount} screenshot turn(s); raw image bytes are not stored.`
      : '',
    topics: inferTopics(text),
    outcome: inferOutcome(turns),
    rolling_summary: buildRollingSummary(turns),
    embeddings: buildLexicalEmbedding(text),
  };
}

function trimForMemory(s: string, max: number): string {
  const compact = s.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function inferTopics(text: string): string[] {
  const t = text.toLowerCase();
  const topics: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ['algorithms', /\b(algorithm|leetcode|complexity|binary search|tree|graph|array|dp|динамик|алгоритм|сложност)\b/i],
    ['system design', /\b(system design|architecture|scale|distributed|cache|queue|kafka|redis|database|архитект|масштаб)\b/i],
    ['behavioral', /\b(behavioral|tell me about|conflict|leadership|ownership|feedback|команд|конфликт|расскаж)\b/i],
    ['frontend', /\b(react|css|frontend|browser|dom|typescript|ui|верстк|фронтенд)\b/i],
    ['backend', /\b(api|backend|go|golang|postgres|sql|grpc|http|server|бэкенд)\b/i],
  ];
  for (const [name, re] of checks) {
    if (re.test(t)) topics.push(name);
  }
  return topics.length > 0 ? topics : ['general'];
}

function inferOutcome(turns: ConversationMemory['turns']): ConversationMemory['outcome'] {
  if (turns.length === 0) return 'skipped';
  const answered = turns.filter((t) => t.answer.trim().length >= 120).length;
  if (answered === turns.length) return 'answered';
  if (answered > 0) return 'weak';
  return 'unclear';
}

function buildRollingSummary(turns: ConversationMemory['turns']): string {
  if (turns.length === 0) return '';
  const recent = turns.slice(-6).map((t) => {
    const q = trimForMemory(t.question, 140);
    const a = trimForMemory(t.answer, 180);
    return `Q: ${q} A: ${a}`;
  });
  return recent.join(' ');
}

function buildLexicalEmbedding(text: string): ConversationMemory['embeddings'] {
  // Bilingual stop-word list used for lexical embedding — these are data,
  // not user-facing UI strings (they never reach the renderer).
  /* eslint-disable d9-i18n/no-cyrillic-literals */
  const stop = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'you', 'are', 'как', 'что', 'это',
    'для', 'или', 'при', 'про', 'мне', 'тебе', 'если', 'then', 'than',
  ]);
  /* eslint-enable d9-i18n/no-cyrillic-literals */
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-zа-я0-9_+#-]{3,}/gi) ?? []) {
    const term = raw.slice(0, 40);
    if (stop.has(term)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 64)
    .map(([term, weight]) => ({ term, weight }));
}

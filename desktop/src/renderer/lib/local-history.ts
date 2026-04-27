import type { Conversation, ConversationMemory, Message } from '@shared/types';
import type { UIMessage } from '../stores/conversation';

const STORE_KEY = 'cue.localHistory.v1';
const RETENTION_KEY = 'cue.localHistory.retentionDays';
const DEFAULT_RETENTION_DAYS = 30;

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
  return readEntries().find((e) => e.conversation.id === id) ?? null;
}

export function deleteLocalConversation(id: string): void {
  writeEntries(readEntries().filter((e) => e.conversation.id !== id));
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
  const firstUser = args.messages.find((m) => m.role === 'user');
  const title = (firstUser?.content || 'Диалог').trim().slice(0, 80) || 'Диалог';
  const messages: Message[] = args.messages
    .filter((m) => !m.pending)
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

  writeEntries([entry, ...entries].slice(0, 250));
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
  localStorage.setItem(STORE_KEY, JSON.stringify(entries));
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
  const stop = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'you', 'are', 'как', 'что', 'это',
    'для', 'или', 'при', 'про', 'мне', 'тебе', 'если', 'then', 'than',
  ]);
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

// export-markdown.ts — client-side formatter that turns the active
// conversation (zustand store) into a Markdown document suitable for
// pasting into Obsidian / Typora / Ghost / most markdown readers.
//
// Design decisions:
//
//   • Data-URI images, not MinIO URLs. We have no persistent upload
//     path for screenshots today — they're held in the conversation
//     store as data: URIs (see UIMessage.screenshotDataUrl). Inlining
//     works everywhere except Notion, which strips data URIs on paste.
//     Notion workflow: paste the text, then drag-attach screenshots
//     manually. A future "upload to MinIO + swap URLs" feature is the
//     cleaner long-term path; out of scope for the MVP.
//
//   • Code blocks: the LLM already returns fenced ```language blocks
//     in its markdown output. We pass them through unchanged — no
//     re-parsing.
//
//   • Timestamp header: first line has an ISO date + time so the
//     pasted note is self-describing. Pick Russian locale for the
//     readable part, ISO for the machine-sortable part.

import type { UIMessage } from '../stores/conversation';

export interface ExportOptions {
  /** Used in the header "Druz9 Copilot · сессия от <when>". Pass the
   *  conversation title when available for context; defaults to a
   *  formatted timestamp. */
  title?: string;
  /** Model id that served the last turn. Shown in the header for
   *  auditing ("answered by groq/llama-3.3-70b"). */
  modelLabel?: string;
}

/**
 * Renders the conversation as a single Markdown string.
 *
 * Output shape:
 *
 *   # Druz9 Copilot · сессия 24 апр 2026, 15:42
 *   _Модель: groq/llama-3.3-70b · 3 turn_
 *
 *   ---
 *
 *   **🧑 Вы:** What is this code doing?
 *
 *   ![screenshot](data:image/png;base64,…)
 *
 *   **🤖 Assistant:** Это SQL-запрос, который…
 *
 *   ```sql
 *   SELECT …
 *   ```
 *
 *   ---
 *
 *   **🧑 Вы:** …
 */
export function exportConversationAsMarkdown(
  messages: UIMessage[],
  opts: ExportOptions = {},
): string {
  const now = new Date();
  const dateHuman = now.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines: string[] = [];
  lines.push(`# ${opts.title ?? `Druz9 Copilot · сессия ${dateHuman}`}`);
  const metaParts: string[] = [];
  if (opts.modelLabel) metaParts.push(`Модель: \`${opts.modelLabel}\``);
  metaParts.push(
    `${messages.filter((m) => m.role === 'user').length} turn${
      messages.filter((m) => m.role === 'user').length === 1 ? '' : ' (всего)'
    }`,
  );
  if (metaParts.length > 0) {
    lines.push(`_${metaParts.join(' · ')}_`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const m of messages) {
    // Error-only bubbles (pending=false + errorCode) still appear in
    // the chat UI; include them so the exported transcript is honest
    // about what the user actually saw.
    const role = m.role === 'user' ? '🧑 Вы' : '🤖 Assistant';
    lines.push(`**${role}:**`);
    lines.push('');

    if (m.screenshotDataUrl) {
      lines.push(`![screenshot](${m.screenshotDataUrl})`);
      lines.push('');
    }

    const content = (m.content ?? '').trim();
    if (content) {
      lines.push(content);
      lines.push('');
    } else if (m.role === 'assistant' && m.pending) {
      lines.push('_(стримится…)_');
      lines.push('');
    }

    if (m.errorCode) {
      lines.push(`> ⚠️ Ошибка ${m.errorCode}: ${m.errorMessage ?? ''}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Trailing separator is noise; drop the last one for cleaner output.
  while (lines[lines.length - 1] === '' || lines[lines.length - 1] === '---') {
    lines.pop();
  }

  return lines.join('\n');
}

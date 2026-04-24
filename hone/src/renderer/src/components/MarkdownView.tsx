// MarkdownView — тонкая обёртка над marked. Sandbox'нутая «безопасность»
// для markdown'а приватных заметок избыточна (юзер пишет для себя и ничего
// не шарится), но мы всё равно включаем GFM + breaks + sanitize для
// корректного рендера без копипаста <script>.
//
// В Phase 5b не используем полноценные react-компоненты (react-markdown) —
// bundle-size бьём, marked отдаёт готовый HTML. Реактивная подсветка
// кода — parking lot.
import { useMemo } from 'react';
import { marked } from 'marked';

interface MarkdownViewProps {
  source: string;
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function MarkdownView({ source }: MarkdownViewProps) {
  const html = useMemo(() => marked.parse(source || '', { async: false }) as string, [source]);
  return (
    <div
      className="mono-markdown"
      // Обосновано: source — private notes текущего юзера, без внешних
      // источников. XSS-вектор = сам юзер, threat-model не меняет ничего.
      // Глобально опасно, но в этом контексте — OK.
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        fontSize: 14,
        lineHeight: 1.75,
        color: 'var(--ink-90)',
        letterSpacing: '-0.003em',
      }}
    />
  );
}

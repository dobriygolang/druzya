// RequiresOnline — Phase 11b offline UI states (Sergey 2026-05-04).
//
// Heavy LLM calls (AI-mock CTA, AI-tutor chat, fork-analysis) — online-only
// с graceful state. Этот wrapper компонент disables children + shows
// tooltip «requires online» когда offline.
//
// Default rule: write-actions = outbox-able (см feedback_offline_rule.md).
// Read-only AI с TTL cache = «from yesterday» chip.
// Heavy LLM (no cache, latency-bound) = RequiresOnline wrapper.
import { useEffect, useState } from 'react';

interface Props {
  children: React.ReactNode;
  // tooltip — отображается при hover над disabled-state'ом. Default
  // «requires online» — для большинства cases подходит.
  tooltip?: string;
}

function getOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

export function RequiresOnline({ children, tooltip = 'requires online' }: Props) {
  const [online, setOnline] = useState<boolean>(getOnline());

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online) {
    return <>{children}</>;
  }
  return (
    <span
      title={tooltip}
      style={{
        opacity: 0.4,
        pointerEvents: 'none',
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  );
}

// useOnlineStatus — hook variant для conditional UI без wrapper'а.
// Используется когда нужен inline-render «cached · from yesterday» chip.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(getOnline());
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

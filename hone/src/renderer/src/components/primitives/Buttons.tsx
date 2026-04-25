// Buttons — реюзабельные кнопки для page-header'ов (BACK / INVITE /
// COPY URL / Open on web). Все ловят hover-эффекты + lift через единый
// motion-token. Используются в Editor RoomView, SharedBoards RoomView
// и любом другом collaboration-toolbar'е.
import type { ReactNode } from 'react';

export function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring mono row"
      style={{
        padding: '5px 10px',
        fontSize: 10,
        letterSpacing: '.12em',
        color: 'var(--ink-40)',
        borderRadius: 6,
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.06)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
        e.currentTarget.style.color = 'var(--ink)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ink-40)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
      }}
    >
      ← BACK
    </button>
  );
}

export function GhostBtn({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="focus-ring mono row"
      style={{
        padding: '6px 14px',
        fontSize: 10,
        letterSpacing: '.14em',
        color: active ? 'var(--ink)' : 'var(--ink-60)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 999,
        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? 'rgba(255,255,255,0.06)' : 'transparent';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
        e.currentTarget.style.color = active ? 'var(--ink)' : 'var(--ink-60)';
      }}
    >
      {children}
    </button>
  );
}

export function PrimaryBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="focus-ring lift surface"
      style={{
        padding: '6px 14px',
        fontSize: 12,
        borderRadius: 999,
        background: '#fff',
        color: '#000',
        fontWeight: 500,
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 4px 14px -6px rgba(255,255,255,0.18)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 8px 22px -6px rgba(255,255,255,0.28)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 14px -6px rgba(255,255,255,0.18)';
      }}
    >
      {children}
    </button>
  );
}

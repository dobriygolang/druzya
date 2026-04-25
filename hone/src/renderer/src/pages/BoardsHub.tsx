// BoardsHub — единая точка для двух collaboration-surfaces: Boards
// (multiplayer Excalidraw) и Code rooms (Editor + Yjs CodeMirror).
// Tabs наверху позволяют переключаться без потери App-state'а.
//
// initialRoomId автоматически определяет таб по типу комнаты:
//   - Editor → 'code'
//   - Whiteboard → 'boards'
// (если пользователь jump'ает из Events page или копирует ссылку).
import { useEffect, useState } from 'react';

import { EditorPage } from './Editor';
import { SharedBoardsPage } from './SharedBoards';

type Tab = 'boards' | 'code';

interface BoardsHubProps {
  initialBoardRoomId?: string | null;
  initialEditorRoomId?: string | null;
  onConsumeBoardInitial?: () => void;
  onConsumeEditorInitial?: () => void;
  initialTab?: Tab;
}

export function BoardsHub({
  initialBoardRoomId,
  initialEditorRoomId,
  onConsumeBoardInitial,
  onConsumeEditorInitial,
  initialTab,
}: BoardsHubProps) {
  // Если пришли с initialEditorRoomId — открываем code tab, иначе по
  // дефолту boards (multiplayer — primary product).
  const [tab, setTab] = useState<Tab>(
    initialTab ?? (initialEditorRoomId ? 'code' : 'boards'),
  );

  // Если App дал явный initial-room — переключаем tab при mount'е.
  useEffect(() => {
    if (initialEditorRoomId) setTab('code');
    else if (initialBoardRoomId) setTab('boards');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        animationDuration: '320ms',
      }}
    >
      <TabStrip tab={tab} onChange={setTab} />
      <div style={{ position: 'absolute', inset: 0, paddingTop: 76 }}>
        {tab === 'boards' ? (
          <SharedBoardsPage
            initialRoomId={initialBoardRoomId}
            onConsumeInitial={onConsumeBoardInitial}
          />
        ) : (
          <EditorPage
            initialRoomId={initialEditorRoomId}
            onConsumeInitial={onConsumeEditorInitial}
          />
        )}
      </div>
    </div>
  );
}

function TabStrip({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 76,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: 4,
          borderRadius: 999,
          background: 'rgba(10,10,10,0.78)',
          border: '1px solid rgba(255,255,255,0.07)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          pointerEvents: 'auto',
        }}
      >
        <Tab id="boards" current={tab} onClick={onChange} kbd="B">
          Boards
        </Tab>
        <Tab id="code" current={tab} onClick={onChange} kbd="E">
          Code rooms
        </Tab>
      </div>
    </div>
  );
}

function Tab({
  id,
  current,
  onClick,
  kbd,
  children,
}: {
  id: Tab;
  current: Tab;
  onClick: (t: Tab) => void;
  kbd: string;
  children: React.ReactNode;
}) {
  const active = id === current;
  return (
    <button
      onClick={() => onClick(id)}
      className="row focus-ring"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-60)',
        fontSize: 12.5,
        fontWeight: 500,
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {children}
      <span
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.04em',
          padding: '1px 5px',
          borderRadius: 4,
          background: 'rgba(255,255,255,0.04)',
          color: 'var(--ink-40)',
        }}
      >
        {kbd}
      </span>
    </button>
  );
}

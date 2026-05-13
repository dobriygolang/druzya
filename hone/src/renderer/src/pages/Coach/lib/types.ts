import type React from 'react';

export type Mode = 'explore' | 'commit' | 'deep';

export const MODES: { key: Mode; label: string }[] = [
  { key: 'explore', label: 'Explore' },
  { key: 'commit', label: 'Commit' },
  { key: 'deep', label: 'Deep' },
];

export function dimColor(opacity: number): React.CSSProperties {
  return { color: `rgba(255,255,255,${opacity})` };
}

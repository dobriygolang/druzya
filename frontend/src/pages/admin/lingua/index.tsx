// pages/admin/lingua/index.tsx — Lingua content CMS entry.
//
// Embedded inside AdminPage tab routing (sub-tab strip). Не использует
// react-router nested route — admin page sidebar держит tab state в
// useState, см. AdminPage.tsx. Сюда заходим когда tab === 'lingua'.
//
// Sub-tabs: reading / listening / speaking / writing. Local useState,
// нет URL-state — admin консольная зона, deep-link сюда не нужен.

import { useState } from 'react'

import { ReadingMaterialsPage } from './ReadingMaterialsPage'
import { ListeningTracksPage } from './ListeningTracksPage'
import { SpeakingExercisesPage } from './SpeakingExercisesPage'
import { WritingPromptsPage } from './WritingPromptsPage'

type SubTab = 'reading' | 'listening' | 'speaking' | 'writing'

const SUBS: { id: SubTab; label: string; hint: string }[] = [
  { id: 'reading', label: 'Reading', hint: 'Materials library' },
  { id: 'listening', label: 'Listening', hint: 'Audio + transcripts' },
  { id: 'speaking', label: 'Speaking', hint: 'Shadowing exercises' },
  { id: 'writing', label: 'Writing', hint: 'Prompts' },
]

export function LinguaAdminPage() {
  const [sub, setSub] = useState<SubTab>('reading')

  return (
    <section className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <header className="flex flex-col gap-1">
        <h3 className="font-display text-base font-bold text-text-primary">Lingua content management</h3>
        <p className="font-mono text-[11px] text-text-muted">
          Curated reading / listening / speaking / writing content для English track. Reuse'ит общие
          HoneService endpoints — admin scope.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface-1 p-1">
        {SUBS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSub(s.id)}
            aria-pressed={sub === s.id}
            className={`flex flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
              sub === s.id
                ? 'bg-text-primary/10 text-text-primary'
                : 'text-text-secondary hover:bg-surface-2'
            }`}
          >
            <span className="font-semibold">{s.label}</span>
            <span className="font-mono text-[10px] text-text-muted">{s.hint}</span>
          </button>
        ))}
      </nav>

      <div className="flex flex-1 flex-col">
        {sub === 'reading' && <ReadingMaterialsPage />}
        {sub === 'listening' && <ListeningTracksPage />}
        {sub === 'speaking' && <SpeakingExercisesPage />}
        {sub === 'writing' && <WritingPromptsPage />}
      </div>
    </section>
  )
}

export default LinguaAdminPage

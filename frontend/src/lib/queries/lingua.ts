// queries/lingua.ts — react-query hooks for /lingua (Phase K Wave 8).
//
// Reading + Writing + Listening + Speaking. Каждая mutation invalidate'ит
// соответствующие query keys так чтобы UI refresh'ился без лишнего refetch
// callsite-кода.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  addReadingMaterial,
  archiveReadingMaterial,
  addVocab,
  endReadingSession,
  getReadingMaterial,
  listReadingMaterials,
  listVocabBySourceMaterial,
  listVocabDue,
  reviewVocab,
  startReadingSession,
  type AddReadingMaterialArgs,
  type AddVocabArgs,
  type EndReadingSessionArgs,
  type ReadingMaterial,
  type VocabEntry,
} from '../../api/lingua/reading'
import { gradeEnglishWriting, type WritingFeedback } from '../../api/lingua/writing'
import {
  addListeningMaterial,
  archiveListeningMaterial,
  getListeningMaterial,
  ingestYouTubeListening,
  listListeningMaterials,
  type AddListeningMaterialArgs,
  type ListeningMaterial,
} from '../../api/lingua/listening'
import {
  gradeSpeaking,
  listSpeakingExercises,
  listSpeakingHistory,
  type GradeSpeakingArgs,
  type SpeakingExercise,
  type SpeakingGradeResult,
  type SpeakingLevel,
  type SpeakingSession,
} from '../../api/lingua/speaking'

// ── Query keys ────────────────────────────────────────────────────────────

export const linguaKeys = {
  readingMaterials: ['lingua', 'reading', 'materials'] as const,
  readingMaterial: (id: string) => ['lingua', 'reading', 'material', id] as const,
  vocabDue: ['lingua', 'vocab', 'due'] as const,
  vocabBySource: (materialId: string) => ['lingua', 'vocab', 'source', materialId] as const,
  listeningMaterials: ['lingua', 'listening', 'materials'] as const,
  listeningMaterial: (id: string) => ['lingua', 'listening', 'material', id] as const,
  speakingExercises: (level?: SpeakingLevel) => ['lingua', 'speaking', 'exercises', level ?? 'all'] as const,
  speakingHistory: ['lingua', 'speaking', 'history'] as const,
}

// ── Reading ───────────────────────────────────────────────────────────────

export function useReadingMaterialsQuery() {
  return useQuery<ReadingMaterial[]>({
    queryKey: linguaKeys.readingMaterials,
    queryFn: () => listReadingMaterials(),
    staleTime: 30_000,
  })
}

export function useReadingMaterialQuery(id: string | null) {
  return useQuery<ReadingMaterial>({
    queryKey: id ? linguaKeys.readingMaterial(id) : ['lingua', 'reading', 'material', 'none'],
    queryFn: () => getReadingMaterial(id ?? ''),
    enabled: typeof id === 'string' && id.length > 0,
    staleTime: 60_000,
  })
}

export function useAddReadingMaterialMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: AddReadingMaterialArgs) => addReadingMaterial(args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: linguaKeys.readingMaterials })
    },
  })
}

export function useArchiveReadingMaterialMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => archiveReadingMaterial(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: linguaKeys.readingMaterials })
    },
  })
}

export function useStartReadingSessionMutation() {
  return useMutation({
    mutationFn: (materialId: string) => startReadingSession(materialId),
  })
}

export function useEndReadingSessionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: EndReadingSessionArgs) => endReadingSession(args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: linguaKeys.readingMaterials })
    },
  })
}

// ── Vocab queue ───────────────────────────────────────────────────────────

export function useVocabDueQuery(enabled = true) {
  return useQuery<VocabEntry[]>({
    queryKey: linguaKeys.vocabDue,
    queryFn: () => listVocabDue(20),
    staleTime: 15_000,
    enabled,
  })
}

export function useVocabBySourceQuery(materialId: string | null) {
  return useQuery<VocabEntry[]>({
    queryKey: materialId ? linguaKeys.vocabBySource(materialId) : ['lingua', 'vocab', 'source', 'none'],
    queryFn: () => listVocabBySourceMaterial(materialId ?? ''),
    enabled: typeof materialId === 'string' && materialId.length > 0,
    staleTime: 30_000,
  })
}

export function useAddVocabMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: AddVocabArgs) => addVocab(args),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: linguaKeys.vocabDue })
      if (vars.sourceMaterial) {
        void qc.invalidateQueries({ queryKey: linguaKeys.vocabBySource(vars.sourceMaterial) })
      }
    },
  })
}

export function useReviewVocabMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { word: string; correct: boolean }) => reviewVocab(args.word, args.correct),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: linguaKeys.vocabDue })
    },
  })
}

// ── Writing ───────────────────────────────────────────────────────────────

export function useGradeWritingMutation() {
  return useMutation<WritingFeedback, Error, { text: string; title?: string }>({
    mutationFn: (args) => gradeEnglishWriting(args),
  })
}

// ── Listening ─────────────────────────────────────────────────────────────

export function useListeningMaterialsQuery() {
  return useQuery<ListeningMaterial[]>({
    queryKey: linguaKeys.listeningMaterials,
    queryFn: () => listListeningMaterials(),
    staleTime: 30_000,
  })
}

export function useListeningMaterialQuery(id: string | null) {
  return useQuery<ListeningMaterial>({
    queryKey: id ? linguaKeys.listeningMaterial(id) : ['lingua', 'listening', 'material', 'none'],
    queryFn: () => getListeningMaterial(id ?? ''),
    enabled: typeof id === 'string' && id.length > 0,
    staleTime: 60_000,
  })
}

export function useAddListeningMaterialMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: AddListeningMaterialArgs) => addListeningMaterial(args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: linguaKeys.listeningMaterials })
    },
  })
}

export function useIngestYouTubeListeningMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { url: string; languageHint?: string }) =>
      ingestYouTubeListening(args.url, args.languageHint ?? ''),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: linguaKeys.listeningMaterials })
    },
  })
}

export function useArchiveListeningMaterialMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => archiveListeningMaterial(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: linguaKeys.listeningMaterials })
    },
  })
}

// ── Speaking ──────────────────────────────────────────────────────────────

export function useSpeakingExercisesQuery(level?: SpeakingLevel) {
  return useQuery<SpeakingExercise[]>({
    queryKey: linguaKeys.speakingExercises(level),
    queryFn: () => listSpeakingExercises(level),
    staleTime: 60_000,
  })
}

export function useSpeakingHistoryQuery() {
  return useQuery<SpeakingSession[]>({
    queryKey: linguaKeys.speakingHistory,
    queryFn: () => listSpeakingHistory(14),
    staleTime: 15_000,
  })
}

export function useGradeSpeakingMutation() {
  const qc = useQueryClient()
  return useMutation<SpeakingGradeResult, Error, GradeSpeakingArgs>({
    mutationFn: (args) => gradeSpeaking(args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: linguaKeys.speakingHistory })
    },
  })
}

// ── Overview composite ────────────────────────────────────────────────────

/** Wraps the 3 queries the Overview hub renders. Components destructure the
 *  individual sub-queries rather than us blocking-await'ить всё в одном
 *  promise — partial render is OK. */
export function useLinguaOverviewQuery() {
  const reading = useReadingMaterialsQuery()
  const vocab = useVocabDueQuery()
  const speaking = useSpeakingHistoryQuery()
  return { reading, vocab, speaking }
}

// api/lingua/writing.ts — Writing AI grader client для web /lingua.
//
// Single endpoint: send a draft, get structured feedback. No persistence
// layer; web сохраняет draft локально только в component state.
import { api } from '../../lib/apiClient'

export type WritingIssueCategory = 'grammar' | 'vocab' | 'style' | 'clarity'

export interface WritingIssue {
  excerpt: string
  category: WritingIssueCategory
  suggestion: string
  explanation: string
}

export interface WritingFeedback {
  overallScore: number
  issues: WritingIssue[]
}

type WireIssue = {
  excerpt: string
  category: string
  suggestion: string
  explanation: string
}

type WireFeedback = {
  overall_score?: number
  overallScore?: number
  issues?: WireIssue[]
}

function normalizeCategory(c: string): WritingIssueCategory {
  switch (c) {
    case 'grammar':
    case 'vocab':
    case 'style':
    case 'clarity':
      return c
    default:
      return 'style'
  }
}

export async function gradeEnglishWriting(args: {
  text: string
  title?: string
}): Promise<WritingFeedback> {
  const resp = await api<WireFeedback>(`/hone/writing/grade`, {
    method: 'POST',
    body: JSON.stringify({ text: args.text, title: args.title ?? '' }),
  })
  return {
    overallScore: resp.overall_score ?? resp.overallScore ?? 0,
    issues: (resp.issues ?? []).map((i) => ({
      excerpt: i.excerpt,
      category: normalizeCategory(i.category),
      suggestion: i.suggestion,
      explanation: i.explanation,
    })),
  }
}

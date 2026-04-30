// api/writing.ts — Wave 4.4 Writing-as-Focus AI grader client.
// Single endpoint: send a draft, get structured feedback. No persistence
// layer; if the user wants to keep their text they save it as a Note.
import { createPromiseClient } from '@connectrpc/connect';
import { HoneService } from '@generated/pb/druz9/v1/hone_connect';

import { transport } from './transport';

export type WritingIssueCategory = 'grammar' | 'vocab' | 'style' | 'clarity';

export interface WritingIssue {
  excerpt: string;
  category: WritingIssueCategory;
  suggestion: string;
  explanation: string;
}

export interface WritingFeedback {
  overallScore: number; // 0..100
  issues: WritingIssue[];
}

const client = createPromiseClient(HoneService, transport);

function normalizeCategory(c: string): WritingIssueCategory {
  switch (c) {
    case 'grammar':
    case 'vocab':
    case 'style':
    case 'clarity':
      return c;
    default:
      return 'style';
  }
}

export async function gradeEnglishWriting(args: {
  text: string;
  title?: string;
}): Promise<WritingFeedback> {
  const resp = await client.gradeEnglishWriting({
    text: args.text,
    title: args.title ?? '',
  });
  return {
    overallScore: resp.overallScore,
    issues: resp.issues.map((i) => ({
      excerpt: i.excerpt,
      category: normalizeCategory(i.category),
      suggestion: i.suggestion,
      explanation: i.explanation,
    })),
  };
}

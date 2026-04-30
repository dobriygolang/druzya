// api/codeReview.ts — Wave 3.6 Code-review-coaching API client.
// Same shape as api/writing.ts; one-shot grader, no persistence.
import { createPromiseClient } from '@connectrpc/connect';
import { HoneService } from '@generated/pb/druz9/v1/hone_connect';

import { transport } from './transport';

export type CodeReviewIssueCategory =
  | 'correctness'
  | 'completeness'
  | 'clarity'
  | 'tone';

export interface CodeReviewIssue {
  excerpt: string;
  category: CodeReviewIssueCategory;
  suggestion: string;
  explanation: string;
}

export interface CodeReviewFeedback {
  overallScore: number; // 0..100
  issues: CodeReviewIssue[];
}

const client = createPromiseClient(HoneService, transport);

function normalizeCategory(c: string): CodeReviewIssueCategory {
  switch (c) {
    case 'correctness':
    case 'completeness':
    case 'clarity':
    case 'tone':
      return c;
    default:
      return 'clarity';
  }
}

export async function gradeCodeReview(args: {
  prTitle?: string;
  diffMd: string;
  reviewMd: string;
}): Promise<CodeReviewFeedback> {
  const resp = await client.gradeCodeReview({
    prTitle: args.prTitle ?? '',
    diffMd: args.diffMd,
    reviewMd: args.reviewMd,
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

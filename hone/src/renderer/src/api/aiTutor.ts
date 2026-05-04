// api/aiTutor.ts — Hone-side wrapper для AITutorService Connect-RPC.
// Используется AICoachPill'ом в Reading-reader'е и в любых будущих
// inline contextual chat surface'ах.
import { createPromiseClient } from '@connectrpc/connect';
import { AITutorService } from '@generated/pb/druz9/v1/ai_tutor_connect';

import { transport } from './transport';

const client = createPromiseClient(AITutorService, transport);

export interface AdoptResult {
  threadId: string;
  personaSlug: string;
  personaDisplayName: string;
}

export async function adoptAITutor(personaSlug: string): Promise<AdoptResult> {
  const resp = await client.adopt({ personaSlug });
  return {
    threadId: resp.thread?.id ?? '',
    personaSlug: resp.persona?.slug ?? personaSlug,
    personaDisplayName: resp.persona?.displayName ?? '',
  };
}

export interface SendResult {
  assistantContent: string;
  compacted: boolean;
}

export async function sendAITutorMessage(args: {
  threadId: string;
  content: string;
  contextNote?: string;
}): Promise<SendResult> {
  const resp = await client.sendMessage({
    threadId: args.threadId,
    content: args.content,
    contextNote: args.contextNote ?? '',
  });
  return {
    assistantContent: resp.assistantEpisode?.content ?? '',
    compacted: resp.compacted,
  };
}

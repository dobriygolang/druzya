// api/curation.ts — Phase 3.5 personal resource library client.
//
// Wraps CurationService Connect-RPC: preview / add / hide / unhelpful /
// replace / reorder / apply-overrides / grade-reflection.
//
// Все methods требуют auth — `transport` middleware прикрепляет JWT.
import { createPromiseClient } from '@connectrpc/connect';
import { CurationService } from '@generated/pb/druz9/v1/curation_connect';
import {
  Resource as PBResource,
  ResourceTarget as PBTarget,
} from '@generated/pb/druz9/v1/curation_pb';

import { transport } from './transport';

const client = createPromiseClient(CurationService, transport);

// ─── Domain-shaped POJOs ────────────────────────────────────────────────────

export interface Resource {
  url: string;
  title: string;
  author: string;
  kind: string;
  minutes: number;
  level: string;
  priority: string;
  why: string;
  topicsCovered: string[];
  prereqs: string[];
  summary: string;
  depth: string;
  formatNotes: string;
  reflectionPrompt: string;
}

export interface Target {
  atlasNodeId: string;       // empty unless node-target
  stepTrackId?: string;      // empty unless step-target
  stepIndex?: number;        // valid only when stepTrackId present
}

export interface PreviewResult {
  preview: Resource;
  manual: boolean;
  fetchStrategy: string;
  fetchError: string;
}

export interface ReflectionGrade {
  qualityScore: number;
  extractedTopics: string[];
  confusionFlag: boolean;
}

// ─── conversions ────────────────────────────────────────────────────────────

function toPBResource(r: Resource): PBResource {
  return new PBResource({
    url: r.url,
    title: r.title,
    author: r.author,
    kind: r.kind,
    minutes: r.minutes,
    level: r.level,
    priority: r.priority,
    why: r.why,
    topicsCovered: r.topicsCovered,
    prereqs: r.prereqs,
    summary: r.summary,
    depth: r.depth,
    formatNotes: r.formatNotes,
    reflectionPrompt: r.reflectionPrompt,
  });
}

function fromPBResource(r: PBResource | undefined): Resource {
  if (!r) {
    return blankResource('');
  }
  return {
    url: r.url,
    title: r.title,
    author: r.author,
    kind: r.kind,
    minutes: r.minutes,
    level: r.level,
    priority: r.priority,
    why: r.why,
    topicsCovered: [...r.topicsCovered],
    prereqs: [...r.prereqs],
    summary: r.summary,
    depth: r.depth,
    formatNotes: r.formatNotes,
    reflectionPrompt: r.reflectionPrompt,
  };
}

function toPBTarget(t: Target): PBTarget {
  return new PBTarget({
    atlasNodeId: t.atlasNodeId ?? '',
    stepTrackId: t.stepTrackId ?? '',
    stepIndex: t.stepIndex ?? 0,
  });
}

export function blankResource(url: string): Resource {
  return {
    url,
    title: '',
    author: '',
    kind: 'article',
    minutes: 0,
    level: 'B',
    priority: 'supplement',
    why: '',
    topicsCovered: [],
    prereqs: [],
    summary: '',
    depth: '',
    formatNotes: '',
    reflectionPrompt: '',
  };
}

// ─── RPCs ──────────────────────────────────────────────────────────────────

export async function previewResource(url: string, allowedAtlasNodeIds: string[] = []): Promise<PreviewResult> {
  const resp = await client.previewResource({ url, allowedAtlasNodeIds });
  return {
    preview: fromPBResource(resp.preview),
    manual: resp.manual,
    fetchStrategy: resp.fetchStrategy,
    fetchError: resp.fetchError,
  };
}

export async function addResource(target: Target, resource: Resource): Promise<string> {
  const resp = await client.addResource({
    target: toPBTarget(target),
    resource: toPBResource(resource),
  });
  return resp.overrideId;
}

export async function hideResource(target: Target, url: string): Promise<void> {
  await client.hideResource({ target: toPBTarget(target), url });
}

export async function markUnhelpful(target: Target, url: string, reason: string): Promise<void> {
  await client.markUnhelpful({ target: toPBTarget(target), url, reason });
}

export async function replaceResource(
  target: Target,
  originalUrl: string,
  replacement: Resource,
  reason: string,
): Promise<void> {
  await client.replaceResource({
    target: toPBTarget(target),
    originalUrl,
    replacement: toPBResource(replacement),
    reason,
  });
}

export async function applyOverrides(target: Target, base: Resource[]): Promise<Resource[]> {
  const resp = await client.applyOverrides({
    target: toPBTarget(target),
    base: base.map(toPBResource),
  });
  return resp.resources.map((r) => fromPBResource(r));
}

export async function gradeReflection(input: {
  userResourceLogId: string;
  takeaways: string[];
  confusionText: string;
  expectedTopics: string[];
  allowedAtlasNodeIds: string[];
}): Promise<ReflectionGrade> {
  const resp = await client.gradeReflection({
    userResourceLogId: input.userResourceLogId,
    takeaways: input.takeaways,
    confusionText: input.confusionText,
    expectedTopics: input.expectedTopics,
    allowedAtlasNodeIds: input.allowedAtlasNodeIds,
  });
  return {
    qualityScore: resp.qualityScore,
    extractedTopics: [...resp.extractedTopics],
    confusionFlag: resp.confusionFlag,
  };
}

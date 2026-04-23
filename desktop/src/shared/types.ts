// Client-side mirror of the proto-derived domain types. We keep these
// hand-typed rather than importing the generated @bufbuild/protobuf classes
// because:
//  1. Generated classes carry proto internals the renderer doesn't need.
//  2. Fields are renamed to idiomatic camelCase without oneof ceremony.
//  3. Dates become strings so they survive IPC serialization unchanged.
//
// The main-process API client (see main/api/client.ts) converts proto ↔
// these shapes at the IPC boundary.

export type HotkeyAction =
  | 'screenshot_area'
  | 'screenshot_full'
  | 'voice_input'
  | 'toggle_window'
  | 'quick_prompt'
  | 'clear_conversation';

export interface HotkeyBinding {
  action: HotkeyAction;
  accelerator: string;
}

export type ModelSpeedClass = 'fast' | 'balanced' | 'reasoning' | '';

export interface ProviderModel {
  id: string;
  displayName: string;
  providerName: string;
  speedClass: ModelSpeedClass;
  supportsVision: boolean;
  supportsReasoning: boolean;
  typicalLatencyMs: number;
  contextWindowTokens: number;
  availableOnCurrentPlan: boolean;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
}

export interface PaywallCopy {
  planId: string;
  displayName: string;
  priceLabel: string;
  tagline: string;
  bullets: string[];
  ctaLabel: string;
}

export interface StealthCompatEntry {
  osVersionMin: string;
  osVersionMax: string;
  browserId: string;
  browserVersionMin: string;
  browserVersionMax: string;
  note: string;
}

export interface DesktopConfig {
  rev: number;
  models: ProviderModel[];
  defaultModelId: string;
  defaultHotkeys: HotkeyBinding[];
  flags: FeatureFlag[];
  paywall: PaywallCopy[];
  stealthWarnings: StealthCompatEntry[];
  updateFeedUrl: string;
  minClientVersion: string;
  analyticsPolicyKey: string;
}

export type SubscriptionPlan = 'free' | 'seeker' | 'ascendant' | '';

export interface Quota {
  plan: SubscriptionPlan;
  requestsUsed: number;
  requestsCap: number; // -1 means unlimited
  resetsAt: string; // ISO-8601
  modelsAllowed: string[];
}

export type MessageRole = 'system' | 'user' | 'assistant' | '';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  hasScreenshot: boolean;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  rating: -1 | 0 | 1;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

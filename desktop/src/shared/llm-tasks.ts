// Task identifiers — mirror of backend's llmchain.Task enum.
// Kept in shared/ (not main/) because renderer needs them too (persona
// suggestedTask lookup). Values must match backend constants verbatim
// so persona-driven suggestions map correctly at dispatch time.
//
// Backend source: backend/shared/pkg/llmchain/provider.go · Task type.

export type Task = 'coder' | 'reasoning' | 'insight' | 'vision';

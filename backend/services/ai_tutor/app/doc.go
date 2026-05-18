// Package app houses AI-tutor use cases.
//
// SendMessage flow:
//  1. Load thread + verify ownership (student_id == requester)
//  2. IncrementCounters (atomic; ErrRateLimited if daily cap hit) +
//     Append user-episode in one DB transaction
//  3. Recall: persona prompt + facts + summary + recent episodes + snapshot
//  4. LLM call (TaskAITutorChat) with the assembled prompt
//  5. Append assistant-episode
//  6. Touch facts (last_used_at update)
//  7. Maybe-compact synchronously when thresholds are crossed.
package app

-- Queries consumed by sqlc; mirror hand-rolled pgx in infra/postgres.go.
-- Screenshot bytes are NEVER persisted — the `has_screenshot` flag on
-- copilot_messages is the only record of an image attachment.

-- =============================================================================
-- Conversations
-- =============================================================================

-- name: CreateCopilotConversation :one
INSERT INTO copilot_conversations (user_id, title, model)
VALUES ($1, $2, $3)
RETURNING id, user_id, title, model, created_at, updated_at;

-- name: GetCopilotConversation :one
SELECT id, user_id, title, model, created_at, updated_at, running_summary
  FROM copilot_conversations
 WHERE id = $1;

-- name: UpdateCopilotConversationRunningSummary :execrows
-- Вызывается фоновым compaction.Worker после успешной суммаризации старых
-- turns (см. backend/shared/pkg/compaction/worker.go). Пишется атомарно
-- поверх любого предыдущего значения — воркер сам решает, когда запускать.
UPDATE copilot_conversations
   SET running_summary = $2,
       updated_at      = now()
 WHERE id = $1;

-- name: UpdateCopilotConversationTitle :execrows
UPDATE copilot_conversations
   SET title      = $2,
       updated_at = now()
 WHERE id = $1;

-- name: TouchCopilotConversation :execrows
UPDATE copilot_conversations
   SET updated_at = now()
 WHERE id = $1;

-- name: DeleteCopilotConversation :execrows
DELETE FROM copilot_conversations
 WHERE id      = $1
   AND user_id = $2;

-- name: ListCopilotConversationsForUser :many
-- Keyset pagination by updated_at DESC, id DESC (stable order).
-- Passing zero-value cursor (cursor_updated_at = 'epoch', cursor_id = all-zeros
-- UUID) returns the newest page. The $4 epoch flag lets the caller request
-- "page 1" without synthesizing a bogus timestamp.
SELECT c.id, c.user_id, c.title, c.model, c.created_at, c.updated_at,
       COALESCE(m.msg_count, 0)::INT AS message_count
  FROM copilot_conversations c
  LEFT JOIN (
    SELECT conversation_id, COUNT(*) AS msg_count
      FROM copilot_messages
     GROUP BY conversation_id
  ) m ON m.conversation_id = c.id
 WHERE c.user_id = $1
   AND (
     sqlc.arg('is_first_page')::BOOLEAN
     OR (c.updated_at, c.id) < (sqlc.arg('cursor_updated_at')::TIMESTAMPTZ, sqlc.arg('cursor_id')::UUID)
   )
 ORDER BY c.updated_at DESC, c.id DESC
 LIMIT sqlc.arg('page_size')::INT;

-- =============================================================================
-- Messages
-- =============================================================================

-- name: InsertCopilotMessage :one
INSERT INTO copilot_messages (
    conversation_id, role, content, has_screenshot,
    tokens_in, tokens_out, latency_ms
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, conversation_id, role, content, has_screenshot,
          tokens_in, tokens_out, latency_ms, rating, created_at;

-- name: UpdateCopilotAssistantMessage :execrows
-- Called when the streaming completion finishes to commit the final assistant
-- text + token accounting onto the placeholder row created at stream start.
UPDATE copilot_messages
   SET content    = $2,
       tokens_in  = $3,
       tokens_out = $4,
       latency_ms = $5
 WHERE id   = $1
   AND role = 'assistant';

-- name: ListCopilotMessagesForConversation :many
SELECT id, conversation_id, role, content, has_screenshot,
       tokens_in, tokens_out, latency_ms, rating, created_at
  FROM copilot_messages
 WHERE conversation_id = $1
 ORDER BY created_at ASC, id ASC;

-- name: RateCopilotMessage :execrows
-- Updates the rating on an assistant message. user_id guard is enforced by
-- joining to the parent conversation — sqlc cannot express that in one query,
-- so the app layer calls GetCopilotMessageOwner first.
UPDATE copilot_messages
   SET rating = $2
 WHERE id   = $1
   AND role = 'assistant';

-- name: GetCopilotMessageOwner :one
-- Used by the app layer to enforce ownership before calling RateCopilotMessage.
-- Returns the user_id of the conversation that owns this message.
SELECT c.user_id
  FROM copilot_messages m
  JOIN copilot_conversations c ON c.id = m.conversation_id
 WHERE m.id = $1;

-- =============================================================================
-- Quotas
-- =============================================================================

-- name: GetCopilotQuota :one
SELECT user_id, plan, requests_used, requests_cap, resets_at, models_allowed,
       updated_at
  FROM copilot_quotas
 WHERE user_id = $1;

-- name: UpsertCopilotQuotaDefault :one
-- Lazily creates a free-tier quota row on first use. Idempotent: if a row
-- already exists, returns it unchanged.
INSERT INTO copilot_quotas (user_id)
VALUES ($1)
ON CONFLICT (user_id) DO UPDATE
   SET updated_at = copilot_quotas.updated_at
RETURNING user_id, plan, requests_used, requests_cap, resets_at, models_allowed,
          updated_at;

-- name: IncrementCopilotQuotaUsage :execrows
-- Called inside the Analyze / Chat transaction after a successful LLM call.
-- The app layer checks (requests_used < requests_cap OR requests_cap < 0)
-- before calling.
UPDATE copilot_quotas
   SET requests_used = requests_used + 1,
       updated_at    = now()
 WHERE user_id = $1;

-- name: ResetCopilotQuotaWindow :execrows
-- Called when `now() >= resets_at`. Resets the counter and shifts the window
-- forward by 24h (the window length is plan-agnostic for MVP).
UPDATE copilot_quotas
   SET requests_used = 0,
       resets_at     = now() + INTERVAL '1 day',
       updated_at    = now()
 WHERE user_id = $1;

-- =============================================================================
-- Sessions
-- =============================================================================

-- name: CreateCopilotSession :one
-- A user may have at most one live (finished_at IS NULL) session; the
-- unique partial index enforces this at the DB layer.
-- document_ids defaults to '{}'; Attach/Detach queries mutate in-place.
INSERT INTO copilot_sessions (user_id, kind)
VALUES ($1, $2)
RETURNING id, user_id, kind, started_at, finished_at, byok_only, document_ids;

-- name: GetCopilotSession :one
SELECT id, user_id, kind, started_at, finished_at, byok_only, document_ids
  FROM copilot_sessions
 WHERE id = $1;

-- name: GetLiveCopilotSession :one
-- Returns the user's currently-open session, if any. Used by the
-- Analyze use case to auto-attach turns AND to pull document_ids for
-- the RAG-context injection path.
SELECT id, user_id, kind, started_at, finished_at, byok_only, document_ids
  FROM copilot_sessions
 WHERE user_id = $1
   AND finished_at IS NULL;

-- name: AttachDocumentToSession :execrows
-- Idempotent: unnest+DISTINCT keeps the array set-like. Returns 0 rows
-- affected when (id, user_id) don't match — handler maps to 404 without
-- disclosing foreign session existence.
UPDATE copilot_sessions
   SET document_ids = ARRAY(
     SELECT DISTINCT x FROM unnest(array_append(document_ids, $3::UUID)) AS x
   )
 WHERE id = $1 AND user_id = $2;

-- name: DetachDocumentFromSession :execrows
-- array_remove is a no-op when the id isn't present, which matches the
-- idempotency we want on the Attach side.
UPDATE copilot_sessions
   SET document_ids = array_remove(document_ids, $3::UUID)
 WHERE id = $1 AND user_id = $2;

-- name: EndCopilotSession :execrows
UPDATE copilot_sessions
   SET finished_at = now()
 WHERE id = $1
   AND user_id = $2
   AND finished_at IS NULL;

-- name: MarkCopilotSessionByok :execrows
-- Called when any turn inside a session used BYOK. Once true, stays true.
UPDATE copilot_sessions
   SET byok_only = TRUE
 WHERE id = $1
   AND byok_only = FALSE;

-- name: ListCopilotSessionsForUser :many
-- Keyset pagination identical in shape to the conversation history query.
-- Filter by kind is optional: pass empty string to return all kinds.
SELECT s.id, s.user_id, s.kind, s.started_at, s.finished_at, s.byok_only, s.document_ids,
       COALESCE(c.conv_count, 0)::INT AS conversation_count
  FROM copilot_sessions s
  LEFT JOIN (
    SELECT session_id, COUNT(*) AS conv_count
      FROM copilot_conversations
     WHERE session_id IS NOT NULL
     GROUP BY session_id
  ) c ON c.session_id = s.id
 WHERE s.user_id = $1
   AND (sqlc.arg('kind_filter')::TEXT = '' OR s.kind = sqlc.arg('kind_filter')::TEXT)
   AND (
     sqlc.arg('is_first_page')::BOOLEAN
     OR (s.started_at, s.id) < (sqlc.arg('cursor_started_at')::TIMESTAMPTZ, sqlc.arg('cursor_id')::UUID)
   )
 ORDER BY s.started_at DESC, s.id DESC
 LIMIT sqlc.arg('page_size')::INT;

-- name: AttachConversationToSession :execrows
-- Called by Analyze when a live session exists — stamps session_id
-- onto the freshly created conversation.
UPDATE copilot_conversations
   SET session_id = $2
 WHERE id = $1
   AND session_id IS NULL;

-- name: ListConversationsInSession :many
-- Used by the analyzer to hydrate the session's full turn history.
SELECT id, user_id, title, model, created_at, updated_at
  FROM copilot_conversations
 WHERE session_id = $1
 ORDER BY created_at ASC, id ASC;

-- =============================================================================
-- Session reports
-- =============================================================================

-- name: InitCopilotSessionReport :one
-- Idempotent — on re-run (duplicate SessionEnded event) keeps the
-- existing row. Starting state is always 'pending'.
INSERT INTO copilot_session_reports (session_id, status)
VALUES ($1, 'pending')
ON CONFLICT (session_id) DO UPDATE
   SET updated_at = copilot_session_reports.updated_at
RETURNING session_id, status, overall_score, section_scores, weaknesses,
          recommendations, links, report_markdown, report_url,
          error_message, started_at, finished_at, updated_at,
          analysis, title;

-- name: GetCopilotSessionReport :one
SELECT session_id, status, overall_score, section_scores, weaknesses,
       recommendations, links, report_markdown, report_url,
       error_message, started_at, finished_at, updated_at,
       analysis, title
  FROM copilot_session_reports
 WHERE session_id = $1;

-- name: MarkCopilotSessionReportRunning :execrows
UPDATE copilot_session_reports
   SET status = 'running',
       started_at = now(),
       updated_at = now()
 WHERE session_id = $1
   AND status = 'pending';

-- name: WriteCopilotSessionReport :execrows
-- Commits a successful analysis. Status jumps to 'ready' regardless of
-- prior state — the analyzer owns the transition.
UPDATE copilot_session_reports
   SET status = 'ready',
       overall_score = $2,
       section_scores = $3,
       weaknesses = $4,
       recommendations = $5,
       links = $6,
       report_markdown = $7,
       report_url = $8,
       analysis = $9,
       title = $10,
       finished_at = now(),
       updated_at = now()
 WHERE session_id = $1;

-- name: FailCopilotSessionReport :execrows
UPDATE copilot_session_reports
   SET status = 'failed',
       error_message = $2,
       finished_at = now(),
       updated_at = now()
 WHERE session_id = $1;

-- name: UpdateCopilotQuotaPlan :execrows
-- Called by the billing service (or admin tool) when a user's subscription
-- changes. Caps and allowed models are plan-derived — callers pass the full
-- target state.
UPDATE copilot_quotas
   SET plan           = $2,
       requests_cap   = $3,
       models_allowed = $4,
       updated_at     = now()
 WHERE user_id = $1;

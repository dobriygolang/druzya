package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/mock_interview/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── mock_pipelines ──────────────────────────────────────────────────────

type Pipelines struct{ pool *pgxpool.Pool }

func NewPipelines(pool *pgxpool.Pool) *Pipelines { return &Pipelines{pool: pool} }

const pipelineCols = `id, user_id, company_id, ai_assist, current_stage_idx, verdict, total_score, started_at, finished_at`

func scanPipeline(row pgx.Row) (domain.MockPipeline, error) {
	var (
		id, userID      pgtype.UUID
		companyID       pgtype.UUID
		aiAssist        bool
		currentStageIdx int16
		verdict         string
		totalScore      pgtype.Float4
		startedAt       time.Time
		finishedAt      pgtype.Timestamptz
	)
	if err := row.Scan(&id, &userID, &companyID, &aiAssist, &currentStageIdx,
		&verdict, &totalScore, &startedAt, &finishedAt); err != nil {
		return domain.MockPipeline{}, fmt.Errorf("row.Scan pipelines: %w", err)
	}
	out := domain.MockPipeline{
		ID:              sharedpg.UUIDFrom(id),
		UserID:          sharedpg.UUIDFrom(userID),
		AIAssist:        aiAssist,
		CurrentStageIdx: int(currentStageIdx),
		Verdict:         domain.PipelineVerdict(verdict),
		StartedAt:       startedAt,
	}
	if companyID.Valid {
		v := sharedpg.UUIDFrom(companyID)
		out.CompanyID = &v
	}
	if totalScore.Valid {
		v := totalScore.Float32
		out.TotalScore = &v
	}
	if finishedAt.Valid {
		v := finishedAt.Time
		out.FinishedAt = &v
	}
	return out, nil
}

func (r *Pipelines) Create(ctx context.Context, p domain.MockPipeline) (domain.MockPipeline, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO mock_pipelines (id, user_id, company_id, ai_assist, current_stage_idx, verdict, started_at)
		VALUES ($1,$2,$3,$4,$5,$6, COALESCE(NULLIF($7, '0001-01-01 00:00:00+00'::timestamptz), now()))
		RETURNING `+pipelineCols,
		sharedpg.UUID(p.ID), sharedpg.UUID(p.UserID), nullableUUID(p.CompanyID),
		p.AIAssist, p.CurrentStageIdx, string(p.Verdict),
		pgtype.Timestamptz{Time: p.StartedAt, Valid: !p.StartedAt.IsZero()})
	out, err := scanPipeline(row)
	if err != nil {
		return domain.MockPipeline{}, fmt.Errorf("mock_interview.Pipelines.Create: %w", err)
	}
	return out, nil
}

func (r *Pipelines) Get(ctx context.Context, id uuid.UUID) (domain.MockPipeline, error) {
	out, err := scanPipeline(r.pool.QueryRow(ctx,
		`SELECT `+pipelineCols+` FROM mock_pipelines WHERE id=$1`, sharedpg.UUID(id)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MockPipeline{}, domain.ErrNotFound
		}
		return domain.MockPipeline{}, fmt.Errorf("mock_interview.Pipelines.Get: %w", err)
	}
	return out, nil
}

func (r *Pipelines) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.MockPipeline, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+pipelineCols+` FROM mock_pipelines WHERE user_id=$1 ORDER BY started_at DESC LIMIT $2`,
		sharedpg.UUID(userID), limit)
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Pipelines.ListByUser: %w", err)
	}
	defer rows.Close()
	var out []domain.MockPipeline
	for rows.Next() {
		p, err := scanPipeline(rows)
		if err != nil {
			return nil, fmt.Errorf("mock_interview.Pipelines.ListByUser scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err pipelines.list_by_user: %w", err)
	}
	return out, nil
}

func (r *Pipelines) UpdateVerdict(ctx context.Context, id uuid.UUID, verdict domain.PipelineVerdict, totalScore *float32) error {
	var score pgtype.Float4
	if totalScore != nil {
		score = pgtype.Float4{Float32: *totalScore, Valid: true}
	}
	// Explicit ::mock_pipeline_verdict cast — pgx v5 sometimes infers $2 as
	// text from the IN-list context and the server then rejects the assign
	// to the enum column with "invalid input value", surfacing as 500.
	tag, err := r.pool.Exec(ctx, `
		UPDATE mock_pipelines SET verdict=$2::mock_pipeline_verdict, total_score=$3,
			finished_at = CASE WHEN $2 IN ('pass','fail','cancelled') THEN now() ELSE finished_at END
		WHERE id=$1`,
		sharedpg.UUID(id), string(verdict), score)
	if err != nil {
		return fmt.Errorf("mock_interview.Pipelines.UpdateVerdict: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// IncrementStageIdx atomically bumps current_stage_idx and RETURNs the new
// value. Used by the orchestrator after FinishStage.
func (r *Pipelines) IncrementStageIdx(ctx context.Context, id uuid.UUID) (int, error) {
	var newIdx int16
	err := r.pool.QueryRow(ctx, `
		UPDATE mock_pipelines SET current_stage_idx = current_stage_idx + 1
		WHERE id=$1 RETURNING current_stage_idx`, sharedpg.UUID(id)).Scan(&newIdx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, domain.ErrNotFound
		}
		return 0, fmt.Errorf("mock_interview.Pipelines.IncrementStageIdx: %w", err)
	}
	return int(newIdx), nil
}

var _ domain.PipelineRepo = (*Pipelines)(nil)

// ── pipeline_stages ─────────────────────────────────────────────────────

type PipelineStages struct{ pool *pgxpool.Pool }

func NewPipelineStages(pool *pgxpool.Pool) *PipelineStages { return &PipelineStages{pool: pool} }

const pipelineStageCols = `id, pipeline_id, stage_kind, ordinal, status, score, verdict,
	COALESCE(ai_feedback_md,''), ai_strictness_profile_id, started_at, finished_at`

func scanPipelineStage(row pgx.Row) (domain.PipelineStage, error) {
	var (
		id, pipelineID pgtype.UUID
		stageKind      string
		ordinal        int16
		status         string
		score          pgtype.Float4
		verdict        pgtype.Text
		feedback       string
		profID         pgtype.UUID
		startedAt      pgtype.Timestamptz
		finishedAt     pgtype.Timestamptz
	)
	if err := row.Scan(&id, &pipelineID, &stageKind, &ordinal, &status,
		&score, &verdict, &feedback, &profID, &startedAt, &finishedAt); err != nil {
		return domain.PipelineStage{}, fmt.Errorf("row.Scan pipeline_stages: %w", err)
	}
	out := domain.PipelineStage{
		ID:           sharedpg.UUIDFrom(id),
		PipelineID:   sharedpg.UUIDFrom(pipelineID),
		StageKind:    domain.StageKind(stageKind),
		Ordinal:      int(ordinal),
		Status:       domain.StageStatus(status),
		AIFeedbackMD: feedback,
	}
	if score.Valid {
		v := score.Float32
		out.Score = &v
	}
	if verdict.Valid {
		v := domain.StageVerdict(verdict.String)
		out.Verdict = &v
	}
	if profID.Valid {
		v := sharedpg.UUIDFrom(profID)
		out.AIStrictnessProfileID = &v
	}
	if startedAt.Valid {
		v := startedAt.Time
		out.StartedAt = &v
	}
	if finishedAt.Valid {
		v := finishedAt.Time
		out.FinishedAt = &v
	}
	return out, nil
}

func (r *PipelineStages) Create(ctx context.Context, s domain.PipelineStage) (domain.PipelineStage, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO pipeline_stages (id, pipeline_id, stage_kind, ordinal, status, ai_strictness_profile_id)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING `+pipelineStageCols,
		sharedpg.UUID(s.ID), sharedpg.UUID(s.PipelineID), string(s.StageKind),
		s.Ordinal, string(s.Status), nullableUUID(s.AIStrictnessProfileID))
	out, err := scanPipelineStage(row)
	if err != nil {
		return domain.PipelineStage{}, fmt.Errorf("mock_interview.PipelineStages.Create: %w", err)
	}
	return out, nil
}

func (r *PipelineStages) Get(ctx context.Context, id uuid.UUID) (domain.PipelineStage, error) {
	out, err := scanPipelineStage(r.pool.QueryRow(ctx,
		`SELECT `+pipelineStageCols+` FROM pipeline_stages WHERE id=$1`, sharedpg.UUID(id)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PipelineStage{}, domain.ErrNotFound
		}
		return domain.PipelineStage{}, fmt.Errorf("mock_interview.PipelineStages.Get: %w", err)
	}
	return out, nil
}

func (r *PipelineStages) ListByPipeline(ctx context.Context, pipelineID uuid.UUID) ([]domain.PipelineStage, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+pipelineStageCols+` FROM pipeline_stages WHERE pipeline_id=$1 ORDER BY ordinal ASC`,
		sharedpg.UUID(pipelineID))
	if err != nil {
		return nil, fmt.Errorf("mock_interview.PipelineStages.ListByPipeline: %w", err)
	}
	defer rows.Close()
	var out []domain.PipelineStage
	for rows.Next() {
		s, err := scanPipelineStage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err pipeline_stages.list: %w", err)
	}
	return out, nil
}

func (r *PipelineStages) UpdateStatus(ctx context.Context, id uuid.UUID, status domain.StageStatus) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE pipeline_stages SET status=$2,
			started_at = CASE WHEN $2='in_progress' AND started_at IS NULL THEN now() ELSE started_at END,
			finished_at = CASE WHEN $2 IN ('finished','skipped') THEN now() ELSE finished_at END
		 WHERE id=$1`,
		sharedpg.UUID(id), string(status))
	if err != nil {
		return fmt.Errorf("mock_interview.PipelineStages.UpdateStatus: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// UpdateStartStage flips status → in_progress, sets started_at if NULL, and
// snapshots ai_strictness_profile_id. Idempotent on repeat-call.
func (r *PipelineStages) UpdateStartStage(ctx context.Context, id uuid.UUID, profileID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE pipeline_stages SET
			status = CASE WHEN status='pending' THEN 'in_progress'::pipeline_stage_status ELSE status END,
			started_at = COALESCE(started_at, now()),
			ai_strictness_profile_id = COALESCE(ai_strictness_profile_id, $2)
		WHERE id=$1`,
		sharedpg.UUID(id), sharedpg.UUID(profileID))
	if err != nil {
		return fmt.Errorf("mock_interview.PipelineStages.UpdateStartStage: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// FinishStage writes score/verdict/feedback + flips status=finished.
func (r *PipelineStages) FinishStage(ctx context.Context, id uuid.UUID, score float32, verdict domain.StageVerdict, feedback string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE pipeline_stages SET
			status='finished'::pipeline_stage_status,
			score=$2,
			verdict=$3::pipeline_stage_verdict,
			ai_feedback_md = NULLIF($4, ''),
			finished_at = COALESCE(finished_at, now())
		WHERE id=$1`,
		sharedpg.UUID(id), pgtype.Float4{Float32: score, Valid: true},
		string(verdict), feedback)
	if err != nil {
		return fmt.Errorf("mock_interview.PipelineStages.FinishStage: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

var _ domain.PipelineStageRepo = (*PipelineStages)(nil)

// ── pipeline_attempts ───────────────────────────────────────────────────

type PipelineAttempts struct{ pool *pgxpool.Pool }

func NewPipelineAttempts(pool *pgxpool.Pool) *PipelineAttempts { return &PipelineAttempts{pool: pool} }

const attemptCols = `id, pipeline_stage_id, kind, task_id, task_question_id, default_question_id, company_question_id,
	COALESCE(user_answer_md,''), COALESCE(user_voice_url,''), COALESCE(user_excalidraw_image_url,''),
	user_excalidraw_scene_json, COALESCE(user_context_md,''), ai_score, ai_verdict, COALESCE(ai_feedback_md,''),
	ai_water_score, ai_missing_points, ai_judged_at, created_at`

func scanAttempt(row pgx.Row) (domain.PipelineAttempt, error) {
	var (
		id, pipelineStageID                                          pgtype.UUID
		kind                                                         string
		taskID, taskQID, defQID, coQID                               pgtype.UUID
		userAnswer, userVoice, userExcalidraw, userContext, feedback string
		sceneJSON                                                    []byte
		aiScore, aiWater                                             pgtype.Float4
		aiVerdict                                                    string
		missing                                                      []byte
		judgedAt                                                     pgtype.Timestamptz
		createdAt                                                    time.Time
	)
	if err := row.Scan(&id, &pipelineStageID, &kind, &taskID, &taskQID, &defQID, &coQID,
		&userAnswer, &userVoice, &userExcalidraw, &sceneJSON, &userContext, &aiScore, &aiVerdict,
		&feedback, &aiWater, &missing, &judgedAt, &createdAt); err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("row.Scan pipeline_attempts: %w", err)
	}
	missingList, err := scanStringList(missing)
	if err != nil {
		return domain.PipelineAttempt{}, err
	}
	out := domain.PipelineAttempt{
		ID:                      sharedpg.UUIDFrom(id),
		PipelineStageID:         sharedpg.UUIDFrom(pipelineStageID),
		Kind:                    domain.AttemptKind(kind),
		UserAnswerMD:            userAnswer,
		UserVoiceURL:            userVoice,
		UserExcalidrawImageURL:  userExcalidraw,
		UserExcalidrawSceneJSON: sceneJSON,
		UserContextMD:           userContext,
		AIVerdict:               domain.AttemptVerdict(aiVerdict),
		AIFeedbackMD:            feedback,
		AIMissingPoints:         missingList,
		CreatedAt:               createdAt,
	}
	if taskID.Valid {
		v := sharedpg.UUIDFrom(taskID)
		out.TaskID = &v
	}
	if taskQID.Valid {
		v := sharedpg.UUIDFrom(taskQID)
		out.TaskQuestionID = &v
	}
	if defQID.Valid {
		v := sharedpg.UUIDFrom(defQID)
		out.DefaultQuestionID = &v
	}
	if coQID.Valid {
		v := sharedpg.UUIDFrom(coQID)
		out.CompanyQuestionID = &v
	}
	if aiScore.Valid {
		v := aiScore.Float32
		out.AIScore = &v
	}
	if aiWater.Valid {
		v := aiWater.Float32
		out.AIWaterScore = &v
	}
	if judgedAt.Valid {
		v := judgedAt.Time
		out.AIJudgedAt = &v
	}
	return out, nil
}

func (r *PipelineAttempts) Create(ctx context.Context, a domain.PipelineAttempt) (domain.PipelineAttempt, error) {
	missing, err := marshalStringList(a.AIMissingPoints)
	if err != nil {
		return domain.PipelineAttempt{}, err
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO pipeline_attempts (id, pipeline_stage_id, kind, task_id, task_question_id,
			default_question_id, company_question_id, user_answer_md, user_voice_url,
			user_excalidraw_image_url, user_context_md, ai_verdict, ai_missing_points)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING `+attemptCols,
		sharedpg.UUID(a.ID), sharedpg.UUID(a.PipelineStageID), string(a.Kind),
		nullableUUID(a.TaskID), nullableUUID(a.TaskQuestionID),
		nullableUUID(a.DefaultQuestionID), nullableUUID(a.CompanyQuestionID),
		nullText(a.UserAnswerMD), nullText(a.UserVoiceURL),
		nullText(a.UserExcalidrawImageURL), nullText(a.UserContextMD),
		string(a.AIVerdict), missing)
	out, err := scanAttempt(row)
	if err != nil {
		return domain.PipelineAttempt{}, fmt.Errorf("mock_interview.PipelineAttempts.Create: %w", err)
	}
	return out, nil
}

func (r *PipelineAttempts) Get(ctx context.Context, id uuid.UUID) (domain.PipelineAttempt, error) {
	out, err := scanAttempt(r.pool.QueryRow(ctx,
		`SELECT `+attemptCols+` FROM pipeline_attempts WHERE id=$1`, sharedpg.UUID(id)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PipelineAttempt{}, domain.ErrNotFound
		}
		return domain.PipelineAttempt{}, fmt.Errorf("mock_interview.PipelineAttempts.Get: %w", err)
	}
	return out, nil
}

func (r *PipelineAttempts) ListByStage(ctx context.Context, pipelineStageID uuid.UUID) ([]domain.PipelineAttempt, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+attemptCols+` FROM pipeline_attempts WHERE pipeline_stage_id=$1 ORDER BY created_at ASC`,
		sharedpg.UUID(pipelineStageID))
	if err != nil {
		return nil, fmt.Errorf("mock_interview.PipelineAttempts.ListByStage: %w", err)
	}
	defer rows.Close()
	var out []domain.PipelineAttempt
	for rows.Next() {
		a, err := scanAttempt(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err pipeline_attempts.list: %w", err)
	}
	return out, nil
}

// nullText sends NULL for empty string, the value otherwise.
func nullText(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// UpdateJudgeResult writes the judge's score/verdict/feedback/missing onto
// an existing attempt row + sets ai_judged_at = now. Also persists the
// user_answer_md (the orchestrator passes it through atomically).
func (r *PipelineAttempts) UpdateJudgeResult(ctx context.Context, id uuid.UUID, userAnswerMD string,
	score float32, waterScore float32, verdict domain.AttemptVerdict,
	feedback string, missingPoints []string) error {
	missing, err := marshalStringList(missingPoints)
	if err != nil {
		return fmt.Errorf("mock_interview.PipelineAttempts.UpdateJudgeResult marshal: %w", err)
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE pipeline_attempts SET
			user_answer_md = NULLIF($2, ''),
			ai_score = $3,
			ai_water_score = $4,
			ai_verdict = $5::pipeline_attempt_verdict,
			ai_feedback_md = NULLIF($6, ''),
			ai_missing_points = $7,
			ai_judged_at = now()
		WHERE id=$1`,
		sharedpg.UUID(id), userAnswerMD,
		pgtype.Float4{Float32: score, Valid: true},
		pgtype.Float4{Float32: waterScore, Valid: true},
		string(verdict), feedback, missing)
	if err != nil {
		return fmt.Errorf("mock_interview.PipelineAttempts.UpdateJudgeResult: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// UpdateCanvasResult — F-3 v2 atomic writeback for sysdesign canvas
// attempts. Persists the Excalidraw scene blob + context + answer body and
// the judge's score/verdict/feedback/missing_points in a single UPDATE.
// ai_water_score is forced to 0 (not applicable to diagrams).
//
// scene_json is jsonb; an empty/nil byte slice means "no scene captured"
// and stays NULL. Callers who passed in legacy data URLs are no longer
// supported — only scene JSON.
func (r *PipelineAttempts) UpdateCanvasResult(ctx context.Context, id uuid.UUID, in domain.CanvasResultUpdate) error {
	missing, err := marshalStringList(in.MissingPoints)
	if err != nil {
		return fmt.Errorf("mock_interview.PipelineAttempts.UpdateCanvasResult marshal: %w", err)
	}
	var scene any
	if len(in.SceneJSON) > 0 {
		scene = in.SceneJSON
	} else {
		scene = nil
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE pipeline_attempts SET
			user_excalidraw_scene_json = $2::jsonb,
			user_context_md = NULLIF($3, ''),
			user_answer_md = NULLIF($4, ''),
			ai_score = $5,
			ai_water_score = 0,
			ai_verdict = $6::pipeline_attempt_verdict,
			ai_feedback_md = NULLIF($7, ''),
			ai_missing_points = $8,
			ai_judged_at = now()
		WHERE id=$1`,
		sharedpg.UUID(id), scene, in.ContextMD, in.UserAnswerMD,
		pgtype.Float4{Float32: in.Score, Valid: true},
		string(in.Verdict), in.Feedback, missing)
	if err != nil {
		return fmt.Errorf("mock_interview.PipelineAttempts.UpdateCanvasResult: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// GetWithQuestion returns attempt + question body / expected / criteria from
// whichever FK column is populated.
func (r *PipelineAttempts) GetWithQuestion(ctx context.Context, id uuid.UUID) (domain.AttemptWithQuestion, error) {
	att, err := r.Get(ctx, id)
	if err != nil {
		return domain.AttemptWithQuestion{}, err
	}
	out := domain.AttemptWithQuestion{Attempt: att}

	var (
		body, expected string
		rcRaw          []byte
		row            pgx.Row
	)
	switch {
	case att.DefaultQuestionID != nil:
		row = r.pool.QueryRow(ctx, `
			SELECT body, COALESCE(expected_answer_md,''), reference_criteria
			FROM stage_default_questions WHERE id=$1`, sharedpg.UUID(*att.DefaultQuestionID))
	case att.CompanyQuestionID != nil:
		row = r.pool.QueryRow(ctx, `
			SELECT body, COALESCE(expected_answer_md,''), reference_criteria
			FROM company_questions WHERE id=$1`, sharedpg.UUID(*att.CompanyQuestionID))
	case att.TaskQuestionID != nil:
		row = r.pool.QueryRow(ctx, `
			SELECT body, COALESCE(expected_answer_md,''), reference_criteria
			FROM task_questions WHERE id=$1`, sharedpg.UUID(*att.TaskQuestionID))
	case att.TaskID != nil:
		// Tasks: body_md serves as the question body, reference_solution_md
		// as the expected answer. Also pull functional_requirements_md +
		// language so the frontend can render the brief / pick the right
		// Monaco language without a second query.
		var (
			funcReq string
			lang    string
		)
		serr := r.pool.QueryRow(ctx, `
			SELECT body_md, COALESCE(reference_solution_md,''), reference_criteria,
				COALESCE(functional_requirements_md,''), language
			FROM mock_tasks WHERE id=$1`, sharedpg.UUID(*att.TaskID)).
			Scan(&body, &expected, &rcRaw, &funcReq, &lang)
		if serr != nil {
			if errors.Is(serr, pgx.ErrNoRows) {
				return domain.AttemptWithQuestion{}, domain.ErrNotFound
			}
			return domain.AttemptWithQuestion{}, fmt.Errorf("mock_interview.PipelineAttempts.GetWithQuestion scan: %w", serr)
		}
		rc, parseErr := scanReferenceCriteria(rcRaw)
		if parseErr != nil {
			return domain.AttemptWithQuestion{}, parseErr
		}
		out.QuestionBody = body
		out.ExpectedAnswerMD = expected
		out.ReferenceCriteria = rc
		out.TaskFunctionalRequirementsMD = funcReq
		out.TaskLanguage = lang
		return out, nil
	default:
		return domain.AttemptWithQuestion{}, fmt.Errorf("attempt has no question FK: %w", domain.ErrNotFound)
	}
	if serr := row.Scan(&body, &expected, &rcRaw); serr != nil {
		if errors.Is(serr, pgx.ErrNoRows) {
			return domain.AttemptWithQuestion{}, domain.ErrNotFound
		}
		return domain.AttemptWithQuestion{}, fmt.Errorf("mock_interview.PipelineAttempts.GetWithQuestion scan: %w", serr)
	}
	rc, err := scanReferenceCriteria(rcRaw)
	if err != nil {
		return domain.AttemptWithQuestion{}, err
	}
	out.QuestionBody = body
	out.ExpectedAnswerMD = expected
	out.ReferenceCriteria = rc
	return out, nil
}

var _ domain.PipelineAttemptRepo = (*PipelineAttempts)(nil)

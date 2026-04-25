package ports

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"druz9/mock_interview/app"
	"druz9/mock_interview/domain"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// errCanvasTooLarge — distinct sentinel so the handler can pick 413 vs 400.
var errCanvasTooLarge = errors.New("image_data_url payload exceeds 5MB")

// validateCanvasDataURL enforces the shape/size requirements documented for
// POST /mock/attempts/{id}/submit-canvas. Accepts only image/png and
// image/jpeg base64 data URLs and a 5MB decoded payload cap.
func validateCanvasDataURL(s string) error {
	const prefix = "data:"
	s = strings.TrimSpace(s)
	if s == "" {
		return errors.New("image_data_url empty")
	}
	if !strings.HasPrefix(s, prefix) {
		return errors.New("image_data_url must start with data:image/png;base64, or data:image/jpeg;base64,")
	}
	rest := s[len(prefix):]
	semi := strings.Index(rest, ";")
	if semi < 0 {
		return errors.New("image_data_url missing ;base64,")
	}
	mime := rest[:semi]
	if mime != "image/png" && mime != "image/jpeg" {
		return fmt.Errorf("image_data_url unsupported mime %q (allowed: image/png, image/jpeg)", mime)
	}
	rest = rest[semi+1:]
	if !strings.HasPrefix(rest, "base64,") {
		return errors.New("image_data_url not base64-encoded")
	}
	rest = rest[len("base64,"):]
	decoded, err := base64.StdEncoding.DecodeString(rest)
	if err != nil {
		return fmt.Errorf("image_data_url base64 decode: %w", err)
	}
	if len(decoded) > maxCanvasBase64Bytes {
		return errCanvasTooLarge
	}
	return nil
}

// Mount registers every route under the gated /api/v1 sub-router. Path
// prefixes:
//
//	/admin/mock/...   — admin role required
//	/mock/...         — any authenticated user
//
// Bearer-auth middleware is applied at the parent router; this Mount only
// adds requireAdmin where needed.
func (s *Server) Mount(r chi.Router) {
	// Admin: companies
	r.Get("/admin/mock/companies", s.adminListCompanies)
	r.Post("/admin/mock/companies", s.adminCreateCompany)
	r.Patch("/admin/mock/companies/{id}", s.adminUpdateCompany)
	r.Post("/admin/mock/companies/{id}/active", s.adminToggleCompanyActive)

	// Admin: strictness
	r.Get("/admin/mock/strictness", s.adminListStrictness)
	r.Post("/admin/mock/strictness", s.adminCreateStrictness)
	r.Patch("/admin/mock/strictness/{id}", s.adminUpdateStrictness)

	// Admin: tasks
	r.Get("/admin/mock/tasks", s.adminListTasks)
	r.Get("/admin/mock/tasks/{id}", s.adminGetTask)
	r.Post("/admin/mock/tasks", s.adminCreateTask)
	r.Patch("/admin/mock/tasks/{id}", s.adminUpdateTask)
	r.Post("/admin/mock/tasks/{id}/active", s.adminToggleTaskActive)

	// Admin: task questions
	r.Post("/admin/mock/tasks/{id}/questions", s.adminCreateTaskQuestion)
	r.Patch("/admin/mock/task-questions/{id}", s.adminUpdateTaskQuestion)
	r.Delete("/admin/mock/task-questions/{id}", s.adminDeleteTaskQuestion)

	// Admin: default questions
	r.Get("/admin/mock/default-questions", s.adminListDefaultQuestions)
	r.Post("/admin/mock/default-questions", s.adminCreateDefaultQuestion)
	r.Patch("/admin/mock/default-questions/{id}", s.adminUpdateDefaultQuestion)
	r.Delete("/admin/mock/default-questions/{id}", s.adminDeleteDefaultQuestion)

	// Admin: company questions
	r.Get("/admin/mock/companies/{id}/questions", s.adminListCompanyQuestions)
	r.Post("/admin/mock/companies/{id}/questions", s.adminCreateCompanyQuestion)
	r.Patch("/admin/mock/company-questions/{id}", s.adminUpdateCompanyQuestion)
	r.Delete("/admin/mock/company-questions/{id}", s.adminDeleteCompanyQuestion)

	// Admin: company stages
	r.Get("/admin/mock/companies/{id}/stages", s.adminGetCompanyStages)
	r.Put("/admin/mock/companies/{id}/stages", s.adminReplaceCompanyStages)

	// Public (any authed user): companies + pipelines
	r.Get("/mock/companies", s.publicListCompanies)
	r.Post("/mock/pipelines", s.publicCreatePipeline)
	r.Get("/mock/pipelines/{id}", s.publicGetPipeline)
	r.Get("/mock/pipelines", s.publicListPipelines)

	// Public Phase B orchestrator routes
	r.Post("/mock/pipelines/{id}/start-next-stage", s.publicStartNextStage)
	r.Post("/mock/pipelines/{id}/cancel", s.publicCancelPipeline)
	r.Post("/mock/attempts/{id}/submit", s.publicSubmitAnswer)
	r.Post("/mock/attempts/{id}/submit-canvas", s.publicSubmitCanvas)
	r.Post("/mock/stages/{id}/finish", s.publicFinishStage)

	// Public: leaderboard (fairness-watermarked: only ai_assist=false counted).
	r.Get("/mock/leaderboard", s.publicLeaderboard)
}

// ── helpers ─────────────────────────────────────────────────────────────

func parseUUIDParam(r *http.Request, key string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, key))
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("uuid.Parse url_param %s: %w", key, err)
	}
	return id, nil
}

func decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	return nil
}

// ── admin: companies ────────────────────────────────────────────────────

func (s *Server) adminListCompanies(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	onlyActive := r.URL.Query().Get("active") == "true"
	cs, err := s.H.ListCompanies(r.Context(), onlyActive)
	if err != nil {
		s.errToHTTP(w, r, err, "adminListCompanies")
		return
	}
	out := make([]companyDTO, 0, len(cs))
	for _, c := range cs {
		out = append(out, toCompanyDTO(c))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) adminCreateCompany(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	var in companyDTO
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	c := domain.Company{
		Slug: in.Slug, Name: in.Name, Difficulty: in.Difficulty,
		MinLevelRequired: in.MinLevelRequired, Sections: in.Sections,
		LogoURL: in.LogoURL, Description: in.Description,
		Active: in.Active, SortOrder: in.SortOrder,
	}
	out, err := s.H.CreateCompany(r.Context(), c)
	if err != nil {
		s.errToHTTP(w, r, err, "adminCreateCompany")
		return
	}
	writeJSON(w, http.StatusCreated, toCompanyDTO(out))
}

func (s *Server) adminUpdateCompany(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in companyDTO
	if decodeErr := decode(r, &in); decodeErr != nil {
		writeErr(w, http.StatusBadRequest, decodeErr.Error())
		return
	}
	c := domain.Company{
		ID: id, Slug: in.Slug, Name: in.Name, Difficulty: in.Difficulty,
		MinLevelRequired: in.MinLevelRequired, Sections: in.Sections,
		LogoURL: in.LogoURL, Description: in.Description,
		Active: in.Active, SortOrder: in.SortOrder,
	}
	out, err := s.H.UpdateCompany(r.Context(), c)
	if err != nil {
		s.errToHTTP(w, r, err, "adminUpdateCompany")
		return
	}
	writeJSON(w, http.StatusOK, toCompanyDTO(out))
}

func (s *Server) adminToggleCompanyActive(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in struct {
		Active bool `json:"active"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.H.SetCompanyActive(r.Context(), id, in.Active); err != nil {
		s.errToHTTP(w, r, err, "adminToggleCompanyActive")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ── admin: strictness ───────────────────────────────────────────────────

func (s *Server) adminListStrictness(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	onlyActive := r.URL.Query().Get("active") == "true"
	ps, err := s.H.ListStrictness(r.Context(), onlyActive)
	if err != nil {
		s.errToHTTP(w, r, err, "adminListStrictness")
		return
	}
	out := make([]strictnessDTO, 0, len(ps))
	for _, p := range ps {
		out = append(out, toStrictnessDTO(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) adminCreateStrictness(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	var in strictnessDTO
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	p := domain.AIStrictnessProfile{
		Slug: in.Slug, Name: in.Name,
		OffTopicPenalty: in.OffTopicPenalty, MustMentionPenalty: in.MustMentionPenalty,
		HallucinationPenalty: in.HallucinationPenalty, BiasTowardFail: in.BiasTowardFail,
		CustomPromptTemplate: in.CustomPromptTemplate, Active: in.Active,
	}
	out, err := s.H.CreateStrictness(r.Context(), p)
	if err != nil {
		s.errToHTTP(w, r, err, "adminCreateStrictness")
		return
	}
	writeJSON(w, http.StatusCreated, toStrictnessDTO(out))
}

func (s *Server) adminUpdateStrictness(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in strictnessDTO
	if decodeErr := decode(r, &in); decodeErr != nil {
		writeErr(w, http.StatusBadRequest, decodeErr.Error())
		return
	}
	p := domain.AIStrictnessProfile{
		ID: id, Slug: in.Slug, Name: in.Name,
		OffTopicPenalty: in.OffTopicPenalty, MustMentionPenalty: in.MustMentionPenalty,
		HallucinationPenalty: in.HallucinationPenalty, BiasTowardFail: in.BiasTowardFail,
		CustomPromptTemplate: in.CustomPromptTemplate, Active: in.Active,
	}
	out, err := s.H.UpdateStrictness(r.Context(), p)
	if err != nil {
		s.errToHTTP(w, r, err, "adminUpdateStrictness")
		return
	}
	writeJSON(w, http.StatusOK, toStrictnessDTO(out))
}

// ── admin: tasks ────────────────────────────────────────────────────────

func (s *Server) adminListTasks(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	q := r.URL.Query()
	f := domain.TaskFilter{
		StageKind:  domain.StageKind(q.Get("stage")),
		Language:   domain.TaskLanguage(q.Get("language")),
		OnlyActive: q.Get("active") == "true",
	}
	ts, err := s.H.ListTasks(r.Context(), f)
	if err != nil {
		s.errToHTTP(w, r, err, "adminListTasks")
		return
	}
	out := make([]taskDTO, 0, len(ts))
	for _, t := range ts {
		out = append(out, toTaskDTO(t))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) adminGetTask(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	tw, err := s.H.GetTaskWithQuestions(r.Context(), id)
	if err != nil {
		s.errToHTTP(w, r, err, "adminGetTask")
		return
	}
	qs := make([]taskQuestionDTO, 0, len(tw.Questions))
	for _, q := range tw.Questions {
		qs = append(qs, toTaskQuestionDTO(q))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"task":      toTaskDTO(tw.Task),
		"questions": qs,
	})
}

func taskFromDTO(in taskDTO, id uuid.UUID) (domain.MockTask, error) {
	t := domain.MockTask{
		ID:                       id,
		StageKind:                domain.StageKind(in.StageKind),
		Language:                 domain.TaskLanguage(in.Language),
		Difficulty:               in.Difficulty,
		Title:                    in.Title,
		BodyMD:                   in.BodyMD,
		SampleIOMD:               in.SampleIOMD,
		ReferenceCriteria:        fromRCDTO(in.ReferenceCriteria),
		ReferenceSolutionMD:      in.ReferenceSolutionMD,
		FunctionalRequirementsMD: in.FunctionalRequirementsMD,
		TimeLimitMin:             in.TimeLimitMin,
		Active:                   in.Active,
	}
	if in.AIStrictnessProfileID != nil && *in.AIStrictnessProfileID != "" {
		pid, err := uuid.Parse(*in.AIStrictnessProfileID)
		if err != nil {
			return domain.MockTask{}, fmt.Errorf("uuid.Parse ai_strictness_profile_id: %w", err)
		}
		t.AIStrictnessProfileID = &pid
	}
	return t, nil
}

func (s *Server) adminCreateTask(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	var in taskDTO
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	t, err := taskFromDTO(in, uuid.Nil)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := s.H.CreateTask(r.Context(), t)
	if err != nil {
		s.errToHTTP(w, r, err, "adminCreateTask")
		return
	}
	writeJSON(w, http.StatusCreated, toTaskDTO(out))
}

func (s *Server) adminUpdateTask(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in taskDTO
	if decodeErr := decode(r, &in); decodeErr != nil {
		writeErr(w, http.StatusBadRequest, decodeErr.Error())
		return
	}
	t, err := taskFromDTO(in, id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := s.H.UpdateTask(r.Context(), t)
	if err != nil {
		s.errToHTTP(w, r, err, "adminUpdateTask")
		return
	}
	writeJSON(w, http.StatusOK, toTaskDTO(out))
}

func (s *Server) adminToggleTaskActive(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in struct {
		Active bool `json:"active"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.H.SetTaskActive(r.Context(), id, in.Active); err != nil {
		s.errToHTTP(w, r, err, "adminToggleTaskActive")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ── admin: task questions ───────────────────────────────────────────────

func (s *Server) adminCreateTaskQuestion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	taskID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in taskQuestionDTO
	if decodeErr := decode(r, &in); decodeErr != nil {
		writeErr(w, http.StatusBadRequest, decodeErr.Error())
		return
	}
	q := domain.TaskQuestion{
		TaskID: taskID, Body: in.Body, ExpectedAnswerMD: in.ExpectedAnswerMD,
		ReferenceCriteria: fromRCDTO(in.ReferenceCriteria), SortOrder: in.SortOrder,
	}
	out, err := s.H.CreateTaskQuestion(r.Context(), q)
	if err != nil {
		s.errToHTTP(w, r, err, "adminCreateTaskQuestion")
		return
	}
	writeJSON(w, http.StatusCreated, toTaskQuestionDTO(out))
}

func (s *Server) adminUpdateTaskQuestion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in taskQuestionDTO
	if decodeErr := decode(r, &in); decodeErr != nil {
		writeErr(w, http.StatusBadRequest, decodeErr.Error())
		return
	}
	q := domain.TaskQuestion{
		ID: id, Body: in.Body, ExpectedAnswerMD: in.ExpectedAnswerMD,
		ReferenceCriteria: fromRCDTO(in.ReferenceCriteria), SortOrder: in.SortOrder,
	}
	out, err := s.H.UpdateTaskQuestion(r.Context(), q)
	if err != nil {
		s.errToHTTP(w, r, err, "adminUpdateTaskQuestion")
		return
	}
	writeJSON(w, http.StatusOK, toTaskQuestionDTO(out))
}

func (s *Server) adminDeleteTaskQuestion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := s.H.DeleteTaskQuestion(r.Context(), id); err != nil {
		s.errToHTTP(w, r, err, "adminDeleteTaskQuestion")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ── admin: default questions ────────────────────────────────────────────

func (s *Server) adminListDefaultQuestions(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	stage := domain.StageKind(r.URL.Query().Get("stage"))
	onlyActive := r.URL.Query().Get("active") == "true"
	out, err := s.H.ListDefaultQuestions(r.Context(), stage, onlyActive)
	if err != nil {
		s.errToHTTP(w, r, err, "adminListDefaultQuestions")
		return
	}
	dtos := make([]defaultQuestionDTO, 0, len(out))
	for _, q := range out {
		dtos = append(dtos, toDefaultQuestionDTO(q))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": dtos})
}

func (s *Server) adminCreateDefaultQuestion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	var in defaultQuestionDTO
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	q := domain.DefaultQuestion{
		StageKind: domain.StageKind(in.StageKind), Body: in.Body,
		ExpectedAnswerMD:  in.ExpectedAnswerMD,
		ReferenceCriteria: fromRCDTO(in.ReferenceCriteria),
		Active:            in.Active, SortOrder: in.SortOrder,
	}
	out, err := s.H.CreateDefaultQuestion(r.Context(), q)
	if err != nil {
		s.errToHTTP(w, r, err, "adminCreateDefaultQuestion")
		return
	}
	writeJSON(w, http.StatusCreated, toDefaultQuestionDTO(out))
}

func (s *Server) adminUpdateDefaultQuestion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in defaultQuestionDTO
	if decodeErr := decode(r, &in); decodeErr != nil {
		writeErr(w, http.StatusBadRequest, decodeErr.Error())
		return
	}
	q := domain.DefaultQuestion{
		ID: id, StageKind: domain.StageKind(in.StageKind), Body: in.Body,
		ExpectedAnswerMD:  in.ExpectedAnswerMD,
		ReferenceCriteria: fromRCDTO(in.ReferenceCriteria),
		Active:            in.Active, SortOrder: in.SortOrder,
	}
	out, err := s.H.UpdateDefaultQuestion(r.Context(), q)
	if err != nil {
		s.errToHTTP(w, r, err, "adminUpdateDefaultQuestion")
		return
	}
	writeJSON(w, http.StatusOK, toDefaultQuestionDTO(out))
}

func (s *Server) adminDeleteDefaultQuestion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := s.H.DeleteDefaultQuestion(r.Context(), id); err != nil {
		s.errToHTTP(w, r, err, "adminDeleteDefaultQuestion")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ── admin: company questions ────────────────────────────────────────────

func (s *Server) adminListCompanyQuestions(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	companyID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	stage := domain.StageKind(r.URL.Query().Get("stage"))
	out, err := s.H.ListCompanyQuestions(r.Context(), companyID, stage)
	if err != nil {
		s.errToHTTP(w, r, err, "adminListCompanyQuestions")
		return
	}
	dtos := make([]companyQuestionDTO, 0, len(out))
	for _, q := range out {
		dtos = append(dtos, toCompanyQuestionDTO(q))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": dtos})
}

func (s *Server) adminCreateCompanyQuestion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	companyID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in companyQuestionDTO
	if decodeErr := decode(r, &in); decodeErr != nil {
		writeErr(w, http.StatusBadRequest, decodeErr.Error())
		return
	}
	q := domain.CompanyQuestion{
		CompanyID: companyID, StageKind: domain.StageKind(in.StageKind),
		Body: in.Body, ExpectedAnswerMD: in.ExpectedAnswerMD,
		ReferenceCriteria: fromRCDTO(in.ReferenceCriteria),
		Active:            in.Active, SortOrder: in.SortOrder,
	}
	out, err := s.H.CreateCompanyQuestion(r.Context(), q)
	if err != nil {
		s.errToHTTP(w, r, err, "adminCreateCompanyQuestion")
		return
	}
	writeJSON(w, http.StatusCreated, toCompanyQuestionDTO(out))
}

func (s *Server) adminUpdateCompanyQuestion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in companyQuestionDTO
	if decodeErr := decode(r, &in); decodeErr != nil {
		writeErr(w, http.StatusBadRequest, decodeErr.Error())
		return
	}
	q := domain.CompanyQuestion{
		ID: id, StageKind: domain.StageKind(in.StageKind),
		Body: in.Body, ExpectedAnswerMD: in.ExpectedAnswerMD,
		ReferenceCriteria: fromRCDTO(in.ReferenceCriteria),
		Active:            in.Active, SortOrder: in.SortOrder,
	}
	out, err := s.H.UpdateCompanyQuestion(r.Context(), q)
	if err != nil {
		s.errToHTTP(w, r, err, "adminUpdateCompanyQuestion")
		return
	}
	writeJSON(w, http.StatusOK, toCompanyQuestionDTO(out))
}

func (s *Server) adminDeleteCompanyQuestion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := s.H.DeleteCompanyQuestion(r.Context(), id); err != nil {
		s.errToHTTP(w, r, err, "adminDeleteCompanyQuestion")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ── admin: company stages ───────────────────────────────────────────────

func (s *Server) adminGetCompanyStages(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	companyID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	stages, err := s.H.GetCompanyStages(r.Context(), companyID)
	if err != nil {
		s.errToHTTP(w, r, err, "adminGetCompanyStages")
		return
	}
	out := make([]companyStageDTO, 0, len(stages))
	for _, st := range stages {
		out = append(out, toCompanyStageDTO(st))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) adminReplaceCompanyStages(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	companyID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in struct {
		Items []companyStageDTO `json:"items"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	stages := make([]domain.CompanyStage, 0, len(in.Items))
	for _, d := range in.Items {
		st, err := fromCompanyStageDTO(companyID, d)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		stages = append(stages, st)
	}
	if err := s.H.ReplaceCompanyStages(r.Context(), companyID, stages); err != nil {
		s.errToHTTP(w, r, err, "adminReplaceCompanyStages")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ── public: companies + pipelines ───────────────────────────────────────

func (s *Server) publicListCompanies(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r); !ok {
		return
	}
	cs, err := s.H.ListCompanies(r.Context(), true) // active only
	if err != nil {
		s.errToHTTP(w, r, err, "publicListCompanies")
		return
	}
	out := make([]companyDTO, 0, len(cs))
	for _, c := range cs {
		out = append(out, toCompanyDTO(c))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) publicCreatePipeline(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var in struct {
		CompanyID string `json:"company_id"`
		AIAssist  bool   `json:"ai_assist"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var companyID *uuid.UUID
	if in.CompanyID != "" {
		cid, err := uuid.Parse(in.CompanyID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid company_id")
			return
		}
		companyID = &cid
	}
	out, err := s.H.CreatePipeline(r.Context(), uid, companyID, in.AIAssist)
	if err != nil {
		s.errToHTTP(w, r, err, "publicCreatePipeline")
		return
	}
	writeJSON(w, http.StatusCreated, toPipelineDTO(out))
}

func (s *Server) publicGetPipeline(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	// Phase B: if the orchestrator is wired, return the full
	// pipeline+stages+attempts view (joined with question bodies).
	if s.Orch != nil {
		full, ferr := s.Orch.GetPipelineFull(r.Context(), id)
		if ferr != nil {
			s.errToHTTP(w, r, ferr, "publicGetPipeline")
			return
		}
		if full.Pipeline.UserID != uid {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeJSON(w, http.StatusOK, toPipelineFullDTO(full))
		return
	}
	out, err := s.H.GetPipeline(r.Context(), id)
	if err != nil {
		s.errToHTTP(w, r, err, "publicGetPipeline")
		return
	}
	if out.Pipeline.UserID != uid {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, toPipelineDTO(out))
}

// ── Phase B orchestrator handlers ───────────────────────────────────────

// pipelineOwnerOnly fetches the pipeline and verifies the caller owns it.
// Returns (pipelineID, ok). Writes 401/403/404 on failure.
func (s *Server) requirePipelineOwner(w http.ResponseWriter, r *http.Request, pipelineID uuid.UUID, uid uuid.UUID) bool {
	p, err := s.H.Pipelines.Get(r.Context(), pipelineID)
	if err != nil {
		s.errToHTTP(w, r, err, "requirePipelineOwner")
		return false
	}
	if p.UserID != uid {
		// Hide existence (same as Get).
		writeErr(w, http.StatusNotFound, "not found")
		return false
	}
	return true
}

func (s *Server) publicStartNextStage(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "orchestrator not configured")
		return
	}
	pipelineID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !s.requirePipelineOwner(w, r, pipelineID, uid) {
		return
	}
	out, err := s.Orch.StartNextStage(r.Context(), pipelineID)
	if err != nil {
		s.errToHTTP(w, r, err, "publicStartNextStage")
		return
	}
	writeJSON(w, http.StatusOK, toStageWithAttemptsDTO(out))
}

func (s *Server) publicCancelPipeline(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "orchestrator not configured")
		return
	}
	pipelineID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := s.Orch.CancelPipeline(r.Context(), pipelineID, uid); err != nil {
		s.errToHTTP(w, r, err, "publicCancelPipeline")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) publicSubmitAnswer(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "orchestrator not configured")
		return
	}
	attemptID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in struct {
		UserAnswerMD string `json:"user_answer_md"`
	}
	if derr := decode(r, &in); derr != nil {
		writeErr(w, http.StatusBadRequest, derr.Error())
		return
	}

	// Walk: attempt → stage → pipeline → owner check.
	att, err := s.H.Attempts.Get(r.Context(), attemptID)
	if err != nil {
		s.errToHTTP(w, r, err, "publicSubmitAnswer attempt")
		return
	}
	stage, err := s.H.PipelineStages.Get(r.Context(), att.PipelineStageID)
	if err != nil {
		s.errToHTTP(w, r, err, "publicSubmitAnswer stage")
		return
	}
	if !s.requirePipelineOwner(w, r, stage.PipelineID, uid) {
		return
	}

	out, err := s.Orch.SubmitAnswer(r.Context(), attemptID, in.UserAnswerMD)
	if err != nil {
		s.errToHTTP(w, r, err, "publicSubmitAnswer")
		return
	}
	writeJSON(w, http.StatusOK, toPipelineAttemptDTO(out, "", "", nil))
}

// maxCanvasBase64Bytes — 5 MB cap on the decoded payload. base64 inflates
// roughly 4/3, so we check against the decoded length for a true byte cap.
const maxCanvasBase64Bytes = 5 * 1024 * 1024

func (s *Server) publicSubmitCanvas(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "orchestrator not configured")
		return
	}
	attemptID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in submitCanvasRequest
	if derr := decode(r, &in); derr != nil {
		writeErr(w, http.StatusBadRequest, derr.Error())
		return
	}
	// Validate data URL shape and size before pulling the LLM into the loop.
	if verr := validateCanvasDataURL(in.ImageDataURL); verr != nil {
		// 413 for size, 400 otherwise.
		if errors.Is(verr, errCanvasTooLarge) {
			writeErr(w, http.StatusRequestEntityTooLarge, verr.Error())
			return
		}
		writeErr(w, http.StatusBadRequest, verr.Error())
		return
	}

	// Walk: attempt → stage → pipeline → owner check (mirrors submit).
	att, err := s.H.Attempts.Get(r.Context(), attemptID)
	if err != nil {
		s.errToHTTP(w, r, err, "publicSubmitCanvas attempt")
		return
	}
	stage, err := s.H.PipelineStages.Get(r.Context(), att.PipelineStageID)
	if err != nil {
		s.errToHTTP(w, r, err, "publicSubmitCanvas stage")
		return
	}
	if !s.requirePipelineOwner(w, r, stage.PipelineID, uid) {
		return
	}

	out, err := s.Orch.SubmitCanvas(r.Context(), app.SubmitCanvasInput{
		AttemptID:       attemptID,
		UserID:          uid,
		ImageDataURL:    in.ImageDataURL,
		SceneJSON:       []byte(in.SceneJSON),
		ContextMD:       in.ContextMD,
		NonFunctionalMD: in.NonFunctionalMD,
	})
	if err != nil {
		s.errToHTTP(w, r, err, "publicSubmitCanvas")
		return
	}
	writeJSON(w, http.StatusOK, toPipelineAttemptDTO(out, "", "", nil))
}

func (s *Server) publicFinishStage(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "orchestrator not configured")
		return
	}
	stageID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	stage, err := s.H.PipelineStages.Get(r.Context(), stageID)
	if err != nil {
		s.errToHTTP(w, r, err, "publicFinishStage stage")
		return
	}
	if !s.requirePipelineOwner(w, r, stage.PipelineID, uid) {
		return
	}
	out, err := s.Orch.FinishStage(r.Context(), stageID)
	if err != nil {
		s.errToHTTP(w, r, err, "publicFinishStage")
		return
	}
	writeJSON(w, http.StatusOK, toPipelineStageDTO(out))
}

func (s *Server) publicListPipelines(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	ps, err := s.H.ListPipelinesByUser(r.Context(), uid, limit)
	if err != nil {
		s.errToHTTP(w, r, err, "publicListPipelines")
		return
	}
	out := make([]pipelineDTO, 0, len(ps))
	for _, p := range ps {
		out = append(out, toPipelineSummaryDTO(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

// publicLeaderboard — GET /mock/leaderboard?company_id=<uuid>&limit=<n>.
//
// Fairness watermark: only pipelines run with AI assist OFF are counted, so
// the leaderboard is a meaningful signal of unaided performance. The
// endpoint always returns the watermark flag in the envelope so the client
// can label the widget consistently.
func (s *Server) publicLeaderboard(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r); !ok {
		return
	}
	q := r.URL.Query()
	limit := 20
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	var companyID *uuid.UUID
	if v := q.Get("company_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "company_id: invalid uuid")
			return
		}
		companyID = &id
	}
	entries, err := s.H.GetLeaderboard(r.Context(), companyID, limit)
	if err != nil {
		s.errToHTTP(w, r, err, "publicLeaderboard")
		return
	}
	out := make([]leaderboardEntryDTO, 0, len(entries))
	for i, e := range entries {
		out = append(out, leaderboardEntryDTO{
			Rank:              i + 1,
			UserID:            e.UserID.String(),
			DisplayName:       e.DisplayName,
			AvatarURL:         e.AvatarURL,
			PipelinesFinished: e.PipelinesFinished,
			PipelinesPassed:   e.PipelinesPassed,
			AvgScore:          e.AvgScore,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":              out,
		"fairness_watermark": domain.FairnessAIAssistOffOnly,
	})
}

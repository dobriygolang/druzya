package services

import (
	"context"
	"time"

	aimockApp "druz9/ai_mock/app"
	aimockDomain "druz9/ai_mock/domain"
	aimockInfra "druz9/ai_mock/infra"
	aimockPorts "druz9/ai_mock/ports"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewAIMock wires the AI-mock-interview bounded context. The report worker
// is a 2-goroutine pool with a 64-deep buffer; we Start it under the root
// context and Close+Wait it during shutdown so in-flight reports finish.
//
// Sessions repo is wrapped with a Redis read-through cache: Get hits Redis
// first (60s TTL) and SendMessage / FinishSession bust the entry on write.
// The report cache is held inside CachedSessionRepo too — UpdateReport drops
// both the session and the report key in one shot.
func NewAIMock(d Deps) *Module {
	rawSessions := aimockInfra.NewSessions(d.Pool)
	var sessions aimockDomain.SessionRepo = rawSessions
	if d.Redis != nil {
		sessions = aimockInfra.NewCachedSessionRepo(
			rawSessions,
			aimockInfra.NewMockRedisKV(d.Redis),
			aimockInfra.DefaultSessionCacheTTL,
			d.Log,
		)
	}
	messages := aimockInfra.NewMessages(d.Pool)
	tasks := aimockInfra.NewTasks(d.Pool)
	companies := aimockInfra.NewCompanies(d.Pool)
	users := aimockInfra.NewUsers(d.Pool)
	llm := aimockInfra.NewOpenRouter(d.Cfg.LLM.OpenRouterAPIKey)

	// Use the real MinIO uploader iff the operator wired credentials in.
	// Empty creds (e.g. local dev without docker-compose minio) fall back
	// to the stub so the report worker still produces something useful.
	var replay aimockDomain.ReplayUploader
	if d.Cfg.MinIO.AccessKey != "" && d.Cfg.MinIO.SecretKey != "" && d.Cfg.MinIO.Endpoint != "" {
		replay = aimockInfra.NewMinIOReplayUploader(
			d.Cfg.MinIO.Endpoint,
			d.Cfg.MinIO.AccessKey,
			d.Cfg.MinIO.SecretKey,
			d.Cfg.MinIO.UseSSL,
		)
	} else {
		replay = aimockInfra.NewStubReplayUploader(d.Cfg.MinIO.Endpoint)
	}
	limiter := aimockInfra.NewRedisLimiter(d.Redis)
	hub := aimockPorts.NewHub(d.Log)

	reportWorker := aimockApp.NewReportWorker(2, 64, d.Log)
	reportWorker.Sessions = sessions
	reportWorker.Messages = messages
	reportWorker.Tasks = tasks
	reportWorker.LLM = llm
	reportWorker.Replay = replay

	createSession := &aimockApp.CreateSession{
		Sessions: sessions, Tasks: tasks, Users: users, Companies: companies,
		Bus:              d.Bus,
		DefaultModelFree: enums.LLMModel(d.Cfg.LLM.DefaultModelFree),
		DefaultModelPaid: enums.LLMModel(d.Cfg.LLM.DefaultModelPaid),
		Log:              d.Log, Now: d.Now,
	}
	getSession := &aimockApp.GetSession{
		Sessions: sessions, Messages: messages, Tasks: tasks,
		LastMessagesLimit: 20,
	}
	// Context-compaction worker для mock-сессий. См. аналог в copilot.go.
	// Worker может быть nil — тогда SendMessage обрезает prior до WindowSize
	// без фоновой суммаризации.
	summaryStore := aimockInfra.NewSessionSummaryStore(d.Pool)
	compactor, compactionCfg, cwErr := BuildCompactionWorker(d.LLMChain, summaryStore, d.Log)
	if cwErr != nil && d.Log != nil {
		d.Log.Info("ai_mock: compaction worker disabled", "reason", cwErr)
	}

	sendMessage := &aimockApp.SendMessage{
		Sessions: sessions, Messages: messages, Tasks: tasks,
		Users: users, Companies: companies,
		LLM: llm, Limiter: limiter, Log: d.Log, Now: d.Now,
		Compactor:     compactor,
		CompactionCfg: compactionCfg,
	}
	stress := &aimockApp.IngestStress{
		Sessions: sessions,
		Emit: func(sid uuid.UUID, c aimockDomain.StressCrossing) {
			hub.BroadcastStressUpdate(sid, c)
		},
	}
	finish := &aimockApp.FinishSession{
		Sessions: sessions, Bus: d.Bus, Worker: reportWorker, Log: d.Log, Now: d.Now,
	}
	report := &aimockApp.GetReport{Sessions: sessions}

	server := aimockPorts.NewMockServer(createSession, getSession, sendMessage, stress, finish, report, d.Log)
	ws := aimockPorts.NewWSHandler(hub, mockTokenVerifier{issuer: d.TokenIssuer}, sessions, messages, sendMessage, stress, d.Log)

	// Voice TTS handler. Uses the real Edge TTS WS proxy (10s timeout).
	// The tier/turn deps are nil for now — the handler treats nil tier as
	// "free" (premium voices return 402) and nil turn as "echo canned reply".
	tts := aimockInfra.NewEdgeTTSClient(10 * time.Second)
	voice := aimockPorts.NewVoiceHandler(tts, nil, nil, d.Log)

	connectPath, connectHandler := druz9v1connect.NewMockServiceHandler(server)
	transcoder := mustTranscode("mock", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/mock/session", transcoder.ServeHTTP)
			r.Get("/mock/session/{sessionId}", transcoder.ServeHTTP)
			r.Post("/mock/session/{sessionId}/message", transcoder.ServeHTTP)
			r.Post("/mock/session/{sessionId}/stress", transcoder.ServeHTTP)
			r.Post("/mock/session/{sessionId}/finish", transcoder.ServeHTTP)
			r.Get("/mock/session/{sessionId}/report", transcoder.ServeHTTP)
			// Voice (Edge TTS proxy + lightweight turn endpoint).
			r.Post("/voice/tts", voice.HandleTTS)
			r.Post("/voice/turn", voice.HandleTurn)
		},
		MountWS: func(ws_r chi.Router) {
			ws_r.Get("/mock/{sessionId}", ws.Handle)
		},
		Background: []func(ctx context.Context){
			func(ctx context.Context) { reportWorker.Start(ctx) },
			func(ctx context.Context) {
				if compactor != nil {
					compactor.Start(ctx)
				}
			},
		},
		Shutdown: []func(ctx context.Context) error{
			func(ctx context.Context) error {
				reportWorker.Close()
				reportWorker.Wait()
				return nil
			},
			func(context.Context) error {
				if compactor != nil {
					compactor.Shutdown()
				}
				return nil
			},
		},
	}
}

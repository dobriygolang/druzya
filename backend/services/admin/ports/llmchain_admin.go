// llmchain_admin.go — Connect-RPC adapter for the runtime LLM chain admin
// surface. Optimistic-locked update (`expected_version`) lives in the
// llmchain.ConfigSource; on success the wired Chain is force-reloaded so
// the new config takes effect on the next request, not the next ticker.
//
// proto3 forbids `map<K, map<K2, V>>`, so the Connect surface uses
// flattened `repeated *Entry` lists; this adapter rebuilds the nested
// runtime structure for the llmchain package.
package ports

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"connectrpc.com/connect"

	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/llmchain"
)

// ChainReloader — narrow port для admin handler'а: reload runtime config
// + ad-hoc test-call для UI sanity-кнопки. *llmchain.Chain удовлетворяет
// обоим методам.
type ChainReloader interface {
	RuntimeForceReload(ctx context.Context)
	TestProviderModel(ctx context.Context, provider llmchain.Provider, model, prompt string) (llmchain.Response, error)
}

type LLMChainAdminServer struct {
	Source llmchain.ConfigSource
	Chain  ChainReloader
	Log    *slog.Logger
}

var _ druz9v1connect.LLMChainAdminServiceHandler = (*LLMChainAdminServer)(nil)

func (s *LLMChainAdminServer) GetConfig(
	ctx context.Context,
	_ *connect.Request[pb.GetLLMChainConfigRequest],
) (*connect.Response[pb.LLMChainConfig], error) {
	cfg, err := s.Source.Load(ctx)
	if err != nil {
		s.logErr(ctx, "GetConfig.load", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("load failed"))
	}
	if cfg == nil {
		cfg = &llmchain.RuntimeConfig{}
	}
	out := configToProto(cfg)
	// Hardcoded defaults — read-only baseline for the frontend's "Override
	// missing → render defaults" branch.
	for virt, chain := range llmchain.DefaultVirtualChains() {
		for i, c := range chain {
			out.VirtualChainsDefaults = append(out.VirtualChainsDefaults, &pb.VirtualChainStep{
				VirtualName: virt,
				Order:       int32(i),
				Provider:    string(c.Provider),
				Model:       c.Model,
			})
		}
	}
	return connect.NewResponse(out), nil
}

// TestProviderModel — sanity-probe одной пары provider+model. Возвращает
// либо текст ответа, либо human-readable error. Не записывает в config.
//
// `ok=false` (не RPC error) для driver-ошибок — frontend отрисует
// сообщение красным под кнопкой и не делает retry-loop'а на сетевую
// ошибку. RPC error возвращаем только когда Chain не сконфигурён.
func (s *LLMChainAdminServer) TestProviderModel(
	ctx context.Context,
	req *connect.Request[pb.TestProviderModelRequest],
) (*connect.Response[pb.TestProviderModelResponse], error) {
	if s.Chain == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("LLM chain not configured on this monolith — set provider API keys"))
	}
	provider := strings.TrimSpace(req.Msg.GetProvider())
	model := strings.TrimSpace(req.Msg.GetModel())
	if provider == "" || model == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("provider and model required"))
	}
	// Cap user-supplied prompt — и без лимита driver всё равно ограничен
	// MaxTokens=64, но защита от случайного 100KB prompt'а из админки
	// (который может попасть в provider-side rate-limit'ы) — стоит копейку.
	prompt := req.Msg.GetPrompt()
	if len(prompt) > 4096 {
		prompt = prompt[:4096]
	}

	start := time.Now()
	resp, err := s.Chain.TestProviderModel(ctx, llmchain.Provider(provider), model, prompt)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return connect.NewResponse(&pb.TestProviderModelResponse{
			Ok:           false,
			ErrorMessage: err.Error(),
			LatencyMs:    latency,
		}), nil
	}
	return connect.NewResponse(&pb.TestProviderModelResponse{
		Ok:             true,
		Output:         resp.Content,
		LatencyMs:      latency,
		ActualProvider: string(resp.Provider),
		ActualModel:    resp.Model,
	}), nil
}

func (s *LLMChainAdminServer) UpdateConfig(
	ctx context.Context,
	req *connect.Request[pb.UpdateLLMChainConfigRequest],
) (*connect.Response[pb.LLMChainConfig], error) {
	if req.Msg.Config == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("config required"))
	}
	cfg := configFromProto(req.Msg.Config)
	if err := s.Source.Save(ctx, cfg, req.Msg.Config.Version); err != nil {
		if strings.Contains(err.Error(), "version conflict") {
			return nil, connect.NewError(connect.CodeAborted,
				errors.New("version conflict — reload current config and retry"))
		}
		s.logErr(ctx, "UpdateConfig.save", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("save failed"))
	}
	if s.Chain != nil {
		s.Chain.RuntimeForceReload(ctx)
	}
	fresh, lerr := s.Source.Load(ctx)
	if lerr != nil || fresh == nil {
		return connect.NewResponse(&pb.LLMChainConfig{Version: cfg.Version + 1}), nil
	}
	return connect.NewResponse(configToProto(fresh)), nil
}

func (s *LLMChainAdminServer) logErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "llmchain_admin."+where, slog.Any("err", err))
}

func configToProto(cfg *llmchain.RuntimeConfig) *pb.LLMChainConfig {
	out := &pb.LLMChainConfig{
		Version:    cfg.Version,
		ChainOrder: make([]string, 0, len(cfg.ChainOrder)),
		TaskMap:    make([]*pb.TaskModelEntry, 0, len(cfg.TaskMap)),
	}
	for _, p := range cfg.ChainOrder {
		out.ChainOrder = append(out.ChainOrder, string(p))
	}
	for task, inner := range cfg.TaskMap {
		for prov, model := range inner {
			out.TaskMap = append(out.TaskMap, &pb.TaskModelEntry{
				Task: string(task), Provider: string(prov), Model: model,
			})
		}
	}
	for virt, chain := range cfg.VirtualChains {
		for i, c := range chain {
			out.VirtualChains = append(out.VirtualChains, &pb.VirtualChainStep{
				VirtualName: virt,
				Order:       int32(i),
				Provider:    string(c.Provider),
				Model:       c.Model,
			})
		}
	}
	return out
}

func configFromProto(p *pb.LLMChainConfig) *llmchain.RuntimeConfig {
	cfg := &llmchain.RuntimeConfig{Version: p.Version}
	for _, prov := range p.ChainOrder {
		cfg.ChainOrder = append(cfg.ChainOrder, llmchain.Provider(prov))
	}
	if len(p.TaskMap) > 0 {
		cfg.TaskMap = make(llmchain.TaskModelMap)
		for _, e := range p.TaskMap {
			task := llmchain.Task(e.Task)
			if cfg.TaskMap[task] == nil {
				cfg.TaskMap[task] = make(map[llmchain.Provider]string)
			}
			cfg.TaskMap[task][llmchain.Provider(e.Provider)] = e.Model
		}
	}
	if len(p.VirtualChains) > 0 {
		cfg.VirtualChains = make(map[string][]llmchain.VirtualCandidate)
		// Group by virtual_name preserving the proto's repeated-list order
		// (Order field used as a tie-breaker only when the list is shuffled
		// over the wire — proto3 arrays preserve element order, but we play
		// safe).
		grouped := make(map[string][]*pb.VirtualChainStep, len(p.VirtualChains))
		for _, step := range p.VirtualChains {
			grouped[step.VirtualName] = append(grouped[step.VirtualName], step)
		}
		for name, steps := range grouped {
			out := make([]llmchain.VirtualCandidate, 0, len(steps))
			for _, step := range steps {
				out = append(out, llmchain.VirtualCandidate{
					Provider: llmchain.Provider(step.Provider),
					Model:    step.Model,
				})
			}
			cfg.VirtualChains[name] = out
		}
	}
	return cfg
}

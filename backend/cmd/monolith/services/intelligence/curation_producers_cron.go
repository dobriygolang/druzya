// curation_producers_cron.go — Phase 3.5d daily/weekly producer ticker.
//
// Wires 4 new producers (coverage / gap / redundancy / confusion) на
// background loop. Insights пишутся через intelligenceMod's existing
// InsightsRepo (через events emit hook). MVP: producers возвращают
// []domain.Insight, мы пишем их через SinkInsights helper.
//
// Daily tick: coverage / gap / confusion.
// Weekly tick: redundancy.
package intelligence

import (
	"context"
	"log/slog"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	"druz9/intelligence/app/producers"
	"druz9/intelligence/domain"
	intelInfra "druz9/intelligence/infra"

	"github.com/google/uuid"
)

// insightUpserter — narrow port over infra.InsightsPostgres.Upsert.
type insightUpserter interface {
	Upsert(ctx context.Context, in domain.Insight) (domain.Insight, error)
}

// NewCurationProducersCron — ticker module.
//
// Implementation note: insight emission per-user. Cron-tick читает signals
// per-user (group via reader's GROUP BY) и upsert'ит insights под anchor'ом
// чтобы повторные тики были idempotent.
func NewCurationProducersCron(d monolithServices.Deps, sink insightUpserter) *monolithServices.Module {
	if d.Pool == nil {
		d.Log.Warn("intelligence.curation_producers: pool nil — skip cron")
		return &monolithServices.Module{}
	}
	reader := intelInfra.NewCurationReader(d.Pool)

	return &monolithServices.Module{
		Background: []func(ctx context.Context){
			func(ctx context.Context) {
				// Bootstrap calls Background synchronously — spawn goroutine
				// иначе блокирует ListenAndServe.
				go func() {
					daily := time.NewTicker(24 * time.Hour)
					weekly := time.NewTicker(7 * 24 * time.Hour)
					defer daily.Stop()
					defer weekly.Stop()
					runDaily(ctx, reader, sink, d.Log)
					for {
						select {
						case <-ctx.Done():
							return
						case <-daily.C:
							runDaily(ctx, reader, sink, d.Log)
						case <-weekly.C:
							runWeekly(ctx, reader, sink, d.Log)
						}
					}
				}()
			},
		},
	}
}

func runDaily(ctx context.Context, reader *intelInfra.CurationReader, sink insightUpserter, log *slog.Logger) {
	now := time.Now().UTC()
	since := now.Add(-7 * 24 * time.Hour)

	// coverage_confirmation — emit confirmed-mastered insights.
	if events, err := reader.RecentCoverageEvents(ctx, since, 0.7); err == nil {
		insights := producers.FromCoverageConfirmation(events, now)
		// MVP: coverage events are not user-scoped в emit (anchor по
		// atlas_node) — выпускаем их как «system» через nil-uuid; sink
		// implementation решает скип/брoadcast. Учитывая что MVP InsightSink
		// не реализован user-broadcast'ом, log-only fallback.
		if log != nil {
			log.Info("intelligence.coverage_confirmation: tick", "events", len(events), "insights", len(insights))
		}
	} else if log != nil {
		log.Warn("intelligence.coverage_confirmation: read", "err", err)
	}

	// gap_detection — per-user.
	if gaps, err := reader.PrereqGaps(ctx, 30*24*time.Hour); err == nil {
		for _, g := range gaps {
			insights := producers.FromGapDetection(g, now)
			if uid, perr := uuid.Parse(g.UserID); perr == nil && sink != nil {
				for _, in := range insights {
					in.UserID = uid
					if _, err := sink.Upsert(ctx, in); err != nil && log != nil {
						log.Warn("intelligence.gap_detection upsert", "err", err)
					}
				}
			}
		}
		if log != nil {
			log.Info("intelligence.gap_detection: tick", "users", len(gaps))
		}
	} else if log != nil {
		log.Warn("intelligence.gap_detection: read", "err", err)
	}

	// confusion_pickup — per-user.
	if events, err := reader.RecentConfusionEvents(ctx, since); err == nil {
		// Group events by user_id чтобы emit per-user.
		byUser := make(map[string][]producers.ConfusionEvent)
		for _, e := range events {
			byUser[e.UserID] = append(byUser[e.UserID], e)
		}
		for userIDStr, list := range byUser {
			insights := producers.FromConfusionPickup(list, now)
			if uid, perr := uuid.Parse(userIDStr); perr == nil && sink != nil {
				for _, in := range insights {
					in.UserID = uid
					if _, err := sink.Upsert(ctx, in); err != nil && log != nil {
						log.Warn("intelligence.confusion_pickup upsert", "err", err)
					}
				}
			}
		}
		if log != nil {
			log.Info("intelligence.confusion_pickup: tick", "events", len(events), "users", len(byUser))
		}
	} else if log != nil {
		log.Warn("intelligence.confusion_pickup: read", "err", err)
	}
}

func runWeekly(ctx context.Context, reader *intelInfra.CurationReader, sink insightUpserter, log *slog.Logger) {
	now := time.Now().UTC()
	since := now.Add(-30 * 24 * time.Hour)
	if clusters, err := reader.HighQualityClustersByTopic(ctx, since); err == nil {
		insights := producers.FromRedundancySignal(clusters, now)
		// Anchor — global per-topic, не user-scoped. MVP log-only.
		if log != nil {
			log.Info("intelligence.redundancy_signal: tick", "clusters", len(clusters), "insights", len(insights))
		}
	} else if log != nil {
		log.Warn("intelligence.redundancy_signal: read", "err", err)
	}
}

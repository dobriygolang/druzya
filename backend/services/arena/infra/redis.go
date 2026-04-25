package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/arena/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Схема ключей (bible §3.4):
//   arena:queue:{section}:{mode}           ZSET   score=elo member="{user_id}|{enq_unix}"
//   arena:queue:user:{user_id}             HASH   карта в (section, mode, enqueued_at) — чтобы идемпотентно удалять
//   arena:lock:{user_id}                   STRING NX+EX 15s
//   arena:readycheck:{match_id}            HASH   users = <csv>, deadline = unix, confirmed:{uid} = "1"
//   arena:anticheat:score:{match_id}:{uid} STRING float
//   arena:anticheat:tabs:{match_id}:{uid}  STRING int

// Redis — Redis-адаптер для arena-домена. Один тип, чтобы вызывающим не
// приходилось жонглировать тремя маленькими структурами; интерфейсы всё
// равно разделены на границе domain.
type Redis struct {
	rdb *redis.Client
}

// NewRedis собирает Redis-адаптер.
func NewRedis(rdb *redis.Client) *Redis {
	return &Redis{rdb: rdb}
}

// ── QueueRepo ─────────────────────────────────────────────────────────────

func queueKey(section enums.Section, mode enums.ArenaMode) string {
	return fmt.Sprintf("arena:queue:%s:%s", section, mode)
}

func userIndexKey(userID uuid.UUID) string {
	return fmt.Sprintf("arena:queue:user:%s", userID)
}

// Enqueue кладёт тикет в очередь section+mode. Возвращает ErrAlreadyInQueue,
// если у пользователя уже есть запись.
func (r *Redis) Enqueue(ctx context.Context, t domain.QueueTicket) error {
	if !t.Section.IsValid() || !t.Mode.IsValid() {
		return fmt.Errorf("arena.redis.Enqueue: invalid section/mode")
	}
	idxKey := userIndexKey(t.UserID)
	exists, err := r.rdb.Exists(ctx, idxKey).Result()
	if err != nil {
		return fmt.Errorf("arena.redis.Enqueue: check: %w", err)
	}
	if exists > 0 {
		return domain.ErrAlreadyInQueue
	}
	member := fmt.Sprintf("%s|%d", t.UserID, t.EnqueuedAt.UTC().UnixNano())
	if err := r.rdb.ZAdd(ctx, queueKey(t.Section, t.Mode), redis.Z{
		Score:  float64(t.Elo),
		Member: member,
	}).Err(); err != nil {
		return fmt.Errorf("arena.redis.Enqueue: zadd: %w", err)
	}
	// Запоминаем (section, mode, member), чтобы Remove мог его найти.
	if err := r.rdb.HSet(ctx, idxKey, map[string]any{
		"section":  string(t.Section),
		"mode":     string(t.Mode),
		"member":   member,
		"elo":      t.Elo,
		"enqueued": t.EnqueuedAt.UTC().Format(time.RFC3339Nano),
	}).Err(); err != nil {
		return fmt.Errorf("arena.redis.Enqueue: hset: %w", err)
	}
	if err := r.rdb.Expire(ctx, idxKey, time.Hour).Err(); err != nil {
		return fmt.Errorf("arena.redis.Enqueue: expire: %w", err)
	}
	return nil
}

// Remove удаляет пользователя из очереди (идемпотентно).
func (r *Redis) Remove(ctx context.Context, userID uuid.UUID, section enums.Section, mode enums.ArenaMode) error {
	idxKey := userIndexKey(userID)
	idx, err := r.rdb.HGetAll(ctx, idxKey).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("arena.redis.Remove: idx: %w", err)
	}
	// Fallback на переданные section/mode, если индекс пуст (best-effort).
	secStr := idx["section"]
	modeStr := idx["mode"]
	member := idx["member"]
	if secStr == "" {
		secStr = string(section)
	}
	if modeStr == "" {
		modeStr = string(mode)
	}
	if member != "" {
		if err := r.rdb.ZRem(ctx, fmt.Sprintf("arena:queue:%s:%s", secStr, modeStr), member).Err(); err != nil {
			return fmt.Errorf("arena.redis.Remove: zrem: %w", err)
		}
	}
	if err := r.rdb.Del(ctx, idxKey).Err(); err != nil {
		return fmt.Errorf("arena.redis.Remove: del: %w", err)
	}
	return nil
}

// Snapshot возвращает все тикеты в (section, mode), отсортированные по ELO ASC.
func (r *Redis) Snapshot(ctx context.Context, section enums.Section, mode enums.ArenaMode) ([]domain.QueueTicket, error) {
	items, err := r.rdb.ZRangeWithScores(ctx, queueKey(section, mode), 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("arena.redis.Snapshot: %w", err)
	}
	out := make([]domain.QueueTicket, 0, len(items))
	for _, it := range items {
		member, _ := it.Member.(string)
		uidStr, tsStr, ok := strings.Cut(member, "|")
		if !ok {
			continue
		}
		uid, err := uuid.Parse(uidStr)
		if err != nil {
			continue
		}
		var enq time.Time
		if ns, err := parseInt64(tsStr); err == nil {
			enq = time.Unix(0, ns).UTC()
		}
		out = append(out, domain.QueueTicket{
			UserID:     uid,
			Section:    section,
			Mode:       mode,
			Elo:        int(it.Score),
			EnqueuedAt: enq,
		})
	}
	return out, nil
}

// Waiting возвращает длину очереди (section, mode) одним ZCard.
func (r *Redis) Waiting(ctx context.Context, section enums.Section, mode enums.ArenaMode) (int, error) {
	if !section.IsValid() || !mode.IsValid() {
		return 0, fmt.Errorf("arena.redis.Waiting: invalid section/mode")
	}
	n, err := r.rdb.ZCard(ctx, queueKey(section, mode)).Result()
	if err != nil {
		return 0, fmt.Errorf("arena.redis.Waiting: zcard: %w", err)
	}
	return int(n), nil
}

// AcquireLock пытается SETNX arena:lock:{user_id}.
func (r *Redis) AcquireLock(ctx context.Context, userID uuid.UUID, ttl time.Duration) (bool, error) {
	ok, err := r.rdb.SetNX(ctx, fmt.Sprintf("arena:lock:%s", userID), "1", ttl).Result()
	if err != nil {
		return false, fmt.Errorf("arena.redis.AcquireLock: %w", err)
	}
	return ok, nil
}

// ReleaseLock удаляет лок.
func (r *Redis) ReleaseLock(ctx context.Context, userID uuid.UUID) error {
	if err := r.rdb.Del(ctx, fmt.Sprintf("arena:lock:%s", userID)).Err(); err != nil {
		return fmt.Errorf("arena.redis.ReleaseLock: %w", err)
	}
	return nil
}

// Position возвращает 1-based позицию пользователя в очереди.
func (r *Redis) Position(ctx context.Context, userID uuid.UUID, section enums.Section, mode enums.ArenaMode) (int, error) {
	idxKey := userIndexKey(userID)
	member, err := r.rdb.HGet(ctx, idxKey, "member").Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return 0, nil
		}
		return 0, fmt.Errorf("arena.redis.Position: idx: %w", err)
	}
	rank, err := r.rdb.ZRank(ctx, queueKey(section, mode), member).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return 0, nil
		}
		return 0, fmt.Errorf("arena.redis.Position: zrank: %w", err)
	}
	return int(rank) + 1, nil
}

// ── ReadyCheckRepo ────────────────────────────────────────────────────────

func readyKey(matchID uuid.UUID) string { return fmt.Sprintf("arena:readycheck:%s", matchID) }

// Start фиксирует новый ready-check.
func (r *Redis) Start(ctx context.Context, matchID uuid.UUID, userIDs []uuid.UUID, deadline time.Time) error {
	ids := make([]string, 0, len(userIDs))
	for _, u := range userIDs {
		ids = append(ids, u.String())
	}
	raw, _ := json.Marshal(ids)
	ttl := time.Until(deadline) + 30*time.Second
	if ttl < time.Second {
		ttl = time.Minute
	}
	pipe := r.rdb.TxPipeline()
	pipe.HSet(ctx, readyKey(matchID), map[string]any{
		"users":    string(raw),
		"deadline": deadline.UTC().Unix(),
	})
	pipe.Expire(ctx, readyKey(matchID), ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("arena.redis.Start: %w", err)
	}
	return nil
}

// Confirm помечает пользователя готовым; возвращает everyone=true, когда подтвердился последний.
func (r *Redis) Confirm(ctx context.Context, matchID, userID uuid.UUID) (bool, error) {
	key := readyKey(matchID)
	state, ok, err := r.Get(ctx, matchID)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, fmt.Errorf("arena.redis.Confirm: %w", domain.ErrNotFound)
	}
	if _, hsErr := r.rdb.HSet(ctx, key, "confirmed:"+userID.String(), "1").Result(); hsErr != nil {
		return false, fmt.Errorf("arena.redis.Confirm: %w", hsErr)
	}
	// Обновляем snapshot — перечитываем подтверждения.
	state, _, err = r.Get(ctx, matchID)
	if err != nil {
		return false, err
	}
	for _, uid := range state.UserIDs {
		if !state.Confirmed[uid] {
			return false, nil
		}
	}
	return true, nil
}

// Get возвращает состояние ready-check.
func (r *Redis) Get(ctx context.Context, matchID uuid.UUID) (domain.ReadyCheckState, bool, error) {
	key := readyKey(matchID)
	raw, err := r.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return domain.ReadyCheckState{}, false, fmt.Errorf("arena.redis.Get: %w", err)
	}
	if len(raw) == 0 {
		return domain.ReadyCheckState{}, false, nil
	}
	var ids []string
	_ = json.Unmarshal([]byte(raw["users"]), &ids)
	state := domain.ReadyCheckState{
		MatchID:   matchID,
		Confirmed: make(map[uuid.UUID]bool, len(ids)),
	}
	for _, s := range ids {
		u, err := uuid.Parse(s)
		if err != nil {
			continue
		}
		state.UserIDs = append(state.UserIDs, u)
		if raw["confirmed:"+s] == "1" {
			state.Confirmed[u] = true
		}
	}
	if dl, err := parseInt64(raw["deadline"]); err == nil {
		state.Deadline = time.Unix(dl, 0).UTC()
	}
	return state, true, nil
}

// Clear удаляет запись ready-check.
func (r *Redis) Clear(ctx context.Context, matchID uuid.UUID) error {
	if err := r.rdb.Del(ctx, readyKey(matchID)).Err(); err != nil {
		return fmt.Errorf("arena.redis.Clear: %w", err)
	}
	return nil
}

// ── AnticheatRepo ─────────────────────────────────────────────────────────

func susKey(matchID, uid uuid.UUID) string {
	return fmt.Sprintf("arena:anticheat:score:%s:%s", matchID, uid)
}
func tabKey(matchID, uid uuid.UUID) string {
	return fmt.Sprintf("arena:anticheat:tabs:%s:%s", matchID, uid)
}

// AddSuspicion увеличивает score на delta и возвращает новое значение.
func (r *Redis) AddSuspicion(ctx context.Context, matchID, uid uuid.UUID, delta float64) (float64, error) {
	v, err := r.rdb.IncrByFloat(ctx, susKey(matchID, uid), delta).Result()
	if err != nil {
		return 0, fmt.Errorf("arena.redis.AddSuspicion: %w", err)
	}
	_ = r.rdb.Expire(ctx, susKey(matchID, uid), 2*time.Hour).Err()
	return v, nil
}

// GetSuspicion возвращает текущий score (0, если записи нет).
func (r *Redis) GetSuspicion(ctx context.Context, matchID, uid uuid.UUID) (float64, error) {
	raw, err := r.rdb.Get(ctx, susKey(matchID, uid)).Float64()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return 0, nil
		}
		return 0, fmt.Errorf("arena.redis.GetSuspicion: %w", err)
	}
	return raw, nil
}

// IncrTabSwitch инкрементирует счётчик вкладок и возвращает новое значение.
func (r *Redis) IncrTabSwitch(ctx context.Context, matchID, uid uuid.UUID) (int, error) {
	v, err := r.rdb.Incr(ctx, tabKey(matchID, uid)).Result()
	if err != nil {
		return 0, fmt.Errorf("arena.redis.IncrTabSwitch: %w", err)
	}
	_ = r.rdb.Expire(ctx, tabKey(matchID, uid), 2*time.Hour).Err()
	return int(v), nil
}

// parseInt64 — маленький хелпер, чтобы не тянуть strconv в несколько мест.
func parseInt64(s string) (int64, error) {
	var v int64
	if _, err := fmt.Sscanf(s, "%d", &v); err != nil {
		return v, fmt.Errorf("arena.redis.parseInt64: %w", err)
	}
	return v, nil
}

// Interface guards — проверки соответствия интерфейсам.
var (
	_ domain.QueueRepo      = (*Redis)(nil)
	_ domain.ReadyCheckRepo = (*Redis)(nil)
	_ domain.AnticheatRepo  = (*Redis)(nil)
)

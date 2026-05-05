-- 00072_drop_weekly_share_tokens.sql — удаление weekly_share_tokens.
--
-- Share flow целиком убран:
--   * frontend pages/WeeklyShareView, components/share/* удалены
--   * App.tsx route /weekly/share/:token убран
--   * profile.ts useWeeklyShareQuery / fetchWeeklyShare / useIssueShareTokenMutation удалены
--   * HeaderRow share-button убран
--   * backend ShareToken / ShareResolution types + IssueShareToken / ResolveShareToken удалены
--   * router.go publicPaths /api/v1/profile/weekly/share/ убран
--   * GetWeeklyShare RPC оставлен как stub-возвращающий-NotFound до regen pb.go

-- +goose Up
-- +goose StatementBegin

DROP TABLE IF EXISTS weekly_share_tokens CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- one-way drop
-- +goose StatementEnd

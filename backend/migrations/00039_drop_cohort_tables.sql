-- Phase-4 ADR-001 (Wave 2) — drop cohort tables.
--
-- The cohort feature has been merged into circles. Circles owns its own
-- `circles`, `circle_members`, `events`, `event_participants` tables (see
-- migrations 00023_circles.sql and 00024_events.sql) and is the canonical
-- bounded context for group-membership going forward. Frontend cohort/war
-- surfaces (CohortPage, WarRoomPage, lib/queries/cohort.ts, MSW handlers,
-- generated proto stubs) have been deleted; /cohort* routes redirect to
-- /circles*. Backend cohort service (backend/services/cohort/), monolith
-- wiring (cmd/monolith/services/cohort.go + bootstrap registration), proto
-- contract (proto/druz9/v1/cohort.proto) and generated stubs are gone in
-- this same change. Cross-service event publishers/subscribers
-- (sharedDomain.CohortWarStarted/Finished, feed.KindCohortWar,
-- enums.NotificationTypeCohortWar*) have been removed.
--
-- This is forward-only — historical migration 00006_cohort.sql stays
-- byte-stable. Drop order respects FKs: cohort_wars and cohort_members
-- both reference cohorts(id), so they go first; no other table references
-- cohorts (verified via grep over backend/migrations/).

-- +goose Up
DROP TABLE IF EXISTS cohort_wars;
DROP TABLE IF EXISTS cohort_members;
DROP TABLE IF EXISTS cohorts;

-- +goose Down
-- Forward-only — restoring requires re-running 00006_cohort.sql plus
-- restoring the matching service code (backend/services/cohort/). Down is
-- intentionally a no-op so a partial rollback doesn't leave the schema
-- half-restored without the matching service code.
SELECT 1;

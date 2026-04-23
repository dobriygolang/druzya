// Package domain — vacancies bounded context.
//
// Aggregates: Vacancy (parsed posting) and SavedVacancy (per-user kanban).
// Ports: VacancyRepo, SavedVacancyRepo, Parser, SingleFetcher, SkillExtractor.
//
// The pipeline is:
//
//	hourly Sync ──► Parser.Fetch ──► VacancyRepo.UpsertByExternal ──┐
//	                                                                 ▼
//	                                          SkillExtractor.Extract (LLM, cached 7d)
//	                                                                 │
//	                                                                 ▼
//	                                  VacancyRepo.UpdateNormalizedSkills
//
// Read paths (List, Get) hit a Redis cache wrapping VacancyRepo (10m for
// list, 1h for individual GetByID). Writes invalidate explicitly.
package domain

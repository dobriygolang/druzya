-- Non-PK indexes.

-- +goose Up
-- +goose StatementBegin
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ab_experiments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ab_experiments_status ON public.ab_experiments USING btree (status, created_at DESC);


--
-- Name: ab_user_assignments_experiment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ab_user_assignments_experiment ON public.ab_user_assignments USING btree (experiment_id, variant);


--
-- Name: ai_tutor_episodes_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_tutor_episodes_thread_idx ON public.ai_tutor_episodes USING btree (thread_id, occurred_at);


--
-- Name: ai_tutor_facts_recall_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_tutor_facts_recall_idx ON public.ai_tutor_facts USING btree (thread_id, confidence DESC, last_used_at DESC);


--
-- Name: ai_tutor_threads_student_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_tutor_threads_student_idx ON public.ai_tutor_threads USING btree (student_id, updated_at DESC);


--
-- Name: coach_prompts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coach_prompts_active ON public.coach_prompts USING btree (is_active, category);


--
-- Name: company_questions_company_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_questions_company_stage_idx ON public.company_questions USING btree (company_id, stage_kind, active, sort_order);


--
-- Name: company_stages_company_ordinal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_stages_company_ordinal_idx ON public.company_stages USING btree (company_id, ordinal);


--
-- Name: cue_sessions_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cue_sessions_user_recent ON public.cue_sessions USING btree (user_id, completed_at DESC);


--
-- Name: events_synced_google; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX events_synced_google ON public.events_synced USING btree (user_id, google_event_id);


--
-- Name: events_synced_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_synced_user_recent ON public.events_synced USING btree (user_id, start_time DESC);


--
-- Name: goal_presets_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goal_presets_active ON public.goal_presets USING btree (is_active, sort_order);


--
-- Name: idx_atlas_edges_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atlas_edges_to ON public.atlas_edges USING btree (to_id);


--
-- Name: idx_atlas_nodes_active_cluster; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atlas_nodes_active_cluster ON public.atlas_nodes USING btree (cluster) WHERE (is_active = true);


--
-- Name: idx_atlas_nodes_active_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atlas_nodes_active_section ON public.atlas_nodes USING btree (section) WHERE (is_active = true);


--
-- Name: idx_atlas_nodes_active_track; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atlas_nodes_active_track ON public.atlas_nodes USING btree (track_kind, section) WHERE (is_active = true);


--
-- Name: idx_atlas_nodes_external_resources_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atlas_nodes_external_resources_gin ON public.atlas_nodes USING gin (external_resources jsonb_path_ops);


--
-- Name: idx_circle_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_circle_members_user ON public.circle_members USING btree (user_id);


--
-- Name: idx_coach_episodes_brief_emitted_brief_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_episodes_brief_emitted_brief_id ON public.coach_episodes USING btree (user_id, ((payload ->> 'brief_id'::text)), created_at DESC) WHERE (kind = 'brief_emitted'::text);


--
-- Name: idx_coach_episodes_embedding_vec; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_episodes_embedding_vec ON public.coach_episodes USING ivfflat (embedding_vec public.vector_cosine_ops) WITH (lists='100') WHERE (embedding_vec IS NOT NULL);


--
-- Name: idx_coach_episodes_pending_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_episodes_pending_embedding ON public.coach_episodes USING btree (created_at) WHERE (embedded_at IS NULL);


--
-- Name: idx_coach_episodes_user_alive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_episodes_user_alive ON public.coach_episodes USING btree (user_id, occurred_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_coach_episodes_user_embedded_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_episodes_user_embedded_time ON public.coach_episodes USING btree (user_id, occurred_at DESC) WHERE (embedded_at IS NOT NULL);


--
-- Name: idx_coach_episodes_user_kind_embedded_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_episodes_user_kind_embedded_time ON public.coach_episodes USING btree (user_id, kind, occurred_at DESC) WHERE (embedded_at IS NOT NULL);


--
-- Name: idx_coach_episodes_user_kind_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_episodes_user_kind_time ON public.coach_episodes USING btree (user_id, kind, occurred_at DESC);


--
-- Name: idx_coach_episodes_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_episodes_user_time ON public.coach_episodes USING btree (user_id, occurred_at DESC);


--
-- Name: idx_codex_articles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_codex_articles_active ON public.codex_articles USING btree (active, sort_order);


--
-- Name: idx_companies_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_active_sort ON public.companies USING btree (active, sort_order) WHERE active;


--
-- Name: idx_copilot_conversations_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_copilot_conversations_session ON public.copilot_conversations USING btree (session_id) WHERE (session_id IS NOT NULL);


--
-- Name: idx_copilot_conversations_user_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_copilot_conversations_user_updated ON public.copilot_conversations USING btree (user_id, updated_at DESC);


--
-- Name: idx_copilot_messages_conv_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_copilot_messages_conv_created ON public.copilot_messages USING btree (conversation_id, created_at);


--
-- Name: idx_copilot_sessions_document_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_copilot_sessions_document_ids ON public.copilot_sessions USING gin (document_ids);


--
-- Name: idx_copilot_sessions_live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_copilot_sessions_live ON public.copilot_sessions USING btree (user_id) WHERE (finished_at IS NULL);


--
-- Name: idx_copilot_sessions_user_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_copilot_sessions_user_started ON public.copilot_sessions USING btree (user_id, started_at DESC);


--
-- Name: idx_day_shutdowns_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_day_shutdowns_user_date ON public.day_shutdowns USING btree (user_id, shutdown_date DESC);


--
-- Name: idx_devices_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_user ON public.devices USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_doc_chunks_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_chunks_doc ON public.doc_chunks USING btree (doc_id, ord);


--
-- Name: idx_doc_chunks_embedding_vec; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_chunks_embedding_vec ON public.doc_chunks USING ivfflat (embedding_vec public.vector_cosine_ops) WITH (lists='100') WHERE (embedding_vec IS NOT NULL);


--
-- Name: idx_documents_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_user_status ON public.documents USING btree (user_id, status);


--
-- Name: idx_dynamic_config_metrics_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dynamic_config_metrics_recent ON public.dynamic_config_metrics USING btree (bucket_day DESC, task);


--
-- Name: idx_editor_rooms_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_editor_rooms_active ON public.editor_rooms USING btree (owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_editor_rooms_archive_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_editor_rooms_archive_candidates ON public.editor_rooms USING btree (expires_at) WHERE (archived_at IS NULL);


--
-- Name: idx_editor_rooms_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_editor_rooms_owner ON public.editor_rooms USING btree (owner_id);


--
-- Name: idx_energy_logs_user_logged; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_energy_logs_user_logged ON public.energy_logs USING btree (user_id, logged_at DESC);


--
-- Name: idx_eval_runs_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_recent ON public.eval_runs USING btree (dataset_name, occurred_at DESC);


--
-- Name: idx_external_activity_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_activity_user_date ON public.external_activity USING btree (user_id, occurred_at DESC);


--
-- Name: idx_external_activity_user_source_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_activity_user_source_date ON public.external_activity USING btree (user_id, source, occurred_at DESC);


--
-- Name: idx_focus_reflections_user_ended; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_focus_reflections_user_ended ON public.focus_reflections USING btree (user_id, ended_at DESC);


--
-- Name: idx_hone_daily_briefs_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_daily_briefs_user_date ON public.hone_daily_briefs USING btree (user_id, brief_date DESC);


--
-- Name: idx_hone_focus_sessions_ended_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_focus_sessions_ended_at ON public.hone_focus_sessions USING btree (ended_at) WHERE (ended_at IS NOT NULL);


--
-- Name: idx_hone_focus_user_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_focus_user_started ON public.hone_focus_sessions USING btree (user_id, started_at DESC);


--
-- Name: idx_hone_listening_materials_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_listening_materials_user_active ON public.hone_listening_materials USING btree (user_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_hone_note_folders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_note_folders_user ON public.hone_note_folders USING btree (user_id);


--
-- Name: idx_hone_notes_ai_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_notes_ai_available ON public.hone_notes USING btree (user_id, updated_at DESC) WHERE ((NOT ai_excluded) AND (NOT encrypted));


--
-- Name: idx_hone_notes_embedded; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_notes_embedded ON public.hone_notes USING btree (user_id) WHERE (embedded_at IS NOT NULL);


--
-- Name: idx_hone_notes_embedding_vec; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_notes_embedding_vec ON public.hone_notes USING ivfflat (embedding_vec public.vector_cosine_ops) WITH (lists='100') WHERE (embedding_vec IS NOT NULL);


--
-- Name: idx_hone_notes_public_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_notes_public_slug ON public.hone_notes USING btree (public_slug) WHERE (public_slug IS NOT NULL);


--
-- Name: idx_hone_notes_user_file_path; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_hone_notes_user_file_path ON public.hone_notes USING btree (user_id, file_path) WHERE (file_path IS NOT NULL);


--
-- Name: idx_hone_notes_user_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_notes_user_folder ON public.hone_notes USING btree (user_id, folder_id);


--
-- Name: idx_hone_notes_user_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_notes_user_kind ON public.hone_notes USING btree (user_id, kind);


--
-- Name: idx_hone_notes_user_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_notes_user_updated ON public.hone_notes USING btree (user_id, updated_at DESC);


--
-- Name: idx_hone_plan_skips_user_skipped; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_plan_skips_user_skipped ON public.hone_plan_skips USING btree (user_id, skipped_at DESC);


--
-- Name: idx_hone_queue_user_date_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_queue_user_date_status ON public.hone_queue_items USING btree (user_id, item_date, status);


--
-- Name: idx_hone_reading_materials_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_reading_materials_user_active ON public.hone_reading_materials USING btree (user_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_hone_reading_sessions_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_reading_sessions_material ON public.hone_reading_sessions USING btree (material_id, started_at DESC);


--
-- Name: idx_hone_reading_sessions_user_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_reading_sessions_user_started ON public.hone_reading_sessions USING btree (user_id, started_at DESC);


--
-- Name: idx_hone_streak_days_user_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_streak_days_user_day ON public.hone_streak_days USING btree (user_id, day DESC);


--
-- Name: idx_hone_streak_days_user_day_asc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_streak_days_user_day_asc ON public.hone_streak_days USING btree (user_id, day);


--
-- Name: idx_hone_task_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_task_comments_task ON public.hone_task_comments USING btree (task_id, created_at);


--
-- Name: idx_hone_tasks_scheduled_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_tasks_scheduled_start ON public.hone_tasks USING btree (user_id, scheduled_start) WHERE (scheduled_start IS NOT NULL);


--
-- Name: idx_hone_tasks_user_skill_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_tasks_user_skill_open ON public.hone_tasks USING btree (user_id, skill_key) WHERE ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'in_review'::text])) AND (skill_key IS NOT NULL));


--
-- Name: idx_hone_tasks_user_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_tasks_user_status_created ON public.hone_tasks USING btree (user_id, status, created_at DESC);


--
-- Name: idx_hone_tasks_user_todo_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_tasks_user_todo_created ON public.hone_tasks USING btree (user_id, created_at) WHERE (status = 'todo'::text);


--
-- Name: idx_hone_vocab_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_vocab_due ON public.hone_vocab_queue USING btree (user_id, next_review_at) WHERE (learned_at IS NULL);


--
-- Name: idx_hone_whiteboards_user_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hone_whiteboards_user_updated ON public.hone_whiteboards USING btree (user_id, updated_at DESC);


--
-- Name: idx_incidents_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_started ON public.incidents USING btree (started_at DESC);


--
-- Name: idx_learning_state_fork; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learning_state_fork ON public.learning_state USING btree (fork_branch) WHERE (fork_branch IS NOT NULL);


--
-- Name: idx_learning_state_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learning_state_mode ON public.learning_state USING btree (mode);


--
-- Name: idx_llm_invocations_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_invocations_day ON public.llm_invocations USING btree ((((created_at AT TIME ZONE 'UTC'::text))::date) DESC);


--
-- Name: idx_llm_invocations_provider_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_invocations_provider_created ON public.llm_invocations USING btree (provider, created_at DESC);


--
-- Name: idx_llm_invocations_task_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_invocations_task_created ON public.llm_invocations USING btree (task_kind, created_at DESC);


--
-- Name: idx_llm_invocations_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_invocations_user_created ON public.llm_invocations USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: idx_mock_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mock_messages_session ON public.mock_messages USING btree (session_id, created_at);


--
-- Name: idx_mock_pipelines_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mock_pipelines_user ON public.mock_pipelines USING btree (user_id, created_at DESC);


--
-- Name: idx_mock_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mock_sessions_user ON public.mock_sessions USING btree (user_id, created_at DESC);


--
-- Name: idx_mock_sessions_user_finished; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mock_sessions_user_finished ON public.mock_sessions USING btree (user_id, finished_at DESC) WHERE (finished_at IS NOT NULL);


--
-- Name: idx_note_yjs_updates_note_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_note_yjs_updates_note_seq ON public.note_yjs_updates USING btree (note_id, seq);


--
-- Name: idx_notification_prefs_chat_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_notification_prefs_chat_id_unique ON public.notification_prefs USING btree (telegram_chat_id) WHERE (telegram_chat_id IS NOT NULL);


--
-- Name: idx_notification_prefs_weekly_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_prefs_weekly_enabled ON public.notification_prefs USING btree (weekly_report_enabled) WHERE weekly_report_enabled;


--
-- Name: idx_oauth_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_user ON public.oauth_accounts USING btree (user_id);


--
-- Name: idx_pipeline_stages_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stages_pipeline ON public.pipeline_stages USING btree (pipeline_id, sort_order);


--
-- Name: idx_podcasts_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_podcasts_category_id ON public.podcasts USING btree (category_id);


--
-- Name: idx_podcasts_published_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_podcasts_published_at ON public.podcasts USING btree (published_at DESC NULLS LAST);


--
-- Name: idx_provider_links_external; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_provider_links_external ON public.provider_links USING btree (provider, external_id);


--
-- Name: idx_resistance_log_user_logged; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resistance_log_user_logged ON public.resistance_log USING btree (user_id, logged_at DESC);


--
-- Name: idx_skill_nodes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_nodes_user ON public.skill_nodes USING btree (user_id);


--
-- Name: idx_speaking_sessions_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_speaking_sessions_user_created ON public.speaking_sessions USING btree (user_id, created_at DESC);


--
-- Name: idx_step_checkpoint_attempts_passed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_checkpoint_attempts_passed ON public.step_checkpoint_attempts USING btree (user_id, track_id, step_index) WHERE (passed_at IS NOT NULL);


--
-- Name: idx_step_checkpoint_attempts_user_step_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_checkpoint_attempts_user_step_recent ON public.step_checkpoint_attempts USING btree (user_id, track_id, step_index, created_at DESC);


--
-- Name: idx_subscriptions_plan_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_plan_active ON public.subscriptions USING btree (plan) WHERE (status = 'active'::public.subscription_status);


--
-- Name: idx_subscriptions_provider_sub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscriptions_provider_sub_id ON public.subscriptions USING btree (provider, provider_sub_id) WHERE (provider_sub_id IS NOT NULL);


--
-- Name: idx_support_tickets_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_status_created ON public.support_tickets USING btree (status, created_at DESC);


--
-- Name: idx_support_tickets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_user ON public.support_tickets USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_sync_tombstones_user_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_tombstones_user_deleted ON public.sync_tombstones USING btree (user_id, deleted_at DESC);


--
-- Name: idx_tasks_section_diff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_section_diff ON public.tasks USING btree (section, difficulty) WHERE is_active;


--
-- Name: idx_tasks_skill_keys_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_skill_keys_gin ON public.tasks USING gin (skill_keys) WHERE is_active;


--
-- Name: idx_telemetry_consent_surface; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_consent_surface ON public.telemetry_consent USING btree (surface, opted_in) WHERE (opted_in = true);


--
-- Name: idx_telemetry_events_name_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_events_name_occurred ON public.telemetry_events USING btree (name, occurred_at DESC);


--
-- Name: idx_telemetry_events_received_brin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_events_received_brin ON public.telemetry_events USING brin (received_at);


--
-- Name: idx_telemetry_events_user_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_events_user_occurred ON public.telemetry_events USING btree (user_id, occurred_at DESC);


--
-- Name: idx_test_cases_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_cases_task ON public.test_cases USING btree (task_id);


--
-- Name: idx_tpa_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tpa_path ON public.tutor_path_assignments USING btree (path_id);


--
-- Name: idx_tpa_student_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tpa_student_active ON public.tutor_path_assignments USING btree (student_id) WHERE ((completed_at IS NULL) AND (archived_at IS NULL));


--
-- Name: idx_tpa_tutor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tpa_tutor ON public.tutor_path_assignments USING btree (tutor_id, assigned_at DESC);


--
-- Name: idx_tpa_unique_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tpa_unique_active ON public.tutor_path_assignments USING btree (path_id, student_id) WHERE (archived_at IS NULL);


--
-- Name: idx_track_steps_external_resources_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_steps_external_resources_gin ON public.track_steps USING gin (external_resources jsonb_path_ops);


--
-- Name: idx_tutor_assignments_due_pending_notify; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_assignments_due_pending_notify ON public.tutor_assignments USING btree (due_at) WHERE ((due_at IS NOT NULL) AND (due_notified_at IS NULL) AND (completed_at IS NULL) AND (archived_at IS NULL));


--
-- Name: idx_tutor_assignments_student_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_assignments_student_pending ON public.tutor_assignments USING btree (student_id, due_at, created_at DESC) WHERE ((archived_at IS NULL) AND (completed_at IS NULL));


--
-- Name: idx_tutor_assignments_tutor_student_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_assignments_tutor_student_active ON public.tutor_assignments USING btree (tutor_id, student_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_tutor_directory_applications_tutor_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_directory_applications_tutor_pending ON public.tutor_directory_applications USING btree (tutor_id, created_at DESC) WHERE (status = 'pending'::text);


--
-- Name: idx_tutor_directory_applications_unique_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tutor_directory_applications_unique_pending ON public.tutor_directory_applications USING btree (tutor_id, student_id) WHERE (status = 'pending'::text);


--
-- Name: idx_tutor_directory_expertise; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_directory_expertise ON public.tutor_directory_profiles USING gin (expertise_tags) WHERE (visible = true);


--
-- Name: idx_tutor_directory_visible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_directory_visible ON public.tutor_directory_profiles USING btree (visible) WHERE (visible = true);


--
-- Name: idx_tutor_event_rsvps_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_event_rsvps_event ON public.tutor_event_rsvps USING btree (event_id);


--
-- Name: idx_tutor_event_rsvps_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_event_rsvps_student ON public.tutor_event_rsvps USING btree (student_id);


--
-- Name: idx_tutor_events_circle_upcoming; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_events_circle_upcoming ON public.tutor_events USING btree (circle_id, scheduled_at) WHERE ((status <> 'cancelled'::text) AND (circle_id IS NOT NULL));


--
-- Name: idx_tutor_events_student_shared; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_events_student_shared ON public.tutor_events USING btree (student_id, shared_at DESC) WHERE ((visibility = 'shared'::text) AND (status = 'completed'::text) AND (student_id IS NOT NULL));


--
-- Name: idx_tutor_events_student_upcoming; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_events_student_upcoming ON public.tutor_events USING btree (student_id, scheduled_at) WHERE ((status <> 'cancelled'::text) AND (student_id IS NOT NULL));


--
-- Name: idx_tutor_events_tutor_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_events_tutor_scheduled ON public.tutor_events USING btree (tutor_id, scheduled_at DESC);


--
-- Name: idx_tutor_invites_code_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tutor_invites_code_active ON public.tutor_invites USING btree (code) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: idx_tutor_invites_target_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_invites_target_pending ON public.tutor_invites USING btree (target_user_id, created_at DESC) WHERE ((target_user_id IS NOT NULL) AND (accepted_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: idx_tutor_invites_tutor_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_invites_tutor_created ON public.tutor_invites USING btree (tutor_id, created_at DESC);


--
-- Name: idx_tutor_reading_paths_tutor_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_reading_paths_tutor_created ON public.tutor_reading_paths USING btree (tutor_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_tutor_shared_materials_tutor_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_shared_materials_tutor_date ON public.tutor_shared_materials USING btree (tutor_id, created_at DESC);


--
-- Name: idx_tutor_students_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tutor_students_active ON public.tutor_students USING btree (tutor_id, student_id) WHERE (ended_at IS NULL);


--
-- Name: idx_tutor_students_student_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_students_student_started ON public.tutor_students USING btree (student_id, started_at DESC);


--
-- Name: idx_tutor_students_tutor_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_students_tutor_started ON public.tutor_students USING btree (tutor_id, started_at DESC);


--
-- Name: idx_un_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_un_user_created ON public.user_notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_un_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_un_user_unread ON public.user_notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: idx_user_app_installs_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_app_installs_last_seen ON public.user_app_installs USING btree (app, last_seen_at DESC);


--
-- Name: idx_user_atlas_node_prefs_hidden; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_atlas_node_prefs_hidden ON public.user_atlas_node_prefs USING btree (user_id) WHERE hidden;


--
-- Name: idx_user_atlas_node_prefs_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_atlas_node_prefs_pinned ON public.user_atlas_node_prefs USING btree (user_id) WHERE pinned;


--
-- Name: idx_user_atlas_struggle_marks_user_marked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_atlas_struggle_marks_user_marked ON public.user_atlas_struggle_marks USING btree (user_id, marked_at DESC);


--
-- Name: idx_user_bans_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_bans_user ON public.user_bans USING btree (user_id, issued_at DESC);


--
-- Name: idx_user_byok_keys_validated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_byok_keys_validated ON public.user_byok_keys USING btree (validated_at) WHERE (validated_at IS NOT NULL);


--
-- Name: idx_user_goals_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_goals_deadline ON public.user_goals USING btree (deadline) WHERE ((status = 'active'::public.user_goal_status) AND (deadline IS NOT NULL));


--
-- Name: idx_user_goals_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_goals_user_active ON public.user_goals USING btree (user_id, deadline) WHERE (status = 'active'::public.user_goal_status);


--
-- Name: idx_user_persona_tracks_one_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_persona_tracks_one_primary ON public.user_persona_tracks USING btree (user_id) WHERE (primary_track = true);


--
-- Name: idx_user_persona_tracks_track_lastactive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_persona_tracks_track_lastactive ON public.user_persona_tracks USING btree (track, last_active_at DESC);


--
-- Name: idx_user_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_reports_status ON public.user_reports USING btree (status, created_at DESC);


--
-- Name: idx_user_reports_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_reports_target ON public.user_reports USING btree (reported_id, created_at DESC);


--
-- Name: idx_user_resource_log_confusion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_resource_log_confusion ON public.user_resource_log USING btree (user_id, occurred_at DESC) WHERE (confusion_flag = true);


--
-- Name: idx_user_resource_log_node_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_resource_log_node_kind ON public.user_resource_log USING btree (atlas_node_id, kind, occurred_at DESC) WHERE (atlas_node_id IS NOT NULL);


--
-- Name: idx_user_resource_log_reflections; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_resource_log_reflections ON public.user_resource_log USING btree (user_id, occurred_at DESC) WHERE (kind = 'reflection_submitted'::text);


--
-- Name: idx_user_resource_log_url_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_resource_log_url_kind ON public.user_resource_log USING btree (resource_url, kind);


--
-- Name: idx_user_resource_log_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_resource_log_user_recent ON public.user_resource_log USING btree (user_id, occurred_at DESC);


--
-- Name: idx_users_storage_tier_paid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_storage_tier_paid ON public.users USING btree (storage_tier) WHERE (storage_tier <> 'free'::text);


--
-- Name: idx_users_tutor_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_tutor_mode ON public.users USING btree (id) WHERE (tutor_mode_enabled = true);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: idx_wb_yjs_updates_wb_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wb_yjs_updates_wb_seq ON public.whiteboard_yjs_updates USING btree (whiteboard_id, seq);


--
-- Name: idx_whiteboard_participants_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whiteboard_participants_user ON public.whiteboard_room_participants USING btree (user_id);


--
-- Name: idx_whiteboard_rooms_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whiteboard_rooms_active ON public.whiteboard_rooms USING btree (owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_whiteboard_rooms_archive_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whiteboard_rooms_archive_candidates ON public.whiteboard_rooms USING btree (expires_at) WHERE (archived_at IS NULL);


--
-- Name: idx_whiteboard_rooms_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whiteboard_rooms_expires ON public.whiteboard_rooms USING btree (expires_at);


--
-- Name: idx_whiteboard_rooms_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whiteboard_rooms_owner ON public.whiteboard_rooms USING btree (owner_id);


--
-- Name: intelligence_insights_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_insights_expires_idx ON public.intelligence_insights USING btree (expires_at) WHERE (dismissed_at IS NULL);


--
-- Name: intelligence_insights_user_surface_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_insights_user_surface_idx ON public.intelligence_insights USING btree (user_id, surface, generated_at DESC);


--
-- Name: interview_prep_sessions_active_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX interview_prep_sessions_active_uniq ON public.interview_prep_sessions USING btree (user_id) WHERE (ended_at IS NULL);


--
-- Name: interview_prep_sessions_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interview_prep_sessions_user_recent ON public.interview_prep_sessions USING btree (user_id, started_at DESC);


--
-- Name: interviewer_applications_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX interviewer_applications_one_pending ON public.interviewer_applications USING btree (user_id) WHERE (status = 'pending'::text);


--
-- Name: interviewer_applications_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interviewer_applications_status_created ON public.interviewer_applications USING btree (status, created_at DESC);


--
-- Name: llm_models_enabled_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_models_enabled_sort_idx ON public.llm_models USING btree (is_enabled, sort_order);


--
-- Name: mock_task_test_cases_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mock_task_test_cases_task_idx ON public.mock_task_test_cases USING btree (task_id, ordinal);


--
-- Name: mock_tasks_stage_kind_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mock_tasks_stage_kind_active_idx ON public.mock_tasks USING btree (stage_kind, active);


--
-- Name: notification_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_templates_active ON public.notification_templates USING btree (is_active, channel);


--
-- Name: personas_enabled_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personas_enabled_sort_idx ON public.personas USING btree (is_enabled, sort_order);


--
-- Name: pipeline_attempts_replay_gen_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_attempts_replay_gen_at_idx ON public.pipeline_attempts USING btree (replay_generated_at) WHERE (replay_generated_at IS NOT NULL);


--
-- Name: resource_promotion_signals_deprecate_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resource_promotion_signals_deprecate_candidates ON public.resource_promotion_signals USING btree (user_count, avg_quality) WHERE (deprecated_at IS NULL);


--
-- Name: resource_promotion_signals_promote_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resource_promotion_signals_promote_candidates ON public.resource_promotion_signals USING btree (user_count, avg_quality) WHERE (promoted_at IS NULL);


--
-- Name: stage_default_questions_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stage_default_questions_stage_idx ON public.stage_default_questions USING btree (stage_kind, active, sort_order);


--
-- Name: stage_templates_builtin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stage_templates_builtin_idx ON public.stage_templates USING btree (is_builtin, slug);


--
-- Name: stripe_subs_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_subs_user_active ON public.stripe_subscriptions USING btree (user_id, status);


--
-- Name: stripe_webhook_events_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_webhook_events_received ON public.stripe_webhook_events USING btree (received_at DESC);


--
-- Name: task_questions_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_questions_task_id_idx ON public.task_questions USING btree (task_id, sort_order);


--
-- Name: track_steps_skill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX track_steps_skill_idx ON public.track_steps USING gin (skill_keys);


--
-- Name: tracks_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tracks_active_idx ON public.tracks USING btree (is_active);


--
-- Name: tutor_session_notes_tutor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutor_session_notes_tutor_idx ON public.tutor_session_notes USING btree (tutor_id, updated_at DESC);


--
-- Name: uq_user_bans_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_bans_active ON public.user_bans USING btree (user_id) WHERE (lifted_at IS NULL);


--
-- Name: user_atlas_nodes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_atlas_nodes_user_idx ON public.user_atlas_nodes USING btree (user_id);


--
-- Name: user_milestones_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_milestones_recent ON public.user_milestones USING btree (user_id, generated_at DESC);


--
-- Name: user_milestones_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_milestones_unique ON public.user_milestones USING btree (user_id, goal_id, week_index);


--
-- Name: user_primary_goals_active_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_primary_goals_active_per_user ON public.user_primary_goals USING btree (user_id) WHERE (active = true);


--
-- Name: user_primary_goals_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_primary_goals_user ON public.user_primary_goals USING btree (user_id);


--
-- Name: user_resource_overrides_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_resource_overrides_lookup ON public.user_resource_overrides USING btree (user_id, atlas_node_id, step_track_id, step_index);


--
-- Name: user_resource_overrides_uniq_node; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_resource_overrides_uniq_node ON public.user_resource_overrides USING btree (user_id, atlas_node_id, url, action) WHERE (atlas_node_id IS NOT NULL);


--
-- Name: user_resource_overrides_uniq_step; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_resource_overrides_uniq_step ON public.user_resource_overrides USING btree (user_id, step_track_id, step_index, url, action) WHERE (step_track_id IS NOT NULL);


--
-- Name: user_tracks_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_tracks_user_active_idx ON public.user_tracks USING btree (user_id) WHERE (completed_at IS NULL);


--
-- Name: writing_prompts_level_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_prompts_level_active_idx ON public.writing_prompts USING btree (level) WHERE (archived_at IS NULL);


-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- IRRECOVERABLE: drop schema via 00001 down to reset
-- +goose StatementEnd

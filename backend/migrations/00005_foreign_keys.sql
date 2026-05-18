-- Foreign-key constraints (run after all tables exist).

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
-- Name: ab_experiments ab_experiments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_experiments
    ADD CONSTRAINT ab_experiments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ab_user_assignments ab_user_assignments_experiment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_user_assignments
    ADD CONSTRAINT ab_user_assignments_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.ab_experiments(id) ON DELETE CASCADE;


--
-- Name: ab_user_assignments ab_user_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_user_assignments
    ADD CONSTRAINT ab_user_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_tutor_episodes ai_tutor_episodes_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_episodes
    ADD CONSTRAINT ai_tutor_episodes_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.ai_tutor_threads(id) ON DELETE CASCADE;


--
-- Name: ai_tutor_facts ai_tutor_facts_source_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_facts
    ADD CONSTRAINT ai_tutor_facts_source_episode_id_fkey FOREIGN KEY (source_episode_id) REFERENCES public.ai_tutor_episodes(id) ON DELETE SET NULL;


--
-- Name: ai_tutor_facts ai_tutor_facts_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_facts
    ADD CONSTRAINT ai_tutor_facts_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.ai_tutor_threads(id) ON DELETE CASCADE;


--
-- Name: ai_tutor_personas ai_tutor_personas_ai_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_personas
    ADD CONSTRAINT ai_tutor_personas_ai_user_id_fkey FOREIGN KEY (ai_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_tutor_processed_mocks ai_tutor_processed_mocks_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_processed_mocks
    ADD CONSTRAINT ai_tutor_processed_mocks_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.ai_tutor_personas(id) ON DELETE CASCADE;


--
-- Name: ai_tutor_threads ai_tutor_threads_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_threads
    ADD CONSTRAINT ai_tutor_threads_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.ai_tutor_personas(id) ON DELETE RESTRICT;


--
-- Name: ai_tutor_threads ai_tutor_threads_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_threads
    ADD CONSTRAINT ai_tutor_threads_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: atlas_edges atlas_edges_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atlas_edges
    ADD CONSTRAINT atlas_edges_from_id_fkey FOREIGN KEY (from_id) REFERENCES public.atlas_nodes(id) ON DELETE CASCADE;


--
-- Name: atlas_edges atlas_edges_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atlas_edges
    ADD CONSTRAINT atlas_edges_to_id_fkey FOREIGN KEY (to_id) REFERENCES public.atlas_nodes(id) ON DELETE CASCADE;


--
-- Name: circle_members circle_members_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_members
    ADD CONSTRAINT circle_members_circle_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;


--
-- Name: circle_members circle_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_members
    ADD CONSTRAINT circle_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: circles circles_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circles
    ADD CONSTRAINT circles_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: coach_episodes coach_episodes_embedding_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_episodes
    ADD CONSTRAINT coach_episodes_embedding_model_id_fkey FOREIGN KEY (embedding_model_id) REFERENCES public.embedding_models(id);


--
-- Name: coach_episodes coach_episodes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_episodes
    ADD CONSTRAINT coach_episodes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: coach_prompts coach_prompts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_prompts
    ADD CONSTRAINT coach_prompts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: codex_articles codex_articles_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.codex_articles
    ADD CONSTRAINT codex_articles_category_fkey FOREIGN KEY (category) REFERENCES public.codex_categories(slug) ON DELETE RESTRICT;


--
-- Name: company_questions company_questions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_questions
    ADD CONSTRAINT company_questions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_stages company_stages_ai_strictness_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_stages
    ADD CONSTRAINT company_stages_ai_strictness_profile_id_fkey FOREIGN KEY (ai_strictness_profile_id) REFERENCES public.ai_strictness_profiles(id) ON DELETE SET NULL;


--
-- Name: company_stages company_stages_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_stages
    ADD CONSTRAINT company_stages_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: copilot_conversations copilot_conversations_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_conversations
    ADD CONSTRAINT copilot_conversations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.copilot_sessions(id) ON DELETE SET NULL;


--
-- Name: copilot_conversations copilot_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_conversations
    ADD CONSTRAINT copilot_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: copilot_messages copilot_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_messages
    ADD CONSTRAINT copilot_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.copilot_conversations(id) ON DELETE CASCADE;


--
-- Name: copilot_quotas copilot_quotas_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_quotas
    ADD CONSTRAINT copilot_quotas_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: copilot_session_reports copilot_session_reports_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_session_reports
    ADD CONSTRAINT copilot_session_reports_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.copilot_sessions(id) ON DELETE CASCADE;


--
-- Name: copilot_sessions copilot_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_sessions
    ADD CONSTRAINT copilot_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: cue_sessions cue_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cue_sessions
    ADD CONSTRAINT cue_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: day_shutdowns day_shutdowns_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_shutdowns
    ADD CONSTRAINT day_shutdowns_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: devices devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: doc_chunks doc_chunks_doc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_chunks
    ADD CONSTRAINT doc_chunks_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: documents documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: dynamic_config dynamic_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_config
    ADD CONSTRAINT dynamic_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: editor_participants editor_participants_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editor_participants
    ADD CONSTRAINT editor_participants_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.editor_rooms(id) ON DELETE CASCADE;


--
-- Name: editor_participants editor_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editor_participants
    ADD CONSTRAINT editor_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: editor_rooms editor_rooms_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editor_rooms
    ADD CONSTRAINT editor_rooms_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: editor_rooms editor_rooms_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editor_rooms
    ADD CONSTRAINT editor_rooms_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: energy_logs energy_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.energy_logs
    ADD CONSTRAINT energy_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: events_synced events_synced_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_synced
    ADD CONSTRAINT events_synced_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: external_activity external_activity_topic_atlas_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_activity
    ADD CONSTRAINT external_activity_topic_atlas_node_id_fkey FOREIGN KEY (topic_atlas_node_id) REFERENCES public.atlas_nodes(id) ON DELETE SET NULL;


--
-- Name: external_activity external_activity_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_activity
    ADD CONSTRAINT external_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: focus_reflections focus_reflections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_reflections
    ADD CONSTRAINT focus_reflections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: follow_up_questions follow_up_questions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_up_questions
    ADD CONSTRAINT follow_up_questions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: goal_presets goal_presets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_presets
    ADD CONSTRAINT goal_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: hone_daily_briefs hone_daily_briefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_daily_briefs
    ADD CONSTRAINT hone_daily_briefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_daily_plans hone_daily_plans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_daily_plans
    ADD CONSTRAINT hone_daily_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_focus_sessions hone_focus_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_focus_sessions
    ADD CONSTRAINT hone_focus_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_listening_materials hone_listening_materials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_listening_materials
    ADD CONSTRAINT hone_listening_materials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_note_folders hone_note_folders_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_note_folders
    ADD CONSTRAINT hone_note_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.hone_note_folders(id) ON DELETE CASCADE;


--
-- Name: hone_note_folders hone_note_folders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_note_folders
    ADD CONSTRAINT hone_note_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_notes hone_notes_embedding_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_notes
    ADD CONSTRAINT hone_notes_embedding_model_id_fkey FOREIGN KEY (embedding_model_id) REFERENCES public.embedding_models(id);


--
-- Name: hone_notes hone_notes_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_notes
    ADD CONSTRAINT hone_notes_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.hone_note_folders(id) ON DELETE SET NULL;


--
-- Name: hone_notes hone_notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_notes
    ADD CONSTRAINT hone_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_plan_skips hone_plan_skips_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_plan_skips
    ADD CONSTRAINT hone_plan_skips_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_queue_items hone_queue_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_queue_items
    ADD CONSTRAINT hone_queue_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_reading_materials hone_reading_materials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_reading_materials
    ADD CONSTRAINT hone_reading_materials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_reading_sessions hone_reading_sessions_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_reading_sessions
    ADD CONSTRAINT hone_reading_sessions_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.hone_reading_materials(id) ON DELETE CASCADE;


--
-- Name: hone_reading_sessions hone_reading_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_reading_sessions
    ADD CONSTRAINT hone_reading_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_streak_days hone_streak_days_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_streak_days
    ADD CONSTRAINT hone_streak_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_streak_state hone_streak_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_streak_state
    ADD CONSTRAINT hone_streak_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_task_comments hone_task_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_task_comments
    ADD CONSTRAINT hone_task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.hone_tasks(id) ON DELETE CASCADE;


--
-- Name: hone_tasks hone_tasks_skill_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_tasks
    ADD CONSTRAINT hone_tasks_skill_key_fkey FOREIGN KEY (skill_key) REFERENCES public.atlas_nodes(id) ON DELETE SET NULL;


--
-- Name: hone_tasks hone_tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_tasks
    ADD CONSTRAINT hone_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_user_settings hone_user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_user_settings
    ADD CONSTRAINT hone_user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_vocab_queue hone_vocab_queue_source_material_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_vocab_queue
    ADD CONSTRAINT hone_vocab_queue_source_material_fkey FOREIGN KEY (source_material) REFERENCES public.hone_reading_materials(id) ON DELETE SET NULL;


--
-- Name: hone_vocab_queue hone_vocab_queue_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_vocab_queue
    ADD CONSTRAINT hone_vocab_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hone_whiteboards hone_whiteboards_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_whiteboards
    ADD CONSTRAINT hone_whiteboards_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: intelligence_insights intelligence_insights_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_insights
    ADD CONSTRAINT intelligence_insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: interview_prep_sessions interview_prep_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interview_prep_sessions
    ADD CONSTRAINT interview_prep_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: interviewer_applications interviewer_applications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviewer_applications
    ADD CONSTRAINT interviewer_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: interviewer_applications interviewer_applications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviewer_applications
    ADD CONSTRAINT interviewer_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: learning_state learning_state_committed_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_state
    ADD CONSTRAINT learning_state_committed_track_id_fkey FOREIGN KEY (committed_track_id) REFERENCES public.tracks(id) ON DELETE RESTRICT;


--
-- Name: learning_state learning_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_state
    ADD CONSTRAINT learning_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mock_messages mock_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_messages
    ADD CONSTRAINT mock_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.mock_sessions(id) ON DELETE CASCADE;


--
-- Name: mock_pipelines mock_pipelines_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_pipelines
    ADD CONSTRAINT mock_pipelines_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: mock_pipelines mock_pipelines_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_pipelines
    ADD CONSTRAINT mock_pipelines_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mock_sessions mock_sessions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_sessions
    ADD CONSTRAINT mock_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: mock_sessions mock_sessions_paired_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_sessions
    ADD CONSTRAINT mock_sessions_paired_user_id_fkey FOREIGN KEY (paired_user_id) REFERENCES public.users(id);


--
-- Name: mock_sessions mock_sessions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_sessions
    ADD CONSTRAINT mock_sessions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: mock_sessions mock_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_sessions
    ADD CONSTRAINT mock_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mock_task_test_cases mock_task_test_cases_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_task_test_cases
    ADD CONSTRAINT mock_task_test_cases_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.mock_tasks(id) ON DELETE CASCADE;


--
-- Name: mock_tasks mock_tasks_ai_strictness_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_tasks
    ADD CONSTRAINT mock_tasks_ai_strictness_profile_id_fkey FOREIGN KEY (ai_strictness_profile_id) REFERENCES public.ai_strictness_profiles(id) ON DELETE SET NULL;


--
-- Name: mock_tasks mock_tasks_created_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_tasks
    ADD CONSTRAINT mock_tasks_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: note_yjs_updates note_yjs_updates_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_yjs_updates
    ADD CONSTRAINT note_yjs_updates_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.hone_notes(id) ON DELETE CASCADE;


--
-- Name: note_yjs_updates note_yjs_updates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_yjs_updates
    ADD CONSTRAINT note_yjs_updates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_prefs notification_prefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_prefs
    ADD CONSTRAINT notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_templates notification_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: oauth_accounts oauth_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_accounts
    ADD CONSTRAINT oauth_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pipeline_attempts pipeline_attempts_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_attempts
    ADD CONSTRAINT pipeline_attempts_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE CASCADE;


--
-- Name: pipeline_stages pipeline_stages_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.mock_pipelines(id) ON DELETE CASCADE;


--
-- Name: podcast_progress podcast_progress_podcast_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.podcast_progress
    ADD CONSTRAINT podcast_progress_podcast_id_fkey FOREIGN KEY (podcast_id) REFERENCES public.podcasts(id) ON DELETE CASCADE;


--
-- Name: podcast_progress podcast_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.podcast_progress
    ADD CONSTRAINT podcast_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: podcasts podcasts_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.podcasts
    ADD CONSTRAINT podcasts_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.podcast_categories(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: provider_links provider_links_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_links
    ADD CONSTRAINT provider_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: resistance_log resistance_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resistance_log
    ADD CONSTRAINT resistance_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: resource_promotion_signals resource_promotion_signals_atlas_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_promotion_signals
    ADD CONSTRAINT resource_promotion_signals_atlas_node_id_fkey FOREIGN KEY (atlas_node_id) REFERENCES public.atlas_nodes(id) ON DELETE CASCADE;


--
-- Name: skill_nodes skill_nodes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_nodes
    ADD CONSTRAINT skill_nodes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: speaking_sessions speaking_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_sessions
    ADD CONSTRAINT speaking_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: step_checkpoint_attempts step_checkpoint_attempts_step_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_checkpoint_attempts
    ADD CONSTRAINT step_checkpoint_attempts_step_fk FOREIGN KEY (track_id, step_index) REFERENCES public.track_steps(track_id, step_index) ON DELETE CASCADE;


--
-- Name: step_checkpoint_attempts step_checkpoint_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_checkpoint_attempts
    ADD CONSTRAINT step_checkpoint_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: stripe_customers stripe_customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_customers
    ADD CONSTRAINT stripe_customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: stripe_subscriptions stripe_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_subscriptions
    ADD CONSTRAINT stripe_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sync_tombstones sync_tombstones_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_tombstones
    ADD CONSTRAINT sync_tombstones_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_questions task_questions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_questions
    ADD CONSTRAINT task_questions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.mock_tasks(id) ON DELETE CASCADE;


--
-- Name: task_templates task_templates_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_templates
    ADD CONSTRAINT task_templates_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: telemetry_consent telemetry_consent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_consent
    ADD CONSTRAINT telemetry_consent_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: telemetry_events telemetry_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_events
    ADD CONSTRAINT telemetry_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: test_cases test_cases_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_cases
    ADD CONSTRAINT test_cases_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: track_steps track_steps_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_steps
    ADD CONSTRAINT track_steps_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.tracks(id) ON DELETE CASCADE;


--
-- Name: tracks tracks_curator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracks
    ADD CONSTRAINT tracks_curator_id_fkey FOREIGN KEY (curator_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tutor_assignments tutor_assignments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_assignments
    ADD CONSTRAINT tutor_assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_assignments tutor_assignments_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_assignments
    ADD CONSTRAINT tutor_assignments_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_directory_applications tutor_directory_applications_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_directory_applications
    ADD CONSTRAINT tutor_directory_applications_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_directory_applications tutor_directory_applications_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_directory_applications
    ADD CONSTRAINT tutor_directory_applications_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_directory_profiles tutor_directory_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_directory_profiles
    ADD CONSTRAINT tutor_directory_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_event_rsvps tutor_event_rsvps_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_event_rsvps
    ADD CONSTRAINT tutor_event_rsvps_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.tutor_events(id) ON DELETE CASCADE;


--
-- Name: tutor_event_rsvps tutor_event_rsvps_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_event_rsvps
    ADD CONSTRAINT tutor_event_rsvps_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_events tutor_events_circle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_events
    ADD CONSTRAINT tutor_events_circle_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;


--
-- Name: tutor_events tutor_events_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_events
    ADD CONSTRAINT tutor_events_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_events tutor_events_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_events
    ADD CONSTRAINT tutor_events_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_invites tutor_invites_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_invites
    ADD CONSTRAINT tutor_invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tutor_invites tutor_invites_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_invites
    ADD CONSTRAINT tutor_invites_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tutor_invites tutor_invites_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_invites
    ADD CONSTRAINT tutor_invites_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_path_assignments tutor_path_assignments_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_path_assignments
    ADD CONSTRAINT tutor_path_assignments_path_id_fkey FOREIGN KEY (path_id) REFERENCES public.tutor_reading_paths(id) ON DELETE CASCADE;


--
-- Name: tutor_path_assignments tutor_path_assignments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_path_assignments
    ADD CONSTRAINT tutor_path_assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_path_assignments tutor_path_assignments_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_path_assignments
    ADD CONSTRAINT tutor_path_assignments_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_reading_paths tutor_reading_paths_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_reading_paths
    ADD CONSTRAINT tutor_reading_paths_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_session_notes tutor_session_notes_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_session_notes
    ADD CONSTRAINT tutor_session_notes_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_session_notes tutor_session_notes_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_session_notes
    ADD CONSTRAINT tutor_session_notes_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_shared_materials tutor_shared_materials_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_shared_materials
    ADD CONSTRAINT tutor_shared_materials_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_students tutor_students_invite_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_students
    ADD CONSTRAINT tutor_students_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.tutor_invites(id) ON DELETE SET NULL;


--
-- Name: tutor_students tutor_students_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_students
    ADD CONSTRAINT tutor_students_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_students tutor_students_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_students
    ADD CONSTRAINT tutor_students_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_app_installs user_app_installs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_app_installs
    ADD CONSTRAINT user_app_installs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_atlas_node_prefs user_atlas_node_prefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_atlas_node_prefs
    ADD CONSTRAINT user_atlas_node_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_atlas_nodes user_atlas_nodes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_atlas_nodes
    ADD CONSTRAINT user_atlas_nodes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_atlas_struggle_marks user_atlas_struggle_marks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_atlas_struggle_marks
    ADD CONSTRAINT user_atlas_struggle_marks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_bans user_bans_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bans
    ADD CONSTRAINT user_bans_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_bans user_bans_lifted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bans
    ADD CONSTRAINT user_bans_lifted_by_fkey FOREIGN KEY (lifted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_bans user_bans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bans
    ADD CONSTRAINT user_bans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_byok_keys user_byok_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_byok_keys
    ADD CONSTRAINT user_byok_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_goals user_goals_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_goals
    ADD CONSTRAINT user_goals_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.tracks(id) ON DELETE SET NULL;


--
-- Name: user_goals user_goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_goals
    ADD CONSTRAINT user_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_google_credentials user_google_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_google_credentials
    ADD CONSTRAINT user_google_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_milestones user_milestones_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_milestones
    ADD CONSTRAINT user_milestones_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.user_primary_goals(id) ON DELETE CASCADE;


--
-- Name: user_milestones user_milestones_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_milestones
    ADD CONSTRAINT user_milestones_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_notifications user_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_persona_tracks user_persona_tracks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_persona_tracks
    ADD CONSTRAINT user_persona_tracks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_primary_goals user_primary_goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_primary_goals
    ADD CONSTRAINT user_primary_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_reports user_reports_reported_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reports
    ADD CONSTRAINT user_reports_reported_id_fkey FOREIGN KEY (reported_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_reports user_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reports
    ADD CONSTRAINT user_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_reports user_reports_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reports
    ADD CONSTRAINT user_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_resource_log user_resource_log_atlas_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_resource_log
    ADD CONSTRAINT user_resource_log_atlas_node_id_fkey FOREIGN KEY (atlas_node_id) REFERENCES public.atlas_nodes(id) ON DELETE SET NULL;


--
-- Name: user_resource_log user_resource_log_reflection_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_resource_log
    ADD CONSTRAINT user_resource_log_reflection_note_id_fkey FOREIGN KEY (reflection_note_id) REFERENCES public.hone_notes(id) ON DELETE SET NULL;


--
-- Name: user_resource_log user_resource_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_resource_log
    ADD CONSTRAINT user_resource_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_resource_overrides user_resource_overrides_atlas_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_resource_overrides
    ADD CONSTRAINT user_resource_overrides_atlas_node_id_fkey FOREIGN KEY (atlas_node_id) REFERENCES public.atlas_nodes(id) ON DELETE CASCADE;


--
-- Name: user_resource_overrides user_resource_overrides_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_resource_overrides
    ADD CONSTRAINT user_resource_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_room_quota user_room_quota_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_room_quota
    ADD CONSTRAINT user_room_quota_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_tracks user_tracks_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tracks
    ADD CONSTRAINT user_tracks_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.tracks(id) ON DELETE CASCADE;


--
-- Name: user_tracks user_tracks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tracks
    ADD CONSTRAINT user_tracks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_xp user_xp_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_xp
    ADD CONSTRAINT user_xp_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: whiteboard_room_participants whiteboard_room_participants_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboard_room_participants
    ADD CONSTRAINT whiteboard_room_participants_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.whiteboard_rooms(id) ON DELETE CASCADE;


--
-- Name: whiteboard_rooms whiteboard_rooms_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboard_rooms
    ADD CONSTRAINT whiteboard_rooms_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: whiteboard_yjs_updates whiteboard_yjs_updates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboard_yjs_updates
    ADD CONSTRAINT whiteboard_yjs_updates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: whiteboard_yjs_updates whiteboard_yjs_updates_whiteboard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboard_yjs_updates
    ADD CONSTRAINT whiteboard_yjs_updates_whiteboard_id_fkey FOREIGN KEY (whiteboard_id) REFERENCES public.hone_whiteboards(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- IRRECOVERABLE: drop schema via 00001 down to reset
-- +goose StatementEnd

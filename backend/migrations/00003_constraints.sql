-- Non-FK constraints (PKs / UNIQUEs / CHECKs).

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
-- Name: ab_experiments ab_experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_experiments
    ADD CONSTRAINT ab_experiments_pkey PRIMARY KEY (id);


--
-- Name: ab_experiments ab_experiments_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_experiments
    ADD CONSTRAINT ab_experiments_slug_key UNIQUE (slug);


--
-- Name: ab_user_assignments ab_user_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_user_assignments
    ADD CONSTRAINT ab_user_assignments_pkey PRIMARY KEY (user_id, experiment_id);


--
-- Name: ai_strictness_profiles ai_strictness_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_strictness_profiles
    ADD CONSTRAINT ai_strictness_profiles_pkey PRIMARY KEY (id);


--
-- Name: ai_strictness_profiles ai_strictness_profiles_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_strictness_profiles
    ADD CONSTRAINT ai_strictness_profiles_slug_key UNIQUE (slug);


--
-- Name: ai_tutor_episodes ai_tutor_episodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_episodes
    ADD CONSTRAINT ai_tutor_episodes_pkey PRIMARY KEY (id);


--
-- Name: ai_tutor_facts ai_tutor_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_facts
    ADD CONSTRAINT ai_tutor_facts_pkey PRIMARY KEY (id);


--
-- Name: ai_tutor_facts ai_tutor_facts_thread_id_fact_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_facts
    ADD CONSTRAINT ai_tutor_facts_thread_id_fact_key_key UNIQUE (thread_id, fact_key);


--
-- Name: ai_tutor_personas ai_tutor_personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_personas
    ADD CONSTRAINT ai_tutor_personas_pkey PRIMARY KEY (id);


--
-- Name: ai_tutor_personas ai_tutor_personas_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_personas
    ADD CONSTRAINT ai_tutor_personas_slug_key UNIQUE (slug);


--
-- Name: ai_tutor_processed_mocks ai_tutor_processed_mocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_processed_mocks
    ADD CONSTRAINT ai_tutor_processed_mocks_pkey PRIMARY KEY (session_id, persona_id);


--
-- Name: ai_tutor_threads ai_tutor_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_threads
    ADD CONSTRAINT ai_tutor_threads_pkey PRIMARY KEY (id);


--
-- Name: ai_tutor_threads ai_tutor_threads_student_id_persona_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tutor_threads
    ADD CONSTRAINT ai_tutor_threads_student_id_persona_id_key UNIQUE (student_id, persona_id);


--
-- Name: atlas_edges atlas_edges_from_id_to_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atlas_edges
    ADD CONSTRAINT atlas_edges_from_id_to_id_key UNIQUE (from_id, to_id);


--
-- Name: atlas_edges atlas_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atlas_edges
    ADD CONSTRAINT atlas_edges_pkey PRIMARY KEY (id);


--
-- Name: atlas_nodes atlas_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atlas_nodes
    ADD CONSTRAINT atlas_nodes_pkey PRIMARY KEY (id);


--
-- Name: circle_members circle_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_members
    ADD CONSTRAINT circle_members_pkey PRIMARY KEY (circle_id, user_id);


--
-- Name: circles circles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circles
    ADD CONSTRAINT circles_pkey PRIMARY KEY (id);


--
-- Name: coach_episodes coach_episodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_episodes
    ADD CONSTRAINT coach_episodes_pkey PRIMARY KEY (id);


--
-- Name: coach_prompts coach_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_prompts
    ADD CONSTRAINT coach_prompts_pkey PRIMARY KEY (id);


--
-- Name: coach_prompts coach_prompts_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_prompts
    ADD CONSTRAINT coach_prompts_slug_key UNIQUE (slug);


--
-- Name: codex_articles codex_articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.codex_articles
    ADD CONSTRAINT codex_articles_pkey PRIMARY KEY (id);


--
-- Name: codex_articles codex_articles_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.codex_articles
    ADD CONSTRAINT codex_articles_slug_key UNIQUE (slug);


--
-- Name: codex_categories codex_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.codex_categories
    ADD CONSTRAINT codex_categories_pkey PRIMARY KEY (slug);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: companies companies_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_slug_key UNIQUE (slug);


--
-- Name: company_questions company_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_questions
    ADD CONSTRAINT company_questions_pkey PRIMARY KEY (id);


--
-- Name: company_stages company_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_stages
    ADD CONSTRAINT company_stages_pkey PRIMARY KEY (company_id, stage_kind);


--
-- Name: copilot_conversations copilot_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_conversations
    ADD CONSTRAINT copilot_conversations_pkey PRIMARY KEY (id);


--
-- Name: copilot_messages copilot_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_messages
    ADD CONSTRAINT copilot_messages_pkey PRIMARY KEY (id);


--
-- Name: copilot_quotas copilot_quotas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_quotas
    ADD CONSTRAINT copilot_quotas_pkey PRIMARY KEY (user_id);


--
-- Name: copilot_session_reports copilot_session_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_session_reports
    ADD CONSTRAINT copilot_session_reports_pkey PRIMARY KEY (session_id);


--
-- Name: copilot_sessions copilot_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_sessions
    ADD CONSTRAINT copilot_sessions_pkey PRIMARY KEY (id);


--
-- Name: cue_sessions cue_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cue_sessions
    ADD CONSTRAINT cue_sessions_pkey PRIMARY KEY (id);


--
-- Name: day_shutdowns day_shutdowns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_shutdowns
    ADD CONSTRAINT day_shutdowns_pkey PRIMARY KEY (id);


--
-- Name: day_shutdowns day_shutdowns_user_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_shutdowns
    ADD CONSTRAINT day_shutdowns_user_date_unique UNIQUE (user_id, shutdown_date);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: doc_chunks doc_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_chunks
    ADD CONSTRAINT doc_chunks_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: documents documents_user_id_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_user_id_sha256_key UNIQUE (user_id, sha256);


--
-- Name: domain_reputation domain_reputation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_reputation
    ADD CONSTRAINT domain_reputation_pkey PRIMARY KEY (domain);


--
-- Name: dynamic_config_metrics dynamic_config_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_config_metrics
    ADD CONSTRAINT dynamic_config_metrics_pkey PRIMARY KEY (id);


--
-- Name: dynamic_config_metrics dynamic_config_metrics_task_provider_bucket_day_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_config_metrics
    ADD CONSTRAINT dynamic_config_metrics_task_provider_bucket_day_key UNIQUE (task, provider, bucket_day);


--
-- Name: dynamic_config dynamic_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_config
    ADD CONSTRAINT dynamic_config_pkey PRIMARY KEY (key);


--
-- Name: editor_participants editor_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editor_participants
    ADD CONSTRAINT editor_participants_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: editor_rooms editor_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editor_rooms
    ADD CONSTRAINT editor_rooms_pkey PRIMARY KEY (id);


--
-- Name: embedding_models embedding_models_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_models
    ADD CONSTRAINT embedding_models_name_key UNIQUE (name);


--
-- Name: embedding_models embedding_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_models
    ADD CONSTRAINT embedding_models_pkey PRIMARY KEY (id);


--
-- Name: energy_logs energy_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.energy_logs
    ADD CONSTRAINT energy_logs_pkey PRIMARY KEY (id);


--
-- Name: eval_runs eval_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_pkey PRIMARY KEY (id);


--
-- Name: events_synced events_synced_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_synced
    ADD CONSTRAINT events_synced_pkey PRIMARY KEY (id);


--
-- Name: external_activity external_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_activity
    ADD CONSTRAINT external_activity_pkey PRIMARY KEY (id);


--
-- Name: focus_reflections focus_reflections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_reflections
    ADD CONSTRAINT focus_reflections_pkey PRIMARY KEY (id);


--
-- Name: focus_reflections focus_reflections_user_session_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_reflections
    ADD CONSTRAINT focus_reflections_user_session_unique UNIQUE (user_id, session_id);


--
-- Name: follow_up_questions follow_up_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_up_questions
    ADD CONSTRAINT follow_up_questions_pkey PRIMARY KEY (id);


--
-- Name: goal_presets goal_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_presets
    ADD CONSTRAINT goal_presets_pkey PRIMARY KEY (id);


--
-- Name: goal_presets goal_presets_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_presets
    ADD CONSTRAINT goal_presets_slug_key UNIQUE (slug);


--
-- Name: hone_daily_briefs hone_daily_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_daily_briefs
    ADD CONSTRAINT hone_daily_briefs_pkey PRIMARY KEY (id);


--
-- Name: hone_daily_briefs hone_daily_briefs_user_id_brief_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_daily_briefs
    ADD CONSTRAINT hone_daily_briefs_user_id_brief_date_key UNIQUE (user_id, brief_date);


--
-- Name: hone_daily_plans hone_daily_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_daily_plans
    ADD CONSTRAINT hone_daily_plans_pkey PRIMARY KEY (id);


--
-- Name: hone_daily_plans hone_daily_plans_user_id_plan_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_daily_plans
    ADD CONSTRAINT hone_daily_plans_user_id_plan_date_key UNIQUE (user_id, plan_date);


--
-- Name: hone_focus_sessions hone_focus_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_focus_sessions
    ADD CONSTRAINT hone_focus_sessions_pkey PRIMARY KEY (id);


--
-- Name: hone_listening_materials hone_listening_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_listening_materials
    ADD CONSTRAINT hone_listening_materials_pkey PRIMARY KEY (id);


--
-- Name: hone_note_folders hone_note_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_note_folders
    ADD CONSTRAINT hone_note_folders_pkey PRIMARY KEY (id);


--
-- Name: hone_notes hone_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_notes
    ADD CONSTRAINT hone_notes_pkey PRIMARY KEY (id);


--
-- Name: hone_notes hone_notes_public_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_notes
    ADD CONSTRAINT hone_notes_public_slug_key UNIQUE (public_slug);


--
-- Name: hone_plan_skips hone_plan_skips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_plan_skips
    ADD CONSTRAINT hone_plan_skips_pkey PRIMARY KEY (id);


--
-- Name: hone_queue_items hone_queue_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_queue_items
    ADD CONSTRAINT hone_queue_items_pkey PRIMARY KEY (id);


--
-- Name: hone_reading_materials hone_reading_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_reading_materials
    ADD CONSTRAINT hone_reading_materials_pkey PRIMARY KEY (id);


--
-- Name: hone_reading_sessions hone_reading_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_reading_sessions
    ADD CONSTRAINT hone_reading_sessions_pkey PRIMARY KEY (id);


--
-- Name: hone_streak_days hone_streak_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_streak_days
    ADD CONSTRAINT hone_streak_days_pkey PRIMARY KEY (user_id, day);


--
-- Name: hone_streak_state hone_streak_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_streak_state
    ADD CONSTRAINT hone_streak_state_pkey PRIMARY KEY (user_id);


--
-- Name: hone_task_comments hone_task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_task_comments
    ADD CONSTRAINT hone_task_comments_pkey PRIMARY KEY (id);


--
-- Name: hone_tasks hone_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_tasks
    ADD CONSTRAINT hone_tasks_pkey PRIMARY KEY (id);


--
-- Name: hone_user_settings hone_user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_user_settings
    ADD CONSTRAINT hone_user_settings_pkey PRIMARY KEY (user_id);


--
-- Name: hone_vocab_queue hone_vocab_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_vocab_queue
    ADD CONSTRAINT hone_vocab_queue_pkey PRIMARY KEY (user_id, word);


--
-- Name: hone_whiteboards hone_whiteboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hone_whiteboards
    ADD CONSTRAINT hone_whiteboards_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: intelligence_insights intelligence_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_insights
    ADD CONSTRAINT intelligence_insights_pkey PRIMARY KEY (id);


--
-- Name: intelligence_insights intelligence_insights_user_id_surface_anchor_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_insights
    ADD CONSTRAINT intelligence_insights_user_id_surface_anchor_key UNIQUE (user_id, surface, anchor);


--
-- Name: interview_prep_sessions interview_prep_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interview_prep_sessions
    ADD CONSTRAINT interview_prep_sessions_pkey PRIMARY KEY (id);


--
-- Name: interviewer_applications interviewer_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviewer_applications
    ADD CONSTRAINT interviewer_applications_pkey PRIMARY KEY (id);


--
-- Name: learning_state learning_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_state
    ADD CONSTRAINT learning_state_pkey PRIMARY KEY (user_id);


--
-- Name: llm_invocations llm_invocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_invocations
    ADD CONSTRAINT llm_invocations_pkey PRIMARY KEY (id);


--
-- Name: llm_models llm_models_model_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_model_id_key UNIQUE (model_id);


--
-- Name: llm_models llm_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_pkey PRIMARY KEY (id);


--
-- Name: llm_runtime_config llm_runtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_runtime_config
    ADD CONSTRAINT llm_runtime_config_pkey PRIMARY KEY (id);


--
-- Name: mock_messages mock_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_messages
    ADD CONSTRAINT mock_messages_pkey PRIMARY KEY (id);


--
-- Name: mock_pipelines mock_pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_pipelines
    ADD CONSTRAINT mock_pipelines_pkey PRIMARY KEY (id);


--
-- Name: mock_sessions mock_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_sessions
    ADD CONSTRAINT mock_sessions_pkey PRIMARY KEY (id);


--
-- Name: mock_task_test_cases mock_task_test_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_task_test_cases
    ADD CONSTRAINT mock_task_test_cases_pkey PRIMARY KEY (id);


--
-- Name: mock_tasks mock_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_tasks
    ADD CONSTRAINT mock_tasks_pkey PRIMARY KEY (id);


--
-- Name: note_yjs_updates note_yjs_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_yjs_updates
    ADD CONSTRAINT note_yjs_updates_pkey PRIMARY KEY (seq);


--
-- Name: notification_prefs notification_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_prefs
    ADD CONSTRAINT notification_prefs_pkey PRIMARY KEY (user_id);


--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (id);


--
-- Name: notification_templates notification_templates_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_slug_key UNIQUE (slug);


--
-- Name: oauth_accounts oauth_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_accounts
    ADD CONSTRAINT oauth_accounts_pkey PRIMARY KEY (id);


--
-- Name: oauth_accounts oauth_accounts_provider_provider_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_accounts
    ADD CONSTRAINT oauth_accounts_provider_provider_user_id_key UNIQUE (provider, provider_user_id);


--
-- Name: personas personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_pkey PRIMARY KEY (id);


--
-- Name: pipeline_attempts pipeline_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_attempts
    ADD CONSTRAINT pipeline_attempts_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: podcast_categories podcast_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.podcast_categories
    ADD CONSTRAINT podcast_categories_pkey PRIMARY KEY (id);


--
-- Name: podcast_categories podcast_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.podcast_categories
    ADD CONSTRAINT podcast_categories_slug_key UNIQUE (slug);


--
-- Name: podcast_progress podcast_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.podcast_progress
    ADD CONSTRAINT podcast_progress_pkey PRIMARY KEY (user_id, podcast_id);


--
-- Name: podcasts podcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.podcasts
    ADD CONSTRAINT podcasts_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: provider_links provider_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_links
    ADD CONSTRAINT provider_links_pkey PRIMARY KEY (user_id, provider);


--
-- Name: resistance_log resistance_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resistance_log
    ADD CONSTRAINT resistance_log_pkey PRIMARY KEY (id);


--
-- Name: resource_promotion_signals resource_promotion_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_promotion_signals
    ADD CONSTRAINT resource_promotion_signals_pkey PRIMARY KEY (url);


--
-- Name: skill_nodes skill_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_nodes
    ADD CONSTRAINT skill_nodes_pkey PRIMARY KEY (user_id, node_key);


--
-- Name: speaking_exercises speaking_exercises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_exercises
    ADD CONSTRAINT speaking_exercises_pkey PRIMARY KEY (id);


--
-- Name: speaking_sessions speaking_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_sessions
    ADD CONSTRAINT speaking_sessions_pkey PRIMARY KEY (id);


--
-- Name: speaking_sessions speaking_sessions_user_client_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_sessions
    ADD CONSTRAINT speaking_sessions_user_client_unique UNIQUE (user_id, client_session_id);


--
-- Name: stage_default_questions stage_default_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_default_questions
    ADD CONSTRAINT stage_default_questions_pkey PRIMARY KEY (id);


--
-- Name: stage_templates stage_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_templates
    ADD CONSTRAINT stage_templates_pkey PRIMARY KEY (id);


--
-- Name: stage_templates stage_templates_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_templates
    ADD CONSTRAINT stage_templates_slug_key UNIQUE (slug);


--
-- Name: step_checkpoint_attempts step_checkpoint_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_checkpoint_attempts
    ADD CONSTRAINT step_checkpoint_attempts_pkey PRIMARY KEY (id);


--
-- Name: stripe_customers stripe_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_customers
    ADD CONSTRAINT stripe_customers_pkey PRIMARY KEY (user_id);


--
-- Name: stripe_customers stripe_customers_stripe_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_customers
    ADD CONSTRAINT stripe_customers_stripe_customer_id_key UNIQUE (stripe_customer_id);


--
-- Name: stripe_subscriptions stripe_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_subscriptions
    ADD CONSTRAINT stripe_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: stripe_subscriptions stripe_subscriptions_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_subscriptions
    ADD CONSTRAINT stripe_subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: stripe_webhook_events stripe_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_webhook_events
    ADD CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (event_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (user_id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: sync_tombstones sync_tombstones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_tombstones
    ADD CONSTRAINT sync_tombstones_pkey PRIMARY KEY (id);


--
-- Name: task_questions task_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_questions
    ADD CONSTRAINT task_questions_pkey PRIMARY KEY (id);


--
-- Name: task_templates task_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_templates
    ADD CONSTRAINT task_templates_pkey PRIMARY KEY (task_id, language);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_slug_key UNIQUE (slug);


--
-- Name: telemetry_consent telemetry_consent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_consent
    ADD CONSTRAINT telemetry_consent_pkey PRIMARY KEY (user_id, surface);


--
-- Name: telemetry_events telemetry_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_events
    ADD CONSTRAINT telemetry_events_pkey PRIMARY KEY (id);


--
-- Name: test_cases test_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_cases
    ADD CONSTRAINT test_cases_pkey PRIMARY KEY (id);


--
-- Name: track_steps track_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_steps
    ADD CONSTRAINT track_steps_pkey PRIMARY KEY (track_id, step_index);


--
-- Name: tracks tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracks
    ADD CONSTRAINT tracks_pkey PRIMARY KEY (id);


--
-- Name: tracks tracks_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracks
    ADD CONSTRAINT tracks_slug_key UNIQUE (slug);


--
-- Name: tutor_assignments tutor_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_assignments
    ADD CONSTRAINT tutor_assignments_pkey PRIMARY KEY (id);


--
-- Name: tutor_directory_applications tutor_directory_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_directory_applications
    ADD CONSTRAINT tutor_directory_applications_pkey PRIMARY KEY (id);


--
-- Name: tutor_directory_profiles tutor_directory_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_directory_profiles
    ADD CONSTRAINT tutor_directory_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: tutor_event_rsvps tutor_event_rsvps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_event_rsvps
    ADD CONSTRAINT tutor_event_rsvps_pkey PRIMARY KEY (event_id, student_id);


--
-- Name: tutor_events tutor_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_events
    ADD CONSTRAINT tutor_events_pkey PRIMARY KEY (id);


--
-- Name: tutor_invites tutor_invites_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_invites
    ADD CONSTRAINT tutor_invites_code_key UNIQUE (code);


--
-- Name: tutor_invites tutor_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_invites
    ADD CONSTRAINT tutor_invites_pkey PRIMARY KEY (id);


--
-- Name: tutor_path_assignments tutor_path_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_path_assignments
    ADD CONSTRAINT tutor_path_assignments_pkey PRIMARY KEY (id);


--
-- Name: tutor_reading_paths tutor_reading_paths_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_reading_paths
    ADD CONSTRAINT tutor_reading_paths_pkey PRIMARY KEY (id);


--
-- Name: tutor_session_notes tutor_session_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_session_notes
    ADD CONSTRAINT tutor_session_notes_pkey PRIMARY KEY (tutor_id, student_id);


--
-- Name: tutor_shared_materials tutor_shared_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_shared_materials
    ADD CONSTRAINT tutor_shared_materials_pkey PRIMARY KEY (id);


--
-- Name: tutor_students tutor_students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_students
    ADD CONSTRAINT tutor_students_pkey PRIMARY KEY (id);


--
-- Name: user_app_installs user_app_installs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_app_installs
    ADD CONSTRAINT user_app_installs_pkey PRIMARY KEY (user_id, app);


--
-- Name: user_atlas_node_prefs user_atlas_node_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_atlas_node_prefs
    ADD CONSTRAINT user_atlas_node_prefs_pkey PRIMARY KEY (user_id, node_key);


--
-- Name: user_atlas_nodes user_atlas_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_atlas_nodes
    ADD CONSTRAINT user_atlas_nodes_pkey PRIMARY KEY (user_id, node_key);


--
-- Name: user_atlas_struggle_marks user_atlas_struggle_marks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_atlas_struggle_marks
    ADD CONSTRAINT user_atlas_struggle_marks_pkey PRIMARY KEY (user_id, atlas_node_id);


--
-- Name: user_bans user_bans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bans
    ADD CONSTRAINT user_bans_pkey PRIMARY KEY (id);


--
-- Name: user_byok_keys user_byok_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_byok_keys
    ADD CONSTRAINT user_byok_keys_pkey PRIMARY KEY (user_id);


--
-- Name: user_goals user_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_goals
    ADD CONSTRAINT user_goals_pkey PRIMARY KEY (id);


--
-- Name: user_google_credentials user_google_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_google_credentials
    ADD CONSTRAINT user_google_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: user_milestones user_milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_milestones
    ADD CONSTRAINT user_milestones_pkey PRIMARY KEY (id);


--
-- Name: user_notifications user_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_pkey PRIMARY KEY (id);


--
-- Name: user_persona_tracks user_persona_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_persona_tracks
    ADD CONSTRAINT user_persona_tracks_pkey PRIMARY KEY (user_id, track);


--
-- Name: user_primary_goals user_primary_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_primary_goals
    ADD CONSTRAINT user_primary_goals_pkey PRIMARY KEY (id);


--
-- Name: user_reports user_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reports
    ADD CONSTRAINT user_reports_pkey PRIMARY KEY (id);


--
-- Name: user_resource_log user_resource_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_resource_log
    ADD CONSTRAINT user_resource_log_pkey PRIMARY KEY (id);


--
-- Name: user_resource_overrides user_resource_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_resource_overrides
    ADD CONSTRAINT user_resource_overrides_pkey PRIMARY KEY (id);


--
-- Name: user_room_quota user_room_quota_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_room_quota
    ADD CONSTRAINT user_room_quota_pkey PRIMARY KEY (user_id);


--
-- Name: user_tracks user_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tracks
    ADD CONSTRAINT user_tracks_pkey PRIMARY KEY (user_id, track_id);


--
-- Name: user_xp user_xp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_xp
    ADD CONSTRAINT user_xp_pkey PRIMARY KEY (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: whiteboard_room_participants whiteboard_room_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboard_room_participants
    ADD CONSTRAINT whiteboard_room_participants_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: whiteboard_rooms whiteboard_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboard_rooms
    ADD CONSTRAINT whiteboard_rooms_pkey PRIMARY KEY (id);


--
-- Name: whiteboard_yjs_updates whiteboard_yjs_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboard_yjs_updates
    ADD CONSTRAINT whiteboard_yjs_updates_pkey PRIMARY KEY (seq);


--
-- Name: writing_prompts writing_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_prompts
    ADD CONSTRAINT writing_prompts_pkey PRIMARY KEY (id);


-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- IRRECOVERABLE: drop schema via 00001 down to reset
-- +goose StatementEnd

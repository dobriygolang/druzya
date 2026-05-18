-- All CREATE TABLE + CREATE SEQUENCE + SET DEFAULT statements.

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ab_experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_experiments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    hypothesis text NOT NULL,
    variants jsonb NOT NULL,
    metric_slug text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ab_experiments_status_chk CHECK ((status = ANY (ARRAY['draft'::text, 'running'::text, 'paused'::text, 'completed'::text])))
);


--
-- Name: ab_user_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_user_assignments (
    user_id uuid NOT NULL,
    experiment_id uuid NOT NULL,
    variant text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_strictness_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_strictness_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    off_topic_penalty double precision DEFAULT 0 NOT NULL,
    must_mention_penalty double precision DEFAULT 0 NOT NULL,
    hallucination_penalty double precision DEFAULT 0 NOT NULL,
    bias_toward_fail double precision DEFAULT 0 NOT NULL,
    custom_prompt_template text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_tutor_episodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_tutor_episodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    model_used text DEFAULT ''::text NOT NULL,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_tutor_episodes_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'assignment'::text, 'snapshot_inject'::text])))
);


--
-- Name: ai_tutor_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_tutor_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    fact_key text NOT NULL,
    fact_value text NOT NULL,
    confidence double precision DEFAULT 0.5 NOT NULL,
    source_episode_id uuid,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_tutor_personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_tutor_personas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    display_name text NOT NULL,
    scope_track_kind public.track_kind NOT NULL,
    prompt_template text NOT NULL,
    pace_per_week integer DEFAULT 3 NOT NULL,
    llm_task_kind text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    ai_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_tutor_processed_mocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_tutor_processed_mocks (
    session_id uuid NOT NULL,
    persona_id uuid NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_tutor_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_tutor_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    persona_id uuid NOT NULL,
    summary_md text DEFAULT ''::text NOT NULL,
    message_count integer DEFAULT 0 NOT NULL,
    last_compacted_at timestamp with time zone,
    daily_msg_count integer DEFAULT 0 NOT NULL,
    daily_msg_reset_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: atlas_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atlas_edges (
    id bigint NOT NULL,
    from_id text NOT NULL,
    to_id text NOT NULL,
    kind text DEFAULT 'prereq'::text NOT NULL,
    CONSTRAINT atlas_edges_kind_valid CHECK ((kind = ANY (ARRAY['prereq'::text, 'suggested'::text, 'crosslink'::text]))),
    CONSTRAINT atlas_edges_no_self CHECK ((from_id <> to_id))
);


--
-- Name: atlas_edges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.atlas_edges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: atlas_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.atlas_edges_id_seq OWNED BY public.atlas_edges.id;


--
-- Name: atlas_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atlas_nodes (
    id text NOT NULL,
    title text NOT NULL,
    section text NOT NULL,
    kind text NOT NULL,
    cluster text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    pos_x integer,
    pos_y integer,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    track_kind public.track_kind DEFAULT 'dev'::public.track_kind NOT NULL,
    external_resources jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT atlas_nodes_kind_valid CHECK ((kind = ANY (ARRAY['hub'::text, 'keystone'::text, 'notable'::text, 'small'::text]))),
    CONSTRAINT atlas_nodes_total_nonneg CHECK ((total_count >= 0))
);


--
-- Name: circle_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_members (
    circle_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT circle_members_role_valid CHECK ((role = ANY (ARRAY['member'::text, 'admin'::text, 'owner'::text])))
);


--
-- Name: circles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coach_episodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_episodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    embedding_vec public.vector(384),
    embedding_model_id integer,
    embedded_at timestamp with time zone,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    edited_at timestamp with time zone
);


--
-- Name: coach_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    category text NOT NULL,
    template text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: codex_articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.codex_articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    category text NOT NULL,
    href text DEFAULT ''::text NOT NULL,
    source text DEFAULT ''::text NOT NULL,
    read_min integer DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    quiz_question text,
    quiz_answer text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: codex_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.codex_categories (
    slug text NOT NULL,
    label text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    difficulty text DEFAULT 'normal'::text NOT NULL,
    min_level_required integer DEFAULT 0 NOT NULL,
    sections text[] DEFAULT '{}'::text[] NOT NULL,
    logo_url text,
    description text DEFAULT ''::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT companies_difficulty_valid CHECK ((difficulty = ANY (ARRAY['normal'::text, 'hard'::text, 'boss'::text])))
);


--
-- Name: company_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    stage_kind text NOT NULL,
    body text NOT NULL,
    expected_answer_md text DEFAULT ''::text NOT NULL,
    reference_criteria jsonb DEFAULT '[]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_stages (
    company_id uuid NOT NULL,
    stage_kind text NOT NULL,
    ordinal integer DEFAULT 0 NOT NULL,
    optional boolean DEFAULT false NOT NULL,
    language_pool public.mock_task_language[] DEFAULT '{}'::public.mock_task_language[] NOT NULL,
    task_pool_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    ai_strictness_profile_id uuid,
    default_question_limit integer,
    company_question_limit integer
);


--
-- Name: copilot_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.copilot_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid,
    title text DEFAULT ''::text NOT NULL,
    model text NOT NULL,
    running_summary text DEFAULT ''::text NOT NULL,
    summary_model text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: copilot_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.copilot_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    has_screenshot boolean DEFAULT false NOT NULL,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    latency_ms integer DEFAULT 0 NOT NULL,
    rating smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT copilot_messages_rating_valid CHECK (((rating IS NULL) OR (rating = ANY (ARRAY['-1'::integer, 0, 1])))),
    CONSTRAINT copilot_messages_role_valid CHECK ((role = ANY (ARRAY['system'::text, 'user'::text, 'assistant'::text])))
);


--
-- Name: copilot_quotas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.copilot_quotas (
    user_id uuid NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    requests_used integer DEFAULT 0 NOT NULL,
    requests_cap integer DEFAULT 20 NOT NULL,
    resets_at timestamp with time zone DEFAULT (now() + '1 day'::interval) NOT NULL,
    models_allowed text[] DEFAULT ARRAY['druz9/turbo'::text] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT copilot_quotas_plan_valid CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text, 'max'::text])))
);


--
-- Name: copilot_session_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.copilot_session_reports (
    session_id uuid NOT NULL,
    status public.copilot_report_status DEFAULT 'pending'::public.copilot_report_status NOT NULL,
    overall_score integer DEFAULT 0 NOT NULL,
    section_scores jsonb DEFAULT '{}'::jsonb NOT NULL,
    weaknesses jsonb DEFAULT '[]'::jsonb NOT NULL,
    recommendations jsonb DEFAULT '[]'::jsonb NOT NULL,
    links jsonb DEFAULT '[]'::jsonb NOT NULL,
    report_markdown text DEFAULT ''::text NOT NULL,
    report_url text DEFAULT ''::text NOT NULL,
    error_message text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    analysis jsonb DEFAULT '{}'::jsonb NOT NULL,
    title text DEFAULT ''::text NOT NULL
);


--
-- Name: copilot_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.copilot_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    document_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    byok_only boolean DEFAULT false NOT NULL,
    CONSTRAINT copilot_sessions_kind_valid CHECK ((kind = ANY (ARRAY['interview'::text, 'work'::text, 'casual'::text])))
);


--
-- Name: cue_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cue_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company text,
    persona text,
    stages jsonb DEFAULT '[]'::jsonb NOT NULL,
    ai_summary text,
    raw_transcript text,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: day_shutdowns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_shutdowns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shutdown_date date NOT NULL,
    done text DEFAULT ''::text NOT NULL,
    pending text DEFAULT ''::text NOT NULL,
    tomorrow text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    platform text NOT NULL,
    last_seen_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT devices_platform_valid CHECK ((platform = ANY (ARRAY['mac'::text, 'ios'::text, 'android'::text, 'web'::text, 'linux'::text, 'windows'::text])))
);


--
-- Name: doc_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doc_id uuid NOT NULL,
    ord integer NOT NULL,
    content text NOT NULL,
    embedding real[],
    embedding_vec public.vector(384),
    token_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    filename text NOT NULL,
    mime text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text DEFAULT ''::text NOT NULL,
    chunk_count integer DEFAULT 0 NOT NULL,
    token_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documents_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'extracting'::text, 'embedding'::text, 'ready'::text, 'failed'::text, 'deleting'::text])))
);


--
-- Name: domain_reputation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.domain_reputation (
    domain text NOT NULL,
    reports_count integer DEFAULT 0 NOT NULL,
    unhelpful_count integer DEFAULT 0 NOT NULL,
    blocked boolean DEFAULT false NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dynamic_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dynamic_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    type text NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT dynconfig_type_valid CHECK ((type = ANY (ARRAY['int'::text, 'float'::text, 'string'::text, 'bool'::text, 'json'::text])))
);


--
-- Name: dynamic_config_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dynamic_config_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task text NOT NULL,
    bucket_day date NOT NULL,
    provider text DEFAULT ''::text NOT NULL,
    calls integer DEFAULT 0 NOT NULL,
    tokens_in_sum bigint DEFAULT 0 NOT NULL,
    tokens_out_sum bigint DEFAULT 0 NOT NULL,
    cost_usd_cents integer DEFAULT 0 NOT NULL,
    latency_p50_ms integer DEFAULT 0 NOT NULL,
    latency_p95_ms integer DEFAULT 0 NOT NULL,
    latency_p99_ms integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: editor_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.editor_participants (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT editor_participants_role_valid CHECK ((role = ANY (ARRAY['owner'::text, 'interviewer'::text, 'participant'::text, 'viewer'::text])))
);


--
-- Name: editor_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.editor_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    type text DEFAULT 'practice'::text NOT NULL,
    task_id uuid,
    language text NOT NULL,
    is_frozen boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    visibility text DEFAULT 'shared'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    free_tier boolean DEFAULT false NOT NULL,
    code text DEFAULT ''::text NOT NULL,
    CONSTRAINT editor_rooms_visibility_valid CHECK ((visibility = ANY (ARRAY['private'::text, 'shared'::text])))
);


--
-- Name: embedding_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embedding_models (
    id integer NOT NULL,
    name text NOT NULL,
    dim integer NOT NULL
);


--
-- Name: embedding_models_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.embedding_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: embedding_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.embedding_models_id_seq OWNED BY public.embedding_models.id;


--
-- Name: energy_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.energy_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    logged_at timestamp with time zone DEFAULT now() NOT NULL,
    level smallint NOT NULL,
    note text,
    CONSTRAINT energy_logs_level_check CHECK (((level >= 1) AND (level <= 5)))
);


--
-- Name: eval_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eval_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dataset_name text NOT NULL,
    task text DEFAULT ''::text NOT NULL,
    triggered_by text NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    parsed_total integer DEFAULT 0 NOT NULL,
    parsed_ok integer DEFAULT 0 NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    git_commit text DEFAULT ''::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: events_synced; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events_synced (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    google_event_id text NOT NULL,
    google_etag text NOT NULL,
    title text NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: external_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    source text NOT NULL,
    topic_atlas_node_id text,
    topic_free_text text DEFAULT ''::text NOT NULL,
    duration_min integer NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT external_activity_duration_min_check CHECK (((duration_min > 0) AND (duration_min <= 600))),
    CONSTRAINT external_activity_source_check CHECK ((source = ANY (ARRAY['leetcode'::text, 'coursera'::text, 'hackerrank'::text, 'youtube'::text, 'book'::text, 'article'::text, 'course'::text, 'other'::text])))
);


--
-- Name: focus_reflections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_reflections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id text NOT NULL,
    focus_mode text NOT NULL,
    duration_seconds integer NOT NULL,
    grade smallint,
    notes text DEFAULT ''::text NOT NULL,
    task_pinned text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT focus_reflections_duration_seconds_check CHECK ((duration_seconds >= 0)),
    CONSTRAINT focus_reflections_grade_check CHECK (((grade IS NULL) OR ((grade >= 1) AND (grade <= 5)))),
    CONSTRAINT focus_reflections_mode_valid CHECK ((focus_mode = ANY (ARRAY['pomodoro'::text, 'stopwatch'::text, 'free'::text, 'plan'::text, 'pinned'::text, 'countdown'::text])))
);


--
-- Name: follow_up_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follow_up_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    question_ru text NOT NULL,
    question_en text NOT NULL,
    answer_hint text,
    order_num integer DEFAULT 0 NOT NULL
);


--
-- Name: goal_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    target_company text DEFAULT ''::text NOT NULL,
    target_level text DEFAULT ''::text NOT NULL,
    target_text text DEFAULT ''::text NOT NULL,
    default_target_days integer,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hone_daily_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_daily_briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    brief_date date NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hone_daily_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_daily_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan_date date NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    regenerated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hone_focus_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_focus_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan_id uuid,
    plan_item_id text DEFAULT ''::text NOT NULL,
    pinned_title text DEFAULT ''::text NOT NULL,
    mode text DEFAULT 'free'::text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    pomodoros_completed integer DEFAULT 0 NOT NULL,
    seconds_focused integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hone_focus_mode_valid CHECK ((mode = ANY (ARRAY['pomodoro'::text, 'stopwatch'::text, 'free'::text, 'plan'::text, 'pinned'::text, 'countdown'::text])))
);


--
-- Name: hone_listening_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_listening_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    audio_url text NOT NULL,
    transcript_md text DEFAULT ''::text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hone_listening_audio_url_nonempty CHECK ((char_length(audio_url) > 0)),
    CONSTRAINT hone_listening_title_nonempty CHECK ((char_length(title) > 0))
);


--
-- Name: hone_note_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_note_folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hone_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    size_bytes integer DEFAULT 0 NOT NULL,
    folder_id uuid,
    kind text DEFAULT 'note'::text NOT NULL,
    raw_analysis_json jsonb,
    encrypted boolean DEFAULT false NOT NULL,
    public_slug text,
    published_at timestamp with time zone,
    embedding real[],
    embedding_vec public.vector(384),
    embedding_model_id integer,
    embedded_at timestamp with time zone,
    file_path text,
    started_at timestamp with time zone,
    imported_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ai_excluded boolean DEFAULT false NOT NULL,
    CONSTRAINT hone_notes_kind_valid CHECK ((kind = ANY (ARRAY['note'::text, 'cue'::text, 'daily'::text])))
);


--
-- Name: hone_plan_skips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_plan_skips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    skill_key text NOT NULL,
    skipped_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hone_queue_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_queue_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    source text DEFAULT 'user'::text NOT NULL,
    status text DEFAULT 'todo'::text NOT NULL,
    item_date date DEFAULT CURRENT_DATE NOT NULL,
    skill_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hone_queue_source_valid CHECK ((source = ANY (ARRAY['ai'::text, 'user'::text]))),
    CONSTRAINT hone_queue_status_valid CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text])))
);


--
-- Name: hone_reading_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_reading_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    source_kind text NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    title text NOT NULL,
    body_md text NOT NULL,
    total_chars integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    book_chapter integer,
    book_total_chapters integer,
    CONSTRAINT hone_reading_materials_chapter_bounds CHECK ((((book_chapter IS NULL) OR (book_chapter >= 0)) AND ((book_total_chapters IS NULL) OR (book_total_chapters > 0)) AND ((book_chapter IS NULL) OR (book_total_chapters IS NULL) OR (book_chapter <= book_total_chapters)))),
    CONSTRAINT hone_reading_materials_source_kind_check CHECK ((source_kind = ANY (ARRAY['paste'::text, 'url'::text, 'pdf'::text, 'epub'::text, 'book'::text]))),
    CONSTRAINT hone_reading_source_kind_valid CHECK ((source_kind = ANY (ARRAY['paste'::text, 'url'::text, 'pdf'::text, 'epub'::text]))),
    CONSTRAINT hone_reading_total_chars_nonneg CHECK ((total_chars >= 0))
);


--
-- Name: hone_reading_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_reading_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    material_id uuid NOT NULL,
    chars_read integer DEFAULT 0 NOT NULL,
    chars_total integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    ai_summary_score integer,
    summary_md text DEFAULT ''::text NOT NULL,
    CONSTRAINT hone_reading_sessions_score_range CHECK (((ai_summary_score IS NULL) OR ((ai_summary_score >= 0) AND (ai_summary_score <= 100))))
);


--
-- Name: hone_streak_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_streak_days (
    user_id uuid NOT NULL,
    day date NOT NULL,
    focused_seconds integer DEFAULT 0 NOT NULL,
    sessions_count integer DEFAULT 0 NOT NULL,
    qualifies_streak boolean DEFAULT false NOT NULL
);


--
-- Name: hone_streak_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_streak_state (
    user_id uuid NOT NULL,
    current_streak integer DEFAULT 0 NOT NULL,
    longest_streak integer DEFAULT 0 NOT NULL,
    last_qualified date,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hone_task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_task_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    author_kind text NOT NULL,
    body_md text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hone_task_comments_author_valid CHECK ((author_kind = ANY (ARRAY['ai'::text, 'user'::text])))
);


--
-- Name: hone_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'todo'::text NOT NULL,
    kind text NOT NULL,
    source text NOT NULL,
    title text NOT NULL,
    brief_md text DEFAULT ''::text NOT NULL,
    skill_key text,
    deep_link text DEFAULT ''::text NOT NULL,
    recommended_reading text[] DEFAULT '{}'::text[] NOT NULL,
    priority smallint DEFAULT 0 NOT NULL,
    due_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    manual_kind_override boolean DEFAULT false NOT NULL,
    scheduled_start timestamp with time zone,
    scheduled_duration_min integer,
    CONSTRAINT hone_tasks_kind_valid CHECK ((kind = ANY (ARRAY['algo'::text, 'sysdesign'::text, 'quiz'::text, 'reflection'::text, 'reading'::text, 'ml'::text, 'custom'::text]))),
    CONSTRAINT hone_tasks_source_valid CHECK ((source = ANY (ARRAY['ai'::text, 'user'::text]))),
    CONSTRAINT hone_tasks_status_valid CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'in_review'::text, 'done'::text, 'dismissed'::text])))
);


--
-- Name: hone_user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_user_settings (
    user_id uuid NOT NULL,
    active_track text DEFAULT 'general'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    english_active boolean DEFAULT false NOT NULL,
    CONSTRAINT hone_user_settings_active_track_check CHECK ((active_track = ANY (ARRAY['general'::text, 'dev'::text, 'ml'::text, 'english'::text, 'go'::text])))
);


--
-- Name: hone_vocab_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_vocab_queue (
    user_id uuid NOT NULL,
    word text NOT NULL,
    translation text DEFAULT ''::text NOT NULL,
    context_md text DEFAULT ''::text NOT NULL,
    source_material uuid,
    box smallint DEFAULT 0 NOT NULL,
    next_review_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_count integer DEFAULT 0 NOT NULL,
    learned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hone_vocab_box_range CHECK (((box >= 0) AND (box <= 5)))
);


--
-- Name: hone_whiteboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hone_whiteboards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    state_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    severity text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    affected_services text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT incidents_severity_valid CHECK ((severity = ANY (ARRAY['minor'::text, 'major'::text, 'critical'::text])))
);


--
-- Name: intelligence_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    surface text NOT NULL,
    severity public.insight_severity DEFAULT 'nudge'::public.insight_severity NOT NULL,
    anchor text NOT NULL,
    headline text NOT NULL,
    evidence text DEFAULT ''::text NOT NULL,
    interpret text DEFAULT ''::text NOT NULL,
    lever text DEFAULT ''::text NOT NULL,
    deep_link text DEFAULT ''::text NOT NULL,
    event_id uuid,
    skill_key text DEFAULT ''::text NOT NULL,
    codex_slug text DEFAULT ''::text NOT NULL,
    track_id uuid,
    dismissed_at timestamp with time zone,
    acted_at timestamp with time zone,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL
);


--
-- Name: interview_prep_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interview_prep_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    parsed_cv jsonb DEFAULT '{}'::jsonb NOT NULL,
    parsed_jd jsonb DEFAULT '{}'::jsonb NOT NULL,
    cv_text text,
    jd_text text,
    company text,
    role text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);


--
-- Name: interviewer_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interviewer_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    motivation text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    decision_note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT interviewer_applications_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: learning_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_state (
    user_id uuid NOT NULL,
    mode public.learning_mode DEFAULT 'explore'::public.learning_mode NOT NULL,
    fork_branch public.fork_branch,
    explore_started_at timestamp with time zone DEFAULT now() NOT NULL,
    committed_track_id uuid,
    committed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_state_commit_requires_track CHECK (((mode = 'explore'::public.learning_mode) OR (committed_track_id IS NOT NULL)))
);


--
-- Name: llm_invocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_invocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    task_kind text DEFAULT ''::text NOT NULL,
    user_id uuid,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cost_estimate_cents integer DEFAULT 0 NOT NULL,
    latency_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT llm_invocations_cost_nonneg CHECK ((cost_estimate_cents >= 0)),
    CONSTRAINT llm_invocations_latency_nonneg CHECK ((latency_ms >= 0)),
    CONSTRAINT llm_invocations_tokens_nonneg CHECK (((input_tokens >= 0) AND (output_tokens >= 0)))
);


--
-- Name: llm_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_models (
    id bigint NOT NULL,
    model_id text NOT NULL,
    label text NOT NULL,
    provider text NOT NULL,
    provider_id text DEFAULT 'openrouter'::text NOT NULL,
    is_virtual boolean DEFAULT false NOT NULL,
    tier text DEFAULT 'free'::text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    context_window integer,
    cost_per_1k_input_usd numeric(8,6),
    cost_per_1k_output_usd numeric(8,6),
    use_for_insight boolean DEFAULT true NOT NULL,
    use_for_mock boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT llm_models_tier_valid CHECK ((tier = ANY (ARRAY['free'::text, 'pro'::text, 'max'::text])))
);


--
-- Name: llm_models_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.llm_models_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: llm_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.llm_models_id_seq OWNED BY public.llm_models.id;


--
-- Name: llm_runtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_runtime_config (
    id integer DEFAULT 1 NOT NULL,
    chain_order text[] DEFAULT '{}'::text[] NOT NULL,
    task_map jsonb DEFAULT '{}'::jsonb NOT NULL,
    virtual_chains jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT llm_runtime_singleton CHECK ((id = 1))
);


--
-- Name: mock_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mock_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    code_snapshot text,
    stress_snapshot jsonb,
    tokens_used integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mock_messages_role_valid CHECK ((role = ANY (ARRAY['system'::text, 'user'::text, 'assistant'::text])))
);


--
-- Name: mock_pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mock_pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id uuid,
    ai_assist boolean DEFAULT false NOT NULL,
    current_stage_idx smallint DEFAULT 0 NOT NULL,
    verdict public.mock_pipeline_verdict DEFAULT 'in_progress'::public.mock_pipeline_verdict NOT NULL,
    total_score real,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mock_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mock_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id uuid,
    task_id uuid,
    section text NOT NULL,
    difficulty text NOT NULL,
    status text NOT NULL,
    duration_min integer DEFAULT 45 NOT NULL,
    voice_mode boolean DEFAULT false NOT NULL,
    paired_user_id uuid,
    llm_model text,
    stress_profile jsonb,
    ai_report jsonb,
    ai_assist boolean DEFAULT false NOT NULL,
    running_summary text DEFAULT ''::text NOT NULL,
    summary_model text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mock_status_valid CHECK ((status = ANY (ARRAY['created'::text, 'in_progress'::text, 'finished'::text, 'abandoned'::text])))
);


--
-- Name: mock_task_test_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mock_task_test_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    input text NOT NULL,
    expected_output text DEFAULT ''::text NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    ordinal integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mock_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mock_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stage_kind text NOT NULL,
    language text DEFAULT 'any'::text NOT NULL,
    difficulty smallint DEFAULT 2 NOT NULL,
    title text NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    sample_io_md text DEFAULT ''::text NOT NULL,
    reference_criteria jsonb DEFAULT '[]'::jsonb NOT NULL,
    reference_solution_md text DEFAULT ''::text NOT NULL,
    functional_requirements_md text DEFAULT ''::text NOT NULL,
    time_limit_min integer DEFAULT 30 NOT NULL,
    ai_strictness_profile_id uuid,
    llm_model text,
    active boolean DEFAULT true NOT NULL,
    created_by_admin_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: note_yjs_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.note_yjs_updates (
    seq bigint NOT NULL,
    note_id uuid NOT NULL,
    user_id uuid NOT NULL,
    update_data bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: note_yjs_updates_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.note_yjs_updates_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: note_yjs_updates_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.note_yjs_updates_seq_seq OWNED BY public.note_yjs_updates.seq;


--
-- Name: notification_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_prefs (
    user_id uuid NOT NULL,
    telegram_chat_id text,
    channel_enabled jsonb DEFAULT '{"in_app": true, "telegram": true}'::jsonb NOT NULL,
    weekly_report_enabled boolean DEFAULT true NOT NULL,
    skill_decay_warnings_enabled boolean DEFAULT true NOT NULL,
    silence_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    channel text NOT NULL,
    subject_template text DEFAULT ''::text NOT NULL,
    body_template text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oauth_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_user_id text NOT NULL,
    access_token_enc bytea,
    refresh_token_enc bytea,
    token_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT oauth_provider_valid CHECK ((provider = ANY (ARRAY['yandex'::text, 'telegram'::text])))
);


--
-- Name: personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personas (
    id text NOT NULL,
    label text NOT NULL,
    hint text DEFAULT ''::text NOT NULL,
    icon_emoji text DEFAULT '💬'::text NOT NULL,
    brand_gradient text DEFAULT ''::text NOT NULL,
    suggested_task text DEFAULT ''::text NOT NULL,
    system_prompt text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pipeline_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stage_id uuid NOT NULL,
    user_answer text,
    ai_feedback jsonb,
    score integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    ideal_answer_md text,
    diff_annotations jsonb,
    replay_generated_at timestamp with time zone
);


--
-- Name: pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    kind text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: podcast_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.podcast_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6c7af0'::text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: podcast_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.podcast_progress (
    user_id uuid NOT NULL,
    podcast_id uuid NOT NULL,
    listened_sec integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: podcasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.podcasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title_ru text NOT NULL,
    title_en text NOT NULL,
    description text,
    section text NOT NULL,
    duration_sec integer NOT NULL,
    audio_key text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    host text,
    category_id uuid,
    episode_num integer,
    cover_url text,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    user_id uuid NOT NULL,
    char_class text DEFAULT 'novice'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT char_class_valid CHECK ((char_class = ANY (ARRAY['novice'::text, 'algorithmist'::text, 'dba'::text, 'backend_dev'::text, 'architect'::text, 'communicator'::text, 'ascendant'::text])))
);


--
-- Name: provider_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_links (
    user_id uuid NOT NULL,
    provider text NOT NULL,
    external_id text NOT NULL,
    external_tier text,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_links_provider_valid CHECK ((provider = ANY (ARRAY['yookassa'::text, 'tbank'::text])))
);


--
-- Name: resistance_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resistance_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    logged_at timestamp with time zone DEFAULT now() NOT NULL,
    text text NOT NULL,
    focus_session_id uuid,
    task_id uuid,
    CONSTRAINT resistance_log_text_check CHECK ((length(text) > 0))
);


--
-- Name: resource_promotion_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_promotion_signals (
    url text NOT NULL,
    atlas_node_id text NOT NULL,
    user_count integer DEFAULT 0 NOT NULL,
    avg_quality real,
    last_user_added_at timestamp with time zone DEFAULT now() NOT NULL,
    promoted_at timestamp with time zone,
    blocked_reason text,
    deprecated_at timestamp with time zone,
    deprecated_reason text
);


--
-- Name: skill_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_nodes (
    user_id uuid NOT NULL,
    node_key text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    unlocked_at timestamp with time zone,
    decayed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_nodes_progress_check CHECK (((progress >= 0) AND (progress <= 100)))
);


--
-- Name: speaking_exercises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speaking_exercises (
    id text NOT NULL,
    level text NOT NULL,
    topic text DEFAULT ''::text NOT NULL,
    prompt text NOT NULL,
    audio_url text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT speaking_exercises_level_valid CHECK ((level = ANY (ARRAY['B1'::text, 'B2'::text, 'C1'::text])))
);


--
-- Name: speaking_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speaking_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_session_id text NOT NULL,
    exercise_id text NOT NULL,
    prompt text NOT NULL,
    user_transcript text DEFAULT ''::text NOT NULL,
    pronunciation_score smallint,
    fluency_score smallint,
    coach_feedback text DEFAULT ''::text NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT speaking_sessions_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT speaking_sessions_fluency_score_check CHECK (((fluency_score IS NULL) OR ((fluency_score >= 0) AND (fluency_score <= 100)))),
    CONSTRAINT speaking_sessions_pronunciation_score_check CHECK (((pronunciation_score IS NULL) OR ((pronunciation_score >= 0) AND (pronunciation_score <= 100))))
);


--
-- Name: stage_default_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stage_default_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stage_kind text NOT NULL,
    body text NOT NULL,
    expected_answer_md text DEFAULT ''::text NOT NULL,
    reference_criteria jsonb DEFAULT '[]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stage_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stage_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    stages_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    usage_count integer DEFAULT 0 NOT NULL,
    is_builtin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: step_checkpoint_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.step_checkpoint_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    track_id uuid NOT NULL,
    step_index smallint NOT NULL,
    score integer NOT NULL,
    attempts jsonb DEFAULT '[]'::jsonb NOT NULL,
    passed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT step_checkpoint_attempts_passed_score CHECK (((passed_at IS NULL) OR (score >= 70))),
    CONSTRAINT step_checkpoint_attempts_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: stripe_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_customers (
    user_id uuid NOT NULL,
    stripe_customer_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stripe_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stripe_subscription_id text NOT NULL,
    stripe_price_id text NOT NULL,
    status text NOT NULL,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stripe_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_webhook_events (
    event_id text NOT NULL,
    event_type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    user_id uuid NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    status public.subscription_status DEFAULT 'active'::public.subscription_status NOT NULL,
    provider text,
    provider_sub_id text,
    current_period_end timestamp with time zone,
    grace_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_plan_valid CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text, 'max'::text]))),
    CONSTRAINT subscriptions_provider_valid CHECK (((provider IS NULL) OR (provider = ANY (ARRAY['yookassa'::text, 'tbank'::text, 'admin'::text]))))
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    contact_kind text NOT NULL,
    contact_value text NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    internal_note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT support_tickets_contact_kind_check CHECK ((contact_kind = 'telegram'::text)),
    CONSTRAINT support_tickets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: sync_tombstones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_tombstones (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    table_name text NOT NULL,
    row_id uuid NOT NULL,
    deleted_at timestamp with time zone DEFAULT now() NOT NULL,
    origin_device_id uuid
);


--
-- Name: sync_tombstones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_tombstones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_tombstones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_tombstones_id_seq OWNED BY public.sync_tombstones.id;


--
-- Name: task_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    body text NOT NULL,
    expected_answer_md text DEFAULT ''::text NOT NULL,
    reference_criteria jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_templates (
    task_id uuid NOT NULL,
    language text NOT NULL,
    starter_code text NOT NULL,
    CONSTRAINT task_templates_lang_valid CHECK ((language = ANY (ARRAY['go'::text, 'python'::text, 'javascript'::text, 'typescript'::text, 'sql'::text])))
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title_ru text NOT NULL,
    title_en text NOT NULL,
    description_ru text NOT NULL,
    description_en text NOT NULL,
    difficulty text NOT NULL,
    section text NOT NULL,
    time_limit_sec integer DEFAULT 60 NOT NULL,
    memory_limit_mb integer DEFAULT 256 NOT NULL,
    solution_hint text,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    avg_rating numeric(3,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    skill_keys text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT tasks_difficulty_valid CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text]))),
    CONSTRAINT tasks_section_valid CHECK ((section = ANY (ARRAY['algorithms'::text, 'sql'::text, 'go'::text, 'system_design'::text, 'behavioral'::text])))
);


--
-- Name: telemetry_consent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_consent (
    user_id uuid NOT NULL,
    surface text NOT NULL,
    opted_in boolean NOT NULL,
    consent_version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT telemetry_consent_surface_check CHECK ((surface = ANY (ARRAY['hone'::text, 'cue'::text, 'web'::text])))
);


--
-- Name: telemetry_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    surface text NOT NULL,
    name text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT telemetry_events_name_check CHECK (((length(name) > 0) AND (length(name) <= 64))),
    CONSTRAINT telemetry_events_surface_check CHECK ((surface = ANY (ARRAY['hone'::text, 'cue'::text, 'web'::text])))
);


--
-- Name: test_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    input text NOT NULL,
    expected_output text NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    order_num integer DEFAULT 0 NOT NULL
);


--
-- Name: track_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.track_steps (
    track_id uuid NOT NULL,
    step_index smallint NOT NULL,
    title text NOT NULL,
    description_md text DEFAULT ''::text NOT NULL,
    skill_keys text[] DEFAULT '{}'::text[] NOT NULL,
    required_kind public.track_step_kind NOT NULL,
    required_count integer DEFAULT 1 NOT NULL,
    recommended_reading text[] DEFAULT '{}'::text[] NOT NULL,
    estimated_minutes integer DEFAULT 25 NOT NULL,
    checkpoint_skill_keys text[] DEFAULT '{}'::text[] NOT NULL,
    reflection_required boolean DEFAULT false NOT NULL,
    graduation_mock_section text,
    external_resources jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT track_steps_required_count_check CHECK ((required_count > 0)),
    CONSTRAINT track_steps_step_index_check CHECK ((step_index >= 0))
);


--
-- Name: tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    tagline text DEFAULT ''::text NOT NULL,
    description_md text DEFAULT ''::text NOT NULL,
    cover_image_url text DEFAULT ''::text NOT NULL,
    accent_color text DEFAULT '#FFFFFF'::text NOT NULL,
    curator_id uuid,
    estimated_weeks smallint DEFAULT 4 NOT NULL,
    difficulty text DEFAULT 'medium'::text NOT NULL,
    is_curated boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    company_focus text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tracks_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text]))),
    CONSTRAINT tracks_estimated_weeks_check CHECK (((estimated_weeks >= 1) AND (estimated_weeks <= 52)))
);


--
-- Name: tutor_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    student_id uuid NOT NULL,
    title text NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    due_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    archived_at timestamp with time zone,
    due_notified_at timestamp with time zone,
    CONSTRAINT tutor_assignments_self_link CHECK ((tutor_id <> student_id)),
    CONSTRAINT tutor_assignments_title_nonempty CHECK ((char_length(title) > 0))
);


--
-- Name: tutor_directory_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_directory_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    student_id uuid NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_directory_applications_msg_len CHECK ((length(message) <= 500)),
    CONSTRAINT tutor_directory_applications_no_self CHECK ((tutor_id <> student_id)),
    CONSTRAINT tutor_directory_applications_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])))
);


--
-- Name: tutor_directory_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_directory_profiles (
    user_id uuid NOT NULL,
    visible boolean DEFAULT false NOT NULL,
    bio_md text DEFAULT ''::text NOT NULL,
    expertise_tags text[] DEFAULT '{}'::text[] NOT NULL,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    timezone text,
    availability_md text,
    linkedin_url text,
    github_url text,
    verified_at timestamp with time zone,
    application_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_directory_profiles_app_msg_len CHECK (((application_message IS NULL) OR (length(application_message) <= 500))),
    CONSTRAINT tutor_directory_profiles_bio_len CHECK ((length(bio_md) <= 2000))
);


--
-- Name: tutor_event_rsvps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_event_rsvps (
    event_id uuid NOT NULL,
    student_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutor_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    student_id uuid,
    circle_id uuid,
    title text NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    duration_min integer NOT NULL,
    meet_url text DEFAULT ''::text NOT NULL,
    capacity integer,
    status text DEFAULT 'scheduled'::text NOT NULL,
    cancellation_reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    session_note text DEFAULT ''::text NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    shared_at timestamp with time zone,
    shared_content_md text DEFAULT ''::text NOT NULL,
    CONSTRAINT tutor_events_cancellation_pair CHECK ((((status = 'cancelled'::text) AND (char_length(cancellation_reason) > 0)) OR ((status <> 'cancelled'::text) AND (cancellation_reason = ''::text)))),
    CONSTRAINT tutor_events_capacity_circle_only CHECK (((capacity IS NULL) OR ((capacity > 0) AND (circle_id IS NOT NULL)))),
    CONSTRAINT tutor_events_duration_bounded CHECK (((duration_min > 0) AND (duration_min <= 480))),
    CONSTRAINT tutor_events_self_link CHECK (((student_id IS NULL) OR (tutor_id <> student_id))),
    CONSTRAINT tutor_events_session_note_pair CHECK (((status = 'completed'::text) OR ((status <> 'completed'::text) AND (session_note = ''::text)))),
    CONSTRAINT tutor_events_status_valid CHECK ((status = ANY (ARRAY['scheduled'::text, 'cancelled'::text, 'completed'::text]))),
    CONSTRAINT tutor_events_target_xor CHECK ((((student_id IS NOT NULL) AND (circle_id IS NULL)) OR ((student_id IS NULL) AND (circle_id IS NOT NULL)))),
    CONSTRAINT tutor_events_title_nonempty CHECK ((char_length(title) > 0)),
    CONSTRAINT tutor_events_visibility_valid CHECK ((visibility = ANY (ARRAY['private'::text, 'shared'::text])))
);


--
-- Name: tutor_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    code text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_by uuid,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    target_user_id uuid,
    CONSTRAINT tutor_invites_code_format CHECK (((char_length(code) >= 6) AND (char_length(code) <= 32)))
);


--
-- Name: tutor_path_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_path_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    path_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    student_id uuid NOT NULL,
    current_step integer DEFAULT 0 NOT NULL,
    total_steps integer NOT NULL,
    snapshot_atlas_node_keys text[] DEFAULT ARRAY[]::text[] NOT NULL,
    snapshot_resource_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    archived_at timestamp with time zone,
    CONSTRAINT tutor_path_assignments_self_check CHECK ((tutor_id <> student_id)),
    CONSTRAINT tutor_path_assignments_step_le_total CHECK ((current_step <= total_steps)),
    CONSTRAINT tutor_path_assignments_steps_nonneg CHECK ((current_step >= 0)),
    CONSTRAINT tutor_path_assignments_total_nonneg CHECK ((total_steps >= 0))
);


--
-- Name: tutor_reading_paths; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_reading_paths (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    atlas_node_keys text[] DEFAULT ARRAY[]::text[] NOT NULL,
    resource_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    assigned_count integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_reading_paths_name_nonempty CHECK (((char_length(name) >= 1) AND (char_length(name) <= 240))),
    CONSTRAINT tutor_reading_paths_node_count CHECK (((array_length(atlas_node_keys, 1) IS NULL) OR (array_length(atlas_node_keys, 1) <= 200))),
    CONSTRAINT tutor_reading_paths_resource_count CHECK (((array_length(resource_ids, 1) IS NULL) OR (array_length(resource_ids, 1) <= 200)))
);


--
-- Name: tutor_session_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_session_notes (
    tutor_id uuid NOT NULL,
    student_id uuid NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutor_shared_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_shared_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    title text NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    student_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_shared_materials_title_check CHECK ((char_length(title) > 0))
);


--
-- Name: tutor_students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    student_id uuid NOT NULL,
    invite_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    note text DEFAULT ''::text NOT NULL,
    CONSTRAINT tutor_students_self_link CHECK ((tutor_id <> student_id))
);


--
-- Name: user_app_installs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_app_installs (
    user_id uuid NOT NULL,
    app text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    app_version text DEFAULT ''::text NOT NULL,
    CONSTRAINT user_app_installs_app_valid CHECK ((app = ANY (ARRAY['web'::text, 'hone'::text, 'cue'::text])))
);


--
-- Name: user_atlas_node_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_atlas_node_prefs (
    user_id uuid NOT NULL,
    node_key text NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_atlas_node_prefs_no_pin_and_hide CHECK ((NOT (pinned AND hidden)))
);


--
-- Name: user_atlas_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_atlas_nodes (
    user_id uuid NOT NULL,
    node_key text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    section text NOT NULL,
    kind text DEFAULT 'small'::text NOT NULL,
    cluster text DEFAULT 'custom'::text NOT NULL,
    source_text text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_atlas_nodes_kind_check CHECK ((kind = ANY (ARRAY['hub'::text, 'keystone'::text, 'notable'::text, 'small'::text])))
);


--
-- Name: user_atlas_struggle_marks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_atlas_struggle_marks (
    user_id uuid NOT NULL,
    atlas_node_id text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    confidence real DEFAULT 0.5 NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_atlas_struggle_marks_atlas_node_id_nonempty CHECK ((length(atlas_node_id) > 0)),
    CONSTRAINT user_atlas_struggle_marks_confidence_range CHECK (((confidence >= (0.0)::double precision) AND (confidence <= (1.0)::double precision))),
    CONSTRAINT user_atlas_struggle_marks_source_valid CHECK ((source = ANY (ARRAY['cue_session'::text, 'hone_reflection'::text, 'mock_stage'::text, 'manual'::text])))
);


--
-- Name: user_bans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_bans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    reason text NOT NULL,
    issued_by uuid,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    lifted_at timestamp with time zone,
    lifted_by uuid
);


--
-- Name: user_byok_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_byok_keys (
    user_id uuid NOT NULL,
    provider text NOT NULL,
    api_key_encrypted text NOT NULL,
    validated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind public.user_goal_kind NOT NULL,
    status public.user_goal_status DEFAULT 'active'::public.user_goal_status NOT NULL,
    title text NOT NULL,
    notes_md text DEFAULT ''::text NOT NULL,
    deadline date,
    track_id uuid,
    skill_keys text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: user_google_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_google_credentials (
    user_id uuid NOT NULL,
    access_token_encrypted text NOT NULL,
    refresh_token_encrypted text NOT NULL,
    expiry timestamp with time zone NOT NULL,
    scopes text[] NOT NULL,
    calendar_id text DEFAULT 'primary'::text NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_milestones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    goal_id uuid NOT NULL,
    week_index integer NOT NULL,
    week_start date NOT NULL,
    title text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    category text DEFAULT 'practice'::text NOT NULL,
    done_at timestamp with time zone,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_milestones_category_valid CHECK ((category = ANY (ARRAY['foundation'::text, 'practice'::text, 'mock'::text, 'reflection'::text, 'final'::text])))
);


--
-- Name: user_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notifications (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    channel text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    payload jsonb,
    priority integer DEFAULT 0 NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_notifications_id_seq OWNED BY public.user_notifications.id;


--
-- Name: user_persona_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_persona_tracks (
    user_id uuid NOT NULL,
    track public.track_kind NOT NULL,
    seniority text,
    primary_track boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_persona_tracks_seniority_valid CHECK (((seniority IS NULL) OR (seniority = ANY (ARRAY['junior'::text, 'middle'::text, 'senior'::text, 'lead'::text]))))
);


--
-- Name: user_primary_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_primary_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind public.primary_goal_kind NOT NULL,
    target_company text,
    target_level text,
    target_text text,
    target_date date,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid NOT NULL,
    reported_id uuid NOT NULL,
    reason text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_reports_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: user_resource_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_resource_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    resource_url text NOT NULL,
    atlas_node_id text,
    kind text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    reflection_text text,
    reflection_note_id uuid,
    reflection_takeaways jsonb DEFAULT '[]'::jsonb NOT NULL,
    reflection_quality_score real,
    extracted_topics text[] DEFAULT '{}'::text[] NOT NULL,
    confusion_flag boolean DEFAULT false NOT NULL,
    CONSTRAINT user_resource_log_kind_valid CHECK ((kind = ANY (ARRAY['clicked'::text, 'finished'::text, 'skipped'::text, 'unhelpful'::text, 'reflection_submitted'::text]))),
    CONSTRAINT user_resource_log_reflection_pair CHECK (((reflection_note_id IS NULL) OR (reflection_text IS NOT NULL)))
);


--
-- Name: user_resource_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_resource_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    atlas_node_id text,
    step_track_id uuid,
    step_index smallint,
    url text NOT NULL,
    action text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    auto_promoted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_resource_overrides_action_valid CHECK ((action = ANY (ARRAY['added'::text, 'hidden'::text, 'replaced'::text, 'reordered'::text, 'unhelpful'::text]))),
    CONSTRAINT user_resource_overrides_step_pair CHECK (((step_track_id IS NULL) = (step_index IS NULL))),
    CONSTRAINT user_resource_overrides_target CHECK (((atlas_node_id IS NOT NULL) OR ((step_track_id IS NOT NULL) AND (step_index IS NOT NULL))))
);


--
-- Name: user_room_quota; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_room_quota (
    user_id uuid NOT NULL,
    active_count integer DEFAULT 0 NOT NULL,
    tier text DEFAULT 'free'::text NOT NULL,
    period_start timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_room_quota_tier_valid CHECK ((tier = ANY (ARRAY['free'::text, 'pro'::text])))
);


--
-- Name: user_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_tracks (
    user_id uuid NOT NULL,
    track_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    current_step smallint DEFAULT 0 NOT NULL,
    progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    paused_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: user_xp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_xp (
    user_id uuid NOT NULL,
    total_xp bigint DEFAULT 0 NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    last_xp_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    locale text DEFAULT 'ru'::text NOT NULL,
    display_name text,
    avatar_url text DEFAULT ''::text NOT NULL,
    ai_insight_model text,
    onboarding_completed_at timestamp with time zone,
    focus_class text DEFAULT ''::text NOT NULL,
    storage_quota_bytes bigint DEFAULT 1073741824 NOT NULL,
    storage_used_bytes bigint DEFAULT 0 NOT NULL,
    storage_tier text DEFAULT 'free'::text NOT NULL,
    storage_recomputed_at timestamp with time zone,
    vault_kdf_salt bytea,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tutor_mode_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT users_focus_class_valid CHECK ((focus_class = ANY (ARRAY[''::text, 'algo'::text, 'backend'::text, 'system'::text, 'concurrency'::text, 'ds'::text]))),
    CONSTRAINT users_locale_valid CHECK ((locale = ANY (ARRAY['ru'::text, 'en'::text]))),
    CONSTRAINT users_role_valid CHECK ((role = ANY (ARRAY['user'::text, 'interviewer'::text, 'admin'::text, 'ai_tutor'::text]))),
    CONSTRAINT users_storage_tier_valid CHECK ((storage_tier = ANY (ARRAY['free'::text, 'pro'::text, 'pro_plus'::text])))
);


--
-- Name: whiteboard_room_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whiteboard_room_participants (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whiteboard_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whiteboard_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    snapshot bytea,
    expires_at timestamp with time zone NOT NULL,
    visibility text DEFAULT 'shared'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    free_tier boolean DEFAULT false NOT NULL,
    CONSTRAINT whiteboard_rooms_visibility_valid CHECK ((visibility = ANY (ARRAY['private'::text, 'shared'::text])))
);


--
-- Name: whiteboard_yjs_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whiteboard_yjs_updates (
    seq bigint NOT NULL,
    whiteboard_id uuid NOT NULL,
    user_id uuid NOT NULL,
    update_data bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whiteboard_yjs_updates_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whiteboard_yjs_updates_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whiteboard_yjs_updates_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whiteboard_yjs_updates_seq_seq OWNED BY public.whiteboard_yjs_updates.seq;


--
-- Name: writing_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_prompts (
    id text NOT NULL,
    level text NOT NULL,
    topic text NOT NULL,
    prompt text NOT NULL,
    rubric_md text DEFAULT ''::text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT writing_prompts_level_check CHECK ((level = ANY (ARRAY['B1'::text, 'B2'::text, 'C1'::text])))
);


--
-- Name: atlas_edges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atlas_edges ALTER COLUMN id SET DEFAULT nextval('public.atlas_edges_id_seq'::regclass);


--
-- Name: embedding_models id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_models ALTER COLUMN id SET DEFAULT nextval('public.embedding_models_id_seq'::regclass);


--
-- Name: llm_models id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_models ALTER COLUMN id SET DEFAULT nextval('public.llm_models_id_seq'::regclass);


--
-- Name: note_yjs_updates seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_yjs_updates ALTER COLUMN seq SET DEFAULT nextval('public.note_yjs_updates_seq_seq'::regclass);


--
-- Name: sync_tombstones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_tombstones ALTER COLUMN id SET DEFAULT nextval('public.sync_tombstones_id_seq'::regclass);


--
-- Name: user_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications ALTER COLUMN id SET DEFAULT nextval('public.user_notifications_id_seq'::regclass);


--
-- Name: whiteboard_yjs_updates seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboard_yjs_updates ALTER COLUMN seq SET DEFAULT nextval('public.whiteboard_yjs_updates_seq_seq'::regclass);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- IRRECOVERABLE: drop schema via 00001 down to reset
-- +goose StatementEnd

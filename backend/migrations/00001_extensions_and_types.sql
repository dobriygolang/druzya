-- Extensions (pgcrypto / uuid-ossp / vector) + ENUM types.

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
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: copilot_report_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.copilot_report_status AS ENUM (
    'pending',
    'running',
    'ready',
    'failed'
);


--
-- Name: fork_branch; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fork_branch AS ENUM (
    'de',
    'mle',
    'none'
);


--
-- Name: insight_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.insight_severity AS ENUM (
    'cruise',
    'nudge',
    'warn',
    'critical'
);


--
-- Name: learning_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.learning_mode AS ENUM (
    'explore',
    'commit',
    'deep'
);


--
-- Name: mock_pipeline_verdict; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mock_pipeline_verdict AS ENUM (
    'in_progress',
    'pass',
    'fail',
    'cancelled'
);


--
-- Name: mock_task_language; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mock_task_language AS ENUM (
    'any',
    'go',
    'python',
    'java',
    'kotlin',
    'cpp',
    'js',
    'ts',
    'rust',
    'sql'
);


--
-- Name: primary_goal_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.primary_goal_kind AS ENUM (
    'top_tier_co',
    'any_senior',
    'ml_offer',
    'english_target',
    'custom'
);


--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status AS ENUM (
    'active',
    'cancelled',
    'expired'
);


--
-- Name: track_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.track_kind AS ENUM (
    'dev',
    'dev_senior',
    'sysanalyst',
    'product_analyst',
    'qa',
    'english',
    'devops',
    'ml',
    'de'
);


--
-- Name: track_step_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.track_step_kind AS ENUM (
    'kata',
    'mock',
    'codex_read',
    'focus_block'
);


--
-- Name: user_goal_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_goal_kind AS ENUM (
    'job_target',
    'skill_target',
    'track_target'
);


--
-- Name: user_goal_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_goal_status AS ENUM (
    'active',
    'paused',
    'done',
    'abandoned'
);


-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
-- Re-create goose's tracking table so the reset can finish its bookkeeping;
-- without this, goose tries to delete this version row in a dropped schema
-- and crashes with SQLSTATE 42P01.
CREATE TABLE goose_db_version (
    id SERIAL PRIMARY KEY,
    version_id BIGINT NOT NULL,
    is_applied BOOLEAN NOT NULL,
    tstamp TIMESTAMP NULL DEFAULT NOW()
);
INSERT INTO goose_db_version (version_id, is_applied) VALUES (0, true);
-- +goose StatementEnd

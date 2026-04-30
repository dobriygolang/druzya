# druz9 alerts — Grafana Cloud import

Two declarative rule files live here:

- `critical.yml` — pages on-call (SEV1: site-down, error rate, runaway spend).
- `warning.yml` — notify-only (SEV2: queue depth, kata difficulty, slow LLM).

Both follow [Prometheus alerting rules format](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/) and import unchanged into Grafana Cloud.

## Importing into Grafana Cloud

1. Sign in → **Alerts & IRM** → **Alert rules**.
2. Click **+ Add new** → **From YAML file** (top-right).
3. Paste contents of `critical.yml`. Set:
   - **Folder**: `druz9`
   - **Group name**: `druz9-critical`
   - **Data source**: your Prometheus / Mimir source (the one ingesting druz9 metrics).
4. Repeat for `warning.yml`.
5. Verify rules are loaded under **druz9 / druz9-critical** and **druz9 / druz9-warning**.

## Telegram notification channel

We reuse the existing `@druz9_bot` (the same bot that handles user notifications via `/api/v1/notify/telegram/webhook`).

1. Get the **alerting chat_id** — a private group containing on-call only. Find it in `.env.prod.generated`:
   - `TELEGRAM_OPS_CHAT_ID` (e.g. `-1002312345678`).
2. Get the **bot token** from `TELEGRAM_BOT_TOKEN` in the same file.
3. In Grafana Cloud → **Alerts & IRM** → **Contact points** → **+ Add contact point**:
   - **Name**: `druz9-telegram`
   - **Integration**: `Telegram`
   - **BOT API Token**: paste `TELEGRAM_BOT_TOKEN`
   - **Chat ID**: paste `TELEGRAM_OPS_CHAT_ID`
   - **Message**: leave default (Grafana renders alert summary + description).
4. **Test** → expect a message in the ops chat within ~3 seconds.

## Notification policy

Under **Alerts & IRM** → **Notification policies**:

| Match label              | Contact point        | Group wait | Repeat |
|--------------------------|----------------------|------------|--------|
| `severity = critical`    | `druz9-telegram`     | 30s        | 1h     |
| `severity = warning`     | `druz9-telegram`     | 5m         | 12h    |

Both policies share the chat for now (small team). Split into a paging
integration (PagerDuty / Opsgenie) when the team grows past two on-callers.

## Postgres exporter (TODO)

`postgres_exporter` is **not** in `infra/docker-compose.prod.yml` yet. Once it's added, enable the commented `PostgresDown` rule in `critical.yml`. Reference: <https://github.com/prometheus-community/postgres_exporter>.

# druz9 Grafana dashboards

Six dashboards in this folder. All target the metrics emitted by `shared/pkg/metrics` (the `druz9_*` namespace).

| File                       | UID              | Purpose                                                      |
|----------------------------|------------------|--------------------------------------------------------------|
| `druz9-overview.json`      | `druz9-overview` | One-screen "is it healthy?" — p99, error rate, error logs.   |
| `druz9-tech.json`          | `druz9-tech`     | HTTP / WS / Postgres / Redis system view.                    |
| `druz9-llm.json`           | `druz9-llm`      | OpenRouter spend, token throughput, latency by model.        |
| `druz9-business.json`      | `druz9-business` | Match start rate, mock dropout, ratings churn.               |
| `druz9-arena.json`         | `druz9-arena`    | Arena RPS, queue depth, match results, win rate.             |
| `druz9-auth.json`          | `druz9-auth`     | Login success/fail, OAuth provider mix, DAU.                 |

## Importing into Grafana Cloud

1. **Dashboards** → **+ Create** → **Import**.
2. **Upload JSON file** → select one of the files in this folder.
3. Set the **datasource**:
   - Prometheus panels → your Mimir/Prometheus source.
   - Loki panels → your Loki source.
4. Click **Import**.

Repeat for each dashboard. Dashboards are tagged `druz9` so you can filter them in the Dashboards listing.

## Importing into self-hosted Grafana

If you switch off Grafana Cloud, drop the files in `/etc/grafana/provisioning/dashboards/` and add a provider block referencing `infra/observability/grafana-dashboards-provider.yml` (already wired in `docker-compose.obs.yml`).

## Modifying

Always update **dashboards in this repo first**, then re-import. Hand-edits in the Grafana UI are lost on the next import.

When you change a metric name or label, search the JSON files (`grep -l 'druz9_metric_name'`) to find every panel that references it.

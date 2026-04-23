# druz9 — On-call runbook

Quick reference for common production incidents on **druz9.online** (VPS, single-node docker-compose). Roles: anyone with SSH to the server can use this.

Pin Grafana Cloud dashboards before reading: <https://grafana.com> → druz9 folder.

---

## SSH / common entry points

```bash
ssh root@druz9.online                       # server access
cd /opt/druz9 && docker compose -f infra/docker-compose.prod.yml ps   # service status
docker compose -f infra/docker-compose.prod.yml logs -f --tail=200 api
```

---

## 1. "Сайт не открывается"

Symptoms: `https://druz9.online` returns nothing / connection refused / cert error / 502.

```bash
# 1. Is nginx up?
docker compose -f infra/docker-compose.prod.yml ps nginx
docker logs druz9-nginx --tail 100

# 2. Cert valid?
echo | openssl s_client -connect druz9.online:443 2>/dev/null | openssl x509 -noout -dates

# 3. DNS resolves to our VPS?
dig +short druz9.online            # should match `curl -s ifconfig.me` on the server

# 4. Cloudflare proxy mode (orange/grey cloud) — check CF dashboard.
```

**Fixes:**
- nginx down → `docker compose restart nginx`. If config is broken: `docker compose exec nginx nginx -t` to find the error, fix `infra/nginx/nginx.prod.conf`, redeploy.
- Cert expired → `docker compose run --rm certbot renew` (cron should run weekly; the compose service is named `certbot`).
- DNS mismatch → check Cloudflare A record points to the right VPS IP.
- Cloudflare 5xx → toggle proxy off (grey cloud) for a minute to bypass; check CF status page.

---

## 2. "API 500-ит"

Symptoms: Grafana `APIErrorRateHigh` alert fires, or users report errors.

```bash
# 1. Recent errors in Loki (or directly):
docker logs druz9-api --tail 500 | grep -iE 'level=error|panic|FATAL'

# 2. Postgres pool saturated?
docker exec druz9-postgres psql -U druz9 -c \
  "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# 3. Judge0 reachable?
curl -s http://localhost:2358/about | jq .

# 4. OpenRouter quota?
docker logs druz9-api --tail 200 | grep -i 'openrouter\|llm'
```

**Fixes:**
- Crash loop → check the panic stack in logs, redeploy a fix or roll back: `git checkout <prev-sha> && ./infra/scripts/deploy.sh`.
- DB pool exhausted → temporary: `docker compose restart api` (drops idle conns). Permanent: tune `POSTGRES_MAX_CONNS` env or add a connection-count alert.
- Judge0 down → see §6 below.
- OpenRouter throttled / out of credit → see §5.

---

## 3. "Очередь не подбирает"

Symptoms: arena queue depth growing in Grafana (alert `ArenaQueueDepthGrowing`) or users complain matches don't start.

```bash
# 1. Matchmaker worker alive?
docker logs druz9-api --tail 200 | grep -i 'matchmak\|arena.queue\|arena.match'

# 2. Inspect the queue keys directly:
docker exec druz9-redis redis-cli --scan --pattern 'arena:queue:*'
docker exec druz9-redis redis-cli ZCARD arena:queue:1v1

# 3. Stuck players? Pop one:
docker exec druz9-redis redis-cli ZRANGE arena:queue:1v1 0 4 WITHSCORES
```

**Fixes:**
- Worker not running → `docker compose restart api` (matchmaker is in-process).
- Queue stuck on a phantom user (user disconnected, didn't get cleaned up) → `redis-cli ZREM arena:queue:1v1 <userId>`.
- Persistent failures → check application logs around `arena.matchmaker.tick` for errors.

---

## 4. "Telegram-бот не отвечает"

Symptoms: users report `@druz9_bot` doesn't respond to deep-link auth, or notifications stopped.

```bash
# 1. Webhook reachable from Telegram side?
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq .

# 2. Did our endpoint get hits recently?
docker logs druz9-api --tail 500 | grep '/api/v1/notify/telegram/webhook'

# 3. Webhook secret matches what Telegram sends?
grep TELEGRAM_WEBHOOK_SECRET .env.prod
```

**Fixes:**
- `getWebhookInfo` shows last_error_date / last_error_message → the URL is unreachable. Verify HTTPS on `druz9.online` and that nginx routes `/api/v1/notify/telegram/webhook` to the API.
- Re-set the webhook (URL changed):
  ```bash
  curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
    -d "url=https://druz9.online/api/v1/notify/telegram/webhook" \
    -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
  ```
- Secret mismatch → align `.env.prod` and the value in the `setWebhook` call above; restart api.

---

## 5. "OpenRouter превысил квоту"

Symptoms: Grafana `LLMSpendDailyHigh` alert, or LLM calls return 402/429 in api logs.

```bash
docker logs druz9-api --tail 200 | grep -iE 'openrouter|429|402'
```

**Fixes (immediate — buy time):**
1. Switch the default free model to a cheaper one in `.env.prod`:
   ```
   LLM_DEFAULT_FREE=mistralai/mistral-7b-instruct:free
   ```
2. Restart api: `docker compose restart api`.

**Permanent:**
- Top-up OpenRouter at <https://openrouter.ai>.
- Lower per-session message cap (today: 10 msg/min). Edit `aimockApp.SendMessage` rate limit.

---

## 6. Judge0 issues

Symptoms: arena/code-editor submissions hang, `Judge0BacklogHigh` alert.

```bash
docker compose -f infra/docker-compose.prod.yml ps | grep judge0
docker logs druz9-judge0 --tail 200
docker exec druz9-redis redis-cli LLEN judge0::queue::default
```

**Fixes:**
- Queue swelling → `docker compose restart judge0-worker` (workers are stateless).
- Server crash → `docker compose restart judge0-server`. If persistent, switch off Judge0 (set `JUDGE0_URL=disabled` in `.env.prod` and restart api → submissions return 503 instead of hanging).

---

## 7. "Postgres диск полный"

Symptoms: write errors in api logs (`disk full`), `df -h` on the host shows `/var/lib/docker` near 100%.

```bash
df -h
docker exec druz9-postgres df -h
docker exec druz9-postgres psql -U druz9 -c \
  "SELECT pg_size_pretty(pg_database_size('druz9'));"
```

**Fixes (in order):**
1. **Backup first**: `./infra/scripts/backup.sh` (writes to MinIO).
2. Identify bloated tables:
   ```bash
   docker exec druz9-postgres psql -U druz9 -c \
     "SELECT relname, pg_size_pretty(pg_total_relation_size(oid))
      FROM pg_class WHERE relkind='r' ORDER BY pg_total_relation_size(oid) DESC LIMIT 10;"
   ```
3. `VACUUM FULL <table>` for the worst offender (locks the table — do off-peak).
4. Truncate or move old log/event tables to ClickHouse.

---

## 8. "Сертификат истёк"

Symptoms: browser shows ERR_CERT_DATE_INVALID; `openssl s_client` shows expired notAfter.

Letsencrypt renewal runs via the `certbot` compose service on a cron schedule, but if it failed silently:

```bash
docker compose -f infra/docker-compose.prod.yml run --rm certbot renew
docker compose -f infra/docker-compose.prod.yml exec nginx nginx -s reload
```

If renewal fails (rate-limited, DNS validation failed): check `docker logs druz9-certbot --tail 200`, fix the underlying issue, then `certbot renew --force-renewal`.

---

## 9. Edge TTS not working

Symptoms: voice playback in mock report falls through to browser TTS; `EdgeTTSStubFiring` warning alert.

```bash
docker logs druz9-api --tail 200 | grep -i 'edge_tts'
```

Most likely Microsoft is throttling our IP or our request format drifted. Workaround: keep frontend's `window.speechSynthesis` fallback (already wired in `MockResultPage.tsx`).

Investigate: `backend/services/ai_mock/infra/edge_tts.go` — try a fresh `X-RequestId`, ensure the `Origin` and `User-Agent` headers match a current Edge release.

---

## 10. Common emergency commands

```bash
# Roll back to previous deployment:
git -C /opt/druz9 log --oneline -10
git -C /opt/druz9 checkout <sha>
./infra/scripts/deploy.sh

# Drain api gracefully (matchmaker finishes ongoing matches first):
docker compose stop api
# Wait for the worker drain to settle (see logs), then bring back up:
docker compose up -d api

# One-off DB query:
docker exec -it druz9-postgres psql -U druz9

# One-off Redis query:
docker exec -it druz9-redis redis-cli
```

---

## Escalation

If an issue is not in this runbook AND you can't fix in 15min, **page the second on-call** (Telegram alerts go to the ops chat — reply with `@here` to escalate). Default response window: 30min for critical, 4h for warning.

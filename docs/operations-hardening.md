# Operations Hardening Checklist

## 1) Deploy Gate

- All deploys must pass:
  - `npm run verify`
  - GitHub Actions `CI` workflow on `main`
- Render build command is set to: `npm ci && npm run verify`.
- `npm run verify` includes smoke tests.
- Run `npm run test:critical-db` before major releases.

## 2) Health Monitoring & Render Keep-Alive (Free Tier)

Render free tier allows **750 hours/month** per web service. One instance awake 24/7 uses ~**720 h/month** — within the limit.

### Keep-alive ping (no database)

- URL: `/api/ping`
- Public, no login
- Returns `200` with `{ "ok": true, "live": true }`
- Use this for UptimeRobot and GitHub cron so Render stays awake without waking Neon on every ping.

Production URL:

`https://welding-app-jhhc.onrender.com/api/ping`

### Full health check (app + database)

- URL: `/api/health`
- Checks database with `SELECT 1`
- Returns `503` if DB is down

### GitHub keep-alive (included in repo)

- Workflow: `.github/workflows/uptime-monitor.yml`
- Frequency: every **5 minutes**
- Required secret: **`PING_URL`** = `https://welding-app-jhhc.onrender.com/api/ping`

Setup:

1. GitHub repo → **Settings → Secrets and variables → Actions**
2. New secret: `PING_URL` = `https://welding-app-jhhc.onrender.com/api/ping`
   - **No quotes**, no spaces, no trailing newline (a bad secret causes `curl: URL rejected`).
3. **Actions → Uptime Monitor → Run workflow** to verify

If the secret is missing or malformed, the workflow falls back to the default URL above.

Enable failure alerts: GitHub repo settings → notify on Actions failures.

### UptimeRobot (optional backup)

1. [uptimerobot.com](https://uptimerobot.com) → Add monitor → **HTTP(s)**
2. URL: `https://welding-app-jhhc.onrender.com/api/ping`
3. Interval: **5 minutes**
4. Save

GitHub + UptimeRobot both pinging the same service still counts as **one** Render instance — not double usage.

## 3) Backup Routine

Daily backup command:

```bash
DATABASE_URL=... npm run db:backup
```

Daily macOS scheduler:

```bash
npm run db:backup:install-daily
```

Detailed setup: `docs/database-backups.md`.

Restore command:

```bash
DATABASE_URL=... npm run db:restore -- ./backups/<file>.dump
```

Retention recommendation:
- Keep last 7 daily backups
- Keep last 4 weekly backups
- Store at least one copy outside server provider

## 4) Monthly Restore Drill

- Pick latest backup.
- Restore into a staging database.
- Log result date/time and success/failure.

## 5) Incident Response (Fast Path)

1. Check `/api/health`.
2. If DB down, pause user operations and restore latest backup to standby DB.
3. Switch `DATABASE_URL` to recovered DB.
4. Verify login, sales create, payment create, and dashboard load.

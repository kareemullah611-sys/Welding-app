# Operations Hardening Checklist

## 1) Deploy Gate

- All deploys must pass:
  - `npm run verify`
  - GitHub Actions `CI` workflow on `main`
- Railway build command is set to: `npm ci --include=dev && npm run verify && npx prisma generate && npx prisma migrate deploy`.
- `npm run verify` includes smoke tests.
- Run `npm run test:critical-db` before major releases.

## 2) Health Monitoring

### Keep-alive ping (no database)

- URL: `/api/ping`
- Public, no login
- Returns `200` with `{ "ok": true, "live": true }`
- Use this for external uptime monitors so pings don't hit the database.

Production URL:

`https://welding-app-production.up.railway.app/api/ping`

### Full health check (app + database)

- URL: `/api/health`
- Checks database with `SELECT 1`
- Returns `503` if DB is down

### Uptime monitor (optional)

1. [uptimerobot.com](https://uptimerobot.com) → Add monitor → **HTTP(s)**
2. URL: `https://welding-app-production.up.railway.app/api/ping`
3. Interval: **5 minutes**
4. Save

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

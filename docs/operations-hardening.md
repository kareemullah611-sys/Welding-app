# Operations Hardening Checklist

## 1) Deploy Gate

- All deploys must pass:
  - `npm run verify`
  - GitHub Actions `CI` workflow on `main`
- Render build command is set to: `npm ci && npm run verify`.
- `npm run verify` includes smoke tests.
- Run `npm run test:critical-db` before major releases.

## 2) Health Monitoring

- Health endpoint: `/api/health`
- Success means:
  - app process is alive
  - database round-trip check passed
- Failure returns HTTP `503`.

Recommended monitor setup:
- Check interval: 1 minute
- Alert on: 2 consecutive failures
- Alert destination: email + WhatsApp/Slack

## 3) Backup Routine

Daily backup command:

```bash
DATABASE_URL=... npm run db:backup
```

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

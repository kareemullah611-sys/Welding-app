# Database Backups

Use provider backups plus independent `pg_dump` backups.

## Daily `pg_dump` backup

Create a local secret file:

```bash
cp .env.example .env.backup
chmod 600 .env.backup
```

Edit `.env.backup` and set:

```bash
DIRECT_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
BACKUP_DIR="/Users/kareemullah/Backups/welding-app"
BACKUP_RETENTION_DAYS="30"
```

Run one manual backup:

```bash
BACKUP_ENV_FILE=.env.backup npm run db:backup
```

Install the daily macOS scheduler:

```bash
npm run db:backup:install-daily
```

Default schedule is daily at `02:15`. To change it:

```bash
BACKUP_HOUR=3 BACKUP_MINUTE=30 npm run db:backup:install-daily
```

## Where backups are saved

Backups are saved in `BACKUP_DIR` as timestamped files:

```text
welding_app_YYYYMMDD_HHMMSS.dump
```

The script keeps files for `BACKUP_RETENTION_DAYS` days. Set `BACKUP_RETENTION_DAYS=0` to disable automatic cleanup.

## Restore test

Restore only into a staging/test database first:

```bash
DATABASE_URL="postgresql://..." npm run db:restore -- /path/to/welding_app_YYYYMMDD_HHMMSS.dump
```

After restore, verify:

- Login works.
- Dashboard loads.
- Sale creation works.
- Payment creation works.
- Customer ledger opens.

## Provider backups

Railway Postgres should still have provider backups enabled:

- Daily volume backups.
- Weekly volume backups.
- Monthly volume backups.
- PITR if available.

Independent `pg_dump` backups protect you if provider restore is unavailable or the provider account/project has a problem.

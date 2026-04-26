# Offline-First Architecture Spec

This document defines how the desktop app should work fully offline (including after full power-off), then sync safely when internet returns.

## 1) Target Outcomes

- App opens and works without internet after restart.
- City admin can continue daily operations offline.
- Superadmin can log in offline on approved devices.
- Sync is reliable, auditable, and conflict-aware.
- No silent data loss.

## 2) Package Strategy

- Keep separate packages per city (for isolation policy).
- Keep separate superadmin package.
- Kandahar package may allow superadmin login by policy flag.

Policy flags:
- `CITY_LOCK_NAMES=Kandahar`
- `CITY_LOCK_ALLOW_SUPER_ADMIN=true|false`
- `OFFLINE_LOGIN_SUPER_ADMIN=true|false`

## 3) Local Runtime Components

Each packaged desktop app includes:

1. Local database (SQLite recommended).
2. Local API service layer (same business commands used by UI).
3. Sync worker (background queue processor).
4. Secure credential/session store.

## 4) Local Data Model (Minimum)

All transactional tables (sales, payments, expenses, withdrawals, transfers, customers, etc.) include:

- `id_local` (UUID, local primary key)
- `id_server` (nullable, server row id)
- `sync_status` (`pending | syncing | synced | failed | conflict`)
- `sync_error` (nullable string)
- `version_local` (integer, increments on local edits)
- `version_server` (nullable integer)
- `updated_at_local` (timestamp)
- `updated_at_server` (nullable timestamp)
- `device_id` (string)

Outbox table:

- `queue_id` (UUID)
- `entity_type`
- `entity_local_id`
- `operation` (`create | update | delete`)
- `payload_json`
- `attempt_count`
- `next_retry_at`
- `status` (`pending | syncing | failed | conflict | done`)
- `created_at`
- `updated_at`

## 5) Offline Login Rules

### City Admin
- Must complete one online login on device first.
- Encrypted local auth cache stores login proof + role + city scope.
- Offline login allowed only for same city-scoped user on same device.

### Superadmin
- Must complete one online login on device first.
- Offline login allowed only when `OFFLINE_LOGIN_SUPER_ADMIN=true`.
- Device approval required (registered device list).

## 6) Sync Protocol

### Push Flow (device -> server)
1. Read next pending outbox item.
2. Send idempotent request with:
   - `device_id`
   - `request_id` (unique)
   - `entity_type`
   - `id_local`
   - `id_server` (if known)
   - `base_version_server` (if known)
3. Server responds:
   - `applied` with server ids/versions, or
   - `conflict` with server snapshot, or
   - `error`.
4. Update local row + queue status.

### Pull Flow (server -> device)
- Poll (or websocket later) for changed rows after `last_sync_cursor`.
- Upsert into local DB.
- Preserve local pending changes; mark conflicts if same record differs.

## 7) Conflict Policy

Default policy:
- Financial rows: **manual review required**.
- Master rows (non-financial): latest-write-wins is allowed.

When conflict occurs:
- Keep local data unchanged.
- Store server snapshot in conflict payload.
- Mark row/queue `conflict`.
- Show in `Audit & Sync` page with options:
  - `Accept Server`
  - `Keep Local (resend)`
  - `Merge` (where supported)

## 8) Audit & Sync UI (Required)

Add `Audit & Sync` module in sidebar:

- Tabs: `Pending`, `Synced`, `Failed`, `Conflict`.
- Each log row shows:
  - action, entity, user, timestamp
  - sync badge
  - retry/edit/discard actions (for pending/failed)
  - conflict resolver (for conflicts)

## 9) Safety Guards

- Idempotency key on every write request.
- Server-side unique `request_id` per device to prevent duplicate writes.
- Atomic server transactions for financial records + journal entries.
- Block “success” when journal posting fails.
- Strict city scope enforcement on every sync write.

## 10) Rollout Plan

### Phase A (Pilot: Kandahar)
- Build local DB + outbox for `customers`, `sales`, `payments`.
- Enable offline login for city admin only.
- Run pilot 1-2 weeks.

### Phase B
- Add `expenses`, `withdrawals`, `haji transfers`, `bank deposits`.
- Add conflict resolution UI.
- Add superadmin offline login by policy.

### Phase C
- Extend to lots/inventory operations.
- Optimize sync performance for large ledgers.
- Roll out to other cities.

## 11) Acceptance Checklist

- App launches with no internet after reboot.
- Offline login works for previously authenticated user/device.
- Create sale/payment offline, restart app, entry still pending.
- Reconnect internet, entry syncs and becomes `synced`.
- Conflict can be resolved from `Audit & Sync`.
- No duplicate journal entries after reconnect retries.

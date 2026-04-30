# Offline Feature Gate

This project enforces an **offline-by-default** rule for dashboard modules.

## Rule

Any dashboard page that performs mutating API calls (`POST`, `PUT`, `PATCH`, `DELETE`) must include offline primitives.

Minimum required primitives:

1. `useOffline()`
2. Queue/snapshot awareness:
   - `queuedItems`, or
   - `showOfflineSnapshot`, or
   - `readOfflineReadSnapshot` / `writeOfflineReadSnapshot`

## Enforcement

The gate runs via:

```bash
npm run test:offline-gate
```

It is included in:

```bash
npm run verify
```

If violated, verify fails and the feature is not considered complete.

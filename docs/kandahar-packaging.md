# Kandahar Packaging Guide (APK + Mac)

This guide creates a city-specific Kandahar package while keeping superadmin as central source of truth.

## 1. Deploy Kandahar Service (separate backend)

Create a dedicated Render service for Kandahar with its own database.

Set required env vars:

- `DATABASE_URL=...`
- `JWT_SECRET=...`
- `NEXT_PUBLIC_APP_URL=https://<kandahar-service>.onrender.com`
- `CITY_LOCK_NAMES=Kandahar`
- `CITY_LOCK_ALLOW_SUPER_ADMIN=true` (set `false` to disallow superadmin login in this package)

Notes:
- `CITY_LOCK_NAMES=Kandahar` ensures non-Kandahar city admins cannot log in to this package.
- Superadmin can still see latest Kandahar data from this isolated service.

## 2. Android APK (Capacitor)

First-time setup:

```bash
npm install
npm run package:android:init
```

Sync Kandahar URL into Android shell:

```bash
CAPACITOR_SERVER_URL=https://<kandahar-service>.onrender.com npm run package:android:sync
npm run package:android:open
```

Then in Android Studio:
1. Build `Release` APK from `Build > Build Bundle(s) / APK(s) > Build APK(s)`.
2. Share the generated APK with Kandahar users.

## 3. Mac App (DMG via Electron)

Set the production URL in:

- [electron/app-config.json](/Users/kareemullah/Desktop/welding-app/electron/app-config.json)

Example:

```json
{
  "startUrl": "https://<kandahar-service>.onrender.com"
}
```

Build DMG:

```bash
npm install
npm run package:mac:dist
```

Output:
- `release/mac/*.dmg`

## 4. Local Verification

Quick local run of Mac shell against local dev server:

```bash
npm run dev
ELECTRON_START_URL=http://127.0.0.1:3000 npm run package:mac:dev
```

## 5. Ongoing Lots Behavior

For half-sold ongoing lots:
- Keep the same lot identity and status (`ongoing`).
- Carry remaining stock only in city package.
- Superadmin remains lot master across cities.
- City package continues sales against remaining quantity and syncs to superadmin when internet returns.

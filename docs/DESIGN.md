# MRF Hardware — Design & Product Guide

Single reference for how the app is structured, how it should look, and how new screens should be built. Based on the current codebase (Next.js 14, city-admin-first UX, offline-capable desktop).

---

## 1. Product identity

| Item | Value |
|------|--------|
| **Name** | MRF Hardware Management System |
| **Desktop app** | MRF Hardware (`productName` in `package.json`) |
| **Business** | Multi-city welding materials import — lots, godowns, sales, payments, Haji settlement |
| **Production URL** | `https://welding-app-jhhc.onrender.com` |
| **Brand mark** | Shield badge + “MRF” wordmark (login, sidebar) |

**Tone:** Professional business software for daily counter work — not a consumer app. City staff are the primary daily users; super admin uses the same shell with more modules.

---

## 2. Users & roles

### Super Admin
- All cities, lots, suppliers, investors, openings, global reports
- Manages users, bank accounts, settings
- Sees city payments in settlement context

### City Admin (primary daily user)
- Scoped to **one city** only
- Daily loop: **Sale → Payment → Expense → Withdrawal → Haji transfer**
- Afghanistan cities: cash-only operations (no bank/cheque complexity in UI where enforced)
- Pakistan cities: PKR; Afghanistan: AFN + USD per city currency setup

**Design rule:** Every city-admin screen must work **offline** after one online sync (see §8).

---

## 3. Information architecture

### Shell
```
Login → AppLayout (Sidebar + main panel)
         ├── Dashboard (role-specific)
         ├── Module pages (DataTable + Modals)
         └── Settings / Activity / Search
```

### Module map

| Group | Modules | Roles |
|-------|---------|-------|
| **Home** | Dashboard | both |
| **Procurement** | Lots, Investors | super_admin |
| **Liabilities** | Suppliers, Shipping Lines, Agents, Intermediaries | super_admin |
| **Daily work** | Sales, Payments, Expenses, Withdrawals, Haji, Customers, Cheques, Bank Deposits | city (+ payments for super) |
| **Stock** | Godowns, Inventory, City Transfers | city |
| **Finance** | Analytics, Profit Report, Accounts, Reports | mixed |
| **System** | Search, Activity Feed, Assistant, Openings, Settings, Bank Accounts | mixed |

Source of truth for nav: `src/components/layout/Sidebar.tsx` (`superAdminNavGroups`, `cityAdminNavGroups`).

### API layout
- REST under `/api/v1/<module>`
- Auth: JWT in httpOnly cookie; `withAuth` on handlers
- Responses: `{ success, data, error?, pagination? }` via `src/lib/api-response.ts`

---

## 4. Visual language

### Colors (warm industrial)

| Role | Usage |
|------|--------|
| **Primary** | Burgundy/rust gradient — primary actions, brand (`--primary`, `.btn-primary`) |
| **Background** | Warm cream gradient on `body` (`#fff8ef` → `#f7f4ef`) |
| **Cards** | White / frosted glass — `.card`, `.stat-card`, `.shell-panel` |
| **Borders** | `#e8dccf`, `#d9d0c2` — soft tan, not cold gray |
| **Semantic** | Green = money in / success; Rose = out / danger; Amber = warning / offline |

Defined in: `src/app/globals.css` (`:root` CSS variables + `@layer components`).

### Typography
- **UI:** Avenir Next / Segoe UI stack on `body`
- **Headings:** Trebuchet MS — slightly tight tracking
- **Numbers:** Prefer `tabular-nums` on money and counts
- **Labels in forms:** Short, uppercase tracking for field labels in quickforms (`.quickform-embed label`)

### Spacing & radius
- Cards/modals: `rounded-2xl` / `1.35rem`
- Inputs: `rounded-xl`, height ~36–40px (`h-9` in quickforms)
- Page padding: `shell-panel` with `p-4 sm:p-5 lg:p-6`

---

## 5. Core components

Location: `src/components/ui/index.tsx` (and shadcn primitives in `src/components/ui/`).

| Component | Use |
|-----------|-----|
| `PageHeader` | Title + subtitle + optional action on full pages |
| `DataTable` | Paginated lists with search/filters |
| `Modal` | Create/edit dialogs; supports `inline` for embed |
| `StatsCard` | Legacy stats; dashboard uses custom `MetricCard` |
| `StatusBadge` | sale / payment / lot status chips |
| `formatNumber`, `formatDate` | Consistent display helpers |

### Buttons
- `.btn-primary` — main action (gradient burgundy)
- `.btn-secondary` — cancel / secondary
- `.btn-danger` — delete, hard delete, cancel sale

### Inputs
- `.input-field` — text, number, date
- `.select-field` — dropdowns

**Do not** introduce new button/input classes per page — extend globals or pass `className` sparingly.

---

## 6. Page patterns

### Standard list page
1. `PageHeader` with record count
2. Optional offline banner: amber strip “Showing last synced data”
3. `DataTable` with pagination
4. `Modal` for create/edit
5. `useOffline()` for queue overlays on mutating modules

### Dashboard (city admin)
- **Quick action cards** (top) — open iframe quickforms
- **Metric cards** — cash, outstanding, cartons, Haji
- Collapsible “operational details” — cash flow, banks, lots
- File: `src/app/(dashboard)/dashboard/page.tsx`

### Embed mode (`?embed=1`)
Used inside dashboard quickform iframe:
- `AppLayout` strips sidebar — `src/components/layout/AppLayout.tsx`
- Page hides `PageHeader` and table when `isEmbed`
- `Modal` uses `inline={true}` + `hideHeader={true}` — **no second title/close**
- Parent dashboard shell provides **one** title + close button

---

## 7. City dashboard quickforms

### UX rules (implemented)
1. **One close control** — only in dashboard overlay header (44px touch target); iframe has no Dialog overlay or Radix close button
2. **One title** — dashboard header only; embed forms use `hideHeader` + `inline` Modal (full-bleed in iframe)
3. **Mobile** — full `100dvh` sheet on phone; centered `max-w-xl` panel on `sm+`
4. **Essential fields only** — hide lot/notes/cheque extras in embed where possible
5. **Full-width primary button** — “Save sale”, “Save payment”, etc.
6. **Simple controls** — prefer `<select>` over large button grids in embed

### Quickform routes
| Action | URL |
|--------|-----|
| New Sale | `/sales?create=1&embed=1` |
| Receive Payment | `/payments?create=payment&embed=1` |
| Record Expense | `/expenses?create=1&embed=1` |
| Withdrawal | `/personal-withdrawals?create=1&embed=1` |
| Haji Transfer | `/haji-transfers?create=1&embed=1` |
| New Customer | `/customers?create=1&embed=1` |

Close posts `postMessage({ type: 'dashboard-quick-close' })` to parent.

### Field order (city forms)
Always lead with what staff know first:
1. **Date**
2. **Who** (customer / withdrawn by)
3. **What** (detail / amount)
4. **How paid** (method / source) — keep to dropdowns in quickform

---

## 8. Offline & sync

### Current architecture (browser + IndexedDB)
- **Queue:** writes while offline → `useOffline` + `useApi` → sync on reconnect
- **Read cache:** `readOfflineReadSnapshot` / `writeOfflineReadSnapshot` per module
- **Full sync:** `GET /api/v1/offline/sync-all` → hydrates IndexedDB + snapshots
- **Activity feed:** queue status, export/import bundle

Hooks: `src/hooks/useOffline.tsx`, `src/lib/offline-full-sync.ts`

### Offline UX copy
- Amber banner: “Showing last synced data (offline mode)”
- Readiness: `getOfflineFormReadinessError()` when currencies not cached
- Login: cached credentials on device after first online login

### Desktop (Electron)
- Static UI + API proxy to production URL
- Config: `electron/app-config.json` → `startUrl`
- Service worker **disabled** in Electron (API proxy path)

Future target (spec only): `docs/offline-first-architecture.md` (SQLite local DB).

---

## 9. Forms & validation

- Client: Zod schemas in `src/lib/validations.ts`
- Server: same schemas in API routes
- Errors: red box above form fields; never only `alert()`
- Money: never assume tax rate or FX — use source data (AGENTS.md)

### Payments (city)
- Methods: Cash, Bank, Cheque, Online (hidden for Afghanistan)
- Destination: Keep in Office vs Send to Haji
- Full page supports batch queue; **quickform = single save**

### Sales (city)
- Godown → customer → line items
- Stock availability shown when godown selected
- Short stock: explicit confirm state

---

## 10. Language & i18n

- `LangProvider` + `useLang()` — English, Urdu, Pashto
- `LangSwitcher` on login and in header areas
- Nav labels use translation keys (`key` in Sidebar)
- Form labels: prefer plain English for city staff; add `t()` when keys exist

**RTL:** `dir` from `useLang()` on layout root — test Urdu/Pashto on forms and tables.

---

## 11. Layout structure (files)

```
src/
├── app/
│   ├── (dashboard)/          # All authenticated pages
│   │   ├── dashboard/        # Role-specific home + quickforms
│   │   ├── sales|payments|…  # Feature modules
│   │   └── layout.tsx        # Wraps AppLayout
│   ├── api/v1/               # REST handlers
│   ├── login/
│   └── globals.css           # Design tokens + utilities
├── components/
│   ├── layout/               # Sidebar, AppLayout, NotificationBell
│   └── ui/                   # Modal, DataTable, Button, …
├── hooks/
│   ├── useAuth.tsx
│   ├── useApi.ts
│   └── useOffline.tsx
└── lib/                      # Business logic, offline, validations
```

---

## 12. Deployment surfaces

| Surface | Build | Config |
|---------|-------|--------|
| **Web** | `npm run build` | Render + Postgres |
| **Desktop** | `npm run package:mac:dist` | `electron/app-config.json`, `out/` static export |
| **Android** | Capacitor (optional) | `CAPACITOR_SERVER_URL` |

See also: `docs/kandahar-packaging.md`, `docs/operations-hardening.md`

---

## 13. Checklist for new UI work

- [ ] City admin can use it offline after sync?
- [ ] Uses existing `.btn-primary`, `.input-field`, `Modal`, `DataTable`?
- [ ] Mutating page uses `useOffline` + snapshot keys (`mrf-<module>-read-cache-v1`)?
- [ ] Role guard matches Sidebar nav roles?
- [ ] Money displays use `formatNumber` / currency from API?
- [ ] Quickform embed: `hideHeader={isEmbed}`, no duplicate close?
- [ ] Labels short and plain (not long English paragraphs)?

---

## 14. Related documents

| Doc | Purpose |
|-----|---------|
| [README.md](../README.md) | Setup, credentials, business rules |
| [offline-first-architecture.md](./offline-first-architecture.md) | Long-term offline/SQLite spec |
| [offline-feature-gate.md](./offline-feature-gate.md) | CI gate for offline-ready modules |
| [operations-hardening.md](./operations-hardening.md) | Deploy, health, backups |
| [kandahar-packaging.md](./kandahar-packaging.md) | Electron/Android packaging |
| [AGENTS.md](../AGENTS.md) | Agent coding rules |

---

*Last aligned with codebase: city quickform cleanup, `welding-app-jhhc` URL, MRF Hardware desktop naming.*

# Welding App - Product Summary

## What This App Does

Welding App is an end-to-end operations and finance system for a welding materials import/distribution business working across multiple cities and countries (notably Pakistan and Afghanistan).  
It combines inventory, sales, treasury, settlement, and accounting workflows in one role-based web platform.

## Core Business Coverage

- Lot lifecycle management (purchase, costing, distribution, completion/reopen)
- City/godown inventory movement and assignment
- Sales with voucher flow and ledger impact
- Customer payments with method/source handling (cash, bank, cheque, online)
- Supplier and shipping-line payment tracking
- Expenses and personal withdrawals
- Haji transfer/settlement workflows
- Intermediary ledger with deposits and currency exchange
- Investor tracking and transaction history
- City and super-admin dashboards, reports, analytics, and search
- Audit/activity visibility and operational controls

## Roles and Access Model

- `super_admin`: global control across cities, strategic modules (lots, suppliers, intermediaries, admin controls, etc.)
- `city_admin`: city-scoped operations (sales, payments, customers, local treasury/stock workflows)

Access and data scope are enforced through authenticated API routes and role/city checks in backend logic.

## Functional Modules (UI + API)

- Dashboard
- Sales
- Payments
- Customers
- Inventory and Godowns
- Lots and Lot Costing
- Expenses
- Personal Withdrawals
- Haji Transfers
- Bank Accounts and Bank Deposits
- Supplier and Shipping-Line modules
- Intermediaries (ledger, deposits, exchanges)
- Investors
- Reports / Profit Report / Analytics
- Settings and User/City controls
- Activity Feed and Search

## Technical Architecture

- Frontend: Next.js 14 App Router + React + TypeScript + Tailwind CSS
- Backend: Next.js API routes (`src/app/api/v1/*`)
- Database: PostgreSQL with Prisma ORM
- Auth: JWT + httpOnly cookies
- Validation & guards: Zod + server-side business-rule checks
- E2E: Playwright smoke coverage

## Data and Accounting Behavior (High Level)

- Business events (sales, payments, expenses, transfers, etc.) are persisted via module-specific APIs.
- Ledgers and treasury views aggregate these events by role/city/account context.
- Accounting helpers and payment audit utilities exist under `src/lib/*` for consistency checks and posting logic.
- Multi-currency handling is implemented in treasury/intermediary/payment flows with rule-based behavior by module and role.

## Operations and Deployment

- Dev start: `npm run dev`
- Production build: `npm run build`
- Start command: `npm run start` (runs bootstrap script + Next start)
- Bootstrap script applies Prisma sync at startup (`scripts/bootstrap.ts`)
- Render deployment is supported via `render.yaml`

## Current Product Character

This is not a generic CRM. It is a process-heavy operations system tailored for real trading workflows:

- tight coupling between stock, money movement, and settlement
- city-level execution with super-admin oversight
- audit-sensitive ledgers and running-balance views
- frequent use of quick-entry forms for daily operations

## Suggested Use of This Document

Use this summary for:

- stakeholder onboarding
- developer handover
- deployment/context briefing
- preparing a deeper module-by-module SOP or training manual


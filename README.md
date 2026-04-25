# Welding Materials Management System

Multi-city sales, inventory, and financial management web application for a welding materials import business operating across Pakistan and Afghanistan.

## Overview

This system manages the complete business workflow:
- **Lot Management** — Import lots per country with city-wise distribution
- **Sales** — FIFO lot allocation, auto voucher generation, stock checking
- **Payments** — Double-entry tracking with Haji/in-hand routing
- **Inventory** — Master godown view with real-time stock calculation
- **Customer Ledger** — Full transaction history with running balance
- **Haji Settlement** — Per-city, per-lot settlement with overflow handling
- **Expenses & Withdrawals** — Tracked per lot and per city
- **Reports** — Filterable reports with export capability
- **Audit Trail** — Complete who/what/when logging

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend**: Next.js API Routes (REST)
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT with httpOnly cookies
- **Validation**: Zod

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 1. Install Dependencies
```bash
cd welding-app
npm install
```

### 2. Configure Database
```bash
cp .env.example .env
# Edit .env and set your DATABASE_URL
```

### 3. Setup Database
```bash
npx prisma generate
npx prisma db push
npx ts-node prisma/seed.ts
```

### 4. Run Development Server
```bash
npm run dev
# Open http://localhost:3000
```

### 5. Verify Before Deploy
```bash
npm run verify
```
This runs linting plus production build checks.

### Default Login Credentials

| Role | Username | Password |
|------|----------|----------|
| Super Admin | superadmin | admin123 |
| Quetta Admin | quetta_admin | city123 |
| Lahore Admin | lahore_admin | city123 |
| Kabul Admin | kabul_admin | city123 |
| Herat Admin | herat_admin | city123 |

## Architecture

### User Roles
- **Super Admin** — Full access to all cities, lot management, user management
- **City Admin** — Scoped to their city only for sales, payments, expenses

### Multi-Currency
- Pakistan cities: PKR only
- Afghanistan cities: AFN and USD (both supported per city)

### Key Business Rules
1. **FIFO Sales** — Sales auto-assigned to oldest ongoing lot
2. **Stock Checking** — Warns on shortage, marks sale as stock-short
3. **Auto Voucher** — 4-digit city-specific vouchers (wraps at 9999)
4. **Settlement Overflow** — Excess transfers roll to next lot on completion
5. **Discount Routing** — If original lot completed, discount charges against current lot

## Project Structure

```
welding-app/
├── prisma/
│   ├── schema.prisma       # Database schema (26 tables)
│   └── seed.ts             # Initial data seeding
├── src/
│   ├── app/
│   │   ├── api/v1/         # REST API endpoints (16 modules)
│   │   ├── dashboard/      # Dashboard page
│   │   ├── sales/          # Sales management
│   │   ├── payments/       # Payment recording
│   │   ├── customers/      # Customer management + ledger
│   │   ├── lots/           # Lot tracking
│   │   ├── godowns/        # Warehouse management
│   │   ├── inventory/      # Master godown view
│   │   ├── expenses/       # Expense tracking
│   │   ├── personal-withdrawals/
│   │   ├── haji-transfers/ # Settlement transfers
│   │   ├── reports/        # Filterable reports
│   │   ├── settings/       # User/product/city management
│   │   ├── search/         # Universal search
│   │   └── login/          # Authentication
│   ├── components/
│   │   ├── layout/         # Sidebar, AppLayout
│   │   └── ui/             # Reusable components
│   ├── hooks/              # useAuth, useApi
│   ├── lib/                # prisma, auth, validations, middleware
│   └── types/              # TypeScript interfaces
```

## API Summary

93 endpoints across 20 modules. See `api_endpoint_design.md` for full documentation.

| Module | Endpoints |
|--------|-----------|
| Auth | 4 |
| Users | 5 |
| Countries & Cities | 5 |
| Products | 5 |
| Godowns | 7 |
| Inventory | 2 |
| Lots | 9 |
| Customers | 6 |
| Sales | 6 |
| Payments | 5 |
| Expenses | 5 |
| Personal Withdrawals | 6 |
| Haji Transfers | 6 |
| Attachments | 5 |
| Dashboard | 2 |
| Reports | 6 |
| Search | 1 |
| Audit Logs | 1 |
| Notifications | 3 |
| Inventory Thresholds | 4 |

## Deployment

### Recommended: Render

This repo now includes a [render.yaml](/Users/kareemullah/Desktop/welding-app/render.yaml) blueprint for deploying both the web app and PostgreSQL on Render.

```bash
# 1. Push code to GitHub

# 2. In Render, create a new Blueprint and select this repo

# 3. Render will read render.yaml and create:
#    - a free Node web service
#    - a free PostgreSQL database

# 4. In the Render dashboard, set these environment variables:
#    JWT_SECRET
#    NEXT_PUBLIC_APP_URL
#    CLOUDINARY_CLOUD_NAME
#    CLOUDINARY_API_KEY
#    CLOUDINARY_API_SECRET
#    DEEPSEEK_API_KEY
```

Notes:
- The app starts with `npm run start`, which already runs `prisma db push` before `next start`.
- Update the service and database names in [render.yaml](/Users/kareemullah/Desktop/welding-app/render.yaml) if you want different names on Render.
- Free Render services can sleep and have cold starts, so this is best for testing, demos, or low-traffic use.

## Security

- JWT tokens in httpOnly cookies (not accessible via JS)
- Password hashing with bcrypt (12 rounds)
- Role-based access control on every API endpoint
- City-scoped data isolation for city admins
- Input validation with Zod on all endpoints
- Audit logging on all create/update/delete operations

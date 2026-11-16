# Crypto Payment Gateway

NestJS API with **Prisma ORM 8** and **PostgreSQL**.

## Stack

- NestJS 12
- Prisma ORM 8 (`@prisma/orm-postgres`)
- Prisma Postgres (or any PostgreSQL via `DATABASE_URL`)

## Setup

1. Install dependencies (already done if you used the scaffold):

```bash
npm install
```

2. Set `DATABASE_URL` in `.env` (gitignored), or export it in your shell. Prisma CLI scripts read the env var.

3. Apply the starter schema:

```bash
npm run db:init
```

4. Start the API:

```bash
npm run dev
```

Swagger UI: [http://localhost:3000/docs](http://localhost:3000/docs)  
(Authorize with the JWT from login/register.)

### USD wallet + OxaPay

Platform balances are **USD**.

1. Set `OXAPAY_MERCHANT_API_KEY` and webhook URLs (`APP_BASE_URL` / `OXAPAY_CALLBACK_URL`).
2. `POST /payments` creates a USD top-up invoice → user pays crypto on OxaPay.
3. On webhook `paid`, the USD amount is credited to `GET /wallet`.
4. `POST /payouts` debits the wallet and sends crypto via OxaPay Payout API (`OXAPAY_PAYOUT_API_KEY`). User chooses `currency` + `network` (e.g. USDT + TRC20).
5. Failed payouts are refunded to the wallet automatically.
6. Admin overview: `GET /admin/stats` (payment/payout counts & amounts, total wallet balance).

Then register/login:

```bash
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" -d "{\"email\":\"you@example.com\",\"password\":\"password123\",\"name\":\"You\"}"
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d "{\"email\":\"you@example.com\",\"password\":\"password123\"}"
curl http://localhost:3000/auth/me -H "Authorization: Bearer <token>"
```

Default roles `user` and `admin` are seeded on startup. New registrations get `user`. Admins manage roles via `/roles`.

## Useful scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Nest watch mode |
| `npm run db:init` | Apply starter contract to an empty DB |
| `npm run contract:emit` | Emit contract after editing `src/prisma/contract.prisma` |
| `npm run db:update` | Apply schema changes |
| `npm run build` | Production build |

## Project layout

```
src/
  main.ts                 # bootstrap
  app.module.ts           # root module
  app.controller.ts       # /, /health
  config/                 # env configuration
  common/                 # constants, filters
  prisma/                 # PrismaModule + ORM contract/client
  users/                  # UsersModule (controller, service, repository, dto)
  payments/               # USD top-up invoices + webhook
  wallet/                 # USD balance + ledger
  payouts/                # OxaPay withdrawals
  oxapay/                 # Shared OxaPay API client
```



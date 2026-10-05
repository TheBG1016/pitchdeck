# Investment Pool Evaluation

A one-event investment simulation for administrators and team leaders. Registered teams are imported from CSV; selected participants receive virtual wallets; shortlisted participants issue fixed-price stock. PostgreSQL transactions enforce the trading rules.

## Requirements

- Node.js 24 and npm
- A Neon project with a `production` branch
- A separate Neon development branch for testing and seed data

## Connect Neon

From this directory:

```powershell
npm i -g neon@latest
neon login
neon skills -y
neon mcp -y
neon link --project-id nameless-base-59945950 --branch production -y
neon config init
neon config plan
neon deploy
```

The committed `neon.ts` is intentionally minimal:

```ts
import { defineConfig } from "@neon/config/v1";

export default defineConfig({});
```

`neon deploy` applies Neon service configuration. It does **not** deploy the Next.js site or create its SQL tables. The link command pulls `DATABASE_URL` into a local ignored environment file. Confirm that `neon config plan` names the intended project and branch before deploying. `.neon`, `.env`, and `.env.local` are ignored by Git.

For development, create and select an isolated branch:

```powershell
neon checkout investment-pool-dev --create
npm ci
npm run db:migrate
```

After development verification, switch back to `production`, review its current schema, and run the migration there:

```powershell
neon checkout production
neon config plan
neon deploy
npm run db:migrate
```

The migration is recorded in `schema_migrations` and will not run twice. Inspect an existing production schema before applying it; the migration creates the application tables and one event.

## Development setup

`npm run dev` starts the site at `http://localhost:3000`. Use `npm run build` for a production build. `DATABASE_URL` is required for authenticated pages and API routes. The application uses the pooled Neon connection string and runs on the Node.js runtime.

Create the first admin after migrating. Pass the password through an environment variable so it does not appear in shell command history:

```powershell
$secret = Read-Host 'Initial admin password' -AsSecureString
$env:ADMIN_INITIAL_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
npm run admin:create -- admin@example.com
Remove-Item Env:ADMIN_INITIAL_PASSWORD
```

The password must be at least 12 characters. The setup command refuses to create a second admin. Set `SESSION_COOKIE_SECURE=true` in production; deploy over HTTPS.

To add six demonstration teams and three offerings **only on a development branch**:

```powershell
$env:DEV_SEED_CONFIRM = 'I_AM_ON_A_DEV_BRANCH'
npm run db:seed
Remove-Item Env:DEV_SEED_CONFIRM
```

The seed prints the generated development credentials once. It refuses to seed an event that already has teams.

## Running the event

1. Sign in as admin. Download the CSV template from **Import teams**. Required columns are `team_name`, leader name/email/registration, and `college`; member 2–4 columns may be empty.
2. Upload, review the preview, and confirm. Download newly generated leader credentials immediately. The app stores only password hashes. Re-importing a team with the same leader registration updates its details without creating a duplicate or resetting its password.
3. Select participants, then choose and confirm the shortlist. Only participants receive wallets; shortlisted participants also issue stock.
4. Set event name, currency, starting balance, stocks per team, stock price, and optional investment start/end times. Times are entered in India Standard Time.
5. Move to **Presentation**, set the order and the current presenter. Move to **Investment** when ready. Pause or close the market from the overview. Configured start/end times are also enforced on the server.
6. Inspect and, if necessary, reverse a purchase with a reason. Reversals restore the buyer's balance and offering stock; purchase and reversal records remain in the history.
7. Close the round, inspect results, reveal them to team leaders, and export results and transactions.

Team leaders sign in with email or leader registration number and their generated password. They can see only their team's private data. Market figures refresh every eight seconds. Purchase confirmation shows the quantity and total before submission.

## Security and data rules

- Admin and team permissions are checked in every server route. Sessions use random opaque tokens stored as hashes in PostgreSQL and sent as HTTP-only cookies.
- Passwords use Argon2id. Login attempts are limited per identifier. Every mutation checks the request origin. PostgreSQL parameters are used for SQL values.
- Purchases lock event state, wallet, and offering in one transaction; they recheck time, phase, participation, self-purchase, stock, and balance. A request UUID makes retries idempotent.
- Settings that change the market economics, participants, and shortlist are locked after the first purchase. Important admin actions and purchases are audited.
- Currency is displayed with two decimal places and stored as integer minor units. Stock price does not fluctuate; portfolio value is purchase cost. The final rank uses net investment received, with shared ranks for ties.

## Tests

```powershell
npm run typecheck
npm test
npm run build
```

The ordinary test run covers CSV validation and password hashing. The PostgreSQL integration test additionally checks five teams, simultaneous purchases against a limited offering, idempotent retries, self-purchases, overspending, sold-out stock, phase closure, and reversal. Run it only against a migrated isolated development branch:

```powershell
$env:TEST_DATABASE_URL = $env:DATABASE_URL
$env:TEST_DB_CONFIRM = 'I_AM_ON_A_DEV_BRANCH'
npm test
Remove-Item Env:TEST_DATABASE_URL
Remove-Item Env:TEST_DB_CONFIRM
```

If Neon wrote the URL into `.env.local` rather than your shell, load it into `TEST_DATABASE_URL` with your local secret-management method. The integration test creates and removes its own event data.

## Deployment

Deploy the Next.js app to a Node.js-capable host such as Vercel. Add the production branch's pooled `DATABASE_URL` as a protected environment variable, serve over HTTPS, run migrations during a controlled release, and create the admin before the event. `neon deploy` configures Neon; the web host deploys the Next.js app separately. Keep development credentials and seed data off the production branch.

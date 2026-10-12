# Bank Sampah API

Express.js API scaffold for the Bank Sampah application. MySQL is expected to run locally through Laragon.

## Requirements

- Node.js 20 or later
- Laragon with MySQL running
- MySQL CLI (`mysql`) available on `PATH`, or use its full path from Laragon's `bin\mysql` directory

## Configure

From PowerShell:

```powershell
cd backend
Copy-Item .env.example .env
```

Set `DB_USER` and `DB_PASSWORD` in `.env` to the local Laragon MySQL credentials. To enable first-time manager setup, set `MANAGER_SETUP_KEY` to a long, private value. Keep `.env` private; it is ignored by Git.

## Create the database with MySQL CLI

In PowerShell, from the `backend` folder:

```powershell
Get-Content .\database\schema.sql | mysql -u root -p
```

Enter the MySQL password when prompted. If the Laragon root account has no password, remove `-p`.

Alternatively, open Laragon's MySQL terminal and run:

```sql
SOURCE C:/path/to/BankSampah/backend/database/schema.sql;
```

For a new database, the schema creates the `bank_sampah` database and Indonesian-named tables for accounts, deposits, points, rewards, and redemptions. It creates no sample records.

For a database created from the earlier English-named schema, run the data-preserving rename migration once instead of rerunning the schema:

```powershell
Get-Content .\database\migrations\001_nama_indonesia.sql | mysql -u root -p
```

The migration renames the existing tables, columns, indexes, and constraints in place; it does not delete table data.

For a database already using Indonesian table names, apply the point-and-reward migration once:

```powershell
Get-Content .\database\migrations\002_poin_reward.sql | mysql -u root -p
```

The migration preserves accounts, sessions, deposits, and existing monetary history. Old prices and deposit amounts are renamed to `harga_per_satuan_arsip` and `nominal_arsip`; they are not converted into points. Monetary transactions and withdrawal requests are retained in `arsip_transaksi_saldo` and `arsip_pengajuan_pencairan`. New points use `transaksi_poin`, reward definitions use `katalog_reward`, and redemption requests use `pengajuan_penukaran`. Existing waste types start with a point rate of `0`, which must be set by the manager before awarding points.

Then apply the persistent notification preference, photo database, and temporary-password migrations in order:

```powershell
Get-Content .\database\migrations\003_pengaturan_persisten.sql | mysql -u root -p
Get-Content .\database\migrations\004_foto_database.sql | mysql -u root -p
Get-Content .\database\migrations\005_akun_ganti_kata_sandi.sql | mysql -u root -p
Get-Content .\database\migrations\006_hapus_jadwal_pengumpulan.sql | mysql -u root -p
Get-Content .\database\migrations\007_nilai_konversi_poin.sql | mysql -u root -p
Get-Content .\database\migrations\008_hapus_satuan_pcs.sql | mysql -u root -p
```

Migration `003` stores in-app notification preferences on each account. Migration `004` adds MySQL blob storage for uploaded waste-type and deposit photos. Migration `005` marks imported student accounts as requiring a password change at first login.
Migration `007` adds the manager-controlled estimated rupiah value for each point. The conversion is informational and does not create a cash balance or a withdrawal.
Migration `008` disables any existing waste type using the removed `buah/pcs` unit while preserving it and its historical deposit records. New and edited waste types can use only kilograms or liters.

Inspect tables and record counts from MySQL CLI:

```sql
USE bank_sampah;
SHOW TABLES;
SELECT 'akun' AS nama_tabel, COUNT(*) AS jumlah FROM akun
UNION ALL SELECT 'jenis_sampah', COUNT(*) FROM jenis_sampah
UNION ALL SELECT 'transaksi_poin', COUNT(*) FROM transaksi_poin
UNION ALL SELECT 'katalog_reward', COUNT(*) FROM katalog_reward
UNION ALL SELECT 'pengajuan_penukaran', COUNT(*) FROM pengajuan_penukaran;
```

## Install and run

```powershell
npm install
npm run dev
```

The API listens on `http://localhost:4000`.

When opening the frontend from another device on the same network, use the frontend's `Network` URL. The API uses the same hostname on port `4000`; allow Node.js through the Windows private-network firewall if the device cannot connect. In development, the API accepts the same-host frontend origin. For production, set `CORS_ORIGIN` to the exact frontend origin and configure `NEXT_PUBLIC_API_URL` to the API URL.

- `GET /api` returns API name and version.
- `GET /api/health` checks connectivity to MySQL and returns `503` through the error handler if the database is unavailable.
- `GET /api/auth/setup` reports whether first-manager setup is available.
- `POST /api/auth/setup-manager` creates the first manager only; it requires the `x-manager-setup-key` header and a configured `MANAGER_SETUP_KEY`.
- `POST /api/auth/login` authenticates an account.
- `GET /api/auth/session` returns the signed-in account from its HttpOnly session cookie.
- `POST /api/auth/logout` ends the current session.
- `PATCH /api/auth/profile` updates the signed-in account's name, WhatsApp, and (for students) class.
- `PUT /api/auth/password` changes the signed-in account's password and invalidates its other sessions.
- `GET /api/auth/students` lists student accounts for a signed-in manager.
- `POST /api/auth/students/import` imports up to 500 student records for a signed-in manager. The request contains `students` with `name`, `identifier` (NISN), and optional `className`. The one-time response includes random temporary passwords; accounts must change them at first login.
- `PATCH /api/auth/students/:id` updates a student's profile or active status.

Successful login sets a seven-day, HttpOnly session cookie. Send requests from a browser with credentials enabled. The API stores scrypt password hashes and SHA-256 hashes of session tokens; it never returns either hash.

Set `CORS_ORIGIN` to the frontend origin. Multiple origins may be comma-separated.
The frontend uses `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`); copy `frontend/.env.example` to `frontend/.env.local` if the API runs at another address. Keep `CORS_ORIGIN` aligned with the frontend page origin.

The frontend's login, session, profile, and password screens use this API. Students cannot self-register; a manager imports CSV or XLSX data from the Participants workspace. The temporary credential CSV is shown once after import, so deliver it privately and do not leave copies on shared devices. The manager workspace also loads and updates server-backed student accounts through `GET /api/auth/students` and `PATCH /api/auth/students/:id`.

### Business API

All business endpoints require a valid session cookie. Manager-only endpoints are marked below.

- `GET /api/business/data` returns the signed-in user's waste types, deposits, point ledger, rewards, redemption history, and notifications. Managers see all records; students see their own deposits/ledger/redemptions and active rewards.
- `PATCH /api/business/conversion-rate` (manager) sets the estimated rupiah value of one point as `{ "rupiahPerPoint": 10 }`. The value is returned in `preferences.rupiahPerPoint` and is informational only; it does not add a withdrawable cash balance.
- `GET /api/business/ranking/monthly` (student) returns active students ranked by points earned from approved deposits in the current month. Reward redemptions do not reduce the monthly score.
- `POST /api/business/waste-types` (manager) creates a waste type. `PATCH /api/business/waste-types/:id` (manager) updates its name, unit, point rate, icon/image, and active state. Images can be compressed JPEG/PNG/WebP data URLs stored in MySQL or HTTP(S) URLs. `GET /api/business/waste-types/:id/image` serves stored images to signed-in users.
- `POST /api/business/deposits` creates a pending deposit for the signed-in student from a list of waste type IDs and up to five compressed image data URLs. Deposit quantities are entered by the manager during review. Photos are stored in MySQL.
- `GET /api/business/deposits/:id/photos` returns stored photos for the owning student or a manager.
- `POST /api/business/deposits/:id/cancel` cancels the signed-in student's pending deposit.
- `POST /api/business/deposits/:id/review` (manager) accepts `{ decision, lines, note }` to approve with actual quantities, or `{ decision: "reject", note }` to reject. Approval stores the accepted quantities and rates and creates one point-ledger credit in a single database transaction.
- `POST /api/business/rewards` (manager) creates a reward. `PATCH /api/business/rewards/:id` (manager) updates it.
- `POST /api/business/redemptions` creates a pending redemption and reserves its points. `POST /api/business/redemptions/:id/review` (manager) approves or rejects it. Approval checks the available point balance, updates stock, and inserts the debit in a transaction. `POST /api/business/redemptions/:id/fulfill` (manager) marks an approved reward as manually handed over.
- `PATCH /api/business/notifications/read-all` and `PATCH /api/business/notifications/:id/read` mark the signed-in user's notifications as read.
- `PATCH /api/business/preferences` stores `{ inAppNotifications }` on the signed-in account. `GET /api/business/data` returns that preference and the manager contact number from the account database.

Business records, notification preferences, and uploaded photos are stored in MySQL. Photo uploads accept compressed JPEG, PNG, or WebP up to 450 KB each; deposit requests are limited to five photos and 1.25 MB total. The JSON request body limit is 2 MB.

## Tests

Run `npm test` from this folder while the configured MySQL database is available. The integration test creates and removes a temporary account.

## Current scope

Database table names, columns, indexes, constraints, and status/type values are Indonesian. API paths, JSON fields, and role names remain stable for the frontend. Do not use real account or banking information with this prototype.

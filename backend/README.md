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

For a new database, the schema creates the `bank_sampah` database and Indonesian-named tables for accounts, deposits, rupiah balances, withdrawals, and notifications. It creates no sample records.

For a database created from the earlier English-named schema, run the data-preserving rename migration once instead of rerunning the schema:

```powershell
Get-Content .\database\migrations\001_nama_indonesia.sql | mysql -u root -p
```

The migration renames the existing tables, columns, indexes, and constraints in place; it does not delete table data.

For an older database already using Indonesian table names, apply the historical migrations below in order. These migrations preserve the old point/reward tables and records for audit; the current API no longer reads or changes them. Existing point values are not converted into rupiah. Set cash rates explicitly before approving new deposits.

```powershell
Get-Content .\database\migrations\002_poin_reward.sql | mysql -u root -p
```

This historical migration preserves accounts, sessions, deposits, and existing monetary history. Old prices and deposit amounts are renamed to `harga_per_satuan_arsip` and `nominal_arsip`; these values are not interpreted as points or converted. Existing monetary transactions and withdrawal requests remain in `arsip_transaksi_saldo` and `arsip_pengajuan_pencairan`. The legacy point/reward tables created by this migration are not used by the current application.

Then apply the persistent notification preference, photo database, and temporary-password migrations in order:

```powershell
Get-Content .\database\migrations\003_pengaturan_persisten.sql | mysql -u root -p
Get-Content .\database\migrations\004_foto_database.sql | mysql -u root -p
Get-Content .\database\migrations\005_akun_ganti_kata_sandi.sql | mysql -u root -p
Get-Content .\database\migrations\006_hapus_jadwal_pengumpulan.sql | mysql -u root -p
Get-Content .\database\migrations\007_nilai_konversi_poin.sql | mysql -u root -p
Get-Content .\database\migrations\008_hapus_satuan_pcs.sql | mysql -u root -p
```

Migration `003` stores in-app notification preferences on each account. Migration `004` adds MySQL blob storage for uploaded waste-type and deposit photos. Migration `005` marks imported student accounts as requiring a password change at first login. Migration `008` disables waste types using the removed `buah/pcs` unit while preserving historical deposit records. Migration `007` is retained as a historical settings migration; conversion settings are no longer read by the application.

Inspect tables and record counts from MySQL CLI:

```sql
USE bank_sampah;
SHOW TABLES;
SELECT 'akun' AS nama_tabel, COUNT(*) AS jumlah FROM akun
UNION ALL SELECT 'jenis_sampah', COUNT(*) FROM jenis_sampah
UNION ALL SELECT 'pengajuan_setoran', COUNT(*) FROM pengajuan_setoran
UNION ALL SELECT 'arsip_transaksi_saldo', COUNT(*) FROM arsip_transaksi_saldo
UNION ALL SELECT 'arsip_pengajuan_pencairan', COUNT(*) FROM arsip_pengajuan_pencairan;
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
- `POST /api/auth/students/:id/reset-password` (manager) accepts `{ temporaryPassword }` (8–128 characters), hashes it, revokes the participant's active sessions, and requires a password change at next login. The one-time response includes the temporary password.
- `PATCH /api/auth/students/:id` updates a student's profile or active status.

Successful login sets a seven-day, HttpOnly session cookie. Send requests from a browser with credentials enabled. The API stores scrypt password hashes and SHA-256 hashes of session tokens; it never returns either hash.

Set `CORS_ORIGIN` to the frontend origin. Multiple origins may be comma-separated.
The frontend uses `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`); copy `frontend/.env.example` to `frontend/.env.local` if the API runs at another address. Keep `CORS_ORIGIN` aligned with the frontend page origin.

The frontend's login, session, profile, and password screens use this API. Students cannot self-register; a manager imports CSV or XLSX data from the Participants workspace. The temporary credential CSV is shown once after import, so deliver it privately and do not leave copies on shared devices. The manager workspace also loads and updates server-backed student accounts through `GET /api/auth/students` and `PATCH /api/auth/students/:id`.

### Business API

All business endpoints require a valid session cookie. Manager-only endpoints are marked below.

- `GET /api/business/data` returns the signed-in user's waste types, deposits, rupiah ledger, withdrawal history, notifications, and preferences. Managers see all records; students see only their own ledger and withdrawals.
- `POST /api/business/waste-types` (manager) creates a waste type. `PATCH /api/business/waste-types/:id` (manager) updates its name, unit, rupiah rate, icon/image, and active state. Images can be compressed JPEG/PNG/WebP data URLs stored in MySQL or HTTP(S) URLs. `GET /api/business/waste-types/:id/image` serves stored images to signed-in users.
- `POST /api/business/deposits` creates a pending deposit for the signed-in student from a list of up to 20 waste type IDs and up to five compressed image data URLs. If no catalog type is available, send an empty `wasteTypeIds` array and a required `otherWasteDescription` (up to 120 characters); the manager maps it to an active, priced catalog type during review. Deposit quantities are entered by the manager during review. Photos are stored in MySQL.
- `GET /api/business/deposits/:id/photos` returns stored photos for the owning student or a manager.
- `POST /api/business/deposits/:id/cancel` cancels the signed-in student's pending deposit.
- `POST /api/business/deposits/:id/review` (manager) accepts `{ decision, lines, note }` to approve with actual quantities (and map uncatalogued lines to an active, priced type), or `{ decision: "reject", note }` to reject. Approval stores the accepted quantities/rates and creates one rupiah-ledger credit in a single database transaction.
- `POST /api/business/deposits/direct` (manager) accepts `{ studentId, wasteTypeId, quantity, note }` for a weighed deposit recorded directly by staff. The server validates the active student/catalog rate, calculates the rupiah amount, stores the approved deposit, credits the student ledger, and sends an in-app notification atomically.
- `POST /api/business/withdrawals` creates a pending student withdrawal and reserves the requested balance. `PATCH /api/business/withdrawals/:id` edits a pending request; `POST /api/business/withdrawals/:id/cancel` cancels it.
- `POST /api/business/withdrawals/:id/review` (manager) approves or rejects a pending request. `POST /api/business/withdrawals/:id/pay` (manager) records a completed manual transfer and debits the rupiah ledger.
- `PATCH /api/business/notifications/read-all` and `PATCH /api/business/notifications/:id/read` mark the signed-in user's notifications as read.
- `PATCH /api/business/preferences` stores `{ inAppNotifications }` on the signed-in account. `GET /api/business/data` returns that preference and the manager contact number from the account database.

Business records, notification preferences, and uploaded photos are stored in MySQL. Photo uploads accept compressed JPEG, PNG, or WebP up to 450 KB each; deposit requests are limited to five photos and 1.25 MB total. The JSON request body limit is 2 MB.

## Tests

Run `npm test` from this folder while the configured MySQL database is available. The integration test creates and removes a temporary account.

## Current scope

Database table names, columns, indexes, constraints, and status/type values are Indonesian. API paths, JSON fields, and role names remain stable for the frontend. Do not use real account or banking information with this prototype.

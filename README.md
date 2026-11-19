# KRZ PRINT POS (v3.0)

Offline-first **Single-Station** Point of Sale, Inventory, and Print Job Management desktop application built with Electron and SQLite (`node:sqlite`), priced in Jamaican Dollars (`JMD`).

## Download & Install (Windows)

1. Go to the [**Releases**](../../releases/latest) page on GitHub.
2. Download either:
   - **`KRZ PRINT POS Setup 3.0.0.exe`** — Standard Windows Installer (creates Desktop & Start Menu shortcuts), or
   - **`KRZ PRINT POS 3.0.0.exe`** — Portable executable (runs directly without installation).
3. Launch **KRZ PRINT POS** and sign in with the default Admin account:
   - **Username**: `admin`
   - **PIN / Password**: `1234`
   - *(Change the default PIN and add Cashier accounts under **Backup & Restore → Staff Accounts & Login PINs**).*

## Features

- **Single-Station SQLite Storage (`no multi-tills`)**:
  - Relational SQLite database (`krz_print_pos.sqlite`) with tables for `settings`, `users`, `products`, `customers`, `sales`, `sale_items`, `jobs`, `job_payments`, `expenses`, and `stock_log`.
  - Enforces a single-instance desktop lock (`requestSingleInstanceLock`) and loopback-only binding.
- **Role-Based Staff Login**:
  - **Admin**: Full access to all 9 modules (`Dashboard`, `Point of Sale`, `Products`, `Inventory`, `Sales History`, `Customers`, `Print Jobs`, `Reports`, `Backup & Restore`).
  - **Cashier**: Focused counter view showing only `Point of Sale`, `Sales History` (reprint only), `Customers`, and `Print Jobs`.
- **Point of Sale & Inventory**:
  - Barcode scanner `Enter`-to-add, Cash Tendered & Change Due, optional Customer attachment, Service/Non-stock items, optional GCT tax (Inclusive or Exclusive), and Sale Voids with automatic stock restoration.
- **Print Jobs & Quotes**:
  - Track `Quote`, `Pending`, `In Progress`, `Ready for Collection`, `Completed`, and `Cancelled` jobs with print specifications (`Paper/Size`, `Print Mode`, `Finishing`, `Artwork/File Ref`), deposits, balance payments, payment history, and printable slips.
- **Reports, Expenses & Daily Closeout**:
  - Unified POS + Print Job collections, recorded shop expenses, date-range filters, printable **Daily Closeout (Z-Report)**, and Excel CSV / JSON backups.

## Development

```bash
npm install
npm start          # Launch Electron desktop app
npm run dist       # Build Windows Setup & Portable .exe in dist/
```

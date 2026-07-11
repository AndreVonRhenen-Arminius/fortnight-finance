# Changelog

## 3.2.1
- Fixed ASB Sync failing to render when linked bank accounts or sync timestamps exist.
- Fixed Settings failing to render when statement-matching rules exist.
- Added a section-render error boundary so a failed view no longer leaves stale Dashboard content visible.
- Bumped the service-worker cache to force browsers to retrieve the corrected application module.

## 3.2
- Renamed dashboard `Cash remaining` to `Net actual cash flow` to avoid implying it is a bank balance.
- Added complete project handoff documentation.
- Included Supabase ASB Edge Function and schedule SQL in the master package.
- Removed incorrectly placed duplicate root `app.js` and `sync.js` files.

## 3.1
- Added projected balances for Afterpay and credit cards after a recorded payment.
- Retained confirmed balances separately.

## 3.0
- Added clearer dashboard actual summary.
- Added linked debt payment status.
- Added credit-card records, limits and available-credit calculation.

## 2.0
- Added automatic transfer classification.
- Added transaction reconciliation and duplicate bill cleanup.
- Improved automatic bill matching.

## 1.4
- Added ASB/Akahu sync interface and Supabase Edge Function integration.

## 1.x
- Initial PWA, Microsoft login, Supabase sync, bills, income, planning, CSV imports and backups.

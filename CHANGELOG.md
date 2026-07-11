# Changelog

## 3.3.2
- Fixed ASB CSV withdrawals containing typographic minus characters such as an en dash (`–$94.00`) being parsed as `$0.00` and marked invalid.
- Added support for common bank amount formats including Unicode minus signs, accounting brackets and `CR`/`DR` suffixes.
- Added automatic detection of the real transaction header row when an ASB export contains report-information rows above the table.
- Removed a leading UTF-8 BOM from detected CSV headings.
- Bumped the service-worker cache so deployed browsers retrieve the corrected importer.

## 3.3.1
- Kept **Load supplied history** visible even when one or more rates invoices already exist.
- Re-importing remains safe: invoice dates already stored are skipped rather than duplicated.
- Bumped the service-worker cache so the corrected Rates screen is retrieved after deployment.

## 3.3
- Added a dedicated Rates section.
- Added quarterly rates invoice records and current amount-owing calculation.
- Added automatic recognition of ASB-synchronised rates payments through the linked Rates bill, category or managed bank-description rule.
- Added manual rates payments, future invoice placeholders, next-invoice estimates and a one-click import for the supplied invoice history.
- Kept the quarterly invoice outside fortnightly cash-flow totals to prevent double-counting; the linked fortnightly Rates bill remains the planned cash expense.
- Migrated existing Version 3.2 data without replacing accounts, bills, transactions, authentication settings or secrets.

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

# Fortnight Finance PWA — Version 3.3.3

A build-free household finance Progressive Web App designed for GitHub Pages.

## Core capabilities

- Fortnightly income and bill scheduling
- Planned versus actual cash-flow dashboard
- Transaction entry, CSV import and duplicate detection
- Spending limits, sinking funds, debt and credit-card tracking
- Rates invoice, payment and outstanding-balance tracking
- Existing Microsoft authentication through Supabase Auth
- Existing Supabase per-user cloud synchronisation
- Optional independent Microsoft OneDrive app-folder synchronisation
- Offline browser storage and queued reconnect sync
- Encrypted export, restore and OneDrive desktop-folder backups
- Read-only ASB transaction synchronisation through Akahu and a Supabase Edge Function
- Internal-transfer exclusion, scheduled-bill matching and split-loan grouping

## Microsoft OneDrive sync

Version 3.3.3 adds an optional second cloud copy through Microsoft Graph without replacing Supabase authentication or storage.

- Authentication library: MSAL Browser 5.17.0
- Flow: SPA authorisation code flow with PKCE
- Authority: `https://login.microsoftonline.com/common`
- Delegated Graph permission: `Files.ReadWrite.AppFolder`
- App identifier: `fortnight-finance-pwa`
- OneDrive file: `fortnight-finance-state.json`
- Storage location: the app registration's dedicated OneDrive app folder through `/me/drive/special/approot`
- Token cache: MSAL-managed session storage; no tokens are written to app state or source files
- Local finance state schema: unchanged at Version 5

Local saving always occurs first. OneDrive sync is queued while offline and retried after reconnecting. Hashes, timestamps and a last-synchronised base hash are used to detect device-only changes, OneDrive-only changes and independent conflicts.

See `MICROSOFT-ONEDRIVE-SETUP.md` for Entra registration and testing steps.

## Start here

- `PROJECT_CONTEXT.md` — architecture and design decisions
- `SETUP_GUIDE.md` — initial Supabase and deployment setup
- `MICROSOFT-ONEDRIVE-SETUP.md` — optional Microsoft Graph OneDrive setup
- `SECURITY.md` — security requirements
- `HANDOFF.md` — continue the project in a new conversation
- `RATES_SETUP.md` — configure quarterly rates invoices and ASB payment matching
- `VALIDATION.md` — validation checklist and Version 3.3.3 test results
- `CHANGELOG.md` — version history

## Repository structure

```text
assets/icons/
js/
samples/
supabase/
tests/
vendor/
index.html
styles.css
manifest.webmanifest
package.json
sw.js
```

The application remains build-free. Upload the repository contents to GitHub Pages and publish from the repository root. Node.js is only required to run the optional automated tests:

```bash
npm test
npm run check
```

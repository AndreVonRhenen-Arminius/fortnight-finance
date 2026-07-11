# Fortnight Finance PWA — Version 3.2.1

A build-free household finance Progressive Web App designed for GitHub Pages.

## Core capabilities

- Fortnightly income and bill scheduling
- Planned versus actual cash-flow dashboard
- Transaction entry, CSV import and duplicate detection
- Spending limits, sinking funds, debt and credit-card tracking
- Microsoft authentication and Supabase cloud synchronisation
- Offline browser storage
- Encrypted export, restore and OneDrive-folder backups
- Read-only ASB transaction synchronisation through Akahu and a Supabase Edge Function
- Internal-transfer exclusion, scheduled-bill matching and split-loan grouping

## Start here

- `PROJECT_CONTEXT.md` — architecture and design decisions
- `SETUP_GUIDE.md` — initial deployment
- `SECURITY.md` — security requirements
- `HANDOFF.md` — continue the project in a new conversation
- `CHANGELOG.md` — version history

## Repository structure

```text
assets/icons/
js/
samples/
supabase/
vendor/
index.html
styles.css
manifest.webmanifest
sw.js
```

The application is build-free. Upload the repository contents to GitHub Pages and publish from the repository root.

# Fortnight Finance PWA — version 1.1

A build-free household finance Progressive Web App intended for GitHub Pages.

## Main capabilities

- fortnight dashboard with Week 1 and Week 2 allocation
- recurring weekly, fortnightly, monthly, quarterly, yearly, and one-time bills
- regular income schedules
- bill amount overrides and amount history
- transaction entry and CSV statement import review
- duplicate detection and merchant matching rules
- flexible budgets, sinking funds, and debt tracking
- offline local storage through IndexedDB
- Supabase login and cross-device cloud synchronisation
- Microsoft sign-in through Supabase Azure Auth
- encrypted manual exports and desktop OneDrive-folder backups
- installable PWA for desktop, laptop, and supported mobile browsers

## Version 1.1 deployment changes

- explicit public `appUrl` configuration for reliable OAuth redirects
- network-first service-worker updates so a changed `config.js` is not trapped behind an old cache
- optional controls to hide local mode, email/password login, and sign-up after Microsoft login is working
- automatic cloud-session sign-out after a configurable inactivity period
- duplicate cloud-entry protection during authentication transitions
- expanded end-to-end setup and verification guide
- read-only Supabase verification SQL

## Start here

Read `SETUP_GUIDE.md` and complete it in order.

## Public and secret values

Safe in `js/config.js`:

- Supabase Project URL
- Supabase publishable key, or legacy anon key
- public GitHub Pages app URL

Never place in GitHub:

- Supabase secret or service-role key
- Microsoft client secret
- database password
- banking credentials
- exported backups or bank statements

## Data model

The current cloud design stores one JSON state row per Supabase Auth user in `public.finance_state`. Row Level Security restricts each authenticated user to their own row.

Use the same Microsoft account on all devices for the same household data. Separate user accounts currently receive separate records.

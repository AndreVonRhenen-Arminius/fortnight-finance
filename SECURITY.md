# Security notes

## Security boundary

The GitHub Pages code is public client-side code. Security does not depend on hiding that code or the Supabase publishable key. It depends on:

- Supabase authentication
- correctly configured Row Level Security
- least-privilege table grants
- protection of the Microsoft client secret inside Supabase
- protection of the user's devices and browser profiles
- tested encrypted backups

## Never commit

- Supabase secret or service-role keys
- Microsoft client secrets
- database passwords
- bank usernames, passwords, PINs, CVVs, or complete card numbers
- bank statements
- exported `.afbackup` or JSON finance files

## Local offline cache

The PWA stores a working copy in browser IndexedDB for offline use. That local browser database is not independently encrypted by the app. Protect it with:

- a private Windows user account and strong device sign-in
- BitLocker or Windows device encryption where available
- an up-to-date browser and operating system
- screen locking when away
- no shared browser profile

The app's inactivity timeout signs out the cloud session, but a person with administrative access to the device or browser profile may still be able to inspect local browser storage. Do not use the app on public or untrusted computers.

## Authentication

For the final setup:

- use Microsoft sign-in
- enable MFA or a passkey on the Microsoft account
- disable local-only mode
- hide email/password sign-in and sign-up in `js/config.js` if they are not needed
- disable new-user sign-ups in Supabase after the intended account exists
- review the Supabase Auth users list periodically

## Supabase

- use a publishable key in the browser
- never use a secret or service-role key in the browser
- run `supabase/schema.sql`
- verify with `supabase/verify_setup.sql`
- confirm RLS remains enabled
- review the Supabase Security Advisor after schema changes

## Microsoft OAuth

- the Microsoft redirect URI is the Supabase callback URL
- the Microsoft client-secret value belongs only in Supabase
- record the secret's expiry and rotate it before it expires
- use the correct tenant URL for the app registration's supported account types
- consider Supabase's recommended `xms_edov` optional claim hardening

## Backups

- encrypted exports use PBKDF2-SHA-256 and AES-GCM in the browser
- the backup password is not stored permanently and cannot be recovered
- the OneDrive folder contains encrypted files, but filenames and modification times remain visible
- automatic folder backup requires the app to be open and the session password to be active
- keep at least one independent, tested encrypted export

## Operational limitations

- this is a personal finance tool, not a bank or accounting system
- CSV classifications require review
- do not treat automatic merchant matching as proof of a transaction's purpose
- avoid editing the same record on several devices at the same time
- reconcile totals against the source bank statement after every import

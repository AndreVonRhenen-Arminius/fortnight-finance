# Validation completed — version 1.1

## Checks completed in the generated package

- JavaScript syntax check passed for every file in `js/` and for `sw.js` using Node.js 22.
- Every local `src` and `href` referenced by `index.html` exists.
- Every static file listed in the service-worker pre-cache exists.
- The application entry page, configuration, manifest, service worker, and local Supabase browser bundle returned HTTP 200 from a temporary static web server.
- Monthly recurrence generation was tested across three months.
- CSV parsing was tested with a quoted merchant description containing a comma.
- Password-encrypted backup creation and successful restore were tested.
- An incorrect backup password was rejected.
- The Supabase schema enables Row Level Security and includes user-specific select, insert, update, and delete policies.
- The setup package includes a read-only Supabase verification script.
- The OAuth code requests Microsoft's required `email` scope and uses the explicit configured public app URL for redirect.
- The service worker uses network-first delivery with offline cache fallback, preventing an old blank `config.js` from remaining after GitHub configuration changes.

## Requires validation with your accounts

The following must be tested after completing `SETUP_GUIDE.md` because they require your permissions and project values:

- GitHub Pages deployment
- live Supabase connection and RLS behaviour under your authenticated user
- Microsoft Entra OAuth sign-in
- cross-device cloud synchronisation
- installed PWA behaviour on your desktop, laptop, and phone
- writing encrypted files to your OneDrive-synchronised desktop folder
- a complete backup and restore using your chosen password

Do not enter the full household finance history until Microsoft login, cross-device sync, and backup restore have all passed.

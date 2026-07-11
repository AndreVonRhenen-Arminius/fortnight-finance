# Fortnight Finance Validation

## Version 3.3.3 validation result

Validation date: 11 July 2026

### Automated checks

Run from the repository root:

```bash
npm run check
npm test
```

Result:

- JavaScript syntax checks: passed
- Automated tests: 23 passed, 0 failed
- Existing project tests: no pre-existing automated test suite was present
- State migration compatibility: passed
- Local-first save ordering: passed
- Microsoft configuration validation: passed
- Mock MSAL initialisation, sign-in and resumed-session handling: passed
- First-sign-in missing-file upload: passed
- Mock OneDrive upload: passed
- Mock OneDrive download: passed
- Pull validation and integrity rejection: passed
- Push validation before upload: passed
- Conflict classification: passed
- Blank-local-data safeguard: passed
- Protected-file hash checks: passed
- Service-worker asset and auth-callback checks: passed
- Utility and recurring-date regression checks: passed
- Offline queue: passed
- Reconnect upload: passed

### Static package checks

- All local `index.html` script, stylesheet, manifest and icon references exist.
- Local HTTP serving returned `200` for the app shell, OneDrive modules, MSAL library, manifest and service worker.
- All service-worker cache assets exist.
- Service-worker cache version is `fortnight-finance-v12`.
- Microsoft authentication callback URLs are excluded from service-worker caching.
- The OneDrive file name is unique: `fortnight-finance-state.json`.
- The OneDrive app identifier is unique: `fortnight-finance-pwa`.
- The requested Graph scope is exactly `Files.ReadWrite.AppFolder`.
- No broad `Files.ReadWrite.All` permission is requested by source code.
- No duplicate root-level `app.js` or `sync.js` files remain.
- ZIP integrity test passed.

### Protected-file checks

The following files were compared byte-for-byte with Version 3.3.2 and remained unchanged:

- `js/config.js`
- `js/sync.js`
- `supabase/schema.sql`
- `supabase/verify_setup.sql`
- `supabase/functions/asb-sync/index.ts`
- `supabase/schedules/remove_asb_sync_schedule.sql`
- `supabase/schedules/schedule_asb_sync.sql`

The existing finance state schema remains Version 5.

### Live Microsoft test status

Live Microsoft authentication and live OneDrive Graph operations were not tested because no Microsoft Entra Application client ID was supplied for this build.

A full browser/PWA refresh smoke test was not completed in the build container because its headless Chromium process could not finish startup. JavaScript, asset, service-worker and local HTTP-serving checks passed; the deployed-browser refresh remains in the manual checklist below.

The package includes mocked MSAL and Graph tests, including resumed-session and first-sign-in behaviour. Complete `MICROSOFT-ONEDRIVE-SETUP.md`, then manually verify:

1. production redirect URI;
2. Microsoft consent;
3. app-folder file creation;
4. second-device pull;
5. second-device push;
6. offline reconnect;
7. conflict warning.

## Manual deployment validation

After uploading Version 3.3.3 to GitHub Pages:

1. Open the app in a private browser window.
2. Confirm the existing Supabase Microsoft sign-in still works.
3. Confirm existing finance data loads from Supabase.
4. Confirm ASB Sync renders and existing mappings remain present.
5. Open **Backup & Sync**.
6. Confirm the existing Supabase controls and encrypted folder-backup controls remain available.
7. Enter the Entra client ID and save Microsoft configuration.
8. Sign in to the optional OneDrive section.
9. Confirm the permission request is limited to the application folder.
10. Confirm `fortnight-finance-state.json` appears in the OneDrive Apps folder.
11. Make a small change and confirm **Saved locally** appears before cloud status changes.
12. Refresh while offline and confirm the app loads from the service-worker cache.
13. Reconnect and confirm the pending OneDrive operation retries.
14. Test on a second device and confirm a newer-copy prompt or safe synchronisation.

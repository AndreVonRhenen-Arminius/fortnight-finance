# Fortnight Finance — Project Context

## Current release

Version 3.3.3, GitHub Pages PWA for fortnightly household finance management.

Finance state schema remains Version 5. Version 3.3.3 does not reset or restructure existing finance data.

## Deployment

- GitHub Pages application URL: `https://andrevonrhenen-arminius.github.io/fortnight-finance/`
- Existing application authentication: Microsoft sign-in through Supabase Auth
- Existing primary cloud storage: one `finance_state` JSON record per authenticated Supabase user
- Optional additional cloud copy: Microsoft Graph OneDrive application folder through `/me/drive/special/approot`
- OneDrive backup file: `fortnight-finance-state.json`
- OneDrive application identifier: `fortnight-finance-pwa`
- Bank data: read-only ASB transaction sync through Akahu and a Supabase Edge Function
- Offline storage: IndexedDB
- Backups: encrypted manual export, existing desktop OneDrive-folder backup and optional Microsoft Graph OneDrive sync

## Authentication boundaries

There are two separate Microsoft sign-in paths:

1. **Existing Supabase Auth Microsoft login**
   - Controls access to the application and existing `finance_state` cloud synchronisation.
   - Remains implemented in `js/sync.js`.
   - Was not replaced by Version 3.3.3.

2. **Optional MSAL Browser login for OneDrive**
   - Used only to obtain delegated Microsoft Graph access to the app's OneDrive folder.
   - Implemented independently in `js/onedrive.js`.
   - Uses `Files.ReadWrite.AppFolder` and never requests `Files.ReadWrite.All`.
   - Uses MSAL-managed session storage and does not manually store access or refresh tokens.

A user can continue using the app and Supabase without configuring OneDrive.

## OneDrive synchronisation model

1. Finance changes save to IndexedDB first.
2. Existing Supabase sync is scheduled as before.
3. If OneDrive is configured and signed in, OneDrive sync is also queued.
4. Offline changes remain local and the OneDrive queue remains pending.
5. Reconnect triggers a safe comparison.
6. A validated app-specific JSON envelope is uploaded or downloaded.
7. Independent changes produce a visible conflict instead of a silent overwrite.

The OneDrive envelope includes:

- envelope schema version;
- unique application identifier;
- update time;
- generated device identifier;
- last-synchronised base hash;
- SHA-256 data integrity hash;
- complete sanitised finance state.

Downloaded files must match the app identifier, supported envelope schema, supported finance schema, required collections and integrity hash before they can be applied.

## Conflict rules

- No OneDrive file: upload the current local state after first sign-in.
- Same hash: report that both copies are current.
- Local changed and OneDrive still matches the last synchronised hash: upload automatically.
- OneDrive changed and local still matches the last synchronised hash: load automatically after validation and a local safety snapshot.
- First comparison without a base hash: use timestamps and ask before replacing either copy.
- Both changed from the last synchronised hash: show a conflict and require an explicit pull or push choice.
- Graph ETags are used when replacing an existing file so a last-second remote change is not silently overwritten.

## Important security design

- Never store ASB username, password, PIN, Netcode, card number or CVV.
- Never put Akahu tokens, Supabase secret/service-role keys, Microsoft client secrets or cron secrets in GitHub, `js/config.js` or `js/microsoft-config.js`.
- The browser contains only public Supabase configuration and the public Microsoft client ID.
- Akahu credentials are stored only as Supabase Edge Function secrets.
- ASB access is read-only; the app cannot initiate payments.
- Microsoft Graph access is limited to the app folder through `Files.ReadWrite.AppFolder`.
- The service worker does not cache Microsoft authentication callback responses.

## Main finance rules

### Bills
Use Bills for scheduled payments with due dates, such as mortgage, personal loan, Afterpay, insurance, Spark, Contact Energy, rates, BestStart and subscriptions.

### Planning
Use Planning for variable fortnightly limits, such as groceries, fuel, takeaways, household extras and personal spending.

### Internal transfers
Transfers between the user's own accounts remain visible but must not count as income or expenses.

### Debt and credit records
A debt record stores balance and account details. A linked bill controls payment amount, due date and Paid/Due status. This prevents double-counting.

### Loan grouping
- `LOAN REPAYMENT 020INTEREST` + `LOAN REPAYMENT 020PRINCIPAL` map to the mortgage bill.
- `LOAN REPAYMENT 022INTEREST` + `LOAN REPAYMENT 022PRINCIPAL` map to the personal-loan bill.

### Rates
- Quarterly rates invoices increase the tracked amount owing.
- Fortnightly rates payments reduce the amount owing and can be detected from ASB-synchronised transactions.
- The linked Rates bill remains the only item counted in fortnightly cash-flow planning, preventing double-counting of the quarterly invoice.

### Afterpay and credit cards
The app keeps a confirmed balance and displays a projected balance after a recorded payment. It does not permanently overwrite the confirmed balance because new purchases, fees and refunds may change it.

## Dashboard definitions

- Planned income: all scheduled income for the selected fortnight.
- Total planned out: bills + spending limits + sinking-fund contributions + separate extra debt payments.
- Income received: actual recorded income transactions.
- Net actual cash flow: opening balance + actual income - actual expenses. Internal transfers are excluded. This is not the user's bank balance.

## Current app features

- Existing Microsoft-only application login through Supabase
- Supabase cloud synchronisation and optimistic conflict handling
- Optional MSAL Browser and Microsoft Graph OneDrive app-folder sync
- OneDrive JSON validation, SHA-256 integrity checks and conflict prompts
- Fortnight navigation
- Recurring and one-off bills and income
- Variable bill occurrence overrides
- Transaction entry and CSV import
- Bulk setup CSV import
- Spending limits, sinking funds and debts
- Credit-card balance and available-credit display
- Rates tracking with quarterly invoices, ASB-synchronised payments and amount owing
- Dark/light theme
- ASB/Akahu account mappings
- Loan principal/interest grouping
- Automatic transfer classification
- Bill matching and duplicate reconciliation
- Encrypted backups

## File placement rules

- Root: `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, documentation and test metadata
- JavaScript: `js/*.js`
- Vendor browser libraries: `vendor/*.js`
- Tests: `tests/*.test.mjs`
- Do not place copies of `app.js` or `sync.js` at the repository root.
- Do not replace `js/config.js` during patches unless explicitly required.
- Do not combine the independent OneDrive MSAL flow with existing Supabase authentication.

## Version 3.3.3 files

### New

- `js/microsoft-config.js`
- `js/onedrive-core.js`
- `js/onedrive.js`
- `vendor/msal-browser.min.js`
- `vendor/MSAL_LICENSE.txt`
- `MICROSOFT-ONEDRIVE-SETUP.md`
- `tests/onedrive-core.test.mjs`
- `tests/onedrive-browser.test.mjs`
- `tests/state-migration.test.mjs`
- `tests/package-validation.test.mjs`
- `tests/utils-regression.test.mjs`
- `package.json`

### Modified

- `index.html`
- `js/app.js`
- `styles.css`
- `sw.js`
- `README.md`
- `PROJECT_CONTEXT.md`
- `CHANGELOG.md`
- `VALIDATION.md`
- `HANDOFF.md`

### Removed

- Obsolete root-level `app.js`
- Duplicate root-level `sync.js`

The active `js/app.js` and protected `js/sync.js` remain in their correct locations.

## Known limitations

- Live Microsoft sign-in and live OneDrive Graph operations require a real Entra client ID and were not executed in the packaged test environment.
- Microsoft documentation identifies `Files.ReadWrite.AppFolder` as the least-privileged permission for personal Microsoft accounts. Work or school accounts can authenticate through `common`, but restricted app-folder access may not be supported for those accounts. This project does not automatically fall back to broader file permissions.
- Microsoft configuration saved through the UI is browser-specific. Set `clientId` in `js/microsoft-config.js` when the same default should be deployed to all devices.
- OneDrive sync is a complete-state sync, not field-by-field merging.

## Recommended future work

- Improve review-queue workflow and transaction-rule learning.
- Add clearer bank-sync audit reporting.
- Add optional household sharing for a second Microsoft user.
- Add an explicit opening-balance workflow per selected fortnight.
- Add reports across multiple fortnights.
- Consider an optional conflict comparison screen for individual finance collections.

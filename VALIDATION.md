# Validation completed — Version 3.3

## Package checks completed

- JavaScript syntax checks passed for every file in `js/` and for `sw.js`.
- Every local `src` and `href` referenced by `index.html` exists.
- Every static file listed in the service-worker cache exists.
- No duplicate HTML IDs were found.
- The Rates navigation entry, renderer, forms and actions are present.
- The Version 3.2 state migrates to schema Version 5 by adding a separate `rates` object without replacing accounts, bills, transactions, debts, rules or bank-sync data.
- `js/config.js` is byte-for-byte unchanged from Version 3.2.1.
- The complete `supabase/` directory is unchanged from Version 3.2.1, including authentication, ASB/Akahu Edge Function and schedule files.
- The supplied invoice history totals $2,560.13.
- The supplied payment example totals $1,737.49 and produces the expected $822.64 owing balance.
- The service-worker cache was increased to `fortnight-finance-v9` so deployed browsers retrieve Version 3.3 files.

## Runtime validation still required after deployment

The execution environment blocked local browser navigation, so the final GitHub Pages build must be checked in the deployed app:

- Open the new **Rates** section.
- Link the existing fortnightly Rates bill.
- Add the ASB bank-description phrase used for council payments.
- Load the supplied invoice history.
- Set ASB Sync lookback to 365 days and run a manual sync.
- Confirm the payment total and amount owing against the council record.
- Confirm Dashboard still counts only the fortnightly Rates bill and does not add the quarterly invoice as a second cash expense.
- Confirm Settings and ASB Sync still open normally.

Create an encrypted backup before deploying or entering additional finance records.

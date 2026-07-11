# Fortnight Finance — Project Context

## Current release

Version 3.3.2, GitHub Pages PWA for fortnightly household finance management.

## Deployment

- GitHub Pages application URL: `https://andrevonrhenen-arminius.github.io/fortnight-finance/`
- Authentication: Microsoft sign-in through Supabase Auth
- Cloud storage: one `finance_state` JSON record per authenticated Supabase user
- Bank data: read-only ASB transaction sync through Akahu and a Supabase Edge Function
- Offline storage: IndexedDB
- Backups: encrypted manual export and optional OneDrive-synchronised folder backup

## Important security design

- Never store ASB username, password, PIN, Netcode, card number or CVV.
- Never put Akahu tokens, Supabase secret/service-role keys, Microsoft client secrets or cron secrets in GitHub or `js/config.js`.
- The browser contains only the Supabase public project URL and publishable key.
- Akahu credentials are stored only as Supabase Edge Function secrets.
- ASB access is read-only; the app cannot initiate payments.

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

- Microsoft-only login
- Supabase cloud synchronisation and conflict handling
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

- Root: `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`
- JavaScript: `js/*.js`
- Do not place copies of `app.js` or `sync.js` at the repository root.
- Do not replace `js/config.js` during patches unless explicitly required.

## Recommended future work

- Improve review-queue workflow and transaction-rule learning.
- Add clearer bank-sync audit reporting.
- Add optional household sharing for a second Microsoft user.
- Add an explicit opening-balance workflow per selected fortnight.
- Add reports across multiple fortnights.

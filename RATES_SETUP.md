# Rates setup — Version 3.3.2

The Rates section tracks the council account separately from fortnightly cash-flow planning.

## Accounting behaviour

- A quarterly invoice increases the Rates amount owing.
- A payment reduces the Rates amount owing.
- The existing fortnightly Rates bill remains the cash expense shown on Dashboard.
- The quarterly invoice is not added to Dashboard spending, preventing double-counting.

## First-time setup

1. Deploy Version 3.3.2 and sign in normally.
2. Open **Rates**.
3. Select **Load supplied history**. The button remains visible after invoices are added, and existing invoice dates are skipped if it is selected again. This adds:
   - 15 September 2025 — $609.49
   - 15 December 2025 — $609.49
   - 15 March 2026 — $670.45
   - 15 June 2026 — $670.70
   - 15 September 2026 — amount pending
   - 15 December 2026 — amount pending
4. Under **Rates setup and automatic matching**, select the existing fortnightly Rates bill.
5. Enter a reliable phrase from the ASB transaction description, such as the council name shown on the bank transaction.
6. Save the Rates setup.
7. Open **ASB Sync**, set the lookback to **365 days**, save it, and run **Sync ASB now**.
8. Return to Rates and compare the payment total and amount owing with the council statement.

The expected figures from the supplied spreadsheet are:

- Total invoiced: $2,560.13
- Total paid: $1,737.49
- Amount owing: $822.64

The ASB payment total depends on the bank history returned by Akahu and the matching phrase entered in Rates setup.

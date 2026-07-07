# Fortnight Finance v1.3 upgrade

This update adds:

- A dark theme, enabled by default
- A light/dark theme switch in the top bar
- A theme selector under Settings
- A Quick Setup CSV import for accounts, income, recurring bills, spending limits, sinking funds, debts and bank-description matching rules
- A downloadable Quick Setup template

## Safe upgrade from your existing GitHub repository

Upload only the files in the v1.3 upgrade patch. The patch does not contain `js/config.js`, so it will not overwrite your Supabase URL, publishable key or Microsoft-login settings.

Replace these files in GitHub:

- `index.html`
- `styles.css`
- `sw.js`
- `js/app.js`

Add this file:

- `samples/finance-setup-template.csv`

After committing, wait for GitHub Pages deployment, then close and reopen the installed PWA. If the previous version remains, press `Ctrl + F5` in the browser version or clear the site's cached data once.

## Quick setup import

1. Open **Settings**.
2. Select **Download setup template**.
3. Open the CSV in Excel.
4. Replace the example amounts and dates with your information.
5. Keep the column names unchanged.
6. Save as CSV.
7. Return to **Settings** and select **Import completed template**.
8. Review the summary and confirm the import.

Existing records with the same name or category are updated rather than duplicated. The app creates a local safety snapshot before applying the import.

Actual bank transactions are still imported under **Transactions > Import CSV statement**.

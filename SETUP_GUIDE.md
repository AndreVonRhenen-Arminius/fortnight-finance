# Fortnight Finance — complete setup guide

This guide takes the app from the ZIP file to a working PWA with:

- GitHub Pages hosting
- Supabase cloud data and device synchronisation
- Microsoft sign-in
- local offline access after sign-in
- encrypted OneDrive-folder backups on the Windows desktop

No Python, Node.js, command prompt, or local web server is required.

---

## Important design facts

1. The GitHub Pages website is publicly reachable, even when the source repository is private on a supported GitHub plan. The source code contains no household finance records.
2. Your finance records are stored in Supabase under the authenticated user's ID and protected with Row Level Security.
3. Use the **same Microsoft account** on the desktop, laptop, and phone to see the same household data.
4. Another Microsoft account currently receives a separate finance record. Shared household access is not included in this version.
5. OneDrive is used for encrypted recovery files, not as the live database.
6. Automatic OneDrive-folder backup runs only while the app is open, the folder permission is available, and the session backup password has been entered.

---

# Part 1 — Record the values you will need

Keep this checklist available while setting up:

| Item | Your value |
|---|---|
| GitHub username | |
| Repository name | `fortnight-finance` recommended |
| GitHub Pages app URL | |
| Supabase Project URL | |
| Supabase publishable key | |
| Supabase Auth callback URL | |
| Microsoft Application (client) ID | |
| Microsoft client-secret expiry date | |
| OneDrive backup password storage location | |

Do not write the Microsoft client-secret value or the Supabase secret/service-role key in this checklist, GitHub, or `js/config.js`.

---

# Part 2 — Create and publish the GitHub repository

## Step 1: Download and extract the package

1. Download `Andre_Fortnight_Finance_PWA_GitHub_v1.1.zip`.
2. Right-click it in Windows and select **Extract All**.
3. Open the extracted `andre-finance-pwa` folder.
4. Confirm that `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, and the `js` folder are visible.

The repository must contain these files at its top level. Do not upload only the outer ZIP file.

## Step 2: Create the GitHub repository

1. Sign in to GitHub.
2. Select **New repository**.
3. Use the name `fortnight-finance` or another simple lowercase name.
4. Add a description such as `Private household finance PWA source code`.
5. Choose **Public** if you use GitHub Free. GitHub Pages from a private repository requires a plan that supports it, and the published Pages site is still publicly reachable.
6. Do not add a licence, `.gitignore`, or starter README because the package already contains the required files.
7. Select **Create repository**.

The repository may be public because it contains application code only. Never commit exported backups, bank statements, passwords, or finance data.

## Step 3: Upload the app files

1. In the empty repository, select **uploading an existing file**, or select **Add file > Upload files**.
2. Open the extracted `andre-finance-pwa` folder in File Explorer.
3. Select all files and folders inside it.
4. Drag them into the GitHub upload area.
5. Confirm that `index.html` will be at the repository root, not inside another `andre-finance-pwa` folder.
6. Enter the commit message `Initial Fortnight Finance PWA`.
7. Select **Commit changes**.

## Step 4: Enable GitHub Pages

1. Open the repository **Settings**.
2. In the left menu, select **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Select branch **main**.
5. Select folder **/(root)**.
6. Select **Save**.
7. Open the repository **Actions** tab and wait for the Pages deployment to finish successfully.
8. Return to **Settings > Pages** and select **Visit site**.

The address normally has this form:

```text
https://YOUR-GITHUB-USERNAME.github.io/fortnight-finance/
```

Copy the exact address, including the repository name and final `/`. Record it as the **GitHub Pages app URL**.

At this point the app should open in local-only mode. Do not enter real finance data yet.

---

# Part 3 — Prepare the Supabase database

## Step 5: Create or select a Supabase project

1. Sign in to Supabase.
2. Create a new project, or use a dedicated existing project that does not contain unrelated production data.
3. Use a name such as `fortnight-finance`.
4. Select a region close to New Zealand where practical.
5. Create a strong database password and store it in a password manager.
6. Wait for the project to finish provisioning.

The browser app never needs the database password.

## Step 6: Create the finance table and security policies

1. In the Supabase project, open **SQL Editor**.
2. Select **New query**.
3. On your computer, open `supabase/schema.sql` from the extracted project folder.
4. Copy the entire file into the Supabase query editor.
5. Select **Run**.
6. Confirm the query completes without an error.

The script creates one table named:

```text
public.finance_state
```

It also enables Row Level Security and creates policies allowing each authenticated user to read and change only the row matching their own user ID.

## Step 7: Verify the Supabase setup

1. In **SQL Editor**, create another query.
2. Open `supabase/verify_setup.sql` from the package.
3. Copy it into the query editor and run it.
4. Confirm:
   - `rls_enabled` is `true`.
   - four policies are listed for select, insert, update, and delete.
   - `authenticated` has select, insert, update, and delete privileges.
   - `anon` does not have table privileges.
5. Open **Database > Tables** or **Table Editor** and confirm `finance_state` exists.
6. Open the Supabase **Security Advisor** and resolve any warning specifically related to this table before proceeding.

## Step 8: Copy the public Supabase values

1. Open **Project Settings > API Keys**. In some dashboard layouts this is available through the project's **Connect** dialog.
2. Copy the **Project URL**. It looks like:

```text
https://YOUR-PROJECT-REF.supabase.co
```

3. Copy the **Publishable key**, beginning with `sb_publishable_`.
4. If the project still uses legacy keys, the legacy `anon` key will also work, but the publishable key is preferred.
5. Never copy the secret key, legacy `service_role` key, or database password into the app.

Record the Project URL and publishable key.

---

# Part 4 — Configure Supabase authentication URLs

## Step 9: Set the Site URL and redirect allow list

1. In Supabase, open **Authentication > URL Configuration**.
2. Set **Site URL** to the exact GitHub Pages app URL, for example:

```text
https://YOUR-GITHUB-USERNAME.github.io/fortnight-finance/
```

3. Under **Redirect URLs**, add the same exact URL.
4. Save the changes.

Use the exact deployed URL rather than a broad wildcard. This URL is used after Microsoft sign-in and for authentication-related redirects.

## Step 10: Copy the Supabase Azure callback URL

1. In Supabase, open **Authentication > Sign In / Providers**.
2. Select **Azure (Microsoft)**.
3. Find the callback URL shown on that provider page.
4. It normally has this form:

```text
https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
```

5. Copy this exact URL and record it as the **Supabase Auth callback URL**.
6. Do not use the GitHub Pages address as the Microsoft app registration's callback URL. Microsoft sends the authentication result to Supabase first.

Leave this Supabase page open because you will return to it.

---

# Part 5 — Create the Microsoft Entra app registration

## Step 11: Register the Microsoft application

1. Sign in to the Microsoft Entra admin centre.
2. Open **Entra ID > App registrations**.
3. Select **New registration**.
4. Name it `Fortnight Finance`.
5. Under **Supported account types**, choose one of the following:
   - **Any Entra ID tenant + Personal Microsoft accounts** if you may use either a work/school account or a personal Microsoft account.
   - **Personal Microsoft accounts only** if this app will only use an Outlook.com, Hotmail, Live, Skype, or Xbox-linked personal account.
6. Leave the Redirect URI empty during initial registration if prompted.
7. Select **Register**.
8. On the Overview page, copy the **Application (client) ID**.

Do not copy the Object ID as the client ID.

## Step 12: Add the Microsoft redirect URI

1. In the new app registration, open **Authentication**.
2. Select **Add a platform**.
3. Select **Web**.
4. Paste the exact **Supabase Auth callback URL** copied earlier:

```text
https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
```

5. Save the configuration.
6. Do not enable implicit grant checkboxes unless Microsoft or Supabase explicitly requires them for a later change. The current Supabase browser flow does not require you to enable them manually.

## Step 13: Create the Microsoft client secret

1. Open **Certificates & secrets**.
2. Open **Client secrets**.
3. Select **New client secret**.
4. Enter a description such as `Supabase Fortnight Finance`.
5. Choose an expiry period you can manage.
6. Select **Add**.
7. Immediately copy the secret from the **Value** column.
8. Do not copy the Secret ID instead.
9. Store the expiry date in your calendar and password manager.

The secret value is entered only in Supabase. Never place it in GitHub or `js/config.js`.

## Step 14: Optional Microsoft identity hardening

Supabase recommends adding the `xms_edov` optional claim so it can reliably determine whether a Microsoft email domain is verified.

This is an optional hardening step after basic sign-in works:

1. In the Entra app registration, open **Manifest**.
2. Save a copy of the original manifest before editing.
3. Follow the current Supabase Azure-provider documentation for the `xms_edov` and `email` optional claims.
4. Save the manifest.
5. Retest Microsoft sign-in.

Do not guess or partially edit the manifest. Use the current structure shown in the official Supabase documentation.

---

# Part 6 — Connect Microsoft authentication to Supabase

## Step 15: Enable the Azure provider

1. Return to Supabase **Authentication > Sign In / Providers > Azure (Microsoft)**.
2. Enable the provider.
3. Paste the Microsoft **Application (client) ID**.
4. Paste the Microsoft **client secret Value**.
5. Configure the Azure tenant URL as follows:
   - For **Any Entra ID tenant + Personal Microsoft accounts**, use the default common tenant or:

```text
https://login.microsoftonline.com/common
```

   - For **Personal Microsoft accounts only**, use:

```text
https://login.microsoftonline.com/consumers
```

   - For a single organisation only, use that tenant's ID in the tenant URL.
6. Save the provider.

The app already requests the required `email` scope during Microsoft sign-in.

---

# Part 7 — Configure the deployed PWA

## Step 16: Edit `js/config.js` in GitHub

1. Return to the GitHub repository.
2. Open `js/config.js`.
3. Select the pencil icon to edit the file.
4. Replace the three blank values with your real public values:

```js
window.FINANCE_CONFIG = {
  appName: "Fortnight Finance",
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabasePublishableKey: "sb_publishable_YOUR_KEY",
  appUrl: "https://YOUR-GITHUB-USERNAME.github.io/fortnight-finance/",

  allowLocalMode: true,
  enableEmailPasswordLogin: true,
  enableSignUp: true,
  enableMicrosoftLogin: true,
  inactivityTimeoutMinutes: 30,

  autoSyncDelayMs: 1800,
  autoFolderBackupDelayMs: 5000
};
```

5. Confirm that `appUrl` exactly matches Supabase's Site URL and Redirect URL, including the final `/`.
6. Confirm that you have used a publishable key, not a secret or service-role key.
7. Commit with the message `Configure Supabase and app URL`.
8. Wait for the GitHub Pages deployment to complete.
9. Open the PWA address and refresh it.

Version 1.1 uses a network-first service-worker strategy, so configuration changes should update normally. If an older installed copy remains stale, close all app windows, reopen the site in Edge, press `Ctrl+F5`, and then reopen the installed app.

---

# Part 8 — Create and secure your first user

## Step 17: Test Microsoft sign-in

1. Open the GitHub Pages app in Microsoft Edge.
2. Select **Sign in with Microsoft**.
3. Sign in with the Microsoft account you intend to use on every device.
4. Review the Microsoft consent screen and continue.
5. Confirm that you return to the GitHub Pages app.
6. Confirm the sidebar status changes to **Cloud synced**.

If sign-in fails, use the troubleshooting section at the end of this guide before entering finance data.

## Step 18: Confirm the user and cloud row

1. In Supabase, open **Authentication > Users**.
2. Confirm your Microsoft user is listed.
3. In the app, add a temporary test bill named `SYNC TEST` for `$1.00`.
4. Wait until the app says it has synced.
5. In Supabase **Table Editor > finance_state**, confirm one row exists.
6. The `user_id` should match your Supabase Auth user ID.
7. The `data` column should contain JSON representing the app state.

Do not manually edit the JSON in Table Editor unless recovering under controlled instructions.

## Step 19: Lock down the login screen

After Microsoft sign-in and sync have been tested successfully:

1. In GitHub, edit `js/config.js` again.
2. Change:

```js
allowLocalMode: false,
enableEmailPasswordLogin: false,
enableSignUp: false,
enableMicrosoftLogin: true,
```

3. Commit the change.
4. In Supabase, open the Auth general configuration/provider settings.
5. Disable **Allow new users to sign up** only after your intended Microsoft account already exists.
6. Sign out and sign back in with Microsoft to confirm the existing account still works.

Disabling new sign-ups prevents additional new Supabase users. Re-enable it temporarily if you later deliberately add another user.

---

# Part 9 — Test synchronisation on another device

## Step 20: Test the laptop

1. On the laptop, open the same GitHub Pages URL.
2. Sign in with the same Microsoft account.
3. Confirm the `SYNC TEST` bill appears.
4. Change it to `$2.00` on the laptop.
5. Wait for **Cloud synced**.
6. Return to the desktop and use **Backup & Sync > Reload cloud copy** if the change is not shown immediately.
7. Confirm the `$2.00` amount appears.

This version synchronises after local saves but does not use a permanent realtime subscription. Avoid editing the same bill on two devices at exactly the same time. If a conflict is detected, the app will ask whether to use the cloud copy or replace it with the current device.

## Step 21: Test offline use

1. While signed in, close and reopen the app once so the static files are cached.
2. Disconnect the laptop from the internet.
3. Open the installed PWA.
4. Confirm the dashboard loads from local storage.
5. Add a temporary transaction.
6. Reconnect to the internet.
7. Confirm the app synchronises.

Do not sign out while deliberately working offline, because authentication and cloud recovery require internet access.

---

# Part 10 — Install the PWA

## Step 22: Install on Windows

In Microsoft Edge:

1. Open the GitHub Pages app.
2. Use the install icon in the address bar, or open the Edge menu and select **Apps > Install Fortnight Finance**.
3. Confirm installation.
4. Pin it to the Start menu or taskbar if required.

Repeat on the laptop.

## Step 23: Install on a phone

On Android using Edge or Chrome:

1. Open the GitHub Pages app.
2. Open the browser menu.
3. Select **Install app** or **Add to Home screen**.
4. Sign in with the same Microsoft account.

The mobile version is intended for checking balances, viewing bills, and entering transactions. Detailed statement imports and folder backups are better performed on the desktop.

---

# Part 11 — Configure encrypted OneDrive-folder backups

## Step 24: Create the backup folder

On the Windows desktop:

1. Confirm the OneDrive desktop client is signed in and synchronising.
2. In File Explorer, create:

```text
OneDrive\Household Finance Backups
```

3. Open the installed finance PWA in Edge or Chrome.
4. Open **Backup & Sync**.
5. Select **Choose folder**.
6. Select the `Household Finance Backups` folder.
7. Approve read/write access when the browser asks.

## Step 25: Set and test the backup password

1. Select **Set session password**.
2. Use a strong, unique password.
3. Store it in your password manager. The password cannot be recovered by the app.
4. Select **Back up now**.
5. In File Explorer, confirm these files or folders appear:

```text
fortnight-finance-latest.afbackup
Daily\fortnight-finance-YYYY-MM-DD.afbackup
```

6. Confirm OneDrive shows the files as synchronised.

The password is held only in memory for the current app/browser session. Enter it again after restarting the browser or computer. Automatic backups occur after saved changes while the app is open.

## Step 26: Test restore before relying on it

1. In **Backup & Sync**, create an additional encrypted manual export.
2. Store that file in a separate safe location.
3. Add a temporary bill named `RESTORE TEST`.
4. Import the encrypted backup created before the test bill.
5. Enter the backup password.
6. Confirm `RESTORE TEST` disappears and the previous state returns.
7. Delete the temporary test records after validation.

A backup that has never been restored is not a proven backup.

---

# Part 12 — Add your real finance details

Use this order after all tests pass:

1. **Settings**
   - Household name
   - Known first date of a payday fortnight
   - Opening buffer, if used
2. **Settings > Account nicknames**
   - Main account
   - Bills account
   - Everyday spending
   - Savings
   - Credit card
   - Dojo account only if you intentionally track it separately
3. **Income**
   - Salary
   - FamilyBoost or assistance
   - Other regular or one-time income
4. **Bills**
   - Weekly bills
   - Fortnightly bills
   - Monthly bills
   - Quarterly and annual bills
   - One-time expected bills
5. **Planning**
   - Grocery and fuel limits
   - Personal spending limits
   - Sinking funds
   - Debt balances and payments
6. **Transactions**
   - Enter actual transactions manually, or import a CSV statement
7. **Settings > Matching rules**
   - Add repeat merchant descriptions after reviewing statement imports

Never enter bank passwords, PINs, CVVs, full card numbers, or Microsoft/Supabase secrets into finance fields.

---

# Troubleshooting

## The site shows local mode after configuring Supabase

Check:

1. `supabaseUrl` is not blank.
2. `supabasePublishableKey` is not blank.
3. You used the publishable key, not a secret key.
4. The GitHub commit deployed successfully.
5. You refreshed with `Ctrl+F5`.
6. `vendor/supabase.min.js` exists in the repository.

## Microsoft says the redirect URI does not match

The Microsoft Entra **Web redirect URI** must be the Supabase callback URL:

```text
https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
```

It is not the GitHub Pages URL.

## Microsoft login succeeds but returns to the wrong site

Confirm all three values are identical:

1. GitHub `js/config.js` → `appUrl`
2. Supabase Authentication → **Site URL**
3. Supabase Authentication → **Redirect URLs**

Use the full GitHub Pages project URL with the final `/`.

## Microsoft login reports that email is required

Confirm:

1. The app's `signInWithOAuth` request still includes the `email` scope.
2. The Azure provider is enabled in Supabase.
3. The Microsoft account has a usable email address.
4. The app registration's supported account type matches the account being used.

## The app reports a Row Level Security error

1. Run `supabase/schema.sql` again.
2. Run `supabase/verify_setup.sql`.
3. Confirm RLS is enabled.
4. Confirm the four policies exist.
5. Confirm the browser uses a publishable key.
6. Sign out and sign in again to refresh the session.

## The laptop does not show the latest change

1. Confirm both devices use the same Microsoft account.
2. Confirm both show **Cloud synced**.
3. Open **Backup & Sync** and select **Sync now**.
4. On the receiving device, select **Reload cloud copy**.
5. Do not overwrite the cloud copy unless you have confirmed that the current device contains the version you want to keep.

## The OneDrive folder backup stops after restarting the browser

This is expected. Reopen **Backup & Sync**, re-enter the session backup password, and approve folder access if requested.

## The app displays an older version after a GitHub update

1. Wait for the GitHub Pages Actions deployment to finish.
2. Close all installed PWA windows.
3. Open the normal site in Edge.
4. Press `Ctrl+F5`.
5. Reopen the installed app.
6. As a last resort, open Edge site settings for the app and clear only the cached site files. Do not clear storage until you have confirmed cloud sync and a tested backup.

---

# Final security checklist

Before entering real data, confirm all of the following:

- [ ] GitHub contains no bank statements or backup files.
- [ ] `js/config.js` contains only the Supabase URL, publishable key, and public app URL.
- [ ] No Supabase secret/service-role key is in GitHub.
- [ ] No Microsoft client secret is in GitHub.
- [ ] Supabase RLS is enabled and the four policies exist.
- [ ] Microsoft sign-in works.
- [ ] Local-only mode is disabled.
- [ ] Sign-up controls are disabled after the intended user exists.
- [ ] Desktop and laptop synchronisation has been tested.
- [ ] An encrypted backup has been created and successfully restored.
- [ ] The backup password is stored separately.
- [ ] Windows sign-in, device encryption, and browser updates are enabled on devices holding the local offline cache.

# Microsoft OneDrive Setup — Fortnight Finance Version 3.3.3

This guide adds optional Microsoft Graph OneDrive app-folder synchronisation to the existing Fortnight Finance application.

It does **not** replace:

- Microsoft login through Supabase Auth;
- the Supabase `finance_state` table;
- Akahu or ASB synchronisation;
- local IndexedDB storage;
- the existing encrypted desktop OneDrive-folder backup.

## Values used by this app

| Setting | Value |
|---|---|
| Production URL | `https://andrevonrhenen-arminius.github.io/fortnight-finance/` |
| Authority | `https://login.microsoftonline.com/common` |
| Platform | Single-page application |
| Graph permission | Delegated `Files.ReadWrite.AppFolder` |
| Graph app-folder base | `/me/drive/special/approot` |
| OneDrive file | `fortnight-finance-state.json` |
| App identifier inside the file | `fortnight-finance-pwa` |
| Client secret | None |

## Important account limitation

The app uses the restricted `Files.ReadWrite.AppFolder` permission and will not request `Files.ReadWrite.All`.

Microsoft's current permissions documentation identifies `Files.ReadWrite.AppFolder` as available for personal Microsoft accounts. The `common` authority also permits work or school sign-in, but the restricted app-folder operation may be rejected for a work or school OneDrive. Do not add a broader permission unless the project owner explicitly approves that security change.

## 1. Create the Microsoft Entra app registration

1. Open the Microsoft Entra admin centre: `https://entra.microsoft.com/`.
2. Sign in with the Microsoft account that can create app registrations.
3. Open **Identity** > **Applications** > **App registrations**.
4. Select **New registration**.
5. Enter a clear name, such as:

   ```text
   Fortnight Finance OneDrive Sync
   ```

6. Under **Supported account types**, select:

   ```text
   Accounts in any organisational directory and personal Microsoft accounts
   ```

   This setting is required for the `common` authority. Restricted OneDrive app-folder access is still subject to the account limitation described above.

7. Leave Redirect URI blank during initial registration if preferred.
8. Select **Register**.

## 2. Copy the Application client ID

On the app registration **Overview** page:

1. Find **Application (client) ID**.
2. Copy the GUID value.
3. Do not copy the Directory object ID or tenant ID by mistake.
4. This client ID is public SPA configuration. It is not a password or secret.

## 3. Add the production SPA redirect URI

1. In the app registration, open **Authentication**.
2. Select **Add a platform**.
3. Select **Single-page application**.
4. Add this exact URI, including the trailing slash:

   ```text
   https://andrevonrhenen-arminius.github.io/fortnight-finance/
   ```

5. Save the authentication configuration.

The URI must be registered under **Single-page application**, not **Web**. SPA platform registration enables the authorisation code flow with PKCE used by MSAL Browser.

## 4. Add a localhost SPA redirect URI

For local testing, add the exact address used by the local web server. A recommended value is:

```text
http://localhost:8000/
```

Start a local server from the project folder with:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Do not open `index.html` directly from a `file://` address. MSAL and the service worker require an HTTP or HTTPS origin.

## 5. Add Microsoft Graph permission

1. Open **API permissions**.
2. Select **Add a permission**.
3. Select **Microsoft Graph**.
4. Select **Delegated permissions**.
5. Search for:

   ```text
   Files.ReadWrite.AppFolder
   ```

6. Select only `Files.ReadWrite.AppFolder`.
7. Select **Add permissions**.
8. Do not add `Files.ReadWrite.All` or `Files.ReadWrite` for this build.

Depending on the tenant and account, user consent may be sufficient. If the organisation blocks user consent, a tenant administrator may need to grant consent.

## 6. Do not create a client secret

This application is a browser-based SPA and is therefore a public client.

- Do not open **Certificates & secrets** to create a client secret.
- A secret placed in browser code cannot remain confidential.
- MSAL Browser uses the authorisation code flow with PKCE instead.
- MSAL manages tokens; the app does not manually store refresh tokens.

## 7. Enter the client ID in Fortnight Finance

1. Deploy or open Fortnight Finance.
2. Sign in through the existing Supabase login, or use the existing local mode if enabled.
3. Open **Backup & Sync**.
4. Find **Microsoft OneDrive app-folder sync**.
5. Enter the copied **Application (client) ID**.
6. Confirm Authority is:

   ```text
   https://login.microsoftonline.com/common
   ```

7. Confirm Redirect URI is exactly:

   ```text
   https://andrevonrhenen-arminius.github.io/fortnight-finance/
   ```

   For local testing, use the exact localhost URI registered in Entra.

8. Select **Save Microsoft configuration**.

The saved values apply only to that browser. To deploy a default client ID to every device, edit only the public `clientId` value in `js/microsoft-config.js`. Never add a secret to that file.

## 8. Sign in to Microsoft OneDrive

1. Select **Sign in with Microsoft**.
2. Choose the Microsoft account that owns the target OneDrive.
3. Review the permission request.
4. Confirm that it asks for access to the application's own folder rather than all OneDrive files.
5. Complete sign-in.

On first sign-in, the app checks for `fortnight-finance-state.json`:

- If the file does not exist, the current local finance state is uploaded.
- If a valid file exists and is newer, the app asks before loading it.
- If the current device is newer, the app asks before replacing OneDrive.
- If both copies changed independently, the app displays a conflict and overwrites neither copy.

## 9. Confirm the backup exists in OneDrive

The app resolves its dedicated folder through the Microsoft Graph `/me/drive/special/approot` endpoint and stores only its own state file there.

After the first successful upload:

1. Open OneDrive in the browser.
2. Open the **Apps** folder.
3. Open the folder created for the Entra application. Its name normally follows the app registration display name.
4. Confirm this file exists:

   ```text
   fortnight-finance-state.json
   ```

Do not manually edit the JSON unless performing controlled recovery work. Changing it can cause the integrity validation to fail.

## 10. Test Sync now

1. In Fortnight Finance, add or update a harmless test record.
2. Confirm the app reports **Saved locally** first.
3. Open **Backup & Sync**.
4. Select **Sync now**.
5. Confirm the status reports a successful OneDrive sync.
6. Confirm the **Last successful OneDrive sync** time updates.

## 11. Test on a second device

1. Open the same deployed app on a second browser or device.
2. Use the existing Supabase application sign-in as normal.
3. Open **Backup & Sync**.
4. Enter the same Microsoft client ID, authority and exact redirect URI if they are not deployed in `js/microsoft-config.js`.
5. Sign in to the same Microsoft OneDrive account.
6. Select **Sync now**.
7. If the OneDrive copy is newer, choose **Load OneDrive copy**.
8. Confirm the expected accounts, bills, income, transactions, rates and planning data appear.
9. Make a small change, wait for local save, then sync.
10. Return to the first device and confirm it detects or safely loads the newer copy.

## 12. Manual Pull from OneDrive

**Pull from OneDrive** replaces the current local working state only after:

- the file is valid JSON;
- envelope schema is supported;
- app ID equals `fortnight-finance-pwa`;
- finance schema is supported;
- required finance collections are present;
- the SHA-256 integrity hash matches.

The app shows a warning and creates a local safety snapshot before applying the OneDrive data.

## 13. Manual Push this device to OneDrive

**Push this device to OneDrive** validates the local state and warns before replacing the OneDrive file.

The upload uses the current Graph ETag where available. If another device changes the file between comparison and upload, the operation stops and asks for another comparison rather than silently overwriting it.

## 14. Redirect URI mismatch troubleshooting

The common error is:

```text
AADSTS50011: The redirect URI specified in the request does not match...
```

Check all of the following:

1. The URI in Fortnight Finance exactly matches the Entra registration.
2. The production URI includes the repository path:

   ```text
   /fortnight-finance/
   ```

3. The trailing slash matches.
4. The URI is registered under **Single-page application**, not **Web**.
5. Localhost uses the same port in Entra and in the local server.
6. The saved app configuration does not contain a query string or `#` fragment.
7. Wait briefly after changing Entra settings, then retry in a new browser tab.

## 15. Permission troubleshooting

If sign-in succeeds but OneDrive returns access denied:

1. Confirm `Files.ReadWrite.AppFolder` is listed as a delegated Microsoft Graph permission.
2. Sign out of the OneDrive section and sign in again to trigger consent.
3. Check whether the account is a personal Microsoft account.
4. If it is a work or school account, the restricted app-folder permission may not be supported.
5. Check whether the organisation blocks user consent.
6. Ask an Entra administrator to review consent policy without adding broader file permissions.
7. Do not add `Files.ReadWrite.All` as a quick workaround.

## 16. Pop-up troubleshooting

If the sign-in window does not open:

1. Allow pop-ups for the GitHub Pages or localhost site.
2. Disable strict pop-up blocking for this site temporarily.
3. Retry from a normal browser tab rather than an embedded preview.
4. Confirm third-party identity sign-in is not blocked by a browser extension.
5. Try Microsoft Edge or a current Chrome version.
6. Clear the displayed error in **Backup & Sync**, then retry.

## 17. Offline and reconnect test

1. Sign in to OneDrive successfully while online.
2. Disconnect the device from the network.
3. Make a small finance change.
4. Confirm the app still says the data was saved locally.
5. Open **Backup & Sync** and confirm the OneDrive queue is pending or offline.
6. Reconnect the network.
7. Confirm the app retries the comparison and sync.
8. If both devices changed while disconnected, confirm a conflict is displayed and neither copy is silently overwritten.

## 18. Security verification

Before publishing, verify:

- `js/microsoft-config.js` contains only a public client ID, authority and redirect URI;
- no client secret exists;
- no access or refresh tokens exist in source files;
- `js/config.js` still contains only the existing public Supabase configuration;
- Akahu tokens remain Supabase Edge Function secrets;
- production uses HTTPS;
- `Files.ReadWrite.AppFolder` is the only OneDrive file permission;
- `fortnight-finance-state.json` is unique to this app.

## Live-test status for this package

The packaged automated tests use mocked MSAL and Microsoft Graph responses. Live Microsoft sign-in and live OneDrive access were not tested because no OneDrive Entra client ID was supplied for this build. Complete the registration and manual steps above before treating the live integration as verified.

## Microsoft documentation

- MSAL Browser: `https://learn.microsoft.com/en-us/entra/msal/javascript/browser/`
- SPA authorisation code flow with PKCE: `https://learn.microsoft.com/en-us/entra/msal/javascript/browser/migrate-spa-implicit-to-auth-code`
- Add a redirect URI: `https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri`
- OneDrive app folder: `https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder`
- Get a special folder: `https://learn.microsoft.com/en-us/graph/api/drive-get-specialfolder?view=graph-rest-1.0`
- Microsoft Graph permissions reference: `https://learn.microsoft.com/en-us/graph/permissions-reference`

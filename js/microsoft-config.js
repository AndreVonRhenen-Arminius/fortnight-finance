/*
  Public Microsoft SPA configuration for optional OneDrive app-folder sync.

  Safe to place here:
  - Microsoft Application (client) ID
  - Authority
  - Redirect URI

  NEVER place a client secret, access token, refresh token or password here.
  Values saved in the app's Backup & Sync screen override these defaults only
  in the current browser.
*/
window.APP_MICROSOFT_CONFIG = Object.freeze({
  clientId: '',
  authority: 'https://login.microsoftonline.com/common',
  redirectUri: window.location.origin + window.location.pathname
});

/*
  Public browser configuration for GitHub Pages.

  Safe to place here:
  - Supabase Project URL
  - Supabase publishable key (or legacy anon key)
  - The public GitHub Pages application URL

  NEVER place here:
  - Supabase secret/service_role key
  - Microsoft client secret
  - Database password
  - Bank login, PIN, card number or CVV
*/
window.FINANCE_CONFIG = {
  appName: "Fortnight Finance",

  // Example: https://YOUR-PROJECT-REF.supabase.co
  supabaseUrl: "",

  // Use an sb_publishable_... key. A legacy anon key also works.
  supabasePublishableKey: "",

  // Exact deployed address, including the repository name and trailing slash.
  // Example: https://YOUR-GITHUB-USERNAME.github.io/fortnight-finance/
  appUrl: "",

  // Leave true only while testing. Change to false after cloud login works.
  allowLocalMode: true,

  // These controls affect what the login screen displays.
  enableEmailPasswordLogin: true,
  enableSignUp: true,
  enableMicrosoftLogin: true,

  // Automatically signs out a cloud session after inactivity. Set 0 to disable.
  inactivityTimeoutMinutes: 30,

  autoSyncDelayMs: 1800,
  autoFolderBackupDelayMs: 5000
};

# Starting a new ChatGPT conversation

Upload this complete ZIP and say:

> Review `PROJECT_CONTEXT.md`, `README.md`, `CHANGELOG.md` and the source code. Continue development from Version 3.3.3. Preserve `js/config.js`, `js/microsoft-config.js`, Supabase authentication, optional OneDrive integration, Akahu secrets and existing finance data unless I explicitly ask.

Also provide a screenshot and browser-console error when reporting a UI fault.

## Sensitive data warning

This package contains a public Supabase publishable key and project URL in `js/config.js`, which are expected in a browser app protected by Row Level Security. It does not contain Akahu tokens, Microsoft client secrets, Supabase service-role keys or bank login credentials.

const cfg = window.FINANCE_CONFIG || {};
let client = null;
let remoteVersion = null;

export function cloudConfigured() {
  return Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey && window.supabase?.createClient);
}

export function initCloud() {
  if (!cloudConfigured()) return null;
  if (!client) {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return client;
}

export async function getSession() {
  if (!initCloud()) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  initCloud();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  initCloud();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

function configuredRedirectUrl() {
  const candidate = cfg.appUrl || window.location.href;
  const url = new URL(candidate, window.location.href);
  url.hash = '';
  url.search = '';
  return url.href;
}

export async function signInMicrosoft() {
  initCloud();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'azure',
    options: { redirectTo: configuredRedirectUrl(), scopes: 'email' }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
  remoteVersion = null;
}

export function onAuthChange(callback) {
  if (!initCloud()) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function loadRemote() {
  if (!client) throw new Error('Cloud sync is not configured.');
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) return null;
  const { data, error } = await client.from('finance_state').select('data, version, updated_at').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  if (!data) { remoteVersion = null; return null; }
  remoteVersion = Number(data.version || 1);
  return { state: data.data, version: remoteVersion, updatedAt: data.updated_at };
}

export async function saveRemote(state, { force = false } = {}) {
  if (!client) throw new Error('Cloud sync is not configured.');
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error('You are not signed in.');

  const payload = structuredClone(state);
  delete payload.ui;
  const now = new Date().toISOString();

  if (remoteVersion === null) {
    const { data, error } = await client.from('finance_state').insert({ user_id: user.id, data: payload, version: 1, updated_at: now }).select('version').single();
    if (error) {
      if (error.code === '23505') {
        const remote = await loadRemote();
        const conflict = new Error('A cloud copy already exists.'); conflict.code = 'SYNC_CONFLICT'; conflict.remote = remote; throw conflict;
      }
      throw error;
    }
    remoteVersion = Number(data.version);
    return remoteVersion;
  }

  const nextVersion = remoteVersion + 1;
  let query = client.from('finance_state').update({ data: payload, version: nextVersion, updated_at: now }).eq('user_id', user.id);
  if (!force) query = query.eq('version', remoteVersion);
  const { data, error } = await query.select('version');
  if (error) throw error;
  if (!data?.length) {
    const remote = await loadRemote();
    const conflict = new Error('The cloud copy was changed on another device.'); conflict.code = 'SYNC_CONFLICT'; conflict.remote = remote; throw conflict;
  }
  remoteVersion = Number(data[0].version);
  return remoteVersion;
}

export async function overwriteRemote(state) {
  const remote = await loadRemote();
  if (!remote && remoteVersion === null) return saveRemote(state);
  return saveRemote(state, { force: true });
}

export function getRemoteVersion() { return remoteVersion; }

export async function invokeBankSync(body = {}) {
  if (!initCloud()) throw new Error('Cloud sync is not configured.');
  const functionName = cfg.bankSyncFunctionName || 'asb-sync';
  const { data, error } = await client.functions.invoke(functionName, { body });
  if (error) {
    const context = error.context;
    let message = error.message || 'ASB sync failed.';
    try {
      const payload = context ? await context.json() : null;
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the original Supabase function error.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

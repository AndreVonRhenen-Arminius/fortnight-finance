// Fortnight Finance v2.0 ASB sync Edge Function.
import { createClient } from 'npm:@supabase/supabase-js@2';

const AKAHU_BASE = 'https://api.akahu.io/v1';
const NZ_TIME_ZONE = 'Pacific/Auckland';
const MAX_HISTORY_DAYS = 365;
const DEFAULT_LOOKBACK_DAYS = 45;
const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

type JsonRecord = Record<string, any>;

function json(body: unknown, status = 200, origin = '') {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type, x-cron-secret');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new Response(JSON.stringify(body), { status, headers });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

function adminKey(): string {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return parsed.default;
    } catch {
      // Fall back to the legacy hosted secret below.
    }
  }
  return requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
}

function allowedOrigin(requestOrigin: string | null): string {
  const configured = requiredEnv('FINANCE_APP_ORIGIN').replace(/\/$/, '');
  if (!requestOrigin) return '';
  if (requestOrigin.replace(/\/$/, '') !== configured) throw new Error('Origin is not allowed.');
  return requestOrigin;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.min(max, Math.max(min, Math.round(numberValue))) : fallback;
}

function localDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '').slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function toUtcStart(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function maskAccountNumber(value = ''): string {
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  return `•••• ${digits.slice(-4)}`;
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function dateOnly(value: string): Date {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(value: string, days: number): string {
  const date = dateOnly(value);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function addMonthsClamped(value: string, months: number, preferredDay?: number): string {
  const date = dateOnly(value);
  const targetDay = preferredDay || date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(targetDay, last));
  return isoDate(target);
}

function nextOccurrence(value: string, frequency: string, preferredDay?: number): string | null {
  if (frequency === 'weekly') return addDays(value, 7);
  if (frequency === 'fortnightly') return addDays(value, 14);
  if (frequency === 'monthly') return addMonthsClamped(value, 1, preferredDay);
  if (frequency === 'quarterly') return addMonthsClamped(value, 3, preferredDay);
  if (frequency === 'yearly') return addMonthsClamped(value, 12, preferredDay);
  return null;
}

function occurrencesBetween(item: JsonRecord, start: string, end: string): string[] {
  if (!item?.active || !item?.nextDate) return [];
  let cursor = String(item.nextDate).slice(0, 10);
  const result: string[] = [];
  let guard = 0;
  if (item.frequency === 'once') return cursor >= start && cursor <= end ? [cursor] : [];
  while (cursor < start && guard++ < 1000) {
    const next = nextOccurrence(cursor, item.frequency, item.dayOfMonth);
    if (!next) return result;
    cursor = next;
  }
  while (cursor <= end && guard++ < 1200) {
    result.push(cursor);
    const next = nextOccurrence(cursor, item.frequency, item.dayOfMonth);
    if (!next) break;
    cursor = next;
  }
  return result;
}

function occurrenceAmount(item: JsonRecord, date: string): number {
  return number(item?.overrides?.[date] ?? item?.amount);
}

function occurrenceKey(id: string, date: string): string {
  return `${id}:${date}`;
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Math.round((dateOnly(a).getTime() - dateOnly(b).getTime()) / 86400000));
}

function fingerprintTransaction(tx: JsonRecord): string {
  const raw = `${tx.accountId || ''}|${tx.date || ''}|${Number(tx.amount || 0).toFixed(2)}|${String(tx.description || '').trim().toUpperCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normaliseDescription(value: unknown): string {
  return String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function sanitizeAccounts(items: JsonRecord[]) {
  return items.map((account) => ({
    id: account._id,
    name: account.name || account.type || 'ASB account',
    institution: account.connection?.name || 'ASB',
    masked: maskAccountNumber(account.formatted_account),
    type: account.type || '',
    status: account.status || '',
    attributes: Array.isArray(account.attributes) ? account.attributes : [],
    balance: account.balance ? {
      current: number(account.balance.current),
      available: number(account.balance.available),
      currency: account.balance.currency || 'NZD',
    } : null,
    refreshedTransactions: account.refreshed?.transactions || '',
  }));
}

function akahuHeaders() {
  return {
    Authorization: `Bearer ${requiredEnv('AKAHU_USER_ACCESS_TOKEN')}`,
    'X-Akahu-Id': requiredEnv('AKAHU_APP_ID_TOKEN'),
    Accept: 'application/json',
  };
}

async function akahuRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${AKAHU_BASE}${path}`, {
    ...init,
    headers: { ...akahuHeaders(), ...(init.headers || {}) },
  });
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok || payload?.success === false) {
    const message = payload?.message || payload?.error || `Akahu request failed (${response.status}).`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function fetchAccounts(): Promise<JsonRecord[]> {
  const payload = await akahuRequest('/accounts');
  return Array.isArray(payload.items) ? payload.items : [];
}

async function requestRefresh() {
  return akahuRequest('/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

async function fetchTransactionsForAccount(accountId: string, start: string, end: string): Promise<JsonRecord[]> {
  const items: JsonRecord[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const query = new URLSearchParams({ start, end });
    if (cursor) query.set('cursor', cursor);
    const payload = await akahuRequest(`/accounts/${encodeURIComponent(accountId)}/transactions?${query.toString()}`);
    items.push(...(Array.isArray(payload.items) ? payload.items : []));
    cursor = payload.cursor?.next ?? null;
  } while (cursor);
  return items;
}

function ruleForTransaction(state: JsonRecord, description: string) {
  const upper = normaliseDescription(description);
  return (state.rules || []).find((rule: JsonRecord) => upper.includes(normaliseDescription(rule.pattern)));
}

function findScheduleOccurrence(state: JsonRecord, kind: 'bill' | 'income', scheduleId: string, date: string, amount: number) {
  const collection = kind === 'bill' ? state.bills || [] : state.incomes || [];
  const schedule = collection.find((item: JsonRecord) => item.id === scheduleId && item.active !== false);
  if (!schedule) return { schedule: null, occurrenceDate: '', exact: false, difference: 0 };
  const start = addDays(date, -5);
  const end = addDays(date, 5);
  const existingTransactions = state.transactions || [];
  const candidates = occurrencesBetween(schedule, start, end)
    .map((occurrenceDate) => ({
      occurrenceDate,
      expected: occurrenceAmount(schedule, occurrenceDate),
      distance: dayDistance(date, occurrenceDate),
      occupiedBy: existingTransactions.find((tx: JsonRecord) => tx.matchedOccurrenceKey === occurrenceKey(schedule.id, occurrenceDate)) || null,
    }))
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return { schedule, occurrenceDate: '', exact: false, difference: 0 };
  const best = candidates[0];
  const difference = Math.abs(best.expected - amount);
  return { schedule, occurrenceDate: best.occurrenceDate, exact: difference <= 0.02, difference, occupiedBy: best.occupiedBy };
}

function addReview(reviewItems: JsonRecord[], item: JsonRecord) {
  const key = item.key || `${item.kind}:${item.transactionId || ''}:${item.billId || ''}:${item.occurrenceDate || ''}`;
  if (reviewItems.some((existing) => existing.key === key && existing.status === 'open')) return;
  reviewItems.unshift({ id: uid('review'), key, status: 'open', createdAt: new Date().toISOString(), ...item });
}

function isInternalTransferDescription(value: unknown) {
  const text = normaliseDescription(value);
  return [
    /^MB TRANSFER\b/,
    /^FN TRANSFER\b/,
    /\bTRANSFER TO\b/,
    /\bTRANSFER FROM\b/,
    /\bTRANSFER EX\b/,
    /\bINTERNAL TRANSFER\b/,
    /\bACCOUNT TRANSFER\b/
  ].some((pattern) => pattern.test(text));
}

function billNameMatches(description: string, billName: string) {
  const bankText = normaliseDescription(description);
  const words = normaliseDescription(billName).split(' ').filter((word) => word.length >= 3);
  return words.some((word) => bankText.includes(word));
}

function applyAutomaticBillMatch(tx: JsonRecord, state: JsonRecord, reviewItems: JsonRecord[]) {
  if (tx.type !== 'expense' || tx.matchedOccurrenceKey || tx._rule?.scheduleId) return;
  const candidates: JsonRecord[] = [];
  for (const bill of (state.bills || []).filter((item: JsonRecord) => item.active !== false)) {
    const result = findScheduleOccurrence(state, 'bill', bill.id, tx.date, tx.amount);
    if (!result.exact || !result.occurrenceDate) continue;
    candidates.push({
      bill,
      occurrenceDate: result.occurrenceDate,
      occupiedBy: result.occupiedBy,
      distance: dayDistance(tx.date, result.occurrenceDate),
      nameMatch: billNameMatches(`${tx.bankDescription || ''} ${tx.description || ''}`, bill.name || ''),
    });
  }
  const named = candidates.filter((item) => item.nameMatch);
  const pool = named.length ? named : candidates;
  pool.sort((a, b) => a.distance - b.distance);
  const chosen = pool.length === 1 || (pool.length > 1 && pool[0].distance < pool[1].distance) ? pool[0] : null;
  if (!chosen) {
    if (pool.length > 1) {
      addReview(reviewItems, {
        key: `ambiguous-bill:${tx.bankSourceId}`,
        kind: 'ambiguous-bill',
        title: `${tx.description} matches more than one scheduled bill`,
        detail: 'The amount matches multiple bills. Confirm the correct bill manually.',
        transactionSourceId: tx.bankSourceId,
        amount: tx.amount,
        date: tx.date,
      });
    }
    return;
  }
  tx.matchedBillId = chosen.bill.id;
  tx.matchedOccurrenceKey = occurrenceKey(chosen.bill.id, chosen.occurrenceDate);
  tx.category = chosen.bill.category || tx.category;
  tx.description = chosen.bill.name || tx.description;
  if (chosen.occupiedBy && !chosen.occupiedBy.bankSourceId) tx.replaceTransactionId = chosen.occupiedBy.id;
}

function rawToTransaction(raw: JsonRecord, mapping: JsonRecord, state: JsonRecord): JsonRecord {
  const description = String(raw.description || '').trim();
  const rule = ruleForTransaction(state, description);
  const signedAmount = number(raw.amount);
  let type = signedAmount < 0 ? 'expense' : 'income';
  if (String(raw.type || '').toUpperCase() === 'TRANSFER' || isInternalTransferDescription(description)) type = 'transfer';
  if (rule?.type) type = rule.type;
  const merchant = rule?.merchant || raw.merchant?.name || description;
  const category = type === 'transfer'
    ? 'Transfer'
    : rule?.category || raw.category?.name || (type === 'income' ? 'Income' : 'Uncategorised');
  const tx: JsonRecord = {
    id: `tx_bank_${hashText(String(raw._id))}`,
    date: localDate(raw.date),
    type,
    description: merchant,
    bankDescription: description,
    merchant,
    category,
    amount: Math.abs(signedAmount),
    accountId: mapping.localAccountId || '',
    source: 'ASB sync',
    bankProvider: 'Akahu',
    bankSourceId: raw._id,
    bankAccountId: raw._account,
    bankRawType: raw.type || '',
    bankUpdatedAt: raw.updated_at || '',
    bankCreatedAt: raw.created_at || '',
    bankBalanceAfter: raw.balance ?? null,
    bankMeta: {
      particulars: raw.meta?.particulars || '',
      code: raw.meta?.code || '',
      reference: raw.meta?.reference || '',
    },
    notes: '',
  };
  tx.fingerprint = fingerprintTransaction(tx);
  tx._rule = rule || null;
  return tx;
}

function buildLoanTransactions(rawTransactions: JsonRecord[], mappingByAccount: Map<string, JsonRecord>, state: JsonRecord, reviewItems: JsonRecord[]) {
  const groups = new Map<string, JsonRecord[]>();
  const componentIds = new Set<string>();
  const regex = /LOAN\s+REPAYMENT\s+([A-Z0-9]+)\s*(INTEREST|PRINCIPAL)/i;

  for (const raw of rawTransactions) {
    const match = normaliseDescription(raw.description).match(regex);
    if (!match) continue;
    const reference = match[1].toUpperCase();
    const date = localDate(raw.date);
    const key = `${raw._account}:${date}:${reference}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(raw);
    componentIds.add(raw._id);
  }

  const combined: JsonRecord[] = [];
  for (const [key, components] of groups.entries()) {
    const [, date, reference] = key.split(':');
    const loanMapping = (state.bankSync?.loanMappings || []).find((entry: JsonRecord) =>
      entry.active !== false && normaliseDescription(entry.reference) === reference
    );
    const hasInterest = components.some((component) => /INTEREST/i.test(component.description));
    const hasPrincipal = components.some((component) => /PRINCIPAL/i.test(component.description));
    if (!loanMapping || !hasInterest || !hasPrincipal) {
      addReview(reviewItems, {
        key: `loan-incomplete:${key}`,
        kind: 'loan-incomplete',
        title: `Loan repayment ${reference} needs review`,
        detail: !loanMapping ? 'No bill mapping exists for this loan reference.' : 'Both principal and interest entries were not found.',
        reference,
        date,
        componentDescriptions: components.map((component) => component.description),
      });
      continue;
    }

    const mapping = mappingByAccount.get(components[0]._account);
    if (!mapping) continue;
    const bill = (state.bills || []).find((entry: JsonRecord) => entry.id === loanMapping.billId);
    const amount = components.reduce((sum, component) => sum + Math.abs(number(component.amount)), 0);
    const sourceId = `loan:${components[0]._account}:${date}:${reference}`;
    const tx: JsonRecord = {
      id: `tx_bank_${hashText(sourceId)}`,
      date,
      type: 'expense',
      description: bill?.name || `Loan repayment ${reference}`,
      bankDescription: components.map((component) => component.description).join(' + '),
      merchant: bill?.name || `Loan repayment ${reference}`,
      category: bill?.category || 'Debt payment',
      amount,
      accountId: mapping.localAccountId || '',
      source: 'ASB sync',
      bankProvider: 'Akahu',
      bankSourceId: sourceId,
      bankSourceIds: components.map((component) => component._id).sort(),
      bankAccountId: components[0]._account,
      bankRawType: 'LOAN',
      loanReference: reference,
      notes: 'Combined automatically from ASB principal and interest entries.',
    };
    if (bill) {
      const match = findScheduleOccurrence(state, 'bill', bill.id, date, amount);
      if (match.exact && match.occurrenceDate) {
        tx.matchedBillId = bill.id;
        tx.matchedOccurrenceKey = occurrenceKey(bill.id, match.occurrenceDate);
        if (match.occupiedBy && !match.occupiedBy.bankSourceId) tx.replaceTransactionId = match.occupiedBy.id;
      } else {
        addReview(reviewItems, {
          key: `loan-amount:${sourceId}`,
          kind: 'bill-match',
          title: `${bill.name} payment amount needs review`,
          detail: match.occurrenceDate
            ? `Expected ${match.schedule ? occurrenceAmount(match.schedule, match.occurrenceDate).toFixed(2) : 'unknown'} but found ${amount.toFixed(2)}.`
            : 'No scheduled occurrence was found within five days.',
          transactionSourceId: sourceId,
          billId: bill.id,
          occurrenceDate: match.occurrenceDate,
          amount,
        });
      }
    }
    tx.fingerprint = fingerprintTransaction(tx);
    combined.push(tx);
  }
  return { combined, componentIds };
}

function applyExplicitScheduleRule(tx: JsonRecord, state: JsonRecord, reviewItems: JsonRecord[]) {
  const rule = tx._rule;
  delete tx._rule;
  if (!rule?.scheduleId || !['bill', 'income'].includes(rule.scheduleKind)) return;
  const match = findScheduleOccurrence(state, rule.scheduleKind, rule.scheduleId, tx.date, tx.amount);
  if (match.exact && match.occurrenceDate) {
    if (rule.scheduleKind === 'bill') tx.matchedBillId = rule.scheduleId;
    tx.matchedOccurrenceKey = occurrenceKey(rule.scheduleId, match.occurrenceDate);
    if (match.occupiedBy && !match.occupiedBy.bankSourceId) tx.replaceTransactionId = match.occupiedBy.id;
    if (match.schedule?.category && tx.type === 'expense') tx.category = match.schedule.category;
    if (rule.scheduleKind === 'income') tx.category = 'Income';
    return;
  }
  addReview(reviewItems, {
    key: `schedule-rule:${tx.bankSourceId}:${rule.scheduleKind}:${rule.scheduleId}`,
    kind: 'schedule-match',
    title: `${tx.description} did not exactly match its linked schedule`,
    detail: match.occurrenceDate
      ? `Expected ${occurrenceAmount(match.schedule, match.occurrenceDate).toFixed(2)} but found ${tx.amount.toFixed(2)}.`
      : 'No scheduled occurrence was found within five days.',
    transactionSourceId: tx.bankSourceId,
    scheduleKind: rule.scheduleKind,
    scheduleId: rule.scheduleId,
    occurrenceDate: match.occurrenceDate,
    amount: tx.amount,
  });
}

function preserveUserEdits(incoming: JsonRecord, existing?: JsonRecord): JsonRecord {
  if (!existing) return incoming;
  const merged = { ...existing, ...incoming, id: existing.id };
  if (existing.bankUserEdited) {
    for (const key of ['date', 'type', 'description', 'category', 'accountId', 'notes', 'matchedBillId', 'matchedOccurrenceKey']) {
      if (existing[key] !== undefined) merged[key] = existing[key];
    }
    merged.bankUserEdited = true;
  }
  return merged;
}

async function authorize(req: Request, admin: ReturnType<typeof createClient>) {
  const ownerUserId = requiredEnv('FINANCE_OWNER_USER_ID');
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret && cronSecret === requiredEnv('FINANCE_CRON_SECRET')) return { userId: ownerUserId, mode: 'cron' };

  const authorization = req.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Authentication is required.');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error('The signed-in session is invalid.');
  if (data.user.id !== ownerUserId) throw new Error('This account is not authorised for ASB sync.');
  return { userId: data.user.id, mode: 'user' };
}

Deno.serve(async (req: Request) => {
  let origin = '';
  try {
    origin = allowedOrigin(req.headers.get('origin'));
  } catch (error) {
    return json({ error: error.message }, 403);
  }

  if (req.method === 'OPTIONS') return json({ ok: true }, 200, origin);
  if (req.method !== 'POST') return json({ error: 'POST is required.' }, 405, origin);

  try {
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const admin = createClient(supabaseUrl, adminKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await authorize(req, admin);
    const body = await req.json().catch(() => ({}));
    const action = body?.action || 'sync';

    if (action === 'accounts') {
      const accounts = await fetchAccounts();
      return json({ ok: true, accounts: sanitizeAccounts(accounts) }, 200, origin);
    }

    if (action !== 'sync') return json({ error: 'Unsupported action.' }, 400, origin);

    const { data: row, error: loadError } = await admin
      .from('finance_state')
      .select('data, version')
      .eq('user_id', auth.userId)
      .single();
    if (loadError || !row) throw loadError || new Error('Finance state was not found.');

    const state: JsonRecord = structuredClone(row.data || {});
    state.bankSync = {
      enabled: true,
      provider: 'Akahu / ASB',
      availableAccounts: [],
      accountMappings: [],
      loanMappings: [],
      reviewItems: [],
      syncHistory: [],
      lookbackDays: DEFAULT_LOOKBACK_DAYS,
      ...(state.bankSync || {}),
    };
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    state.rules = Array.isArray(state.rules) ? state.rules : [];
    state.audit = Array.isArray(state.audit) ? state.audit : [];
    state.bankSync.lastAttemptAt = new Date().toISOString();

    let refreshRequested = false;
    let refreshMessage = '';
    const lastRefresh = state.bankSync.lastRefreshRequestedAt ? new Date(state.bankSync.lastRefreshRequestedAt).getTime() : 0;
    if (body?.requestRefresh && Date.now() - lastRefresh >= REFRESH_COOLDOWN_MS) {
      try {
        await requestRefresh();
        refreshRequested = true;
        state.bankSync.lastRefreshRequestedAt = new Date().toISOString();
      } catch (error) {
        refreshMessage = error.message;
      }
    } else if (body?.requestRefresh) {
      refreshMessage = 'A manual Akahu refresh was already requested within the last hour.';
    }

    const accounts = await fetchAccounts();
    const safeAccounts = sanitizeAccounts(accounts);
    state.bankSync.availableAccounts = safeAccounts;
    state.bankSync.lastAccountsRefresh = new Date().toISOString();
    state.bankSync.lastDataRefresh = safeAccounts
      .map((account) => account.refreshedTransactions)
      .filter(Boolean)
      .sort()
      .at(-1) || '';

    const mappings = (state.bankSync.accountMappings || []).filter((mapping: JsonRecord) =>
      mapping.importTransactions !== false && mapping.akahuAccountId && mapping.localAccountId
    );
    if (!mappings.length) {
      return json({
        error: 'No ASB accounts are mapped for transaction import. Load accounts in the app, map at least one account, and try again.',
        accounts: safeAccounts,
      }, 400, origin);
    }

    const mappedAccountIds = new Set(mappings.map((mapping: JsonRecord) => mapping.akahuAccountId));
    const mappingByAccount = new Map(mappings.map((mapping: JsonRecord) => [mapping.akahuAccountId, mapping]));
    const lookbackDays = clamp(state.bankSync.lookbackDays, 7, MAX_HISTORY_DAYS, DEFAULT_LOOKBACK_DAYS);
    const start = toUtcStart(lookbackDays);
    const end = new Date().toISOString();
    const rawTransactions: JsonRecord[] = [];
    for (const mapping of mappings) {
      const account = accounts.find((entry) => entry._id === mapping.akahuAccountId);
      if (!account || !Array.isArray(account.attributes) || !account.attributes.includes('TRANSACTIONS')) continue;
      rawTransactions.push(...await fetchTransactionsForAccount(mapping.akahuAccountId, start, end));
    }

    const reviewItems = (state.bankSync.reviewItems || []).filter((item: JsonRecord) => item.status !== 'open');
    const { combined: loanTransactions, componentIds } = buildLoanTransactions(rawTransactions, mappingByAccount, state, reviewItems);
    const converted = rawTransactions
      .filter((raw) => mappedAccountIds.has(raw._account) && !componentIds.has(raw._id))
      .map((raw) => rawToTransaction(raw, mappingByAccount.get(raw._account), state));
    for (const tx of converted) {
      applyExplicitScheduleRule(tx, state, reviewItems);
      applyAutomaticBillMatch(tx, state, reviewItems);
      delete tx._rule;
    }
    const incoming = [...loanTransactions, ...converted];

    const existingBySource = new Map(
      state.transactions
        .filter((tx: JsonRecord) => tx.bankProvider === 'Akahu' && tx.bankSourceId)
        .map((tx: JsonRecord) => [tx.bankSourceId, tx])
    );
    const incomingIds = new Set(incoming.map((tx) => tx.bankSourceId));
    let added = 0;
    let updated = 0;
    for (const tx of incoming) {
      const sourceExisting = existingBySource.get(tx.bankSourceId);
      const occurrenceExisting = !sourceExisting && tx.replaceTransactionId
        ? state.transactions.find((item: JsonRecord) => item.id === tx.replaceTransactionId)
        : null;
      const existing = sourceExisting || occurrenceExisting;
      delete tx.replaceTransactionId;
      const merged = preserveUserEdits(tx, existing);
      if (existing) {
        const index = state.transactions.findIndex((item: JsonRecord) => item.id === existing.id);
        state.transactions[index] = merged;
        updated++;
      } else {
        state.transactions.push(merged);
        added++;
      }
    }

    let duplicatesRemoved = 0;
    const occurrenceGroups = new Map<string, JsonRecord[]>();
    for (const tx of state.transactions) {
      if (!tx.matchedOccurrenceKey) continue;
      if (!occurrenceGroups.has(tx.matchedOccurrenceKey)) occurrenceGroups.set(tx.matchedOccurrenceKey, []);
      occurrenceGroups.get(tx.matchedOccurrenceKey)!.push(tx);
    }
    for (const items of occurrenceGroups.values()) {
      if (items.length < 2) continue;
      items.sort((a, b) => {
        const score = (tx: JsonRecord) => tx.bankProvider === 'Akahu' || tx.source === 'ASB sync' ? 4 : tx.source === 'bill' || tx.source === 'income schedule' ? 3 : 1;
        return score(b) - score(a);
      });
      const removeIds = new Set(items.slice(1).map((item) => item.id));
      if (removeIds.size) {
        state.transactions = state.transactions.filter((item: JsonRecord) => !removeIds.has(item.id));
        duplicatesRemoved += removeIds.size;
      }
    }

    const transfers = incoming.filter((tx) => tx.type === 'transfer').length;

    let removed = 0;
    const startDate = localDate(start);
    const endDate = localDate(end);
    state.transactions = state.transactions.filter((tx: JsonRecord) => {
      const inWindow = tx.bankProvider === 'Akahu' && tx.date >= startDate && tx.date <= endDate && mappedAccountIds.has(tx.bankAccountId);
      if (!inWindow || incomingIds.has(tx.bankSourceId)) return true;
      if (tx.bankUserEdited) {
        addReview(reviewItems, {
          key: `bank-removed:${tx.bankSourceId}`,
          kind: 'bank-removed',
          title: `${tx.description} is no longer returned by ASB`,
          detail: 'It was kept because you edited it manually. Check it against ASB.',
          transactionId: tx.id,
          transactionSourceId: tx.bankSourceId,
        });
        return true;
      }
      removed++;
      return false;
    });

    state.bankSync.reviewItems = reviewItems.slice(0, 100);
    state.bankSync.lastSuccessfulSync = new Date().toISOString();
    const summary = {
      at: state.bankSync.lastSuccessfulSync,
      mode: auth.mode,
      fetched: rawTransactions.length,
      added,
      updated,
      removed,
      review: state.bankSync.reviewItems.filter((item: JsonRecord) => item.status === 'open').length,
      transfers,
      duplicatesRemoved,
      refreshRequested,
      refreshMessage,
      lookbackDays,
    };
    state.bankSync.syncHistory = [summary, ...(state.bankSync.syncHistory || [])].slice(0, 30);
    state.updatedAt = new Date().toISOString();
    state.audit.unshift({ id: uid('audit'), at: state.updatedAt, reason: `ASB sync: ${added} added, ${updated} updated, ${removed} removed` });
    state.audit = state.audit.slice(0, 200);

    const nextVersion = number(row.version) + 1;
    const { data: updatedRows, error: updateError } = await admin
      .from('finance_state')
      .update({ data: state, version: nextVersion, updated_at: state.updatedAt })
      .eq('user_id', auth.userId)
      .eq('version', row.version)
      .select('version');
    if (updateError) throw updateError;
    if (!updatedRows?.length) return json({ error: 'Finance data changed during ASB sync. Run the sync again.' }, 409, origin);

    return json({ ok: true, summary, accounts: safeAccounts, version: nextVersion }, 200, origin);
  } catch (error) {
    console.error(error);
    const status = Number((error as any)?.status) || (/authori|authentic|origin/i.test(error.message) ? 403 : 500);
    return json({ error: error.message || 'ASB sync failed.' }, status, origin);
  }
});

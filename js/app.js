// Fortnight Finance v3.3.2 application module. This file belongs in /js/app.js only.
import { storage } from './storage.js';
import {
  cloudConfigured, getSession, signIn, signUp, signInMicrosoft, signOut,
  onAuthChange, loadRemote, saveRemote, overwriteRemote, invokeBankSync
} from './sync.js';
import {
  exportBackup, readBackupPackage, chooseBackupFolder, restoreFolderHandle,
  setSessionBackupPassword, hasSessionBackupPassword, hasFolderHandle,
  automaticFolderBackup, disconnectFolder
} from './backup.js';
import {
  uid, todayISO, isoDate, toDate, addDays, addMonthsClamped, daysBetween, fortnightContaining,
  occurrencesBetween, nextOccurrence, money, formatDate, formatShortDate,
  frequencyLabel, number, escapeHtml, csvParse, parseMoney, parseDateFlexible,
  fingerprintTransaction
} from './utils.js';

const cfg = window.FINANCE_CONFIG || {};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state;
let session = null;
let localOnly = false;
let currentView = 'dashboard';
let saveTimer = null;
let syncTimer = null;
let folderBackupTimer = null;
let installPrompt = null;
let importRows = [];
let enteringCloud = false;
let inactivityTimer = null;

const titles = {
  dashboard: ['Dashboard', 'Your selected fortnight at a glance'],
  bills: ['Bills', 'Regular, variable and one-time household bills'],
  income: ['Income', 'Regular and one-off income schedules'],
  transactions: ['Transactions', 'Actual money in and money out'],
  planning: ['Planning', 'Spending limits, sinking funds and debts'],
  rates: ['Rates', 'Quarterly invoices, fortnightly payments and amount owing'],
  bank: ['ASB Sync', 'Read-only bank transaction updates through Akahu'],
  backup: ['Backup & Sync', 'Cloud status, exports and recovery'],
  settings: ['Settings', 'Accounts, fortnight dates and matching rules']
};

const DATE_TIME = new Intl.DateTimeFormat('en-NZ', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

function formatDateTime(value) {
  if (!value) return '—';
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : DATE_TIME.format(parsed);
}

function defaultState() {
  const today = todayISO();
  return {
    schemaVersion: 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      currency: 'NZD',
      fortnightAnchor: today,
      selectedPeriodStart: today,
      openingBalance: 0,
      householdName: 'Household',
      showDojoAccount: false,
      theme: 'dark'
    },
    accounts: [
      { id: uid('acct'), name: 'Main account', type: 'everyday', active: true },
      { id: uid('acct'), name: 'Bills account', type: 'bills', active: true },
      { id: uid('acct'), name: 'Savings', type: 'savings', active: true },
      { id: uid('acct'), name: 'Credit card', type: 'credit', active: true }
    ],
    bills: [],
    incomes: [],
    budgets: [
      { id: uid('budget'), category: 'Groceries', amount: 0, active: true },
      { id: uid('budget'), category: 'Fuel / transport', amount: 0, active: true },
      { id: uid('budget'), category: 'Takeaways / entertainment', amount: 0, active: true },
      { id: uid('budget'), category: 'Household extras', amount: 0, active: true },
      { id: uid('budget'), category: 'Personal spending — André', amount: 0, active: true },
      { id: uid('budget'), category: 'Personal spending — Elaine', amount: 0, active: true }
    ],
    sinkingFunds: [
      { id: uid('fund'), name: 'Emergency fund', target: 0, balance: 0, contribution: 0, active: true },
      { id: uid('fund'), name: 'Car maintenance / tyres / WOF', target: 0, balance: 0, contribution: 0, active: true },
      { id: uid('fund'), name: 'Home repairs', target: 0, balance: 0, contribution: 0, active: true },
      { id: uid('fund'), name: 'Christmas / birthdays', target: 0, balance: 0, contribution: 0, active: true }
    ],
    debts: [],
    rates: {
      councilName: 'Council rates',
      linkedBillId: '',
      bankMatchPattern: '',
      managedRuleId: '',
      estimatedQuarterlyAmount: 0,
      nextInvoiceDate: '',
      invoices: []
    },
    transactions: [],
    rules: [],
    bankSync: {
      enabled: true,
      provider: 'Akahu / ASB',
      availableAccounts: [],
      accountMappings: [],
      loanMappings: [],
      reviewItems: [],
      syncHistory: [],
      lookbackDays: 45,
      lastSuccessfulSync: '',
      lastAttemptAt: '',
      lastDataRefresh: ''
    },
    audit: []
  };
}

function migrate(input) {
  const base = defaultState();
  if (!input || typeof input !== 'object') return base;
  const merged = {
    ...base,
    ...input,
    settings: { ...base.settings, ...(input.settings || {}) },
    rates: { ...base.rates, ...(input.rates || {}) },
    bankSync: { ...base.bankSync, ...(input.bankSync || {}) }
  };
  for (const key of ['accounts', 'bills', 'incomes', 'budgets', 'sinkingFunds', 'debts', 'transactions', 'rules', 'audit']) {
    merged[key] = Array.isArray(input[key]) ? input[key] : base[key];
  }
  for (const key of ['availableAccounts', 'accountMappings', 'loanMappings', 'reviewItems', 'syncHistory']) {
    merged.bankSync[key] = Array.isArray(input.bankSync?.[key]) ? input.bankSync[key] : base.bankSync[key];
  }
  merged.rates.invoices = Array.isArray(input.rates?.invoices) ? input.rates.invoices : base.rates.invoices;
  if (!merged.rates.linkedBillId) {
    const likelyRatesBills = merged.bills.filter(bill => /\bRATES?\b/i.test(`${bill.name || ''} ${bill.category || ''}`));
    if (likelyRatesBills.length === 1) merged.rates.linkedBillId = likelyRatesBills[0].id;
  }
  if (!number(merged.rates.estimatedQuarterlyAmount)) {
    const latestInvoice = merged.rates.invoices
      .filter(invoice => number(invoice.amount) > 0)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    if (latestInvoice) merged.rates.estimatedQuarterlyAmount = number(latestInvoice.amount);
  }
  merged.schemaVersion = 5;
  return merged;
}

async function init() {
  state = migrate(await storage.getState());
  applyTheme(state.settings.theme);
  await restoreFolderHandle().catch(() => null);
  registerServiceWorker();
  bindGlobalEvents();

  if (cloudConfigured()) {
    session = await getSession().catch(() => null);
    if (!session) showAuth();
    else await enterCloudMode();
    onAuthChange(async newSession => {
      session = newSession;
      if (session && !localOnly) await enterCloudMode();
    });
  } else {
    localOnly = true;
    hideAuth();
    render();
    updateSyncBadge('local', 'Local mode');
  }
}

async function enterCloudMode() {
  if (enteringCloud) return;
  enteringCloud = true;
  localOnly = false;
  hideAuth();
  $('#signOutButton').classList.remove('hidden');
  updateSyncBadge('pending', 'Loading cloud data…');
  try {
    const remote = await loadRemote();
    if (remote?.state) {
      state = migrate(remote.state);
      applyTheme(state.settings.theme);
      await storage.setState(state);
    } else {
      await saveRemote(state);
    }
    updateSyncBadge('synced', 'Cloud synced');
  } catch (error) {
    updateSyncBadge('error', 'Cloud error');
    toast(error.message, 'error');
  }
  render();
  startInactivityTimer();
  enteringCloud = false;
}

function showAuth() {
  $('#authScreen').classList.remove('hidden');
  $('#localModeButton').classList.toggle('hidden', !cfg.allowLocalMode);
  $('#microsoftLoginButton').classList.toggle('hidden', !cfg.enableMicrosoftLogin);
  $('#authForm').classList.toggle('hidden', cfg.enableEmailPasswordLogin === false);
  $('#signUpButton').classList.toggle('hidden', cfg.enableSignUp === false);
}
function hideAuth() { $('#authScreen').classList.add('hidden'); }

function bindGlobalEvents() {
  $('#mainNav').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    currentView = button.dataset.view;
    $$('.nav-item').forEach(item => item.classList.toggle('active', item === button));
    $('#sidebar').classList.remove('open');
    render();
  });

  $('#menuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#quickAddButton').addEventListener('click', () => openTransactionForm());
  $('#themeToggle').addEventListener('click', toggleTheme);
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const message = $('#authMessage'); message.textContent = '';
    try {
      await signIn($('#authEmail').value.trim(), $('#authPassword').value);
      session = await getSession();
      await enterCloudMode();
    } catch (error) { message.textContent = error.message; }
  });

  $('#signUpButton').addEventListener('click', async () => {
    const message = $('#authMessage'); message.textContent = '';
    try {
      const result = await signUp($('#authEmail').value.trim(), $('#authPassword').value);
      message.textContent = result.user && !result.session
        ? 'Account created. Check your email to confirm the account, then sign in.'
        : 'Account created.';
    } catch (error) { message.textContent = error.message; }
  });

  $('#microsoftLoginButton').addEventListener('click', async () => {
    try { await signInMicrosoft(); } catch (error) { $('#authMessage').textContent = error.message; }
  });

  $('#localModeButton').addEventListener('click', () => {
    localOnly = true; hideAuth(); render(); updateSyncBadge('local', 'Local mode');
  });

  $('#signOutButton').addEventListener('click', async () => {
    await signOut().catch(error => toast(error.message, 'error'));
    clearTimeout(inactivityTimer); session = null; localOnly = false; $('#signOutButton').classList.add('hidden'); showAuth();
  });

  $('#backupImportInput').addEventListener('change', handleBackupImport);
  $('#statementImportInput').addEventListener('change', handleStatementFile);
  $('#setupImportInput').addEventListener('change', handleSetupFile);

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
    $('#installButton').classList.remove('hidden');
  });
  $('#installButton').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null;
    $('#installButton').classList.add('hidden');
  });
  window.addEventListener('online', () => scheduleSync());

  for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(eventName, resetInactivityTimer, { passive: true });
  }
}

function applyTheme(theme = 'dark') {
  const selected = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = selected;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', selected === 'dark' ? '#0d161d' : '#17324d');
  const button = $('#themeToggle');
  if (button) {
    button.textContent = selected === 'dark' ? '☀' : '☾';
    button.setAttribute('aria-label', selected === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    button.title = selected === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }
}

async function toggleTheme() {
  state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
  applyTheme(state.settings.theme);
  await commit(`Changed theme to ${state.settings.theme}`, false);
}

function resetInactivityTimer() {
  if (!session || localOnly) return;
  startInactivityTimer();
}

function startInactivityTimer() {
  clearTimeout(inactivityTimer);
  const minutes = Number(cfg.inactivityTimeoutMinutes || 0);
  if (!session || localOnly || minutes <= 0) return;
  inactivityTimer = setTimeout(async () => {
    await signOut().catch(() => null);
    session = null;
    localOnly = false;
    $('#signOutButton').classList.add('hidden');
    showAuth();
    toast('Signed out after a period of inactivity.', 'info');
  }, minutes * 60 * 1000);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    registration.update().catch(() => null);
  } catch {
    // The app remains usable online even if service-worker registration fails.
  }
}

function render() {
  applyTheme(state.settings.theme);
  const selectedTitle = titles[currentView] || titles.dashboard;
  const [title, subtitle] = selectedTitle;
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
  const renderers = { dashboard: renderDashboard, bills: renderBills, income: renderIncome, transactions: renderTransactions, planning: renderPlanning, rates: renderRates, bank: renderBankSync, backup: renderBackup, settings: renderSettings };
  const renderer = renderers[currentView] || renderDashboard;
  try {
    $('#content').innerHTML = renderer();
  } catch (error) {
    console.error(`Failed to render ${currentView}`, error);
    $('#content').innerHTML = '<div class="notice danger"><strong>This section could not be loaded.</strong> Refresh the page. If the problem continues, check the browser console or restore the latest working app files.</div>';
  }
  bindViewEvents();
  if (currentView === 'backup') loadSnapshotsIntoView();
}

function bindViewEvents() {
  const content = $('#content');
  content.onclick = async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id, date } = button.dataset;
    const actions = {
      'period-prev': () => changePeriod(-14),
      'period-next': () => changePeriod(14),
      'period-current': () => goCurrentPeriod(),
      'add-bill': () => openBillForm(),
      'edit-bill': () => openBillForm(id),
      'delete-bill': () => deleteEntity('bills', id, 'bill'),
      'bill-paid': () => markBillPaid(id, date),
      'bill-override': () => setBillOverride(id, date),
      'add-income': () => openIncomeForm(),
      'edit-income': () => openIncomeForm(id),
      'delete-income': () => deleteEntity('incomes', id, 'income'),
      'income-received': () => markIncomeReceived(id, date),
      'add-transaction': () => openTransactionForm(),
      'edit-transaction': () => openTransactionForm(id),
      'delete-transaction': () => deleteEntity('transactions', id, 'transaction'),
      'import-statement': () => $('#statementImportInput').click(),
      'download-setup-template': () => downloadSetupTemplate(),
      'import-setup': () => $('#setupImportInput').click(),
      'add-budget': () => openBudgetForm(),
      'edit-budget': () => openBudgetForm(id),
      'delete-budget': () => deleteEntity('budgets', id, 'budget category'),
      'add-fund': () => openFundForm(),
      'edit-fund': () => openFundForm(id),
      'delete-fund': () => deleteEntity('sinkingFunds', id, 'sinking fund'),
      'add-debt': () => openDebtForm(),
      'add-credit-card': () => openDebtForm('', 'credit-card'),
      'rates-add-invoice': () => openRatesInvoiceForm(),
      'rates-load-supplied-history': () => loadSuppliedRatesHistory(),
      'rates-edit-invoice': () => openRatesInvoiceForm(id),
      'rates-delete-invoice': () => deleteRatesInvoice(id),
      'rates-add-payment': () => openRatesPaymentForm(),
      'rates-exclude-payment': () => excludeRatesPayment(id),
      'bank-load-accounts': () => loadBankAccounts(),
      'bank-sync-now': () => runBankSync(),
      'bank-clean-duplicates': () => reconcileBankTransactions(),
      'add-loan-mapping': () => openLoanMappingForm(),
      'edit-loan-mapping': () => openLoanMappingForm(id),
      'delete-loan-mapping': () => deleteLoanMapping(id),
      'bank-review-confirm': () => confirmBankReview(id),
      'bank-review-ignore': () => ignoreBankReview(id),
      'edit-debt': () => openDebtForm(id),
      'delete-debt': () => deleteEntity('debts', id, 'debt'),
      'add-account': () => openAccountForm(),
      'edit-account': () => openAccountForm(id),
      'delete-account': () => deleteEntity('accounts', id, 'account'),
      'add-rule': () => openRuleForm(),
      'edit-rule': () => openRuleForm(id),
      'delete-rule': () => deleteEntity('rules', id, 'matching rule'),
      'export-encrypted': () => promptEncryptedExport(),
      'export-plain': () => exportBackup(state),
      'import-backup': () => $('#backupImportInput').click(),
      'choose-folder': () => configureBackupFolder(),
      'folder-password': () => configureBackupPassword(),
      'backup-now': () => runFolderBackup(),
      'disconnect-folder': () => disconnectBackupFolder(),
      'sync-now': () => syncNow(),
      'restore-cloud': () => restoreFromCloud(),
      'overwrite-cloud': () => overwriteCloud(),
      'restore-snapshot': () => restoreSnapshot(id),
      'clear-all': () => clearAllData()
    };
    if (actions[action]) await actions[action]();
  };

  const settingsForm = $('#settingsForm');
  if (settingsForm) settingsForm.addEventListener('submit', saveSettings);
  const bankMappingsForm = $('#bankMappingsForm');
  if (bankMappingsForm) bankMappingsForm.addEventListener('submit', saveBankMappings);
  const bankOptionsForm = $('#bankOptionsForm');
  if (bankOptionsForm) bankOptionsForm.addEventListener('submit', saveBankOptions);
  const ratesSettingsForm = $('#ratesSettingsForm');
  if (ratesSettingsForm) ratesSettingsForm.addEventListener('submit', saveRatesSettings);
}


async function downloadSetupTemplate() {
  try {
    const response = await fetch('./samples/finance-setup-template.csv', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load the setup template (${response.status}).`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'finance-setup-template.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Setup template downloaded.', 'success');
  } catch (error) {
    toast(error.message || 'Could not download the setup template.', 'error');
  }
}

function getPeriod() {
  const start = state.settings.selectedPeriodStart || fortnightContaining(state.settings.fortnightAnchor).start;
  return { start: isoDate(start), end: isoDate(addDays(start, 13)) };
}

function changePeriod(days) {
  state.settings.selectedPeriodStart = isoDate(addDays(getPeriod().start, days));
  commit('Changed selected fortnight', false); render();
}
function goCurrentPeriod() {
  state.settings.selectedPeriodStart = fortnightContaining(state.settings.fortnightAnchor, new Date()).start;
  commit('Returned to current fortnight', false); render();
}

function amountForOccurrence(item, date) { return number(item.overrides?.[date] ?? item.amount); }
function occurrenceKey(id, date) { return `${id}:${date}`; }
function isOccurrenceRecorded(id, date) { return state.transactions.some(t => t.matchedOccurrenceKey === occurrenceKey(id, date)); }

function billOccurrences(period = getPeriod()) {
  return state.bills.flatMap(bill => occurrencesBetween(bill, period.start, period.end).map(date => ({
    ...bill, occurrenceDate: date, occurrenceAmount: amountForOccurrence(bill, date), paid: isOccurrenceRecorded(bill.id, date)
  }))).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
}
function incomeOccurrences(period = getPeriod()) {
  return state.incomes.flatMap(income => occurrencesBetween(income, period.start, period.end).map(date => ({
    ...income, occurrenceDate: date, occurrenceAmount: amountForOccurrence(income, date), received: isOccurrenceRecorded(income.id, date)
  }))).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
}
function periodTransactions(period = getPeriod()) {
  return state.transactions.filter(t => t.date >= period.start && t.date <= period.end).sort((a, b) => b.date.localeCompare(a.date));
}
function plannedSummary(period = getPeriod()) {
  const bills = billOccurrences(period).reduce((sum, b) => sum + b.occurrenceAmount, 0);
  const income = incomeOccurrences(period).reduce((sum, i) => sum + i.occurrenceAmount, 0);
  const budgets = state.budgets.filter(x => x.active).reduce((sum, x) => sum + number(x.amount), 0);
  const funds = state.sinkingFunds.filter(x => x.active).reduce((sum, x) => sum + number(x.contribution), 0);
  const debts = state.debts.filter(x => x.active).reduce((sum, x) => sum + number(x.extraPayment), 0);
  return { income, bills, budgets, funds, debts, remaining: number(state.settings.openingBalance) + income - bills - budgets - funds - debts };
}
function actualSummary(period = getPeriod()) {
  const tx = periodTransactions(period);
  const income = tx.filter(t => t.type === 'income').reduce((sum, t) => sum + number(t.amount), 0);
  const expenseTransactions = tx.filter(t => t.type === 'expense');
  const expenses = expenseTransactions.reduce((sum, t) => sum + number(t.amount), 0);
  const billsPaid = expenseTransactions.filter(t => t.matchedBillId || t.matchedOccurrenceKey).reduce((sum, t) => sum + number(t.amount), 0);
  const variableSpent = expenseTransactions.filter(t => !t.matchedBillId && !t.matchedOccurrenceKey).reduce((sum, t) => sum + number(t.amount), 0);
  const transfersIgnored = tx.filter(t => t.type === 'transfer').reduce((sum, t) => sum + number(t.amount), 0);
  return {
    income,
    expenses,
    billsPaid,
    variableSpent,
    transfersIgnored,
    remaining: number(state.settings.openingBalance) + income - expenses
  };
}

function renderPeriodBar() {
  const period = getPeriod();
  const current = fortnightContaining(state.settings.fortnightAnchor).start === period.start;
  return `<div class="period-bar">
    <div><div class="period-title">${formatDate(period.start)} – ${formatDate(period.end)}</div><div class="period-subtitle">${current ? 'Current fortnight' : 'Selected fortnight'}</div></div>
    <div class="button-row">
      <button class="secondary-button" data-action="period-prev">← Previous</button>
      <button class="secondary-button" data-action="period-current">Current</button>
      <button class="secondary-button" data-action="period-next">Next →</button>
    </div>
  </div>`;
}

function renderDashboard() {
  const period = getPeriod();
  const planned = plannedSummary(period);
  const actual = actualSummary(period);
  const occurrences = billOccurrences(period);
  const weekBoundary = isoDate(addDays(period.start, 6));
  const week1 = occurrences.filter(x => x.occurrenceDate <= weekBoundary);
  const week2 = occurrences.filter(x => x.occurrenceDate > weekBoundary);
  const unplanned = periodTransactions(period).filter(t => t.type === 'expense' && !t.matchedBillId && (!t.category || t.category === 'Uncategorised'));
  const overspent = state.budgets.filter(b => b.active).map(b => {
    const spent = periodTransactions(period).filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + number(t.amount), 0);
    return { ...b, spent, difference: number(b.amount) - spent };
  }).filter(x => x.difference < 0);
  const expectedIncomeCount = incomeOccurrences(period).length;
  const receivedIncomeCount = periodTransactions(period).filter(t => t.type === 'income').length;
  const unpaidCount = occurrences.filter(x => !x.paid).length;

  return `${renderPeriodBar()}
    <div class="grid cards">
      ${metricCard('Planned income', money(planned.income), `${expectedIncomeCount} scheduled payment(s)`, 'good')}
      ${metricCard('Total planned out', money(planned.bills + planned.budgets + planned.funds + planned.debts), `${unpaidCount} bill(s) still unpaid`, unpaidCount ? 'warn' : 'good')}
      ${metricCard('Income received', money(actual.income), `${receivedIncomeCount} actual deposit(s) recorded`, actual.income < planned.income ? 'warn' : 'good')}
      ${metricCard('Net actual cash flow', money(actual.remaining), `${money(actual.expenses)} actually spent`, actual.remaining < 0 ? 'bad' : 'good')}
    </div>

    <div class="grid two" style="margin-top:18px">
      ${scheduleCard('Week 1', period.start, weekBoundary, week1)}
      ${scheduleCard('Week 2', isoDate(addDays(period.start, 7)), period.end, week2)}
    </div>

    <div class="grid two" style="margin-top:18px">
      <div class="card">
        <div class="section-header" style="margin:0 0 8px"><h2>Fortnight plan</h2></div>
        ${summaryLine('Bills scheduled', planned.bills)}
        ${summaryLine('Variable spending limits', planned.budgets)}
        ${summaryLine('Sinking-fund contributions', planned.funds)}
        ${summaryLine('Separate debt planning', planned.debts)}
        ${summaryLine('Planned money remaining', planned.remaining, true)}
      </div>
      <div class="card">
        <div class="section-header" style="margin:0 0 8px"><h2>Actual fortnight summary</h2></div>
        ${summaryLine('Income received', actual.income)}
        ${summaryLine('Matched bills paid', actual.billsPaid)}
        ${summaryLine('Other spending', actual.variableSpent)}
        ${summaryLine('Transfers ignored', actual.transfersIgnored)}
        ${summaryLine('Net actual cash flow', actual.remaining, true)}
        <div class="muted small" style="margin-top:10px">Net actual cash flow uses only recorded income and real expenses. Internal transfers are shown for reference but excluded.</div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <h2>Review required</h2>
      ${unplanned.length || overspent.length || actual.income < planned.income ? `
        ${actual.income < planned.income ? `<div class="notice warning">Only ${money(actual.income)} of ${money(planned.income)} planned income has been recorded so far.</div>` : ''}
        ${unplanned.length ? `<div class="notice warning" style="margin-top:10px">${unplanned.length} imported or entered expense(s) are uncategorised.</div>` : ''}
        ${overspent.length ? `<div class="notice danger" style="margin-top:10px">${overspent.length} spending categor${overspent.length === 1 ? 'y is' : 'ies are'} over budget.</div>` : ''}
        <div class="list" style="margin-top:10px">
          ${unplanned.slice(0, 4).map(t => `<div class="list-item"><div><strong>${escapeHtml(t.description)}</strong><span>${formatShortDate(t.date)} · Uncategorised</span></div><strong>${money(t.amount)}</strong></div>`).join('')}
          ${overspent.slice(0, 4).map(b => `<div class="list-item"><div><strong>${escapeHtml(b.category)}</strong><span>Over the ${money(b.amount)} limit</span></div><strong class="negative">${money(Math.abs(b.difference))}</strong></div>`).join('')}
        </div>` : `<div class="empty-state"><strong>No immediate issues</strong>No missing income, uncategorised spending or overspent limits in this fortnight.</div>`}
    </div>`;
}

function metricCard(label, value, note, tone = '') {
  return `<div class="card ${tone}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`;
}
function summaryLine(label, value, total = false) {
  return `<div class="list-item" ${total ? 'style="font-weight:750"' : ''}><span>${label}</span><strong>${money(value)}</strong></div>`;
}
function scheduleCard(title, start, end, items) {
  return `<div class="card"><div class="section-header" style="margin:0 0 8px"><div><h2>${title}</h2><div class="muted small">${formatShortDate(start)} – ${formatShortDate(end)}</div></div></div>
    ${items.length ? `<div class="list">${items.map(item => `<div class="list-item"><div><strong>${escapeHtml(item.name)}</strong><span>${formatShortDate(item.occurrenceDate)} · ${escapeHtml(item.category || 'No category')}</span></div><div class="right"><strong>${money(item.occurrenceAmount)}</strong><span class="status ${item.paid ? 'paid' : 'due'}">${item.paid ? 'Paid' : 'Due'}</span></div></div>`).join('')}</div>` : `<div class="empty-state">No bills scheduled.</div>`}
  </div>`;
}

function renderBills() {
  const period = getPeriod();
  const due = billOccurrences(period);
  const rows = state.bills.slice().sort((a, b) => a.name.localeCompare(b.name)).map(bill => {
    const next = nextDueDate(bill);
    return `<tr>
      <td><strong>${escapeHtml(bill.name)}</strong><div class="muted small">${escapeHtml(bill.category || 'No category')}</div></td>
      <td>${money(bill.amount)}${bill.variable ? '<div class="muted small">Variable</div>' : ''}</td>
      <td>${frequencyLabel(bill.frequency)}</td>
      <td>${formatDate(next)}</td>
      <td>${bill.automatic ? 'Automatic' : 'Manual'}</td>
      <td><span class="status ${bill.active ? 'paid' : 'upcoming'}">${bill.active ? 'Active' : 'Paused'}</span></td>
      <td class="actions"><button class="secondary-button" data-action="edit-bill" data-id="${bill.id}">Edit</button><button class="text-button negative" data-action="delete-bill" data-id="${bill.id}">Delete</button></td>
    </tr>`;
  }).join('');

  return `${renderPeriodBar()}
    <div class="section-header"><h2>Due in this fortnight</h2><button class="primary-button" data-action="add-bill">+ Add bill</button></div>
    <div class="table-wrap"><table><thead><tr><th>Bill</th><th>Due date</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${due.length ? due.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong><div class="muted small">${escapeHtml(item.category || '')}</div></td><td>${formatDate(item.occurrenceDate)}</td><td>${money(item.occurrenceAmount)}</td><td><span class="status ${item.paid ? 'paid' : 'due'}">${item.paid ? 'Paid' : 'Due'}</span></td><td class="actions">${item.paid ? '' : `<button class="primary-button" data-action="bill-paid" data-id="${item.id}" data-date="${item.occurrenceDate}">Mark paid</button><button class="secondary-button" data-action="bill-override" data-id="${item.id}" data-date="${item.occurrenceDate}">Change this amount</button>`}</td></tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">No bills due in this fortnight.</div></td></tr>`}
    </tbody></table></div>

    <div class="section-header"><h2>All bill schedules</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Bill</th><th>Standard amount</th><th>Frequency</th><th>Next due</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${rows || `<tr><td colspan="7"><div class="empty-state"><strong>No bills yet</strong>Add each regular bill once and it will be scheduled automatically.</div></td></tr>`}
    </tbody></table></div>`;
}

function nextDueDate(item) {
  if (!item.nextDate) return '';
  let d = toDate(item.nextDate); let guard = 0;
  if (item.frequency === 'once') return isoDate(d);
  while (d < toDate(todayISO()) && guard++ < 1000) d = nextOccurrence(d, item.frequency, item.dayOfMonth);
  return isoDate(d);
}

function renderIncome() {
  const due = incomeOccurrences(getPeriod());
  return `${renderPeriodBar()}
    <div class="section-header"><h2>Expected in this fortnight</h2><button class="primary-button" data-action="add-income">+ Add income</button></div>
    <div class="table-wrap"><table><thead><tr><th>Income</th><th>Expected date</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>
      ${due.length ? due.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${formatDate(item.occurrenceDate)}</td><td>${money(item.occurrenceAmount)}</td><td><span class="status ${item.received ? 'paid' : 'upcoming'}">${item.received ? 'Received' : 'Expected'}</span></td><td>${item.received ? '' : `<button class="primary-button" data-action="income-received" data-id="${item.id}" data-date="${item.occurrenceDate}">Mark received</button>`}</td></tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">No income scheduled in this fortnight.</div></td></tr>`}
    </tbody></table></div>
    <div class="section-header"><h2>All income schedules</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Amount</th><th>Frequency</th><th>Next expected</th><th>Account</th><th>Actions</th></tr></thead><tbody>
      ${state.incomes.length ? state.incomes.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${money(item.amount)}</td><td>${frequencyLabel(item.frequency)}</td><td>${formatDate(nextDueDate(item))}</td><td>${escapeHtml(accountName(item.accountId))}</td><td class="actions"><button class="secondary-button" data-action="edit-income" data-id="${item.id}">Edit</button><button class="text-button negative" data-action="delete-income" data-id="${item.id}">Delete</button></td></tr>`).join('') : `<tr><td colspan="6"><div class="empty-state"><strong>No income schedules</strong>Add salary, FamilyBoost or other expected income.</div></td></tr>`}
    </tbody></table></div>`;
}

function renderTransactions() {
  const period = getPeriod(); const transactions = periodTransactions(period);
  return `${renderPeriodBar()}
    <div class="section-header"><h2>Transactions in this fortnight</h2><div class="button-row"><button class="secondary-button" data-action="import-statement">Import CSV statement</button><button class="primary-button" data-action="add-transaction">+ Add transaction</button></div></div>
    <div class="notice">Importing never changes your data immediately. The app first shows a review screen, flags probable duplicates and lets you correct categories.</div>
    <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Type</th><th>Amount</th><th>Source</th><th>Actions</th></tr></thead><tbody>
      ${transactions.length ? transactions.map(t => `<tr><td>${formatShortDate(t.date)}</td><td><strong>${escapeHtml(t.description)}</strong>${t.notes ? `<div class="muted small">${escapeHtml(t.notes)}</div>` : ''}</td><td>${escapeHtml(t.category || 'Uncategorised')}</td><td>${escapeHtml(accountName(t.accountId))}</td><td>${t.type === 'income' ? 'Money in' : t.type === 'transfer' ? 'Transfer' : 'Money out'}</td><td class="${t.type === 'expense' ? 'negative' : t.type === 'income' ? 'positive' : ''}">${money(t.amount)}</td><td>${escapeHtml(t.source || 'manual')}</td><td class="actions"><button class="secondary-button" data-action="edit-transaction" data-id="${t.id}">Edit</button><button class="text-button negative" data-action="delete-transaction" data-id="${t.id}">Delete</button></td></tr>`).join('') : `<tr><td colspan="8"><div class="empty-state"><strong>No transactions</strong>Add actual spending or import a bank CSV statement.</div></td></tr>`}
    </tbody></table></div>`;
}

function debtTypeLabel(value = 'other') {
  const labels = {
    mortgage: 'Mortgage',
    'personal-loan': 'Personal loan',
    'credit-card': 'Credit card',
    afterpay: 'Afterpay / BNPL',
    other: 'Other debt'
  };
  return labels[value] || labels.other;
}

function linkedDebtBill(debt) {
  if (debt.linkedBillId) return state.bills.find(bill => bill.id === debt.linkedBillId) || null;
  const debtText = normalisedBankText(debt.name || '');
  const candidates = state.bills.filter(bill => {
    const billText = normalisedBankText(bill.name || '');
    return debtText && (billText.includes(debtText) || debtText.includes(billText));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function linkedBankAccount(debt) {
  return (state.bankSync?.availableAccounts || []).find(account => account.id === debt.bankAccountId) || null;
}

function debtDisplayedBalance(debt) {
  const bankAccount = linkedBankAccount(debt);
  if (bankAccount?.balance && Number.isFinite(Number(bankAccount.balance.current))) {
    return { amount: Math.abs(number(bankAccount.balance.current)), source: 'ASB balance' };
  }
  return { amount: number(debt.balance), source: 'Manual balance' };
}

function debtPaymentStatus(debt, period = getPeriod()) {
  const bill = linkedDebtBill(debt);
  if (!bill) return { bill: null, amount: 0, paid: false, due: false, nextDate: '', status: 'Not linked' };
  const occurrences = billOccurrences(period).filter(item => item.id === bill.id);
  const current = occurrences[0] || null;
  return {
    bill,
    amount: current ? current.occurrenceAmount : number(bill.amount),
    paid: Boolean(current?.paid),
    due: Boolean(current && !current.paid),
    nextDate: current?.occurrenceDate || nextDueDate(bill),
    status: current ? (current.paid ? 'Paid' : 'Due') : 'Upcoming'
  };
}


function debtProjectedBalance(debt, payment) {
  const confirmed = debtDisplayedBalance(debt).amount;
  const canProject = debt.debtType === 'afterpay' || debt.debtType === 'credit-card';
  if (!canProject || !payment?.paid) {
    return { amount: confirmed, changed: false, note: '' };
  }
  const paidAmount = Math.min(confirmed, number(payment.amount));
  return {
    amount: Math.max(0, confirmed - paidAmount),
    changed: true,
    note: `Projected after ${money(paidAmount)} paid`
  };
}

function renderPlanning() {
  const period = getPeriod();
  const tx = periodTransactions(period);
  return `<div class="grid two">
    <div>
      <div class="section-header"><h2>Fortnightly spending limits</h2><button class="primary-button" data-action="add-budget">+ Add</button></div>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th>Limit</th><th>Spent</th><th>Remaining</th><th></th></tr></thead><tbody>
        ${state.budgets.map(item => { const spent = tx.filter(t => t.type === 'expense' && t.category === item.category).reduce((s,t)=>s+number(t.amount),0); const remaining=number(item.amount)-spent; return `<tr><td>${escapeHtml(item.category)}</td><td>${money(item.amount)}</td><td>${money(spent)}</td><td class="${remaining < 0 ? 'negative' : 'positive'}">${money(remaining)}</td><td class="actions"><button class="secondary-button" data-action="edit-budget" data-id="${item.id}">Edit</button><button class="text-button negative" data-action="delete-budget" data-id="${item.id}">Delete</button></td></tr>`; }).join('')}
      </tbody></table></div>
    </div>
    <div>
      <div class="section-header"><h2>Sinking funds</h2><button class="primary-button" data-action="add-fund">+ Add</button></div>
      <div class="card">${state.sinkingFunds.length ? state.sinkingFunds.map(item => { const pct = item.target > 0 ? Math.min(100, item.balance/item.target*100) : 0; return `<div class="list-item"><div style="flex:1"><strong>${escapeHtml(item.name)}</strong><span>${money(item.balance)} of ${money(item.target)} · ${money(item.contribution)}/fortnight</span><div class="progress"><span style="width:${pct}%"></span></div></div><div class="actions"><button class="secondary-button" data-action="edit-fund" data-id="${item.id}">Edit</button><button class="text-button negative" data-action="delete-fund" data-id="${item.id}">Delete</button></div></div>`; }).join('') : '<div class="empty-state">No sinking funds.</div>'}</div>
    </div>
  </div>

  <div class="section-header"><div><h2>Debt and credit accounts</h2><div class="muted small">Link each record to its scheduled bill. Link an ASB account when Akahu supplies a live balance.</div></div><div class="button-row"><button class="secondary-button" data-action="add-credit-card">+ Add credit card</button><button class="primary-button" data-action="add-debt">+ Add debt</button></div></div>
  <div class="table-wrap"><table><thead><tr><th>Debt</th><th>Balance</th><th>Payment this fortnight</th><th>Next payment</th><th>Status</th><th>Available credit</th><th>Actions</th></tr></thead><tbody>
    ${state.debts.length ? state.debts.map(item => {
      const balance = debtDisplayedBalance(item);
      const payment = debtPaymentStatus(item, period);
      const projected = debtProjectedBalance(item, payment);
      const availableCredit = item.debtType === 'credit-card' && number(item.creditLimit) > 0 ? Math.max(0, number(item.creditLimit) - projected.amount) : null;
      return `<tr>
        <td><strong>${escapeHtml(item.name)}</strong><div class="muted small">${escapeHtml(debtTypeLabel(item.debtType))}${payment.bill ? ` · ${escapeHtml(payment.bill.name)}` : ' · No bill linked'}</div></td>
        <td>
          ${money(projected.amount)}
          <div class="muted small">${projected.changed ? escapeHtml(projected.note) : escapeHtml(balance.source)}</div>
          ${projected.changed ? `<div class="muted small">Confirmed balance: ${money(balance.amount)}</div>` : ''}
        </td>
        <td>${payment.bill ? money(payment.amount) : '—'}</td>
        <td>${payment.nextDate ? formatDate(payment.nextDate) : '—'}</td>
        <td><span class="status ${payment.paid ? 'paid' : payment.due ? 'due' : 'upcoming'}">${escapeHtml(payment.status)}</span></td>
        <td>${availableCredit === null ? '—' : money(availableCredit)}${item.debtType === 'credit-card' && number(item.creditLimit) > 0 ? `<div class="muted small">Limit ${money(item.creditLimit)}</div>` : ''}</td>
        <td class="actions"><button class="secondary-button" data-action="edit-debt" data-id="${item.id}">Edit</button><button class="text-button negative" data-action="delete-debt" data-id="${item.id}">Delete</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="7"><div class="empty-state"><strong>No debt or credit records</strong>Add your mortgage, personal loan, Afterpay and credit card, then link each to the matching bill schedule.</div></td></tr>`}
  </tbody></table></div>
  <div class="notice" style="margin-top:14px"><strong>Balance handling:</strong> mortgage and personal-loan balances are never reduced by the full repayment because repayments include interest. Afterpay and credit-card records show a projected balance after a recorded payment, while retaining the confirmed balance separately. New purchases, fees and refunds are not included until the balance is refreshed or edited.</div>`;
}


function configuredRatesBill() {
  const configured = state.bills.find(bill => bill.id === state.rates?.linkedBillId);
  if (configured) return configured;
  const likely = state.bills.filter(bill => /\bRATES?\b/i.test(`${bill.name || ''} ${bill.category || ''}`));
  return likely.length === 1 ? likely[0] : null;
}

function ratesInvoices() {
  return [...(state.rates?.invoices || [])]
    .filter(invoice => invoice?.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function isRatesPayment(tx) {
  if (!tx || tx.type !== 'expense' || tx.ratesExcluded) return false;
  if (tx.ratesPayment) return true;
  const bill = configuredRatesBill();
  if (bill && (tx.matchedBillId === bill.id || String(tx.matchedOccurrenceKey || '').startsWith(`${bill.id}:`))) return true;
  if (/^RATES?$/i.test(String(tx.category || '').trim())) return true;
  const pattern = normalisedBankText(state.rates?.bankMatchPattern || '');
  const bankText = normalisedBankText(`${tx.bankDescription || ''} ${tx.description || ''} ${tx.merchant || ''}`);
  return Boolean(pattern && bankText.includes(pattern));
}

function ratesPayments() {
  return state.transactions
    .filter(isRatesPayment)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function ratesSummary() {
  const invoices = ratesInvoices();
  const payments = ratesPayments();
  const invoiced = invoices.reduce((sum, invoice) => sum + number(invoice.amount), 0);
  const paid = payments.reduce((sum, tx) => sum + number(tx.amount), 0);
  return {
    invoices,
    payments,
    invoiced,
    paid,
    owing: Math.max(0, invoiced - paid),
    credit: Math.max(0, paid - invoiced)
  };
}

function nextRatesInvoice() {
  const invoices = ratesInvoices();
  const futurePlaceholder = invoices
    .filter(invoice => invoice.date >= todayISO() && number(invoice.amount) <= 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  if (futurePlaceholder) return { date: futurePlaceholder.date, amount: 0, source: 'Scheduled placeholder' };
  if (state.rates?.nextInvoiceDate) {
    return { date: state.rates.nextInvoiceDate, amount: number(state.rates.estimatedQuarterlyAmount), source: 'Configured estimate' };
  }
  const latest = invoices[0];
  if (!latest?.date) return { date: '', amount: number(state.rates?.estimatedQuarterlyAmount), source: 'Not scheduled' };
  return {
    date: isoDate(addMonthsClamped(latest.date, 3, toDate(latest.date).getDate())),
    amount: number(state.rates?.estimatedQuarterlyAmount || latest.amount),
    source: 'Quarterly estimate'
  };
}

function nextRatesPayment() {
  const bill = configuredRatesBill();
  if (!bill) return { bill: null, date: '', amount: 0, paid: false };
  const from = todayISO();
  const to = isoDate(addDays(from, 120));
  const occurrences = occurrencesBetween(bill, from, to).map(date => ({
    date,
    amount: amountForOccurrence(bill, date),
    paid: isOccurrenceRecorded(bill.id, date)
  }));
  return { bill, ...(occurrences.find(item => !item.paid) || occurrences[0] || { date: nextDueDate(bill), amount: number(bill.amount), paid: false }) };
}

function renderRates() {
  const summary = ratesSummary();
  const bill = configuredRatesBill();
  const nextInvoice = nextRatesInvoice();
  const nextPayment = nextRatesPayment();
  const projectedOwing = Math.max(0, summary.owing - (nextPayment.paid ? 0 : number(nextPayment.amount)));
  const councilName = state.rates?.councilName || 'Council rates';

  return `<div class="notice"><strong>How this section works:</strong> quarterly invoices increase the amount owing. Fortnightly payments reduce it. Only the linked payment bill counts in the fortnightly cash-flow plan, so the quarterly invoice is not counted a second time as cash spending.</div>
    <div class="grid cards" style="margin-top:18px">
      ${metricCard('Current rates owing', money(summary.owing), summary.credit ? `${money(summary.credit)} paid ahead` : `${summary.invoices.filter(item => number(item.amount) > 0).length} confirmed invoice(s)`, summary.owing > 0 ? 'warn' : 'good')}
      ${metricCard('Total invoiced', money(summary.invoiced), `Quarterly invoices for ${escapeHtml(councilName)}`)}
      ${metricCard('Total paid', money(summary.paid), `${summary.payments.length} payment(s) found`, 'good')}
      ${metricCard('After next payment', money(projectedOwing), nextPayment.date ? `${money(nextPayment.amount)} due ${formatDate(nextPayment.date)}` : 'No linked payment bill', nextPayment.date ? 'good' : 'warn')}
    </div>

    <div class="grid two" style="margin-top:18px">
      <div class="card">
        <h2>Next quarterly invoice</h2>
        <div class="metric-value">${nextInvoice.date ? formatDate(nextInvoice.date) : 'Not scheduled'}</div>
        <div class="metric-note">${nextInvoice.amount > 0 ? `Estimated ${money(nextInvoice.amount)}` : 'Amount not entered yet'} · ${escapeHtml(nextInvoice.source)}</div>
        <div class="notice warning" style="margin-top:14px">The estimate is for planning only. Add or edit the invoice when the council statement arrives.</div>
      </div>
      <div class="card">
        <h2>Linked fortnightly payment</h2>
        ${bill ? `<div class="metric-value">${money(nextPayment.amount || bill.amount)}</div><div class="metric-note">${escapeHtml(bill.name)} · ${nextPayment.date ? `next due ${formatDate(nextPayment.date)}` : frequencyLabel(bill.frequency)}</div>` : '<div class="empty-state"><strong>No bill linked</strong>Select the existing Rates bill below so ASB payments can mark it paid automatically.</div>'}
      </div>
    </div>

    <div class="section-header"><div><h2>Quarterly invoices</h2><div class="muted small">Use amount 0 for a future invoice date when the amount is not known yet. Loading the supplied history is safe to repeat because existing invoice dates are skipped.</div></div><div class="button-row"><button class="secondary-button" data-action="rates-load-supplied-history">Load supplied history</button><button class="primary-button" data-action="rates-add-invoice">+ Add invoice</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Invoice date</th><th>Amount</th><th>Reference</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${summary.invoices.length ? summary.invoices.map(invoice => `<tr><td>${formatDate(invoice.date)}</td><td>${number(invoice.amount) > 0 ? money(invoice.amount) : '—'}</td><td>${escapeHtml(invoice.reference || invoice.notes || '')}</td><td><span class="status ${number(invoice.amount) > 0 ? 'paid' : 'upcoming'}">${number(invoice.amount) > 0 ? 'Confirmed' : 'Awaiting amount'}</span></td><td class="actions"><button class="secondary-button" data-action="rates-edit-invoice" data-id="${invoice.id}">Edit</button><button class="text-button negative" data-action="rates-delete-invoice" data-id="${invoice.id}">Delete</button></td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state"><strong>No rates invoices entered</strong>Add each quarterly invoice from the council statement.</div></td></tr>'}
    </tbody></table></div>

    <div class="section-header"><div><h2>Rates payments</h2><div class="muted small">ASB-synchronised transactions appear automatically when they match the linked bill, category or bank-description rule.</div></div><button class="secondary-button" data-action="rates-add-payment">+ Add manual payment</button></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Source</th><th>Bill match</th><th>Actions</th></tr></thead><tbody>
      ${summary.payments.length ? summary.payments.map(tx => `<tr><td>${formatDate(tx.date)}</td><td><strong>${escapeHtml(tx.description || tx.merchant || 'Rates payment')}</strong><div class="muted small">${escapeHtml(tx.bankDescription || '')}</div></td><td>${money(tx.amount)}</td><td>${escapeHtml(tx.source || 'manual')}</td><td>${tx.matchedOccurrenceKey ? '<span class="status paid">Matched</span>' : '<span class="status upcoming">Rates only</span>'}</td><td class="actions"><button class="secondary-button" data-action="edit-transaction" data-id="${tx.id}">Edit</button><button class="text-button negative" data-action="rates-exclude-payment" data-id="${tx.id}">Exclude</button></td></tr>`).join('') : '<tr><td colspan="6"><div class="empty-state"><strong>No rates payments found</strong>Link the Rates bill and add a bank-description phrase, then run ASB Sync.</div></td></tr>'}
    </tbody></table></div>

    <form id="ratesSettingsForm" class="card" style="margin-top:26px">
      <h2>Rates setup and automatic matching</h2>
      <div class="form-grid">
        <label>Council or rates name<input name="councilName" value="${escapeHtml(councilName)}" required></label>
        <label>Linked fortnightly bill<select name="linkedBillId"><option value="">Not linked</option>${state.bills.map(item => `<option value="${item.id}" ${item.id === bill?.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${money(item.amount)} · ${frequencyLabel(item.frequency)}</option>`).join('')}</select><span class="help">This existing bill remains the cash expense shown on Dashboard.</span></label>
        <label>ASB description contains<input name="bankMatchPattern" value="${escapeHtml(state.rates?.bankMatchPattern || '')}" placeholder="e.g. CHRISTCHURCH CITY COUNCIL"><span class="help">Enter a reliable phrase exactly as it appears in ASB. A managed statement rule is created automatically.</span></label>
        <label>Estimated quarterly invoice<input name="estimatedQuarterlyAmount" type="number" min="0" step="0.01" value="${number(state.rates?.estimatedQuarterlyAmount)}"><span class="help">Used only for the next-invoice estimate.</span></label>
        <label>Next invoice date override<input name="nextInvoiceDate" type="date" value="${state.rates?.nextInvoiceDate || ''}"><span class="help">Leave blank to calculate three months after the latest invoice.</span></label>
      </div>
      <div class="button-row end"><button class="primary-button">Save rates setup</button></div>
    </form>`;
}

function renderBankSync() {
  const bank = state.bankSync || {};
  const available = Array.isArray(bank.availableAccounts) ? bank.availableAccounts : [];
  const mappings = Array.isArray(bank.accountMappings) ? bank.accountMappings : [];
  const loanMappings = Array.isArray(bank.loanMappings) ? bank.loanMappings : [];
  const reviews = (bank.reviewItems || []).filter(item => item.status === 'open');
  const history = Array.isArray(bank.syncHistory) ? bank.syncHistory : [];
  const accountRows = available.map(account => {
    const mapping = mappings.find(item => item.akahuAccountId === account.id) || {};
    const canImport = (account.attributes || []).includes('TRANSACTIONS');
    return `<tr data-bank-account-row data-account-id="${escapeHtml(account.id)}">
      <td><strong>${escapeHtml(account.name)}</strong><div class="muted small">${escapeHtml(account.institution || 'ASB')} · ${escapeHtml(account.masked || 'Number hidden')}</div></td>
      <td>${escapeHtml(account.type || 'Unknown')}</td>
      <td>${account.balance ? money(account.balance.current) : 'Not supplied'}<div class="muted small">${escapeHtml(account.status || '')}</div></td>
      <td>${formatDateTime(account.refreshedTransactions)}</td>
      <td><select data-bank-local-account><option value="">Do not import</option>${accountOptions(mapping.localAccountId || '')}</select></td>
      <td><label class="checkbox-row"><input data-bank-use type="checkbox" ${mapping.importTransactions !== false && mapping.localAccountId ? 'checked' : ''} ${canImport ? '' : 'disabled'}> Import</label>${canImport ? '' : '<div class="muted small">Transactions unavailable</div>'}</td>
    </tr>`;
  }).join('');

  return `<div class="notice warning"><strong>Read-only connection.</strong> The app retrieves account and transaction data through Akahu. It cannot make payments and never receives your ASB password or PIN.</div>
    <div class="grid cards" style="margin-top:18px">
      ${metricCard('Last successful sync', bank.lastSuccessfulSync ? formatDateTime(bank.lastSuccessfulSync) : 'Never', 'Cloud transaction update')}
      ${metricCard('ASB data refreshed', bank.lastDataRefresh ? formatDateTime(bank.lastDataRefresh) : 'Unknown', 'Timestamp reported by Akahu')}
      ${metricCard('Mapped accounts', String(mappings.filter(item => item.importTransactions !== false && item.localAccountId).length), `${available.length} account(s) discovered`)}
      ${metricCard('Needs review', String(reviews.length), reviews.length ? 'Check uncertain matches' : 'No open bank reviews', reviews.length ? 'warn' : 'good')}
    </div>

    <div class="section-header"><div><h2>Connection and sync</h2><div class="muted small">Transfers do not count as spending. Exact bank payments replace manual bill records.</div></div><div class="button-row"><button class="secondary-button" data-action="bank-load-accounts">Load ASB accounts</button><button class="secondary-button" data-action="bank-clean-duplicates">Reconcile existing transactions</button><button class="primary-button" data-action="bank-sync-now">Sync ASB now</button></div></div>
    <form id="bankOptionsForm" class="card"><div class="form-grid"><label>Rolling transaction lookback (days)<input name="lookbackDays" type="number" min="7" max="365" step="1" value="${number(bank.lookbackDays || 45)}"><span class="help">The sync rechecks this window to catch bank changes and avoid duplicates. Forty-five days is recommended.</span></label></div><div class="button-row end"><button class="primary-button">Save sync options</button></div></form>

    <div class="section-header"><h2>ASB account mapping</h2></div>
    <form id="bankMappingsForm">
      <div class="table-wrap"><table><thead><tr><th>ASB account</th><th>Type</th><th>Balance</th><th>Transaction data refreshed</th><th>App account</th><th>Use</th></tr></thead><tbody>
        ${accountRows || `<tr><td colspan="6"><div class="empty-state"><strong>No ASB accounts loaded</strong>Select Load ASB accounts after the Edge Function and secrets are configured.</div></td></tr>`}
      </tbody></table></div>
      ${available.length ? '<div class="button-row end" style="margin-top:12px"><button class="primary-button">Save account mapping</button></div>' : ''}
    </form>

    <div class="section-header"><div><h2>Loan repayment grouping</h2><div class="muted small">Map each ASB loan reference to one scheduled bill. Principal and interest are combined into the final repayment amount.</div></div><button class="primary-button" data-action="add-loan-mapping">+ Add loan mapping</button></div>
    <div class="table-wrap"><table><thead><tr><th>ASB loan reference</th><th>Scheduled bill</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${loanMappings.length ? loanMappings.map(item => `<tr><td><strong>${escapeHtml(item.reference)}</strong><div class="muted small">Matches LOAN REPAYMENT ${escapeHtml(item.reference)}INTEREST and PRINCIPAL</div></td><td>${escapeHtml(state.bills.find(bill => bill.id === item.billId)?.name || 'Missing bill')}</td><td>${item.active !== false ? 'Active' : 'Paused'}</td><td class="actions"><button class="secondary-button" data-action="edit-loan-mapping" data-id="${item.id}">Edit</button><button class="text-button negative" data-action="delete-loan-mapping" data-id="${item.id}">Delete</button></td></tr>`).join('') : `<tr><td colspan="4"><div class="empty-state">Add 020 for the mortgage and 022 for the personal loan, mapped to the correct bill schedules.</div></td></tr>`}
    </tbody></table></div>

    <div class="section-header"><h2>Bank review queue</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Issue</th><th>Details</th><th>Date</th><th>Actions</th></tr></thead><tbody>
      ${reviews.length ? reviews.map(item => {
        const confirmable = item.occurrenceDate && (item.billId || item.scheduleId) && item.transactionSourceId;
        return `<tr><td><strong>${escapeHtml(item.title || item.kind)}</strong></td><td>${escapeHtml(item.detail || '')}</td><td>${item.occurrenceDate ? formatDate(item.occurrenceDate) : escapeHtml(item.date || '—')}</td><td class="actions">${confirmable ? `<button class="primary-button" data-action="bank-review-confirm" data-id="${item.id}">Confirm match</button>` : ''}<button class="secondary-button" data-action="bank-review-ignore" data-id="${item.id}">Dismiss</button></td></tr>`;
      }).join('') : `<tr><td colspan="4"><div class="empty-state">No bank items currently need review.</div></td></tr>`}
    </tbody></table></div>

    <div class="section-header"><h2>Recent sync history</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Time</th><th>Mode</th><th>Fetched</th><th>Added</th><th>Updated</th><th>Removed</th><th>Review</th></tr></thead><tbody>
      ${history.length ? history.map(item => `<tr><td>${formatDateTime(item.at)}</td><td>${escapeHtml(item.mode || '')}</td><td>${number(item.fetched)}</td><td>${number(item.added)}</td><td>${number(item.updated)}</td><td>${number(item.removed)}</td><td>${number(item.review)}</td></tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">No ASB sync has run yet.</div></td></tr>`}
    </tbody></table></div>`;
}

function renderBackup() {
  return `<div class="grid two">
    <div class="card"><h2>Cloud synchronisation</h2>
      ${cloudConfigured() ? `<p class="muted">${session && !localOnly ? `Signed in as <strong>${escapeHtml(session.user.email || 'Microsoft account')}</strong>. Changes sync automatically after they are saved locally.` : 'Cloud is configured, but this session is using local mode.'}</p>
      <div class="button-row"><button class="primary-button" data-action="sync-now">Sync now</button><button class="secondary-button" data-action="restore-cloud">Reload cloud copy</button><button class="secondary-button" data-action="overwrite-cloud">Replace cloud with this device</button></div>` : `<div class="notice warning">Supabase is not configured yet. Follow SETUP_GUIDE.md after uploading the project to GitHub.</div>`}
    </div>
    <div class="card"><h2>Manual export</h2><p class="muted">Encrypted exports are recommended. Keep the backup password separately; it cannot be recovered.</p><div class="button-row"><button class="primary-button" data-action="export-encrypted">Encrypted export</button><button class="secondary-button" data-action="export-plain">Plain JSON</button><button class="secondary-button" data-action="import-backup">Import backup</button></div></div>
  </div>
  <div class="grid two" style="margin-top:18px">
    <div class="card"><h2>Automatic OneDrive-folder backup</h2><p class="muted">On desktop Edge or Chrome, choose a folder inside your locally synced OneDrive. The app overwrites a latest encrypted backup after changes and keeps one encrypted file per day.</p>
      <div class="notice ${hasFolderHandle() ? 'success' : ''}">${hasFolderHandle() ? 'A backup folder is connected.' : 'No backup folder is connected.'} ${hasSessionBackupPassword() ? 'The backup password is active for this browser session.' : 'Enter the backup password again after restarting the browser.'}</div>
      <div class="button-row" style="margin-top:12px"><button class="secondary-button" data-action="choose-folder">Choose folder</button><button class="secondary-button" data-action="folder-password">Set session password</button><button class="primary-button" data-action="backup-now">Back up now</button><button class="text-button negative" data-action="disconnect-folder">Disconnect</button></div>
    </div>
    <div class="card"><h2>Recovery notes</h2><ul class="muted"><li>Local data saves immediately in this browser.</li><li>The last 30 meaningful local snapshots are retained.</li><li>Cloud sync is the main cross-device copy once configured.</li><li>OneDrive-folder files are independent recovery backups.</li></ul></div>
  </div>
  <div class="section-header"><h2>Recent local snapshots</h2></div><div id="snapshotArea" class="card"><p class="muted">Loading snapshots…</p></div>`;
}

function renderSettings() {
  return `<div class="card">
    <h2>Quick setup import</h2>
    <p class="muted">The fastest setup method is to complete one CSV template for accounts, income, recurring bills, spending limits, sinking funds, debts and statement-matching rules. Actual bank spending is imported separately under Transactions.</p>
    <div class="button-row"><button class="secondary-button" type="button" data-action="download-setup-template">Download setup template</button><button class="primary-button" type="button" data-action="import-setup">Import completed template</button></div>
  </div>
  <form id="settingsForm" class="card" style="margin-top:18px">
    <h2>Fortnight settings</h2><div class="form-grid">
      <label>Household name<input name="householdName" value="${escapeHtml(state.settings.householdName)}"></label>
      <label>Known fortnight start date<input name="fortnightAnchor" type="date" value="${state.settings.fortnightAnchor}" required><span class="help">Enter the first day of a known payday fortnight.</span></label>
      <label>Opening available balance<input name="openingBalance" type="number" min="0" step="0.01" value="${number(state.settings.openingBalance)}"><span class="help">Optional buffer or money already available at the start of each selected fortnight.</span></label>
      <label>Colour theme<select name="theme"><option value="dark" ${state.settings.theme !== 'light' ? 'selected' : ''}>Dark</option><option value="light" ${state.settings.theme === 'light' ? 'selected' : ''}>Light</option></select><span class="help">You can also use the sun/moon button in the top bar.</span></label>
    </div><div class="button-row end"><button class="primary-button">Save settings</button></div>
  </form>
  <div class="section-header"><h2>Account nicknames</h2><button class="primary-button" data-action="add-account">+ Add account</button></div>
  <div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.accounts.map(a => `<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.type)}</td><td>${a.active ? 'Active' : 'Paused'}</td><td class="actions"><button class="secondary-button" data-action="edit-account" data-id="${a.id}">Edit</button><button class="text-button negative" data-action="delete-account" data-id="${a.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>
  <div class="section-header"><h2>Statement matching rules</h2><button class="primary-button" data-action="add-rule">+ Add rule</button></div>
  <div class="notice">A rule checks whether the bank description contains a phrase, then recommends a merchant, category and transaction type. Linking a schedule allows an exact bank match to mark a bill paid or income received.</div>
  <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Description contains</th><th>Merchant</th><th>Category</th><th>Type</th><th>Linked schedule</th><th>Actions</th></tr></thead><tbody>${state.rules.length ? state.rules.map(r => `<tr><td>${escapeHtml(r.pattern)}</td><td>${escapeHtml(r.merchant || '')}</td><td>${escapeHtml(r.category || '')}</td><td>${escapeHtml(r.type || 'expense')}</td><td>${escapeHtml(linkedScheduleName(r))}</td><td class="actions"><button class="secondary-button" data-action="edit-rule" data-id="${r.id}">Edit</button><button class="text-button negative" data-action="delete-rule" data-id="${r.id}">Delete</button></td></tr>`).join('') : `<tr><td colspan="6"><div class="empty-state">Rules can also be created later as statement descriptions become familiar.</div></td></tr>`}</tbody></table></div>
  <div class="section-header"><h2>Danger zone</h2></div><div class="card"><div class="notice danger">Clearing data removes the local working copy. It does not automatically delete an existing cloud copy.</div><button class="danger-button" style="margin-top:12px" data-action="clear-all" type="button">Clear local app data</button></div>`;
}

function linkedScheduleName(rule = {}) {
  const scheduleId = rule.scheduleId || rule.linkedBillId || rule.linkedIncomeId || '';
  if (!scheduleId) return 'Not linked';

  const requestedKind = rule.scheduleKind || (rule.linkedBillId ? 'bill' : rule.linkedIncomeId ? 'income' : '');
  if (requestedKind === 'bill') {
    const bill = state.bills.find(item => item.id === scheduleId);
    return bill ? `Bill — ${bill.name}` : 'Missing bill';
  }
  if (requestedKind === 'income') {
    const income = state.incomes.find(item => item.id === scheduleId);
    return income ? `Income — ${income.name}` : 'Missing income';
  }

  const bill = state.bills.find(item => item.id === scheduleId);
  if (bill) return `Bill — ${bill.name}`;
  const income = state.incomes.find(item => item.id === scheduleId);
  if (income) return `Income — ${income.name}`;
  return 'Missing schedule';
}

function accountName(id) { return state.accounts.find(a => a.id === id)?.name || 'Not selected'; }
function accountOptions(selected = '') { return state.accounts.filter(a => a.active).map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join(''); }
function bankAccountOptions(selected = '') {
  return (state.bankSync?.availableAccounts || []).map(account => `<option value="${escapeHtml(account.id)}" ${account.id === selected ? 'selected' : ''}>${escapeHtml(account.name)} · ${escapeHtml(account.masked || 'number hidden')}</option>`).join('');
}
function billOptions(selected = '') {
  return state.bills.filter(bill => bill.active !== false).map(bill => `<option value="${bill.id}" ${bill.id === selected ? 'selected' : ''}>${escapeHtml(bill.name)} · ${money(bill.amount)}</option>`).join('');
}
function categoryList() {
  return [...new Set([
    ...state.bills.map(x => x.category), ...state.budgets.map(x => x.category), ...state.rules.map(x => x.category),
    'Rates', 'Uncategorised', 'Transfer', 'Debt payment', 'Savings transfer'
  ].filter(Boolean))].sort();
}
function categoryOptions(selected = '') { return categoryList().map(c => `<option ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`).join(''); }

function openModal(title, html, { wide = false } = {}) {
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
  $('.modal-card').classList.toggle('wide', wide); $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }

function commonScheduleFields(item = {}) {
  return `<label>Frequency<select name="frequency" required>${['weekly','fortnightly','monthly','quarterly','yearly','once'].map(v => `<option value="${v}" ${item.frequency === v ? 'selected' : ''}>${frequencyLabel(v)}</option>`).join('')}</select></label>
    <label>First or next date<input name="nextDate" type="date" value="${item.nextDate || todayISO()}" required><span class="help">This anchors the repeating schedule.</span></label>`;
}

function openBillForm(id = '') {
  const item = state.bills.find(x => x.id === id) || { amount: 0, frequency: 'monthly', active: true, automatic: true, variable: false };
  openModal(id ? 'Edit bill' : 'Add bill', `<form id="billForm"><div class="form-grid">
    <label>Bill name<input name="name" value="${escapeHtml(item.name || '')}" required></label>
    <label>Category<input name="category" list="categoryData" value="${escapeHtml(item.category || '')}" required><datalist id="categoryData">${categoryList().map(c=>`<option value="${escapeHtml(c)}">`).join('')}</datalist></label>
    <label>Standard amount<input name="amount" type="number" min="0" step="0.01" value="${number(item.amount)}" required></label>
    ${commonScheduleFields(item)}
    <label>Paid from<select name="accountId"><option value="">Select account</option>${accountOptions(item.accountId)}</select></label>
    <label class="checkbox-row"><input name="automatic" type="checkbox" ${item.automatic ? 'checked' : ''}> Paid automatically</label>
    <label class="checkbox-row"><input name="variable" type="checkbox" ${item.variable ? 'checked' : ''}> Amount can change</label>
    <label class="checkbox-row"><input name="active" type="checkbox" ${item.active !== false ? 'checked' : ''}> Active schedule</label>
    <label class="full">Notes<textarea name="notes">${escapeHtml(item.notes || '')}</textarea></label>
  </div><div class="button-row end"><button type="button" class="secondary-button" id="cancelForm">Cancel</button><button class="primary-button">Save bill</button></div></form>`);
  $('#cancelForm').onclick = closeModal;
  $('#billForm').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); const oldAmount = number(item.amount); const updated = { ...item, id: item.id || uid('bill'), name: f.get('name').trim(), category: f.get('category').trim(), amount: number(f.get('amount')), frequency: f.get('frequency'), nextDate: f.get('nextDate'), dayOfMonth: toDate(f.get('nextDate')).getDate(), accountId: f.get('accountId'), automatic: f.has('automatic'), variable: f.has('variable'), active: f.has('active'), notes: f.get('notes').trim(), overrides: item.overrides || {}, amountHistory: item.amountHistory || [] };
    if (id && oldAmount !== updated.amount) updated.amountHistory.push({ effectiveAt: new Date().toISOString(), previousAmount: oldAmount, amount: updated.amount });
    upsert('bills', updated, id ? 'Updated bill' : 'Added bill'); closeModal(); };
}

function openIncomeForm(id = '') {
  const item = state.incomes.find(x => x.id === id) || { amount: 0, frequency: 'fortnightly', active: true, variable: false };
  openModal(id ? 'Edit income' : 'Add income', `<form id="incomeForm"><div class="form-grid">
    <label>Income name<input name="name" value="${escapeHtml(item.name || '')}" required></label>
    <label>Expected amount<input name="amount" type="number" min="0" step="0.01" value="${number(item.amount)}" required></label>
    ${commonScheduleFields(item)}
    <label>Paid into<select name="accountId"><option value="">Select account</option>${accountOptions(item.accountId)}</select></label>
    <label class="checkbox-row"><input name="variable" type="checkbox" ${item.variable ? 'checked' : ''}> Amount can change</label>
    <label class="checkbox-row"><input name="active" type="checkbox" ${item.active !== false ? 'checked' : ''}> Active schedule</label>
    <label class="full">Notes<textarea name="notes">${escapeHtml(item.notes || '')}</textarea></label>
  </div><div class="button-row end"><button type="button" class="secondary-button" id="cancelForm">Cancel</button><button class="primary-button">Save income</button></div></form>`);
  $('#cancelForm').onclick = closeModal;
  $('#incomeForm').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); const updated = { ...item, id: item.id || uid('income'), name: f.get('name').trim(), amount: number(f.get('amount')), frequency: f.get('frequency'), nextDate: f.get('nextDate'), dayOfMonth: toDate(f.get('nextDate')).getDate(), accountId: f.get('accountId'), variable: f.has('variable'), active: f.has('active'), notes: f.get('notes').trim(), overrides: item.overrides || {} }; upsert('incomes', updated, id ? 'Updated income' : 'Added income'); closeModal(); };
}

function openTransactionForm(id = '') {
  const item = state.transactions.find(x => x.id === id) || { date: todayISO(), type: 'expense', amount: 0, source: 'manual' };
  openModal(id ? 'Edit transaction' : 'Add transaction', `<form id="transactionForm"><div class="form-grid">
    <label>Date<input name="date" type="date" value="${item.date}" required></label>
    <label>Type<select name="type"><option value="expense" ${item.type==='expense'?'selected':''}>Money out</option><option value="income" ${item.type==='income'?'selected':''}>Money in</option><option value="transfer" ${item.type==='transfer'?'selected':''}>Internal transfer</option></select></label>
    <label class="full">Description<input name="description" value="${escapeHtml(item.description || '')}" required></label>
    <label>Amount<input name="amount" type="number" min="0" step="0.01" value="${number(item.amount)}" required></label>
    <label>Category<select name="category"><option value="">Select category</option>${categoryOptions(item.category)}</select></label>
    <label>Account<select name="accountId"><option value="">Select account</option>${accountOptions(item.accountId)}</select></label>
    <label class="full">Notes<textarea name="notes">${escapeHtml(item.notes || '')}</textarea></label>
  </div><div class="button-row end"><button type="button" class="secondary-button" id="cancelForm">Cancel</button><button class="primary-button">Save transaction</button></div></form>`);
  $('#cancelForm').onclick = closeModal;
  $('#transactionForm').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); const updated = { ...item, id: item.id || uid('tx'), date: f.get('date'), type: f.get('type'), description: f.get('description').trim(), amount: number(f.get('amount')), category: f.get('type') === 'transfer' ? 'Transfer' : f.get('category'), accountId: f.get('accountId'), notes: f.get('notes').trim(), source: item.source || 'manual', bankUserEdited: Boolean(item.bankSourceId) || item.bankUserEdited }; updated.fingerprint = fingerprintTransaction(updated); upsert('transactions', updated, id ? 'Updated transaction' : 'Added transaction'); closeModal(); };
}

function openBudgetForm(id = '') {
  const item = state.budgets.find(x => x.id === id) || { amount: 0, active: true };
  openModal(id ? 'Edit spending limit' : 'Add spending limit', `<form id="simpleForm"><label>Category<input name="name" value="${escapeHtml(item.category || '')}" required></label><label>Limit per fortnight<input name="amount" type="number" min="0" step="0.01" value="${number(item.amount)}" required></label><label class="checkbox-row"><input name="active" type="checkbox" ${item.active!==false?'checked':''}> Active</label><div class="button-row end"><button class="primary-button">Save</button></div></form>`);
  $('#simpleForm').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); upsert('budgets', { ...item, id:item.id||uid('budget'), category:f.get('name').trim(), amount:number(f.get('amount')), active:f.has('active') }, id?'Updated spending limit':'Added spending limit'); closeModal(); };
}
function openFundForm(id = '') {
  const item = state.sinkingFunds.find(x => x.id === id) || { target:0,balance:0,contribution:0,active:true };
  openModal(id ? 'Edit sinking fund' : 'Add sinking fund', `<form id="simpleForm"><div class="form-grid"><label class="full">Fund name<input name="name" value="${escapeHtml(item.name||'')}" required></label><label>Target<input name="target" type="number" min="0" step="0.01" value="${number(item.target)}"></label><label>Current balance<input name="balance" type="number" min="0" step="0.01" value="${number(item.balance)}"></label><label>Contribution per fortnight<input name="contribution" type="number" min="0" step="0.01" value="${number(item.contribution)}"></label><label class="checkbox-row"><input name="active" type="checkbox" ${item.active!==false?'checked':''}> Active</label></div><div class="button-row end"><button class="primary-button">Save</button></div></form>`);
  $('#simpleForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);upsert('sinkingFunds',{...item,id:item.id||uid('fund'),name:f.get('name').trim(),target:number(f.get('target')),balance:number(f.get('balance')),contribution:number(f.get('contribution')),active:f.has('active')},id?'Updated sinking fund':'Added sinking fund');closeModal();};
}
function openDebtForm(id = '', preferredType = '') {
  const item = state.debts.find(x => x.id === id) || {
    debtType: preferredType || 'other',
    balance: 0,
    creditLimit: 0,
    interestRate: 0,
    minimumPayment: 0,
    extraPayment: 0,
    linkedBillId: '',
    bankAccountId: '',
    active: true
  };
  openModal(id ? 'Edit debt or credit account' : (preferredType === 'credit-card' ? 'Add credit card' : 'Add debt'), `<form id="simpleForm"><div class="form-grid">
    <label>Debt name<input name="name" value="${escapeHtml(item.name || '')}" required></label>
    <label>Type<select name="debtType">
      ${['mortgage','personal-loan','credit-card','afterpay','other'].map(value => `<option value="${value}" ${item.debtType === value ? 'selected' : ''}>${escapeHtml(debtTypeLabel(value))}</option>`).join('')}
    </select></label>
    <label>Current balance<input name="balance" type="number" min="0" step="0.01" value="${number(item.balance)}"><span class="help">Manual fallback when a live ASB balance is unavailable.</span></label>
    <label>Credit limit<input name="creditLimit" type="number" min="0" step="0.01" value="${number(item.creditLimit)}"><span class="help">Used only for credit cards.</span></label>
    <label>Interest rate (%)<input name="interestRate" type="number" min="0" step="0.01" value="${number(item.interestRate)}"></label>
    <label>Linked scheduled bill<select name="linkedBillId"><option value="">Not linked</option>${billOptions(item.linkedBillId || '')}</select><span class="help">This provides the payment amount, due date and paid status.</span></label>
    <label>Linked ASB/Akahu account<select name="bankAccountId"><option value="">Use manual balance</option>${bankAccountOptions(item.bankAccountId || '')}</select><span class="help">Load ASB accounts first. A supplied bank balance overrides the manual balance display.</span></label>
    <label>Separate extra payment<input name="extraPayment" type="number" min="0" step="0.01" value="${number(item.extraPayment)}"><span class="help">Optional extra not already included in the linked bill.</span></label>
    <label class="checkbox-row"><input name="active" type="checkbox" ${item.active !== false ? 'checked' : ''}> Active</label>
  </div><div class="button-row end"><button class="primary-button">Save</button></div></form>`);
  $('#simpleForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    upsert('debts', {
      ...item,
      id: item.id || uid('debt'),
      name: f.get('name').trim(),
      debtType: f.get('debtType'),
      balance: number(f.get('balance')),
      creditLimit: number(f.get('creditLimit')),
      interestRate: number(f.get('interestRate')),
      minimumPayment: 0,
      extraPayment: number(f.get('extraPayment')),
      linkedBillId: f.get('linkedBillId'),
      bankAccountId: f.get('bankAccountId'),
      active: f.has('active')
    }, id ? 'Updated debt or credit account' : 'Added debt or credit account');
    closeModal();
  };
}


async function loadSuppliedRatesHistory() {
  if (!confirm('Add the quarterly invoice dates and amounts from the supplied rates spreadsheet? Existing invoice dates will not be replaced.')) return;
  const supplied = [
    { date: '2025-09-15', amount: 609.49, reference: 'Quarterly rates invoice' },
    { date: '2025-12-15', amount: 609.49, reference: 'Quarterly rates invoice' },
    { date: '2026-03-15', amount: 670.45, reference: 'Quarterly rates invoice' },
    { date: '2026-06-15', amount: 670.70, reference: 'Quarterly rates invoice' },
    { date: '2026-09-15', amount: 0, reference: 'Future invoice — amount pending' },
    { date: '2026-12-15', amount: 0, reference: 'Future invoice — amount pending' }
  ];
  const existingDates = new Set((state.rates.invoices || []).map(invoice => invoice.date));
  let added = 0;
  for (const item of supplied) {
    if (existingDates.has(item.date)) continue;
    state.rates.invoices.push({ id: uid('ratesinv'), ...item, notes: '', updatedAt: new Date().toISOString() });
    added++;
  }
  state.rates.estimatedQuarterlyAmount = number(state.rates.estimatedQuarterlyAmount) || 670.70;
  await commit(`Loaded ${added} supplied rates invoice record(s)`, true);
  toast(added ? `${added} invoice record(s) added.` : 'All supplied invoice dates already exist.', added ? 'success' : 'info');
  render();
}

function openRatesInvoiceForm(id = '') {
  const item = (state.rates?.invoices || []).find(invoice => invoice.id === id) || { date: todayISO(), amount: 0, reference: '', notes: '' };
  openModal(id ? 'Edit rates invoice' : 'Add rates invoice', `<form id="ratesInvoiceForm"><div class="form-grid">
    <label>Invoice date<input name="date" type="date" value="${item.date || todayISO()}" required></label>
    <label>Invoice amount<input name="amount" type="number" min="0" step="0.01" value="${number(item.amount)}"><span class="help">Use 0 for a future date when the amount is not yet known.</span></label>
    <label class="full">Invoice reference<input name="reference" value="${escapeHtml(item.reference || '')}" placeholder="Optional council invoice reference"></label>
    <label class="full">Notes<textarea name="notes">${escapeHtml(item.notes || '')}</textarea></label>
  </div><div class="button-row end"><button type="button" class="secondary-button" id="cancelForm">Cancel</button><button class="primary-button">Save invoice</button></div></form>`);
  $('#cancelForm').onclick = closeModal;
  $('#ratesInvoiceForm').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const invoice = {
      ...item,
      id: item.id || uid('ratesinv'),
      date: form.get('date'),
      amount: number(form.get('amount')),
      reference: String(form.get('reference') || '').trim(),
      notes: String(form.get('notes') || '').trim(),
      updatedAt: new Date().toISOString()
    };
    const index = state.rates.invoices.findIndex(entry => entry.id === invoice.id);
    if (index >= 0) state.rates.invoices[index] = invoice; else state.rates.invoices.push(invoice);
    if (invoice.amount > 0) state.rates.estimatedQuarterlyAmount = invoice.amount;
    await commit(id ? 'Updated rates invoice' : 'Added rates invoice', true);
    closeModal();
    render();
  };
}

async function deleteRatesInvoice(id) {
  if (!confirm('Delete this rates invoice?')) return;
  state.rates.invoices = (state.rates.invoices || []).filter(invoice => invoice.id !== id);
  await commit('Deleted rates invoice', true);
  render();
}

function nearestRatesBillOccurrence(date, amount) {
  const bill = configuredRatesBill();
  if (!bill) return null;
  const candidates = occurrencesBetween(bill, isoDate(addDays(date, -5)), isoDate(addDays(date, 5)))
    .map(occurrenceDate => ({
      occurrenceDate,
      distance: Math.abs(daysBetween(date, occurrenceDate)),
      amount: amountForOccurrence(bill, occurrenceDate),
      occupied: isOccurrenceRecorded(bill.id, occurrenceDate)
    }))
    .filter(item => !item.occupied && Math.abs(item.amount - number(amount)) <= 0.02)
    .sort((a, b) => a.distance - b.distance);
  return candidates[0] || null;
}

function openRatesPaymentForm() {
  const bill = configuredRatesBill();
  const defaults = nextRatesPayment();
  openModal('Add manual rates payment', `<form id="ratesPaymentForm"><div class="form-grid">
    <label>Payment date<input name="date" type="date" value="${defaults.date || todayISO()}" required></label>
    <label>Amount<input name="amount" type="number" min="0.01" step="0.01" value="${number(defaults.amount || bill?.amount)}" required></label>
    <label>Paid from<select name="accountId"><option value="">Select account</option>${accountOptions(bill?.accountId || '')}</select></label>
    <label>Description<input name="description" value="${escapeHtml(state.rates?.councilName || bill?.name || 'Rates')}" required></label>
    <label class="full">Notes<textarea name="notes"></textarea></label>
  </div><div class="notice">Use this only when the payment is not already present through ASB Sync, to avoid duplicates.</div><div class="button-row end"><button type="button" class="secondary-button" id="cancelForm">Cancel</button><button class="primary-button">Add payment</button></div></form>`);
  $('#cancelForm').onclick = closeModal;
  $('#ratesPaymentForm').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = form.get('date');
    const amount = number(form.get('amount'));
    const candidate = nearestRatesBillOccurrence(date, amount);
    const tx = {
      id: uid('tx'),
      date,
      type: 'expense',
      description: String(form.get('description') || 'Rates').trim(),
      amount,
      category: 'Rates',
      accountId: form.get('accountId'),
      source: 'Rates manual',
      ratesPayment: true,
      notes: String(form.get('notes') || '').trim(),
      matchedBillId: candidate && bill ? bill.id : '',
      matchedOccurrenceKey: candidate && bill ? occurrenceKey(bill.id, candidate.occurrenceDate) : ''
    };
    tx.fingerprint = fingerprintTransaction(tx);
    const duplicate = state.transactions.some(existing => (existing.fingerprint || fingerprintTransaction(existing)) === tx.fingerprint);
    if (duplicate) return toast('That payment already appears to exist.', 'error');
    state.transactions.push(tx);
    await commit('Added manual rates payment', true);
    closeModal();
    render();
  };
}

async function excludeRatesPayment(id) {
  const tx = state.transactions.find(item => item.id === id);
  if (!tx) return;
  if (!confirm('Exclude this transaction from the Rates totals? The transaction itself will remain in the app.')) return;
  tx.ratesExcluded = true;
  tx.ratesPayment = false;
  await commit('Excluded transaction from rates tracking', true);
  render();
}

async function saveRatesSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const linkedBillId = String(form.get('linkedBillId') || '');
  const pattern = String(form.get('bankMatchPattern') || '').trim();
  state.rates.councilName = String(form.get('councilName') || '').trim() || 'Council rates';
  state.rates.linkedBillId = linkedBillId;
  state.rates.bankMatchPattern = pattern;
  state.rates.estimatedQuarterlyAmount = number(form.get('estimatedQuarterlyAmount'));
  state.rates.nextInvoiceDate = String(form.get('nextInvoiceDate') || '');

  let managedRule = state.rules.find(rule => rule.id === state.rates.managedRuleId || rule.managedBy === 'rates');
  if (pattern) {
    const updatedRule = {
      ...(managedRule || {}),
      id: managedRule?.id || uid('rule'),
      managedBy: 'rates',
      pattern,
      merchant: state.rates.councilName,
      category: 'Rates',
      type: 'expense',
      scheduleKind: linkedBillId ? 'bill' : '',
      scheduleId: linkedBillId
    };
    const index = state.rules.findIndex(rule => rule.id === updatedRule.id);
    if (index >= 0) state.rules[index] = updatedRule; else state.rules.push(updatedRule);
    state.rates.managedRuleId = updatedRule.id;
  } else if (managedRule) {
    state.rules = state.rules.filter(rule => rule.id !== managedRule.id);
    state.rates.managedRuleId = '';
  }

  await commit('Updated rates setup', true);
  toast('Rates setup saved.', 'success');
  render();
}

function openAccountForm(id='') {
  const item=state.accounts.find(x=>x.id===id)||{type:'everyday',active:true};
  openModal(id?'Edit account':'Add account',`<form id="simpleForm"><label>Account nickname<input name="name" value="${escapeHtml(item.name||'')}" required></label><label>Type<select name="type">${['everyday','bills','savings','credit','cash','other'].map(v=>`<option ${item.type===v?'selected':''}>${v}</option>`).join('')}</select></label><label class="checkbox-row"><input name="active" type="checkbox" ${item.active!==false?'checked':''}> Active</label><div class="button-row end"><button class="primary-button">Save</button></div></form>`);
  $('#simpleForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);upsert('accounts',{...item,id:item.id||uid('acct'),name:f.get('name').trim(),type:f.get('type'),active:f.has('active')},id?'Updated account':'Added account');closeModal();};
}
function openRuleForm(id='') {
  const item=state.rules.find(x=>x.id===id)||{type:'expense'};
  openModal(id?'Edit matching rule':'Add matching rule',`<form id="simpleForm"><label>Bank description contains<input name="pattern" value="${escapeHtml(item.pattern||'')}" required></label><label>Clean merchant name<input name="merchant" value="${escapeHtml(item.merchant||'')}"></label><label>Category<input name="category" list="ruleCategories" value="${escapeHtml(item.category||'')}"><datalist id="ruleCategories">${categoryList().map(c=>`<option value="${escapeHtml(c)}">`).join('')}</datalist></label><label>Type<select name="type"><option value="expense" ${item.type==='expense'?'selected':''}>Money out</option><option value="income" ${item.type==='income'?'selected':''}>Money in</option><option value="transfer" ${item.type==='transfer'?'selected':''}>Transfer</option></select></label><label>Linked schedule<select name="schedule"><option value="">No automatic paid/received match</option>${state.bills.map(b=>`<option value="bill:${b.id}" ${item.scheduleKind==='bill'&&item.scheduleId===b.id?'selected':''}>Bill — ${escapeHtml(b.name)}</option>`).join('')}${state.incomes.map(i=>`<option value="income:${i.id}" ${item.scheduleKind==='income'&&item.scheduleId===i.id?'selected':''}>Income — ${escapeHtml(i.name)}</option>`).join('')}</select><span class="help">Link only when this bank description reliably identifies one schedule.</span></label><div class="button-row end"><button class="primary-button">Save</button></div></form>`);
  $('#simpleForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);const schedule=String(f.get('schedule')||'');const [scheduleKind,scheduleId]=schedule.includes(':')?schedule.split(':'):['',''];upsert('rules',{...item,id:item.id||uid('rule'),pattern:f.get('pattern').trim(),merchant:f.get('merchant').trim(),category:f.get('category').trim(),type:f.get('type'),scheduleKind,scheduleId},id?'Updated matching rule':'Added matching rule');closeModal();};
}


function normalisedBankText(value = '') {
  return String(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isInternalTransferDescription(value = '') {
  const text = normalisedBankText(value);
  return [
    /^MB TRANSFER\b/,
    /^FN TRANSFER\b/,
    /\bTRANSFER TO\b/,
    /\bTRANSFER FROM\b/,
    /\bTRANSFER EX\b/,
    /\bINTERNAL TRANSFER\b/,
    /\bACCOUNT TRANSFER\b/
  ].some(pattern => pattern.test(text));
}

function transactionPriority(tx) {
  if (tx.bankProvider === 'Akahu' || tx.source === 'ASB sync') return 4;
  if (tx.source === 'bill' || tx.source === 'income schedule') return 3;
  if (tx.source === 'CSV import') return 2;
  return 1;
}

function occurrenceCandidatesForBankTransaction(tx) {
  const date = tx.date;
  const candidates = [];
  for (const bill of state.bills.filter(item => item.active !== false)) {
    for (const occurrenceDate of occurrencesBetween(bill, isoDate(addDays(date, -5)), isoDate(addDays(date, 5)))) {
      const expected = amountForOccurrence(bill, occurrenceDate);
      if (Math.abs(expected - number(tx.amount)) > 0.02) continue;
      const bankText = normalisedBankText(`${tx.bankDescription || ''} ${tx.description || ''}`);
      const billWords = normalisedBankText(bill.name).split(' ').filter(word => word.length >= 3);
      const nameMatch = billWords.some(word => bankText.includes(word));
      candidates.push({ bill, occurrenceDate, nameMatch, distance: Math.abs(daysBetween(date, occurrenceDate)) });
    }
  }
  const named = candidates.filter(item => item.nameMatch);
  const pool = named.length ? named : candidates;
  pool.sort((a, b) => a.distance - b.distance);
  if (pool.length === 1) return pool[0];
  if (pool.length > 1 && pool[0].distance < pool[1].distance) return pool[0];
  return null;
}

async function reconcileBankTransactions() {
  if (!confirm('Reclassify internal transfers and remove exact duplicate bill records? A local safety snapshot will be created first.')) return;
  await storage.addSnapshot(structuredClone(state), 'Before transaction reconciliation').catch(() => null);

  let transfersChanged = 0;
  let matched = 0;
  let removed = 0;

  for (const tx of state.transactions) {
    if (isInternalTransferDescription(`${tx.bankDescription || ''} ${tx.description || ''}`) && tx.type !== 'transfer') {
      tx.type = 'transfer';
      tx.category = 'Transfer';
      tx.matchedBillId = '';
      tx.matchedOccurrenceKey = '';
      transfersChanged++;
    }
  }

  for (const tx of state.transactions.filter(item =>
    (item.bankProvider === 'Akahu' || item.source === 'ASB sync') &&
    item.type === 'expense' &&
    !item.matchedOccurrenceKey
  )) {
    const candidate = occurrenceCandidatesForBankTransaction(tx);
    if (!candidate) continue;
    tx.matchedBillId = candidate.bill.id;
    tx.matchedOccurrenceKey = occurrenceKey(candidate.bill.id, candidate.occurrenceDate);
    tx.category = candidate.bill.category || tx.category;
    tx.description = candidate.bill.name;
    matched++;
  }

  const groups = new Map();
  for (const tx of state.transactions) {
    if (!tx.matchedOccurrenceKey) continue;
    if (!groups.has(tx.matchedOccurrenceKey)) groups.set(tx.matchedOccurrenceKey, []);
    groups.get(tx.matchedOccurrenceKey).push(tx);
  }

  const removeIds = new Set();
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => transactionPriority(b) - transactionPriority(a));
    for (const duplicate of items.slice(1)) removeIds.add(duplicate.id);
  }
  if (removeIds.size) {
    state.transactions = state.transactions.filter(tx => !removeIds.has(tx.id));
    removed = removeIds.size;
  }

  await commit(`Reconciled bank transactions: ${transfersChanged} transfers, ${matched} bill matches, ${removed} duplicates removed`, true);
  render();
  toast(`Reconciliation complete: ${transfersChanged} transfer(s), ${matched} bill match(es), ${removed} duplicate(s) removed.`, 'success');
}

async function loadBankAccounts() {
  if (!session || localOnly) return toast('Sign in with Microsoft before loading ASB accounts.', 'error');
  updateSyncBadge('pending', 'Loading ASB accounts…');
  try {
    const result = await invokeBankSync({ action: 'accounts' });
    state.bankSync.availableAccounts = Array.isArray(result.accounts) ? result.accounts : [];
    state.bankSync.lastAccountsRefresh = new Date().toISOString();
    await commit('Loaded ASB account list', true);
    updateSyncBadge('synced', 'Cloud synced');
    render();
    toast(`${state.bankSync.availableAccounts.length} ASB account(s) loaded.`, 'success');
  } catch (error) {
    updateSyncBadge('error', 'ASB connection error');
    toast(error.message, 'error');
  }
}

async function saveBankMappings(event) {
  event.preventDefault();
  const rows = $$('[data-bank-account-row]', event.currentTarget);
  state.bankSync.accountMappings = rows.map(row => {
    const account = state.bankSync.availableAccounts.find(item => item.id === row.dataset.accountId) || {};
    const localAccountId = $('[data-bank-local-account]', row).value;
    const importTransactions = $('[data-bank-use]', row).checked && Boolean(localAccountId);
    return {
      akahuAccountId: row.dataset.accountId,
      localAccountId,
      importTransactions,
      label: account.name || '',
      masked: account.masked || ''
    };
  });
  await commit('Updated ASB account mapping', true);
  toast('ASB account mapping saved.', 'success');
  render();
}

async function saveBankOptions(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.bankSync.lookbackDays = Math.min(365, Math.max(7, Math.round(number(form.get('lookbackDays')) || 45)));
  await commit('Updated ASB sync options', true);
  toast('ASB sync options saved.', 'success');
  render();
}

async function runBankSync() {
  if (!session || localOnly) return toast('Sign in with Microsoft before syncing ASB.', 'error');
  if (!(state.bankSync.accountMappings || []).some(item => item.importTransactions !== false && item.localAccountId)) {
    return toast('Map at least one ASB account to an app account first.', 'error');
  }
  updateSyncBadge('pending', 'Syncing ASB…');
  try {
    // Save mapping changes before the server-side function reads finance_state.
    await storage.setState(state);
    await saveRemote(state);
    const result = await invokeBankSync({ action: 'sync', requestRefresh: true });
    const remote = await loadRemote();
    if (!remote?.state) throw new Error('ASB sync completed, but the cloud copy could not be reloaded.');
    state = migrate(remote.state);
    await storage.setState(state);
    updateSyncBadge('synced', 'Cloud synced');
    render();
    const summary = result.summary || {};
    toast(`ASB sync complete: ${number(summary.added)} added, ${number(summary.updated)} updated, ${number(summary.transfers)} transfer(s), ${number(summary.duplicatesRemoved)} duplicate(s) removed, ${number(summary.review)} to review.`, 'success');
  } catch (error) {
    updateSyncBadge('error', 'ASB sync error');
    toast(error.message, 'error');
  }
}

function openLoanMappingForm(id = '') {
  const item = (state.bankSync.loanMappings || []).find(entry => entry.id === id) || { reference: '', billId: '', active: true };
  openModal(id ? 'Edit loan mapping' : 'Add loan mapping', `<form id="loanMappingForm">
    <label>ASB loan reference<input name="reference" value="${escapeHtml(item.reference || '')}" placeholder="020" maxlength="20" required><span class="help">Enter only the identifier between LOAN REPAYMENT and INTEREST/PRINCIPAL.</span></label>
    <label>Scheduled bill<select name="billId" required><option value="">Select bill</option>${state.bills.map(bill => `<option value="${bill.id}" ${bill.id === item.billId ? 'selected' : ''}>${escapeHtml(bill.name)} — ${money(bill.amount)}</option>`).join('')}</select></label>
    <label class="checkbox-row"><input name="active" type="checkbox" ${item.active !== false ? 'checked' : ''}> Active</label>
    <div class="button-row end"><button type="button" id="cancelForm" class="secondary-button">Cancel</button><button class="primary-button">Save mapping</button></div>
  </form>`);
  $('#cancelForm').onclick = closeModal;
  $('#loanMappingForm').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reference = String(form.get('reference') || '').toUpperCase().replace(/\s+/g, '').trim();
    if (!reference) return toast('Enter the ASB loan reference.', 'error');
    const duplicate = (state.bankSync.loanMappings || []).find(entry => entry.id !== item.id && String(entry.reference).toUpperCase() === reference);
    if (duplicate) return toast('That loan reference is already mapped.', 'error');
    const updated = { ...item, id: item.id || uid('loanmap'), reference, billId: form.get('billId'), active: form.has('active') };
    const index = state.bankSync.loanMappings.findIndex(entry => entry.id === updated.id);
    if (index >= 0) state.bankSync.loanMappings[index] = updated; else state.bankSync.loanMappings.push(updated);
    await commit(id ? 'Updated ASB loan mapping' : 'Added ASB loan mapping', true);
    closeModal();
    render();
  };
}

async function deleteLoanMapping(id) {
  if (!confirm('Delete this ASB loan mapping?')) return;
  state.bankSync.loanMappings = (state.bankSync.loanMappings || []).filter(item => item.id !== id);
  await commit('Deleted ASB loan mapping', true);
  render();
}

function bankTransactionForReview(item) {
  return state.transactions.find(tx => tx.bankSourceId === item.transactionSourceId || tx.id === item.transactionId);
}

async function confirmBankReview(id) {
  const item = (state.bankSync.reviewItems || []).find(entry => entry.id === id);
  if (!item) return;
  const tx = bankTransactionForReview(item);
  if (!tx) return toast('The related bank transaction was not found.', 'error');
  const scheduleKind = item.scheduleKind || (item.billId ? 'bill' : '');
  const scheduleId = item.scheduleId || item.billId;
  if (!scheduleId || !item.occurrenceDate) return toast('This item cannot be confirmed automatically. Correct the mapping and sync again.', 'error');
  tx.matchedOccurrenceKey = occurrenceKey(scheduleId, item.occurrenceDate);
  if (scheduleKind === 'bill') {
    tx.matchedBillId = scheduleId;
    const bill = state.bills.find(entry => entry.id === scheduleId);
    if (bill?.category) tx.category = bill.category;
  } else if (scheduleKind === 'income') {
    tx.category = 'Income';
    tx.type = 'income';
  }
  item.status = 'confirmed';
  item.resolvedAt = new Date().toISOString();
  await commit('Confirmed ASB schedule match', true);
  render();
}

async function ignoreBankReview(id) {
  const item = (state.bankSync.reviewItems || []).find(entry => entry.id === id);
  if (!item) return;
  item.status = 'ignored';
  item.resolvedAt = new Date().toISOString();
  await commit('Dismissed ASB review item', true);
  render();
}

function upsert(collection, item, reason) {
  const index = state[collection].findIndex(x => x.id === item.id);
  if (index >= 0) state[collection][index] = item; else state[collection].push(item);
  commit(reason, true); render();
}
async function deleteEntity(collection, id, label) {
  if (!confirm(`Delete this ${label}?`)) return;
  state[collection] = state[collection].filter(x => x.id !== id);
  await commit(`Deleted ${label}`, true); render();
}

async function markBillPaid(id, date) {
  const bill = state.bills.find(x => x.id === id); if (!bill) return;
  const tx = { id:uid('tx'), date, type:'expense', description:bill.name, amount:amountForOccurrence(bill,date), category:bill.category, accountId:bill.accountId, source:'bill', matchedBillId:bill.id, matchedOccurrenceKey:occurrenceKey(bill.id,date), notes:bill.notes||'' };
  tx.fingerprint=fingerprintTransaction(tx); state.transactions.push(tx); await commit(`Marked ${bill.name} paid`,true); render();
}
async function markIncomeReceived(id,date) {
  const income=state.incomes.find(x=>x.id===id);if(!income)return;
  const tx={id:uid('tx'),date,type:'income',description:income.name,amount:amountForOccurrence(income,date),category:'Income',accountId:income.accountId,source:'income schedule',matchedOccurrenceKey:occurrenceKey(income.id,date),notes:income.notes||''};tx.fingerprint=fingerprintTransaction(tx);state.transactions.push(tx);await commit(`Recorded ${income.name}`,true);render();
}
async function setBillOverride(id,date) {
  const bill=state.bills.find(x=>x.id===id);if(!bill)return;
  const value=prompt(`Amount for ${bill.name} on ${formatDate(date)}:`,String(amountForOccurrence(bill,date)));
  if(value===null)return;const amount=number(value);if(amount<0)return toast('Amount cannot be negative.','error');
  bill.overrides={...(bill.overrides||{}),[date]:amount};await commit(`Changed one ${bill.name} occurrence`,true);render();
}

async function saveSettings(event) {
  event.preventDefault(); const f=new FormData(event.target); const oldAnchor=state.settings.fortnightAnchor;
  state.settings.householdName=f.get('householdName').trim()||'Household';state.settings.fortnightAnchor=f.get('fortnightAnchor');state.settings.openingBalance=number(f.get('openingBalance'));state.settings.theme=f.get('theme')==='light'?'light':'dark';applyTheme(state.settings.theme);
  if(oldAnchor!==state.settings.fortnightAnchor) state.settings.selectedPeriodStart=fortnightContaining(state.settings.fortnightAnchor).start;
  await commit('Updated settings',true);toast('Settings saved.','success');render();
}

async function commit(reason='Updated data', snapshot=true) {
  state.updatedAt=new Date().toISOString();
  state.audit.unshift({id:uid('audit'),at:state.updatedAt,reason});state.audit=state.audit.slice(0,200);
  $('#saveStatus').textContent='Saving…';
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    await storage.setState(state);
    if(snapshot) await storage.addSnapshot(structuredClone(state),reason).catch(()=>null);
    $('#saveStatus').textContent='Saved locally';
    scheduleSync();scheduleFolderBackup();
  },150);
}

function scheduleSync() {
  if(localOnly||!session||!cloudConfigured())return;
  updateSyncBadge('pending','Sync pending');clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>syncNow(false),cfg.autoSyncDelayMs||1800);
}
async function syncNow(showToast=true) {
  if(localOnly||!session||!cloudConfigured()){if(showToast)toast('Cloud sync is not active.','error');return;}
  updateSyncBadge('pending','Syncing…');
  try { await saveRemote(state); updateSyncBadge('synced','Cloud synced'); if(showToast)toast('Cloud sync complete.','success'); }
  catch(error){ updateSyncBadge('error','Sync conflict'); if(error.code==='SYNC_CONFLICT') showSyncConflict(error.remote); else toast(error.message,'error'); }
}
function showSyncConflict(remote) {
  openModal('Cloud sync conflict',`<div class="notice danger">Another device changed the cloud copy before this device finished syncing.</div><p><strong>Cloud updated:</strong> ${escapeHtml(remote?.updatedAt||'Unknown')}</p><p>Choose carefully. Reloading cloud discards this device's unsynchronised version. Replacing cloud overwrites the other device's version.</p><div class="button-row end"><button class="secondary-button" id="conflictReload">Reload cloud</button><button class="danger-button" id="conflictOverwrite">Replace cloud</button></div>`);
  $('#conflictReload').onclick=async()=>{await restoreFromCloud();closeModal();};$('#conflictOverwrite').onclick=async()=>{await overwriteCloud();closeModal();};
}
async function restoreFromCloud() { if(!confirm('Replace this device data with the current cloud copy?'))return;const remote=await loadRemote();if(!remote?.state)return toast('No cloud copy was found.','error');state=migrate(remote.state);applyTheme(state.settings.theme);await storage.setState(state);render();toast('Cloud copy restored.','success'); }
async function overwriteCloud() { if(!confirm('Replace the cloud copy with this device data?'))return;await overwriteRemote(state);updateSyncBadge('synced','Cloud synced');toast('Cloud copy replaced.','success'); }
function updateSyncBadge(kind,text){const badge=$('#syncBadge');badge.className=`sync-badge ${kind}`;badge.textContent=text;}

function scheduleFolderBackup() {
  if(!hasFolderHandle()||!hasSessionBackupPassword())return;clearTimeout(folderBackupTimer);
  folderBackupTimer=setTimeout(()=>automaticFolderBackup(state).catch(error=>toast(`Automatic backup: ${error.message}`,'error')),cfg.autoFolderBackupDelayMs||5000);
}
async function configureBackupFolder(){try{const name=await chooseBackupFolder();toast(`Backup folder connected: ${name}`,'success');render();}catch(error){toast(error.message,'error');}}
function configureBackupPassword(){const password=prompt('Enter the password used to encrypt automatic backups. It is kept only for this browser session.');if(!password)return;const confirmPassword=prompt('Enter the same backup password again.');if(password!==confirmPassword)return toast('The passwords did not match.','error');setSessionBackupPassword(password);toast('Automatic backup password activated for this session.','success');render();}
async function runFolderBackup(){try{if(!hasFolderHandle())await configureBackupFolder();if(!hasSessionBackupPassword())configureBackupPassword();if(!hasFolderHandle()||!hasSessionBackupPassword())return;const result=await automaticFolderBackup(state);if(!result.skipped)toast(`Encrypted backup saved to ${result.folder}.`,'success');}catch(error){toast(error.message,'error');}}
async function disconnectBackupFolder(){await disconnectFolder();toast('Backup folder disconnected.');render();}
async function promptEncryptedExport(){const password=prompt('Create a backup password. You will need this exact password to restore the file.');if(!password)return;const again=prompt('Enter the backup password again.');if(password!==again)return toast('The passwords did not match.','error');await exportBackup(state,password);}

async function handleBackupImport(event) {
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try{const text=await file.text();let password='';let parsed=JSON.parse(text);if(parsed.format==='fortnight-finance-encrypted')password=prompt('Enter the backup password:')||'';const backup=await readBackupPackage(text,password);openModal('Restore backup',`<div class="notice warning">Restoring replaces the current working data on this device. A local safety snapshot will be created first.</div><p><strong>Backup created:</strong> ${escapeHtml(backup.createdAt||'Unknown')}</p><p><strong>Bills:</strong> ${backup.data.bills?.length||0}<br><strong>Transactions:</strong> ${backup.data.transactions?.length||0}<br><strong>Income schedules:</strong> ${backup.data.incomes?.length||0}</p><div class="button-row end"><button class="danger-button" id="confirmRestore">Restore backup</button></div>`);$('#confirmRestore').onclick=async()=>{await storage.addSnapshot(structuredClone(state),'Before backup restore');state=migrate(backup.data);applyTheme(state.settings.theme);await storage.setState(state);closeModal();render();scheduleSync();toast('Backup restored.','success');};}catch(error){toast(error.message,'error');}
}

async function loadSnapshotsIntoView() {
  if(currentView!=='backup'||!$('#snapshotArea'))return;const snapshots=await storage.listSnapshots();
  $('#snapshotArea').innerHTML=snapshots.length?`<div class="table-wrap"><table><thead><tr><th>Created</th><th>Reason</th><th></th></tr></thead><tbody>${snapshots.slice(0,15).map(s=>`<tr><td>${new Date(s.createdAt).toLocaleString('en-NZ')}</td><td>${escapeHtml(s.reason)}</td><td><button class="secondary-button" data-action="restore-snapshot" data-id="${s.id}">Restore</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">No snapshots yet.</div>';
}
async function restoreSnapshot(id){if(!confirm('Restore this local snapshot?'))return;const snap=await storage.getSnapshot(id);if(!snap)return;await storage.addSnapshot(structuredClone(state),'Before snapshot restore');state=migrate(snap.state);applyTheme(state.settings.theme);await storage.setState(state);render();scheduleSync();toast('Snapshot restored.','success');}

async function clearAllData(){if(!confirm('Clear the local app data on this device? This cannot be undone without a backup or cloud copy.'))return;state=defaultState();await storage.clearAll();await storage.setState(state);render();toast('Local app data cleared.');}

function normaliseSetupHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}
function setupBoolean(value, fallback = true) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['yes', 'y', 'true', '1', 'active', 'on'].includes(text);
}
function setupType(value) {
  const text = normaliseSetupHeader(value);
  const aliases = {
    accounts: 'account', account: 'account',
    incomes: 'income', income: 'income',
    bills: 'bill', bill: 'bill', recurring_expense: 'bill',
    budget: 'budget', spending_limit: 'budget', spending_limits: 'budget',
    sinking_fund: 'sinking_fund', sinkingfund: 'sinking_fund', fund: 'sinking_fund',
    debt: 'debt', debts: 'debt', loan: 'debt',
    rule: 'rule', matching_rule: 'rule'
  };
  return aliases[text] || '';
}
function setupFrequency(value) {
  const text = normaliseSetupHeader(value);
  const aliases = { week: 'weekly', weekly: 'weekly', fortnight: 'fortnightly', fortnightly: 'fortnightly', biweekly: 'fortnightly', month: 'monthly', monthly: 'monthly', quarter: 'quarterly', quarterly: 'quarterly', annual: 'yearly', annually: 'yearly', year: 'yearly', yearly: 'yearly', one_time: 'once', oneoff: 'once', once: 'once' };
  return aliases[text] || '';
}
function setupAccountType(value) {
  const text = normaliseSetupHeader(value);
  return ['everyday', 'bills', 'savings', 'credit', 'cash', 'other'].includes(text) ? text : 'other';
}
function findAccountByName(name) {
  const target = String(name || '').trim().toLowerCase();
  return state.accounts.find(a => a.name.trim().toLowerCase() === target);
}
function upsertImported(collection, keyFn, incoming) {
  const key = keyFn(incoming);
  const index = state[collection].findIndex(item => keyFn(item) === key);
  if (index >= 0) {
    const existing = state[collection][index];
    state[collection][index] = { ...existing, ...incoming, id: existing.id };
    return 'updated';
  }
  state[collection].push(incoming);
  return 'added';
}
function buildSetupImportPlan(rows) {
  const headers = rows[0].map(normaliseSetupHeader);
  const required = ['record_type'];
  if (required.some(name => !headers.includes(name))) throw new Error('The setup CSV must contain a record_type column. Download the current template and copy your information into it.');
  const records = [];
  const errors = [];
  rows.slice(1).forEach((row, index) => {
    const data = {};
    headers.forEach((header, col) => { data[header] = String(row[col] ?? '').trim(); });
    const rowNumber = index + 2;
    const recordType = setupType(data.record_type);
    if (!recordType) { errors.push(`Row ${rowNumber}: unknown record_type “${data.record_type || 'blank'}”.`); return; }
    const name = data.name || '';
    if (['account', 'income', 'bill', 'sinking_fund', 'debt'].includes(recordType) && !name) { errors.push(`Row ${rowNumber}: ${recordType} requires a name.`); return; }
    if (recordType === 'budget' && !(data.category || name)) { errors.push(`Row ${rowNumber}: budget requires a category.`); return; }
    if (recordType === 'rule' && !data.pattern) { errors.push(`Row ${rowNumber}: rule requires a pattern.`); return; }
    if (['income', 'bill'].includes(recordType)) {
      const frequency = setupFrequency(data.frequency);
      const nextDate = parseDateFlexible(data.next_date || data.nextdate);
      if (!frequency) { errors.push(`Row ${rowNumber}: ${name} has an invalid frequency.`); return; }
      if (!nextDate) { errors.push(`Row ${rowNumber}: ${name} requires a valid next_date.`); return; }
    }
    records.push({ rowNumber, recordType, data });
  });
  return { records, errors };
}
function setupImportSummary(plan) {
  const counts = {};
  plan.records.forEach(r => counts[r.recordType] = (counts[r.recordType] || 0) + 1);
  const labels = { account: 'accounts', income: 'income schedules', bill: 'bills', budget: 'spending limits', sinking_fund: 'sinking funds', debt: 'debts', rule: 'matching rules' };
  return Object.entries(counts).map(([type, count]) => `<div class="list-item"><span>${escapeHtml(labels[type] || type)}</span><strong>${count}</strong></div>`).join('');
}
async function handleSetupFile(event) {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  try {
    const rows = csvParse(await file.text());
    if (rows.length < 2) throw new Error('The setup CSV does not contain any data rows.');
    const plan = buildSetupImportPlan(rows);
    const errorList = plan.errors.length ? `<div class="notice danger"><strong>${plan.errors.length} row(s) cannot be imported.</strong><ul>${plan.errors.slice(0, 12).map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>${plan.errors.length > 12 ? `<p>Only the first 12 errors are shown.</p>` : ''}</div>` : '<div class="notice success">All rows passed the basic validation checks.</div>';
    openModal('Review quick setup import', `<div class="notice">Existing records with the same name or category will be updated instead of duplicated. A safety snapshot is created before import.</div><div class="grid two" style="margin-top:14px"><div class="card"><h3>Ready to import</h3><div class="list">${setupImportSummary(plan) || '<div class="empty-state">No valid rows.</div>'}</div></div><div>${errorList}</div></div><div class="button-row end" style="margin-top:16px"><button class="secondary-button" id="cancelSetupImport">Cancel</button><button class="primary-button" id="confirmSetupImport" ${plan.records.length ? '' : 'disabled'}>Import ${plan.records.length} record(s)</button></div>`, { wide: true });
    $('#cancelSetupImport').onclick = closeModal;
    $('#confirmSetupImport').onclick = () => applySetupImport(plan);
  } catch (error) { toast(error.message, 'error'); }
}
async function applySetupImport(plan) {
  await storage.addSnapshot(structuredClone(state), 'Before quick setup import').catch(() => null);
  const results = { added: 0, updated: 0, skipped: plan.errors.length };
  const keyName = item => String(item.name || '').trim().toLowerCase();
  const keyCategory = item => String(item.category || '').trim().toLowerCase();
  const keyPattern = item => String(item.pattern || '').trim().toLowerCase();

  for (const record of plan.records.filter(r => r.recordType === 'account')) {
    const d = record.data;
    const outcome = upsertImported('accounts', keyName, { id: uid('acct'), name: d.name, type: setupAccountType(d.type), active: setupBoolean(d.active, true) });
    results[outcome]++;
  }

  for (const record of plan.records.filter(r => r.recordType !== 'account')) {
    const d = record.data;
    const accountId = findAccountByName(d.account)?.id || '';
    let outcome = 'skipped';
    if (record.recordType === 'income') {
      const nextDate = parseDateFlexible(d.next_date || d.nextdate);
      outcome = upsertImported('incomes', keyName, { id: uid('income'), name: d.name, amount: parseMoney(d.amount), frequency: setupFrequency(d.frequency), nextDate, dayOfMonth: toDate(nextDate).getDate(), accountId, variable: setupBoolean(d.variable, false), active: setupBoolean(d.active, true), notes: d.notes || '', overrides: {} });
    } else if (record.recordType === 'bill') {
      const nextDate = parseDateFlexible(d.next_date || d.nextdate);
      const incoming = { id: uid('bill'), name: d.name, category: d.category || 'Uncategorised', amount: parseMoney(d.amount), frequency: setupFrequency(d.frequency), nextDate, dayOfMonth: toDate(nextDate).getDate(), accountId, automatic: setupBoolean(d.automatic, false), variable: setupBoolean(d.variable, false), active: setupBoolean(d.active, true), notes: d.notes || '', overrides: {}, amountHistory: [] };
      const existing = state.bills.find(x => keyName(x) === keyName(incoming));
      if (existing && number(existing.amount) !== number(incoming.amount)) incoming.amountHistory = [...(existing.amountHistory || []), { effectiveAt: new Date().toISOString(), previousAmount: number(existing.amount), amount: number(incoming.amount), source: 'quick setup import' }];
      outcome = upsertImported('bills', keyName, incoming);
    } else if (record.recordType === 'budget') {
      outcome = upsertImported('budgets', keyCategory, { id: uid('budget'), category: d.category || d.name, amount: parseMoney(d.amount), active: setupBoolean(d.active, true) });
    } else if (record.recordType === 'sinking_fund') {
      outcome = upsertImported('sinkingFunds', keyName, { id: uid('fund'), name: d.name, target: parseMoney(d.target), balance: parseMoney(d.balance), contribution: parseMoney(d.contribution), active: setupBoolean(d.active, true) });
    } else if (record.recordType === 'debt') {
      outcome = upsertImported('debts', keyName, { id: uid('debt'), name: d.name, balance: parseMoney(d.balance), interestRate: parseMoney(d.interest_rate), minimumPayment: parseMoney(d.minimum_payment), extraPayment: parseMoney(d.extra_payment), active: setupBoolean(d.active, true) });
    } else if (record.recordType === 'rule') {
      const txType = ['income', 'expense', 'transfer'].includes(String(d.type).toLowerCase()) ? String(d.type).toLowerCase() : 'expense';
      outcome = upsertImported('rules', keyPattern, { id: uid('rule'), pattern: d.pattern, merchant: d.merchant || '', category: d.category || '', type: txType });
    }
    results[outcome]++;
  }

  await commit(`Quick setup import: ${results.added} added, ${results.updated} updated`, true);
  closeModal(); render();
  toast(`Setup imported: ${results.added} added, ${results.updated} updated${results.skipped ? `, ${results.skipped} skipped` : ''}.`, results.skipped ? 'info' : 'success');
}

function findStatementHeaderIndex(rows) {
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    const headers = rows[i].map(value => String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase());
    const hasDate = headers.some(header => header.includes('date'));
    const hasDescription = headers.some(header => ['description', 'details', 'particular', 'merchant', 'narrative', 'payee'].some(term => header.includes(term)));
    const hasAmount = headers.some(header => ['amount', 'debit', 'withdrawal', 'money out', 'credit', 'deposit', 'money in'].some(term => header.includes(term)));
    if (hasDate && hasDescription && hasAmount) return i;
  }
  return 0;
}
async function handleStatementFile(event) {
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try{
    const parsed=csvParse(await file.text());
    const headerIndex=findStatementHeaderIndex(parsed);
    const rows=parsed.slice(headerIndex);
    if(rows.length<2)throw new Error('The CSV file does not contain transaction rows.');
    openMappingStep(rows);
  }catch(error){toast(error.message,'error');}
}
function inferHeader(headers,patterns){const lower=headers.map(h=>h.toLowerCase());return lower.findIndex(h=>patterns.some(p=>h.includes(p)));}
function openMappingStep(rows) {
  const headers=rows[0].map(x=>String(x||'').replace(/^\uFEFF/,'').trim());const options=(selected)=>headers.map((h,i)=>`<option value="${i}" ${i===selected?'selected':''}>${escapeHtml(h||`Column ${i+1}`)}</option>`).join('');
  const dateIdx=inferHeader(headers,['date']);const descIdx=inferHeader(headers,['description','details','particular','merchant','narrative']);const amountIdx=inferHeader(headers,['amount']);const debitIdx=inferHeader(headers,['debit','withdrawal','money out']);const creditIdx=inferHeader(headers,['credit','deposit','money in']);
  openModal('Map bank statement columns',`<form id="mappingForm"><div class="import-grid"><label>Date<select name="date"><option value="">Not mapped</option>${options(dateIdx)}</select></label><label>Description<select name="description"><option value="">Not mapped</option>${options(descIdx)}</select></label><label>Single amount<select name="amount"><option value="">Not used</option>${options(amountIdx)}</select></label><label>Money out / debit<select name="debit"><option value="">Not used</option>${options(debitIdx)}</select></label><label>Money in / credit<select name="credit"><option value="">Not used</option>${options(creditIdx)}</select></label></div><div class="form-grid" style="margin-top:14px"><label>Account<select name="accountId"><option value="">Select account</option>${accountOptions('')}</select></label><label>Single amount convention<select name="amountDirection"><option value="negative-out">Negative = money out</option><option value="positive-out">Positive = money out</option></select></label></div><div class="notice" style="margin-top:12px">Use either a single Amount column, or separate Money out and Money in columns.</div><div class="button-row end"><button class="primary-button">Preview import</button></div></form>` ,{wide:true});
  const form=$('#mappingForm');for(const name of ['date','description','amount','debit','credit']){const sel=form.elements[name];if(Number.isInteger({date:dateIdx,description:descIdx,amount:amountIdx,debit:debitIdx,credit:creditIdx}[name])&&{date:dateIdx,description:descIdx,amount:amountIdx,debit:debitIdx,credit:creditIdx}[name]>=0)sel.value=String({date:dateIdx,description:descIdx,amount:amountIdx,debit:debitIdx,credit:creditIdx}[name]);}
  form.onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);buildImportPreview(rows,{date:f.get('date'),description:f.get('description'),amount:f.get('amount'),debit:f.get('debit'),credit:f.get('credit'),accountId:f.get('accountId'),amountDirection:f.get('amountDirection')});};
}
function buildImportPreview(rows,map) {
  if(map.date===''||map.description==='')return toast('Map the date and description columns.','error');
  if(map.amount===''&&map.debit===''&&map.credit==='')return toast('Map an amount column or debit/credit columns.','error');
  const existing=new Set(state.transactions.map(t=>t.fingerprint||fingerprintTransaction(t)));
  importRows=rows.slice(1).map((row,index)=>{
    const date=parseDateFlexible(row[Number(map.date)]);const description=String(row[Number(map.description)]||'').trim();let type='expense',amount=0;
    if(map.debit!==''||map.credit!==''){const debit=map.debit===''?0:Math.abs(parseMoney(row[Number(map.debit)]));const credit=map.credit===''?0:Math.abs(parseMoney(row[Number(map.credit)]));if(credit>0){type='income';amount=credit;}else{type='expense';amount=debit;}}
    else {const raw=parseMoney(row[Number(map.amount)]);if(map.amountDirection==='negative-out'){type=raw<0?'expense':'income';amount=Math.abs(raw);}else{type=raw>0?'expense':'income';amount=Math.abs(raw);}}
    const match=categoriseDescription(description,type);const tx={id:uid('tx'),date,description,merchant:match.merchant,category:match.category,type:match.type||type,amount,accountId:map.accountId,source:'CSV import',matchedBillId:match.matchedBillId||'',importRow:index+2};tx.fingerprint=fingerprintTransaction(tx);return{...tx,duplicate:existing.has(tx.fingerprint),valid:Boolean(date&&description&&amount>0),include:!existing.has(tx.fingerprint)&&Boolean(date&&description&&amount>0)};
  }).filter(x=>x.description||x.amount);
  renderImportPreview();
}
function categoriseDescription(description,type) {
  const upper=description.toUpperCase();const rule=state.rules.find(r=>upper.includes(String(r.pattern).toUpperCase()));if(rule)return{merchant:rule.merchant||description,category:rule.category||'Uncategorised',type:rule.type||type};
  const bill=state.bills.find(b=>upper.includes(b.name.toUpperCase()));if(bill)return{merchant:bill.name,category:bill.category,type:'expense',matchedBillId:bill.id};
  const income=state.incomes.find(i=>upper.includes(i.name.toUpperCase()));if(income)return{merchant:income.name,category:'Income',type:'income'};
  return{merchant:description,category:type==='income'?'Income':'Uncategorised',type};
}
function renderImportPreview() {
  const dup=importRows.filter(x=>x.duplicate).length;const invalid=importRows.filter(x=>!x.valid).length;const ready=importRows.filter(x=>x.include).length;
  openModal('Review statement import',`<div class="grid three"><div class="notice success"><strong>${ready}</strong><br>ready to import</div><div class="notice warning"><strong>${dup}</strong><br>probable duplicates</div><div class="notice danger"><strong>${invalid}</strong><br>invalid rows</div></div><div class="import-preview"><table><thead><tr><th>Use</th><th>Date</th><th>Description</th><th>Type</th><th>Category</th><th>Amount</th><th>Check</th></tr></thead><tbody>${importRows.map((r,i)=>`<tr><td><input type="checkbox" data-import-include="${i}" ${r.include?'checked':''} ${!r.valid||r.duplicate?'disabled':''}></td><td>${escapeHtml(r.date||'Invalid')}</td><td>${escapeHtml(r.description)}</td><td><select data-import-type="${i}"><option value="expense" ${r.type==='expense'?'selected':''}>Money out</option><option value="income" ${r.type==='income'?'selected':''}>Money in</option><option value="transfer" ${r.type==='transfer'?'selected':''}>Transfer</option></select></td><td><select data-import-category="${i}">${categoryOptions(r.category)}</select></td><td>${money(r.amount)}</td><td>${r.duplicate?'<span class="status overdue">Duplicate</span>':!r.valid?'<span class="status overdue">Invalid</span>':'<span class="status upcoming">Review</span>'}</td></tr>`).join('')}</tbody></table></div><div class="button-row end" style="margin-top:14px"><button class="secondary-button" id="backToMapping">Back</button><button class="primary-button" id="confirmImport">Import selected</button></div>`,{wide:true});
  $$('[data-import-include]').forEach(el=>el.onchange=()=>importRows[Number(el.dataset.importInclude)].include=el.checked);$$('[data-import-type]').forEach(el=>el.onchange=()=>importRows[Number(el.dataset.importType)].type=el.value);$$('[data-import-category]').forEach(el=>el.onchange=()=>importRows[Number(el.dataset.importCategory)].category=el.value);
  $('#confirmImport').onclick=confirmImport;$('#backToMapping').onclick=closeModal;
}
async function confirmImport(){const selected=importRows.filter(x=>x.include&&!x.duplicate&&x.valid).map(({duplicate,valid,include,...tx})=>{tx.fingerprint=fingerprintTransaction(tx);return tx;});if(!selected.length)return toast('No transactions are selected.','error');state.transactions.push(...selected);await commit(`Imported ${selected.length} bank transactions`,true);closeModal();render();toast(`${selected.length} transactions imported.`,'success');}

function toast(message,type='') { const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;$('#toastContainer').appendChild(el);setTimeout(()=>el.remove(),4500); }

init().catch(error=>{console.error(error);toast(error.message,'error');});

import { ext } from '../shared/api';
import { localizePage, t, tn } from '../shared/i18n';
import { sitePattern } from '../shared/sites';
import {
  type ActionResult,
  type CaptureFilters,
  type PopupRequest,
  type PopupState,
  type TabInfo,
} from '../shared/types';

// Must be called inside the click handler before any await, or the browser rejects it.
async function requestSiteAccess(tabId: number, url: string): Promise<boolean> {
  const pattern = sitePattern(url);

  if (!pattern) {
    return true;
  }

  send({ type: 'pendingCapture', tabId, pattern }).catch(() => {});

  let granted = false;

  try {
    granted = await ext.permissions.request({ origins: [pattern] });
  } catch {
    granted = false;
  }

  if (!granted) {
    send({ type: 'clearPending' }).catch(() => {});
  }

  return granted;
}

function send<T = ActionResult>(message: PopupRequest): Promise<T> {
  return ext.runtime.sendMessage(message) as Promise<T>;
}

async function getState(): Promise<PopupState> {
  const state = await send<PopupState | ActionResult>({ type: 'getState' });

  if (!state || state.ok === false) {
    throw new Error((state as ActionResult | undefined)?.error || t('errNoState'));
  }

  return state as PopupState;
}

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

async function openApp(tabId?: number): Promise<void> {
  try {
    const res = await send({ type: 'focusApp', tabId });

    if (res?.ok) {
      window.close();
      return;
    }
  } catch {}

  const query = tabId != null ? `?tab=${encodeURIComponent(tabId)}` : '';
  const url = `schemo://open${query}`;

  // Opened via the tab so the browser's app prompt is centered, not attached to the popup.
  const activeTabId = lastState?.activeTabId;

  if (activeTabId != null) {
    try {
      await ext.tabs.update(activeTabId, { url });
      window.close();
      return;
    } catch {}
  }

  window.location.href = url;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function agoLabel(at: number): string {
  if (!at) {
    return '';
  }

  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));

  if (sec < 60) {
    return t('lastSeconds', [sec]);
  }

  const min = Math.round(sec / 60);

  if (min < 60) {
    return t('lastMinutes', [min]);
  }

  return t('lastHours', [Math.round(min / 60)]);
}

function buildIcon(favIconUrl: string, label: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'icon-slot';

  const initial = (label || '?').trim().charAt(0) || '?';

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = initial;
  avatar.hidden = Boolean(favIconUrl);

  if (favIconUrl) {
    const img = document.createElement('img');

    img.className = 'favicon';
    img.src = favIconUrl;
    img.alt = '';

    img.addEventListener('error', () => {
      img.classList.add('hidden');
      avatar.hidden = false;
    });

    wrap.appendChild(img);
  }

  wrap.appendChild(avatar);

  return wrap;
}

function buildMoreRow(tab: TabInfo): HTMLElement {
  const row = document.createElement('div');
  row.className = 'more-row';

  const host = hostnameOf(tab.url);

  row.appendChild(buildIcon(tab.favIconUrl, tab.title || host));

  const text = document.createElement('div');
  text.className = 'more-text';

  const title = document.createElement('div');
  title.className = 'more-title';
  title.textContent = tab.title || host || t('tabFallback');

  const hostEl = document.createElement('div');
  hostEl.className = 'more-host mono';
  hostEl.textContent = host;

  text.append(title, hostEl);
  row.appendChild(text);

  const count = document.createElement('span');
  count.className = 'more-count';
  count.textContent = String(tab.count || 0);
  row.appendChild(count);

  const stop = document.createElement('button');

  stop.className = 'more-stop';
  stop.title = t('stopTabCapture');
  stop.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  stop.addEventListener('click', async (event) => {
    event.stopPropagation();

    stop.disabled = true;

    try {
      await runAction({ type: 'stopCaptureTab', tabId: tab.tabId });
    } finally {
      stop.disabled = false;
    }
  });

  row.appendChild(stop);

  row.addEventListener('click', () => {
    openApp(tab.tabId);
  });

  return row;
}

function renderHeader(state: PopupState): void {
  const dot = $('status-dot');
  const text = $('status-text');

  if (state.appRunning) {
    dot.className = 'dot dot-status-ok';
    text.textContent = t('statusConnected');
    return;
  }

  dot.className = 'dot dot-status-warn';
  text.textContent = t(state.link === 'no-host' ? 'statusNotInstalled' : 'statusNotRunning');
}

function renderCurrentTab(state: PopupState): void {
  const card = $('current-card');
  const tab = state.currentTab;
  const capturing = Boolean(tab?.capturing);

  card.className = 'card current ' + (capturing ? 'on' : 'off') + (state.appRunning ? '' : ' muted');

  if (!tab) {
    $('current-title').textContent = t('noActiveTab');
    $('current-host').textContent = '';
    $<HTMLInputElement>('enabled').checked = false;
    $('current-count').textContent = '';
    $('current-ago').textContent = '';
    $('current-arrow').hidden = true;
    $('current-foot').classList.remove('actionable', 'text');

    return;
  }

  const host = hostnameOf(tab.url);
  const label = tab.title || host || t('tabFallback');

  const top = card.querySelector('.current-top')!;

  top.querySelectorAll('.icon-slot').forEach((node) => node.remove());
  top.prepend(buildIcon(tab.favIconUrl, label));

  $('current-title').textContent = label;
  $('current-host').textContent = host;
  $<HTMLInputElement>('enabled').checked = capturing;

  const count = tab.count || 0;
  const foot = $('current-foot');
  const countEl = $('current-count');
  const agoEl = $('current-ago');
  const arrow = $('current-arrow');

  foot.hidden = !state.appRunning;

  if (foot.hidden) {
    foot.classList.remove('actionable', 'text');
    foot.onclick = null;
    return;
  }

  if (!capturing) {
    countEl.textContent = '';
    agoEl.textContent = t('tabNotCaptured');
    arrow.hidden = true;

    foot.classList.remove('actionable');
    foot.classList.add('text');
    foot.onclick = null;

    return;
  }

  foot.classList.remove('text');

  if (count === 0) {
    countEl.textContent = '';
    agoEl.textContent = t('waitingFirst');
    arrow.hidden = true;

    foot.classList.remove('actionable');
    foot.onclick = null;

    return;
  }

  countEl.textContent = tn('requests', count);
  agoEl.textContent = agoLabel(tab.lastAt);
  arrow.hidden = false;

  foot.classList.add('actionable');
  foot.onclick = () => {
    openApp(tab.tabId);
  };
}

function renderWarning(state: PopupState): void {
  const warn = $('warn-card');

  warn.hidden = state.appRunning;

  if (!state.appRunning) {
    const missing = state.link === 'no-host';

    $('warn-text').textContent = t(missing ? 'warnNoHost' : 'warnAppDown');
    $('warn-launch').hidden = missing;
  }
}

function renderActionError(): void {
  const line = $('error-line');

  line.hidden = !actionError;

  if (actionError) {
    $('error-text').textContent = actionError;
  }
}

function renderOtherTabs(state: PopupState): void {
  const section = $('more-section');
  const list = $('more-list');

  list.textContent = '';

  const others = (state.capturedTabs || []).filter((tab) => tab.tabId !== state.activeTabId);

  section.hidden = others.length === 0;

  if (section.hidden) {
    return;
  }

  for (const tab of others) {
    list.appendChild(buildMoreRow(tab));
  }
}

function renderOpenButton(state: PopupState): void {
  const secondary = state.appRunning && !state.capturing;

  $('open-app').className = 'open-app' + (secondary ? ' secondary' : '');
}

const SETTING_INPUTS = ['set-rememberTabs'];

function renderSettings(state: PopupState): void {
  const active = document.activeElement;

  if (active?.closest?.('.view-settings')) {
    return;
  }

  for (const id of SETTING_INPUTS) {
    const key = id.replace('set-', '') as keyof PopupState['settings'];

    $<HTMLInputElement>(id).checked = Boolean(state.settings?.[key]);
  }

  renderFilters(state.filters);
}

function renderFilters(filters: CaptureFilters | undefined): void {
  const box = $('filters');

  if (!box || !filters) {
    return;
  }

  const rows: [string, string][] = [
    [t('filterHosts'), filters.hosts?.length ? filters.hosts.join(', ') : t('filterHostsAll')],
    [t('filterStatic'), filters.static ? t('filterSkipped') : t('filterKept')],
    [t('filterAnalytics'), filters.analytics ? t('filterSkipped') : t('filterKept')],
    [t('filterJson'), filters.json ? t('yes') : t('no')],
  ];

  box.textContent = '';

  for (const [name, value] of rows) {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const key = document.createElement('span');
    key.className = 'filter-name';
    key.textContent = name;

    const val = document.createElement('span');
    val.className = 'filter-value mono';
    val.textContent = value;

    row.append(key, val);
    box.append(row);
  }
}

let lastState: PopupState | null = null;

function render(state: PopupState): void {
  lastState = state;

  renderHeader(state);
  renderCurrentTab(state);
  renderWarning(state);
  renderActionError();
  renderOtherTabs(state);
  renderOpenButton(state);
  renderSettings(state);
}

async function refresh(): Promise<void> {
  try {
    render(await getState());
  } catch {}
}

let actionError = '';

async function runAction(message: PopupRequest): Promise<void> {
  try {
    const res = await send(message);

    actionError = res?.ok ? '' : res?.error || t('errActionFailed');
  } catch {
    actionError = t('errNoAnswer');
  }

  await refresh();
}

let actionInProgress = false;

$<HTMLInputElement>('enabled').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;

  if (actionInProgress) {
    return;
  }

  actionInProgress = true;
  input.disabled = true;

  try {
    const tab = lastState?.currentTab;

    if (input.checked && tab && !(await requestSiteAccess(tab.tabId, tab.url))) {
      input.checked = false;
      actionError = t('errNoHostAccess');
      renderActionError();
      return;
    }

    await runAction(input.checked ? { type: 'startCapture' } : { type: 'stopCapture' });
  } finally {
    actionInProgress = false;
    input.disabled = false;
  }
});

$('open-app').addEventListener('click', () => openApp());
$('warn-launch').addEventListener('click', () => openApp());

$('open-settings').addEventListener('click', () => {
  document.body.classList.add('settings');
});

$('close-settings').addEventListener('click', () => {
  document.body.classList.remove('settings');
});

for (const id of SETTING_INPUTS) {
  $<HTMLInputElement>(id).addEventListener('change', async (event) => {
    try {
      await send({
        type: 'setSetting',
        key: id.replace('set-', ''),
        value: (event.target as HTMLInputElement).checked,
      });
    } catch {}

    await refresh();
  });
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(refresh, 2500);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
  }

  pollTimer = null;
}

localizePage();

$('settings-version').textContent = t('version', [ext.runtime.getManifest().version]);

refresh().finally(startPolling);

window.addEventListener('unload', stopPolling);

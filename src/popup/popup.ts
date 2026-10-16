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

function fillIcon(slot: HTMLElement, favIconUrl: string, label: string): void {
  slot.textContent = (label || '?').trim().charAt(0) || '?';

  if (favIconUrl) {
    const img = document.createElement('img');
    img.src = favIconUrl;
    img.alt = '';
    img.addEventListener('load', () => slot.replaceChildren(img));
  }
}

function buildMoreRow(tab: TabInfo): HTMLElement {
  const row = document.createElement('div');
  row.className = 'more-row';

  const host = hostnameOf(tab.url);
  const icon = document.createElement('span');
  icon.className = 'icon-slot';
  fillIcon(icon, tab.favIconUrl, tab.title || host);

  const text = document.createElement('div');
  text.className = 'tab-text';

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || host || t('tabFallback');

  const hostEl = document.createElement('span');
  hostEl.className = 'tab-host mono';
  hostEl.textContent = tab.paused ? `${host} · ${t('statusPaused')}` : host;

  text.append(title, hostEl);

  const count = document.createElement('span');
  count.className = 'more-count';
  count.textContent = String(tab.count || 0);

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

  row.append(icon, text, count, stop);
  row.addEventListener('click', () => openApp(tab.tabId));

  return row;
}

function renderHeader(state: PopupState): void {
  $('status-dot').className = state.appRunning ? 'dot ok' : 'dot';
  $('status-text').textContent = state.appRunning
      ? t('statusConnected')
      : t(state.link === 'no-host' ? 'statusNotInstalled' : 'statusNotRunning');
}

function renderCurrentTab(state: PopupState): void {
  const tab = state.currentTab;
  const capturing = Boolean(tab?.capturing);

  $('current-card').classList.toggle('muted', !state.appRunning);
  $<HTMLInputElement>('enabled').checked = capturing;

  const host = tab ? hostnameOf(tab.url) : '';
  const label = tab ? tab.title || host || t('tabFallback') : t('noActiveTab');

  $('current-title').textContent = label;
  $('current-host').textContent = tab?.paused ? `${host} · ${t('statusPaused')}` : host;
  fillIcon($('current-icon'), tab?.favIconUrl || '', label);

  const foot = $('current-foot');

  foot.hidden = !tab || (!capturing && !tab.paused) || !state.appRunning;
  foot.classList.remove('link');
  foot.onclick = null;

  if (foot.hidden || !tab) {
    return;
  }

  const count = tab.count || 0;

  $('current-count').textContent = count ? tn('requests', count) : '';
  $('current-ago').textContent = count ? agoLabel(tab.lastAt) : t('waitingFirst');
  $('current-arrow').hidden = !count;

  if (count) {
    foot.classList.add('link');
    foot.onclick = () => openApp(tab.tabId);
  }
}

function renderWarning(state: PopupState): void {
  $('warn-card').hidden = state.appRunning;

  if (!state.appRunning) {
    const missing = state.link === 'no-host';

    $('warn-text').textContent = t(missing ? 'warnNoHost' : 'warnAppDown');
    $('warn-launch').hidden = missing;
  }
}

function renderActionError(): void {
  $('error-line').hidden = !actionError;
  $('error-text').textContent = actionError;
}

function renderOtherTabs(state: PopupState): void {
  const others = (state.capturedTabs || []).filter((tab) => tab.tabId !== state.activeTabId);

  $('more-section').hidden = others.length === 0;
  $('more-list').replaceChildren(...others.map(buildMoreRow));
}

let hostsMode: 'all' | 'list' | null = null;

function selectHostsMode(mode: 'all' | 'list'): void {
  const active = $(mode === 'all' ? 'hosts-all' : 'hosts-list');
  const thumb = $('hosts-thumb');

  $('hosts-all').classList.toggle('on', mode === 'all');
  $('hosts-list').classList.toggle('on', mode === 'list');
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
}

function renderSettings(state: PopupState): void {
  $<HTMLInputElement>('set-rememberTabs').checked = state.settings.rememberTabs;

  const filters = state.filters;
  const editable = state.appRunning;

  $<HTMLFieldSetElement>('filters').disabled = !editable;
  $('filters-hint').textContent = filtersError || t(editable ? 'filtersApplyNow' : 'filtersOffline');

  const mode = hostsMode ?? (filters.hosts.length ? 'list' : 'all');

  selectHostsMode(mode);
  $('hosts-input-row').hidden = mode !== 'list';

  const input = $<HTMLInputElement>('hosts-input');

  if (document.activeElement !== input) {
    input.value = filters.hosts.join(', ');
  }

  $<HTMLInputElement>('filter-static').checked = filters.static;
  $<HTMLInputElement>('filter-analytics').checked = filters.analytics;
  $<HTMLInputElement>('filter-json').checked = filters.json;
  $('static-value').textContent = t(filters.static ? 'filterSkipped' : 'filterKept');
  $('analytics-value').textContent = t(filters.analytics ? 'filterSkipped' : 'filterKept');
  $('json-value').textContent = t(filters.json ? 'yes' : 'no');
}

let lastState: PopupState | null = null;

function render(state: PopupState): void {
  lastState = state;

  renderHeader(state);
  renderCurrentTab(state);
  renderWarning(state);
  renderActionError();
  renderOtherTabs(state);
  renderSettings(state);
}

async function refresh(): Promise<void> {
  try {
    render(await getState());
  } catch {}
}

let actionError = '';
let filtersError = '';

async function runAction(message: PopupRequest): Promise<void> {
  try {
    const res = await send(message);

    actionError = res?.ok ? '' : res?.error || t('errActionFailed');
  } catch {
    actionError = t('errNoAnswer');
  }

  await refresh();
}

async function updateFilters(change: Partial<CaptureFilters>): Promise<void> {
  if (!lastState) {
    return;
  }

  try {
    const res = await send({ type: 'setFilters', filters: { ...lastState.filters, ...change } });

    filtersError = res?.ok ? '' : res?.error || t('errActionFailed');
  } catch {
    filtersError = t('errNoAnswer');
  }

  await refresh();
}

function parseHosts(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((h) => h.trim().toLowerCase()).filter(Boolean))];
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

  // Measure the thumb once visible and animate only moves after that first placement.
  const segmented = document.querySelector('.segmented')!;
  segmented.classList.remove('ready');
  if (lastState) {
    renderSettings(lastState);
  }
  void $('hosts-thumb').offsetWidth;
  segmented.classList.add('ready');
});

$('close-settings').addEventListener('click', () => {
  document.body.classList.remove('settings');
});

$<HTMLInputElement>('set-rememberTabs').addEventListener('change', async (event) => {
  try {
    await send({ type: 'setSetting', key: 'rememberTabs', value: (event.target as HTMLInputElement).checked });
  } catch {}

  await refresh();
});

$('hosts-all').addEventListener('click', () => {
  hostsMode = 'all';
  selectHostsMode('all');
  updateFilters({ hosts: [] });
});

$('hosts-list').addEventListener('click', () => {
  hostsMode = 'list';
  selectHostsMode('list');
  $('hosts-input-row').hidden = false;
  $('hosts-input').focus();
});

$<HTMLInputElement>('hosts-input').addEventListener('change', (event) => {
  updateFilters({ hosts: parseHosts((event.target as HTMLInputElement).value) });
});

const TOGGLES: [string, keyof CaptureFilters][] = [
  ['filter-static', 'static'],
  ['filter-analytics', 'analytics'],
  ['filter-json', 'json'],
];

for (const [id, key] of TOGGLES) {
  $<HTMLInputElement>(id).addEventListener('change', (event) => {
    updateFilters({ [key]: (event.target as HTMLInputElement).checked });
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

refresh().finally(() => {
  void document.body.offsetWidth;
  document.body.classList.add('ready');
  startPolling();
});

window.addEventListener('unload', stopPolling);

import { ext } from '../shared/api';
import { localizePage, t, tn } from '../shared/i18n';
import {
  DEFAULT_PORT,
  type ActionResult,
  type CaptureFilters,
  type PopupRequest,
  type PopupState,
  type TabInfo,
} from '../shared/types';

// Firefox treats host permissions of a Manifest V3 extension as optional: the user may not have
// granted them at install, and may take them back at any time. Chrome and Edge grant them at install.
// Without them nothing can be injected, so the popup asks — and it has to ask from inside the click,
// which is why whether access is there is known before anybody clicks.
const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };
let hostAccess = true;

async function checkHostAccess(): Promise<void> {
  try {
    hostAccess = await ext.permissions.contains(ALL_SITES);
  } catch {
    hostAccess = true;
  }

  $('access-card').hidden = hostAccess;
}

// Called straight from a click handler, before anything is awaited: a request made later is not a
// user's request any more, and Firefox refuses it.
async function requestHostAccess(): Promise<boolean> {
  let granted = false;

  try {
    granted = await ext.permissions.request(ALL_SITES);
  } catch {
    granted = false;
  }

  hostAccess = granted;
  $('access-card').hidden = granted;

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
  } catch {
    // The worker did not answer; the link below still opens the app.
  }

  const query = tabId != null ? `?tab=${encodeURIComponent(tabId)}` : '';

  window.location.href = `schemo://open${query}`;
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
  const port = $('status-port');

  if (state.appRunning) {
    dot.className = 'dot dot-status-ok';
    text.textContent = t('statusConnected');
    port.textContent = ':' + (state.port || DEFAULT_PORT);
    return;
  }

  dot.className = 'dot dot-status-warn';
  text.textContent = t('statusNotRunning');
  port.textContent = '';
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
    renderAppDown(state.port || DEFAULT_PORT);
  }

  const line = $('buffered-line');
  const buffered = state.bufferedCount || 0;

  line.hidden = state.appRunning || buffered === 0;

  if (!line.hidden) {
    $('buffered-text').textContent = t('buffered', [tn('requests', buffered)]);
  }
}

// The port sits inside the sentence and is drawn in the monospace face, so the translated sentence is
// split around it rather than set as plain text. Where it sits is the translation's business.
function renderAppDown(port: number): void {
  const marker = '\u0000';
  const [before, after = ''] = t('warnAppDown', [marker]).split(marker);
  const portEl = document.createElement('span');

  portEl.className = 'mono';
  portEl.textContent = String(port);

  $('warn-text').replaceChildren(before, portEl, after);
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

  $<HTMLInputElement>('port').value = String(state.port || DEFAULT_PORT);

  for (const id of SETTING_INPUTS) {
    const key = id.replace('set-', '') as keyof PopupState['settings'];

    $<HTMLInputElement>(id).checked = Boolean(state.settings?.[key]);
  }

  renderFilters(state.filters);
}

// The rules the app filters by, listed as they are: the popup is where somebody looks to find out why
// a request they expected is not here, and «фильтры в приложении» is not an answer to that.
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

function render(state: PopupState): void {
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
  } catch {
    // The worker is starting; the next poll will draw it.
  }
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
    if (input.checked && !hostAccess && !(await requestHostAccess())) {
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

$('access-grant').addEventListener('click', () => {
  requestHostAccess().then((granted) => {
    if (granted) {
      actionError = '';
      refresh();
    }
  });
});

$('open-app').addEventListener('click', () => openApp());
$('warn-launch').addEventListener('click', () => openApp());

$('open-settings').addEventListener('click', () => {
  document.body.classList.add('settings');
});

$('close-settings').addEventListener('click', () => {
  document.body.classList.remove('settings');
});

$<HTMLInputElement>('port').addEventListener('change', async (event) => {
  const port = parseInt((event.target as HTMLInputElement).value, 10);

  if (port > 0 && port < 65536) {
    try {
      await send({ type: 'setPort', port });
    } catch {
      // Drawn again below either way.
    }
  }

  await refresh();
});

for (const id of SETTING_INPUTS) {
  $<HTMLInputElement>(id).addEventListener('change', async (event) => {
    try {
      await send({
        type: 'setSetting',
        key: id.replace('set-', ''),
        value: (event.target as HTMLInputElement).checked,
      });
    } catch {
      // Drawn again below either way.
    }

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

checkHostAccess();
refresh().finally(startPolling);

window.addEventListener('unload', stopPolling);

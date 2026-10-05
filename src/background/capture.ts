import { ext } from '../shared/api';
import { t } from '../shared/i18n';
import { sitePattern } from '../shared/sites';
import type { ActionResult, CapturedMessage } from '../shared/types';
import { isBlockedPage } from './browser';
import { connect, disconnect, isConnected, send, sendState } from './connection';
import { keptByFilters } from './filters';
import {
  captureTitleText,
  refreshIndicator,
  setCaptureIcon,
  setCaptureTitle,
  titleDisconnected,
} from './indicator';
import { forgetTab, mayConnect, persistCapture, state } from './state';

const KEEPALIVE = 'schemo-keepalive';
// Chrome's minimum alarm period.
const KEEPALIVE_MINUTES = 0.5;

export function isKeepalive(alarm: chrome.alarms.Alarm): boolean {
  return alarm.name === KEEPALIVE;
}

export function startKeepalive(): void {
  ext.alarms.create(KEEPALIVE, { periodInMinutes: KEEPALIVE_MINUTES });
}

export function stopKeepalive(): void {
  ext.alarms.clear(KEEPALIVE);
}

export function originOf(url: string | undefined): string {
  try {
    return new URL(url || '').origin;
  } catch {
    return '';
  }
}

async function rememberOrigin(origin: string): Promise<void> {
  if (!origin) {
    return;
  }

  const { captureOrigins = [] } = (await ext.storage.local.get('captureOrigins')) as {
    captureOrigins?: string[];
  };

  if (captureOrigins.includes(origin)) {
    return;
  }

  captureOrigins.push(origin);

  await ext.storage.local.set({ captureOrigins });
}

async function forgetOrigin(origin: string): Promise<void> {
  if (!origin) {
    return;
  }

  const { captureOrigins = [] } = (await ext.storage.local.get('captureOrigins')) as {
    captureOrigins?: string[];
  };

  const next = captureOrigins.filter((item) => item !== origin);

  if (next.length !== captureOrigins.length) {
    await ext.storage.local.set({ captureOrigins: next });
  }
}

export async function forgetOriginsWithoutAccess(): Promise<void> {
  const origins = await rememberedOrigins();
  const kept: string[] = [];

  for (const origin of origins) {
    const pattern = sitePattern(origin);

    if (pattern && (await ext.permissions.contains({ origins: [pattern] }))) {
      kept.push(origin);
    }
  }

  if (kept.length !== origins.length) {
    await ext.storage.local.set({ captureOrigins: kept });
  }
}

export async function rememberedOrigins(): Promise<string[]> {
  const { captureOrigins = [] } = (await ext.storage.local.get('captureOrigins')) as {
    captureOrigins?: string[];
  };

  return captureOrigins;
}

function injectionFailure(tab: chrome.tabs.Tab | undefined, err: unknown): string {
  console.warn('[schemo] injection into', tab?.url || '(unknown)', 'failed:', err);

  return isBlockedPage(tab?.url)
      ? t('errBlockedPage')
      : t('errPageUnreachable');
}

export async function injectInto(tabId: number): Promise<void> {
  await ext.scripting.executeScript({
    target: { tabId },
    files: ['content/bridge.js'],
  });

  await ext.scripting.executeScript({
    target: { tabId },
    files: ['content/interceptor.js'],
    world: 'MAIN',
    injectImmediately: true,
  });
}

async function disableInTab(tabId: number): Promise<void> {
  try {
    await ext.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.__schemoEnabled = false;
      },
      world: 'MAIN',
    });
  } catch (err) {
    console.warn(`[schemo] could not switch capture off in tab ${tabId}:`, err);
  }
}

function addCaptureTab(tab: chrome.tabs.Tab, resetCount = true): void {
  if (tab?.id == null) {
    return;
  }

  const fresh = !state.captureTabIds.has(tab.id);

  state.captureTabIds.add(tab.id);

  if (fresh) {
    state.captureTabSince.set(tab.id, Date.now());
  }

  state.captureTabMeta.set(tab.id, {
    title: tab.title || '',
    url: tab.url || '',
  });

  if (resetCount) {
    state.capturedCounts.set(tab.id, 0);
  }
}

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function startCapture(): Promise<ActionResult & { tabId?: number }> {
  return startCaptureOn(await activeTab());
}

export async function startCaptureOn(
    tab: chrome.tabs.Tab | undefined
): Promise<ActionResult & { tabId?: number }> {
  if (tab?.id == null) {
    return { ok: false, error: t('errNoActiveTab') };
  }

  // A person asked for this tab, so the link may be opened and kept up for the session whatever the
  // switch says.
  state.wanted = true;

  if (!state.captureTabIds.has(tab.id)) {
    try {
      await injectInto(tab.id);
    } catch (err) {
      return { ok: false, error: injectionFailure(tab, err) };
    }

    state.paused = false;
    addCaptureTab(tab);

    if (state.settings.rememberTabs) {
      await rememberOrigin(originOf(tab.url));
    }

    await persistCapture();
  }

  startKeepalive();

  setCaptureIcon(tab.id, 'disconnected');
  setCaptureTitle(tab.id, titleDisconnected());

  if (!isConnected()) {
    connect();
  } else {
    refreshIndicator(isConnected());
    sendState();
  }

  return { ok: true, tabId: tab.id };
}

export async function stopCaptureFor(tabId: number, keepConnection = false): Promise<void> {
  await disableInTab(tabId);

  setCaptureIcon(tabId, 'normal');
  setCaptureTitle(tabId, 'Schemo');

  const meta = state.captureTabMeta.get(tabId);

  forgetTab(tabId);

  if (!keepConnection && meta?.url) {
    const origin = originOf(meta.url);

    const stillUsed = await Promise.all(
        [...state.captureTabIds].map(async (id) => {
          try {
            const tab = await ext.tabs.get(id);
            return originOf(tab.url) === origin;
          } catch {
            return false;
          }
        })
    );

    if (!stillUsed.some(Boolean)) {
      await forgetOrigin(origin);
    }
  }

  await persistCapture();

  if (state.captureTabIds.size === 0 && !keepConnection) {
    stopKeepalive();
    disconnect();
  }

  sendState();
}

export async function stopCapture(): Promise<ActionResult> {
  const tab = await activeTab();

  if (tab?.id != null) {
    await stopCaptureFor(tab.id);
  }

  return { ok: true };
}

export async function captureByOrigins(origins: string[]): Promise<number> {
  if (!origins.length) {
    return 0;
  }

  const tabs = await ext.tabs.query({});

  for (const tab of tabs) {
    if (
        tab.id == null ||
        !tab.url ||
        state.captureTabIds.has(tab.id) ||
        !origins.includes(originOf(tab.url))
    ) {
      continue;
    }

    try {
      await injectInto(tab.id);
    } catch {
      continue;
    }

    addCaptureTab(tab);
  }

  if (state.captureTabIds.size === 0) {
    return 0;
  }

  await persistCapture();

  startKeepalive();
  refreshIndicator(isConnected());

  // The tabs are armed either way — that is what "remember tabs" asks for — and the link is opened
  // only if the switch allows the extension to open one by itself.
  if (mayConnect()) {
    connect();
  }

  sendState();

  return state.captureTabIds.size;
}

export async function pauseAll(): Promise<void> {
  const origins = [
    ...new Set(
        [...state.captureTabIds]
            .map((tabId) => originOf(state.captureTabMeta.get(tabId)?.url))
            .filter(Boolean)
    ),
  ];

  state.pausedOrigins = origins;
  state.paused = true;

  await ext.storage.session.set({ pausedOrigins: origins });

  for (const tabId of [...state.captureTabIds]) {
    await stopCaptureFor(tabId, true);
  }

  startKeepalive();
  connect();
  sendState();
}

export async function resumeAll(): Promise<void> {
  const [session, remembered] = await Promise.all([
    ext.storage.session.get('pausedOrigins') as Promise<{ pausedOrigins?: string[] }>,
    rememberedOrigins(),
  ]);

  const origins = state.pausedOrigins.length
      ? state.pausedOrigins
      : session.pausedOrigins?.length
          ? session.pausedOrigins
          : remembered;

  state.pausedOrigins = [];
  state.paused = false;

  await ext.storage.session.set({ pausedOrigins: [] });

  await captureByOrigins(origins);
}

function makeId(): string {
  return `${Date.now().toString(36)}-` + Math.random().toString(36).slice(2, 8);
}

export function handleCapturedRequest(message: CapturedMessage, sender: chrome.runtime.MessageSender): void {
  const tabId = sender.tab?.id;

  if (tabId == null || !state.captureTabIds.has(tabId)) {
    return;
  }

  if (!keptByFilters(message)) {
    return;
  }

  const sent = send({
    type: 'request',
    id: makeId(),
    method: message.method,
    url: message.url,
    requestHeaders: message.requestHeaders || {},
    requestBody: message.requestBody || '',
    status: message.status,
    statusText: message.statusText || '',
    responseHeaders: message.responseHeaders || {},
    responseBody: message.responseBody || '',
    durationMs: message.durationMs || 0,
    hasTiming: Boolean(message.hasTiming),
    waitMs: message.waitMs || 0,
    downloadMs: message.downloadMs || 0,
    startedAt: message.startedAt || Date.now(),
    tabId,
    tabTitle: message.tabTitle,
    tabURL: message.tabURL,
    favIconUrl: sender.tab?.favIconUrl || '',
  });

  // Not stored: a request the app can't take right now is dropped.
  if (!sent) {
    return;
  }

  state.capturedCounts.set(tabId, (state.capturedCounts.get(tabId) || 0) + 1);
  state.capturedLastAt.set(tabId, Date.now());
  setCaptureTitle(tabId, captureTitleText(tabId));
}

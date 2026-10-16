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
} from './indicator';
import { mayConnect, persistCapture, rememberTab, state } from './state';

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

  // Explicit capture may connect regardless of autoConnect.
  state.wanted = true;

  if (state.tabs.get(tab.id)?.paused) {
    await resumeCapture(tab.id);
    if (state.tabs.get(tab.id)?.paused) {
      return { ok: false, error: t('errPageUnreachable') };
    }
  }

  if (!state.tabs.has(tab.id)) {
    try {
      await injectInto(tab.id);
    } catch (err) {
      return { ok: false, error: injectionFailure(tab, err) };
    }

    rememberTab(tab);

    if (state.settings.rememberTabs) {
      await rememberOrigin(originOf(tab.url));
    }

    await persistCapture();
  }

  startKeepalive();

  if (!isConnected()) {
    connect();
  }
  refreshIndicator(isConnected());
  sendState();

  return { ok: true, tabId: tab.id };
}

export async function stopCaptureFor(tabId: number): Promise<void> {
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  state.tabs.delete(tabId);

  await disableInTab(tabId);

  setCaptureIcon(tabId, 'normal');
  setCaptureTitle(tabId, 'Schemo');

  if (tab.url) {
    const origin = originOf(tab.url);

    const stillUsed = [...state.tabs.values()].some(tab => originOf(tab.url) === origin);

    if (!stillUsed) {
      await forgetOrigin(origin);
    }
  }

  await persistCapture();

  if (state.tabs.size === 0) {
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
        state.tabs.has(tab.id) ||
        !origins.includes(originOf(tab.url))
    ) {
      continue;
    }

    try {
      await injectInto(tab.id);
    } catch {
      continue;
    }

    rememberTab(tab);
  }

  if (state.tabs.size === 0) {
    return 0;
  }

  await persistCapture();

  startKeepalive();
  refreshIndicator(isConnected());

  // Remembered tabs are armed even when automatic connection is disabled.
  if (mayConnect()) {
    connect();
  }

  sendState();

  return state.tabs.size;
}

export async function pauseCapture(tabId?: number): Promise<void> {
  const targets = tabId === undefined ? [...state.tabs.keys()] : [tabId];
  for (const id of targets) {
    const tab = state.tabs.get(id);
    if (!tab || tab.paused) continue;
    tab.paused = true;
    await disableInTab(id);
  }
  await persistCapture();
  refreshIndicator(isConnected());
  sendState();
}

export async function resumeCapture(tabId?: number): Promise<void> {
  const targets = tabId === undefined ? [...state.tabs.keys()] : [tabId];
  for (const id of targets) {
    const tab = state.tabs.get(id);
    if (!tab?.paused) continue;
    try {
      await injectInto(id);
      tab.paused = false;
    } catch (err) {
      console.warn('[schemo] could not resume capture in tab', id, err);
    }
  }
  await persistCapture();
  refreshIndicator(isConnected());
  sendState();
}

export function handleCapturedRequest(message: CapturedMessage, sender: chrome.runtime.MessageSender): void {
  const tabId = sender.tab?.id;
  const tab = tabId === undefined ? undefined : state.tabs.get(tabId);

  if (tabId === undefined || !tab || tab.paused) {
    return;
  }

  if (!keptByFilters(message)) {
    return;
  }

  const sent = send({
    type: 'request',
    id: crypto.randomUUID(),
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

  tab.count++;
  tab.lastAt = Date.now();
  setCaptureTitle(tabId, captureTitleText(tabId));
}

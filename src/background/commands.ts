// What the popup can ask the worker.

import { ext } from '../shared/api';
import {
  DEFAULT_SETTINGS,
  type ActionResult,
  type CurrentTab,
  type PopupRequest,
  type PopupState,
  type Settings,
  type TabInfo,
} from '../shared/types';
import { t } from '../shared/i18n';
import { BROWSER_NAME } from './browser';
import { activeTab, startCapture, stopCapture, stopCaptureFor } from './capture';
import { bufferedCount, connect, disconnect, isAppRunning, isConnected, send } from './connection';
import { isActive, readState, state } from './state';

function describeTab(tab: chrome.tabs.Tab | undefined): CurrentTab | null {
  if (tab?.id == null) {
    return null;
  }

  return {
    tabId: tab.id,
    title: tab.title || '',
    url: tab.url || '',
    favIconUrl: tab.favIconUrl || '',
    count: state.capturedCounts.get(tab.id) || 0,
    lastAt: state.capturedLastAt.get(tab.id) || 0,
    capturing: state.captureTabIds.has(tab.id),
  };
}

async function getCapturedTabs(): Promise<TabInfo[]> {
  const tabs: TabInfo[] = [];

  for (const tabId of state.captureTabIds) {
    try {
      const tab = await ext.tabs.get(tabId);

      tabs.push({
        tabId,
        title: tab.title || '',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl || '',
        count: state.capturedCounts.get(tabId) || 0,
      });
    } catch {
      // The tab is gone; onRemoved will forget it.
    }
  }

  return tabs;
}

async function getState(): Promise<PopupState> {
  const { port } = await readState();
  const appRunning = isConnected() || (await isAppRunning(port));
  const tab = await activeTab();

  return {
    capturing: tab?.id != null && state.captureTabIds.has(tab.id),
    activeTabId: tab?.id ?? null,
    port,
    appRunning,
    capturedTabs: await getCapturedTabs(),
    currentTab: describeTab(tab),
    bufferedCount: bufferedCount(),
    settings: { ...state.settings },
    filters: { ...state.filters },
    browser: BROWSER_NAME,
  };
}

function focusApp(tabId: number | null | undefined): ActionResult {
  return { ok: send({ type: 'focus', tab: tabId ?? 0 }) };
}

async function setSetting(key: string, value: boolean): Promise<ActionResult & { settings: Settings }> {
  if (key in DEFAULT_SETTINGS) {
    state.settings = { ...state.settings, [key]: Boolean(value) };

    await ext.storage.local.set({ settings: state.settings });

    if (key === 'rememberTabs' && !state.settings.rememberTabs) {
      await ext.storage.local.set({ captureOrigins: [] });
    }
  }

  return { ok: true, settings: { ...state.settings } };
}

async function setPort(value: unknown): Promise<ActionResult> {
  const port = parseInt(String(value), 10);

  if (port > 0 && port < 65536) {
    await ext.storage.local.set({ port });

    if (isActive()) {
      disconnect();
      connect(port);
    }
  }

  return { ok: true };
}

export async function respond(message: PopupRequest): Promise<unknown> {
  switch (message.type) {
    case 'getState':
      return getState();

    case 'focusApp':
      return focusApp(message.tabId);

    case 'setSetting':
      return setSetting(String(message.key || ''), message.value);

    case 'startCapture':
      return startCapture();

    case 'stopCapture':
      return stopCapture();

    case 'stopCaptureTab':
      if (message.tabId != null && state.captureTabIds.has(message.tabId)) {
        await stopCaptureFor(message.tabId);
      }

      return { ok: true };

    case 'setPort':
      return setPort(message.port);

    default:
      return {
        ok: false,
        error: t('errUnknownCommand', [String((message as { type?: unknown }).type)]),
      };
  }
}

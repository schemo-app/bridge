import { ext } from '../shared/api';
import {
  DEFAULT_SETTINGS,
  type ActionResult,
  type CaptureFilters,
  type CurrentTab,
  type PopupRequest,
  type PopupState,
  type Settings,
  type TabInfo,
} from '../shared/types';
import { t } from '../shared/i18n';
import { clearPendingCapture, setPendingCapture } from './access';
import { BROWSER_NAME } from './browser';
import { activeTab, startCapture, stopCapture, stopCaptureFor } from './capture';
import { getLinkState, probe, send } from './connection';
import { applyFilters } from './filters';
import { saveSettings, state } from './state';

function describeTab(tab: chrome.tabs.Tab | undefined): CurrentTab | null {
  if (tab?.id == null) {
    return null;
  }

  const captured = state.tabs.get(tab.id);
  return {
    tabId: tab.id,
    title: tab.title || '',
    url: tab.url || '',
    favIconUrl: tab.favIconUrl || '',
    count: captured?.count ?? 0,
    lastAt: captured?.lastAt ?? 0,
    capturing: !!captured && !captured.paused,
    paused: captured?.paused ?? false,
  };
}

async function getCapturedTabs(): Promise<TabInfo[]> {
  const tabs: TabInfo[] = [];

  for (const [tabId, captured] of state.tabs) {
    try {
      const tab = await ext.tabs.get(tabId);

      tabs.push({
        tabId,
        title: tab.title || '',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl || '',
        count: captured.count,
        paused: captured.paused,
      });
    } catch {}
  }

  return tabs;
}

async function getState(): Promise<PopupState> {
  const appRunning = await probe();
  const tab = await activeTab();
  const currentTab = describeTab(tab);

  return {
    link: getLinkState(),
    capturing: currentTab?.capturing ?? false,
    activeTabId: tab?.id ?? null,
    appRunning,
    capturedTabs: await getCapturedTabs(),
    currentTab,
    settings: { ...state.settings },
    filters: { ...state.filters },
    browser: BROWSER_NAME,
  };
}

// Filters belong to the app: an edit goes there and comes back to every browser.
async function setFilters(filters: CaptureFilters): Promise<ActionResult> {
  if (!send({ type: 'filters', filters })) {
    return { ok: false, error: t('errFiltersOffline') };
  }

  await applyFilters(filters);
  return { ok: true };
}

function focusApp(tabId: number | null | undefined): ActionResult {
  return { ok: send({ type: 'focus', tab: tabId ?? 0 }) };
}

async function setSetting(key: string, value: boolean): Promise<ActionResult & { settings: Settings }> {
  if (key in DEFAULT_SETTINGS) {
    await saveSettings({ [key]: Boolean(value) });
  }

  return { ok: true, settings: { ...state.settings } };
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

    case 'pendingCapture':
      await setPendingCapture(message.tabId, message.pattern);
      return { ok: true };

    case 'setFilters':
      return setFilters(message.filters);

    case 'clearPending':
      await clearPendingCapture();
      return { ok: true };

    case 'stopCaptureTab':
      await stopCaptureFor(message.tabId);
      return { ok: true };

    default:
      return {
        ok: false,
        error: t('errUnknownCommand', [String((message as { type?: unknown }).type)]),
      };
  }
}

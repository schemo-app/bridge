import { ext } from '../shared/api';
import { t } from '../shared/i18n';
import type { AppFrame, RuntimeMessage } from '../shared/types';
import {
  captureByOrigins,
  handleCapturedRequest,
  injectInto,
  isKeepalive,
  pauseCapture,
  rememberedOrigins,
  resumeCapture,
  startKeepalive,
  stopKeepalive,
} from './capture';
import { listenForGrants } from './access';
import { respond } from './commands';
import { connect, disconnect, isConnected, sendState, setFrameHandler } from './connection';
import { applyFilters } from './filters';
import { refreshIndicator } from './indicator';
import { BROWSER_NAME } from './browser';
import { isActive, listenForSettings, mayConnect, persistCapture, readState, rememberTab, saveSettings, state, type StoredTab } from './state';

const ready = readState().then(restoreCaptured).catch((err: unknown) => {
  console.warn('[schemo] restoring capture', err);
});
listenForSettings();
listenForGrants(ready);

setFrameHandler((frame: AppFrame) => {
  switch (frame.type) {
    case 'pause':
      if (!frame.browser || frame.browser === BROWSER_NAME) {
        pauseCapture(frame.tabId).catch((err: unknown) => console.warn('[schemo] pause capture', err));
      }
      break;

    case 'resume':
      if (!frame.browser || frame.browser === BROWSER_NAME) {
        resumeCapture(frame.tabId).catch((err: unknown) => console.warn('[schemo] resume capture', err));
      }
      break;

    case 'filters':
      if (frame.filters) {
        applyFilters(frame.filters);
      }
      break;

    case 'settings': {
      saveSettings({
        autoConnect: frame.autoConnect ?? state.settings.autoConnect,
        rememberTabs: frame.rememberTabs ?? state.settings.rememberTabs,
      }).catch((err: unknown) => console.warn('[schemo] settings', err));
      break;
    }
  }
});

ext.runtime.onMessage.addListener((message: RuntimeMessage | undefined, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  ready.then(() => {
    if (message.type === 'captured') {
      handleCapturedRequest(message, sender);
      return;
    }
    return respond(message);
  })
      .then(sendResponse)
      .catch((err: unknown) => {
        console.warn('[schemo] message', message?.type, 'failed:', err);

        sendResponse({
          ok: false,
          error: t('errCrashed', [String((err as Error)?.message || err || t('errUnknown'))]),
        });
      });

  return true;
});

ext.alarms.onAlarm.addListener(async (alarm) => {
  await ready;
  if (isKeepalive(alarm) && isActive() && !isConnected() && mayConnect()) {
    connect();
  }
});

// A new document loses the hooks; re-inject into captured tabs.
ext.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await ready;
  const captured = state.tabs.get(tabId);
  if (!captured) {
    return;
  }

  if (changeInfo.status === 'loading') {
    refreshIndicator(isConnected());
    if (!captured.paused) injectInto(tabId).catch(() => {});
  }

  if (changeInfo.url || changeInfo.title) {
    captured.title = tab.title || '';
    captured.url = tab.url || '';
    sendState();
  }
});

ext.runtime.onStartup.addListener(async () => {
  await ready;

  if (!state.settings.rememberTabs) {
    return;
  }

  await captureByOrigins(await rememberedOrigins());
});

ext.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  if (!state.tabs.delete(tabId)) {
    return;
  }

  persistCapture().catch(() => {});

  if (state.tabs.size === 0) {
    stopKeepalive();
    disconnect();
  }

  sendState();
});

async function restoreCaptured(tabs: StoredTab[]): Promise<void> {
  if (!tabs.length) {
    return;
  }

  for (const saved of tabs) {
    try {
      rememberTab(await ext.tabs.get(saved.tabId), saved);
    } catch {
      // Closed tabs are not restored.
      continue;
    }
  }

  await persistCapture();
  if (state.tabs.size > 0) {
    state.wanted = true;
    startKeepalive();
    refreshIndicator(false);
    connect();
  }
}

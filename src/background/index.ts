import { ext } from '../shared/api';
import { t } from '../shared/i18n';
import type { AppFrame, RuntimeMessage } from '../shared/types';
import {
  captureByOrigins,
  handleCapturedRequest,
  injectInto,
  isKeepalive,
  pauseAll,
  rememberedOrigins,
  resumeAll,
  startKeepalive,
  stopKeepalive,
} from './capture';
import { listenForGrants } from './access';
import { respond } from './commands';
import { connect, disconnect, isConnected, sendState, setFrameHandler } from './connection';
import { applyFilters } from './filters';
import { refreshIndicator, setCaptureIcon, setCaptureTitle, titleDisconnected } from './indicator';
import { forgetTab, isActive, loadStoredSettings, persistCapture, readState, state } from './state';

loadStoredSettings();
listenForGrants();

setFrameHandler((frame: AppFrame) => {
  switch (frame.type) {
    case 'pause':
      pauseAll();
      break;

    case 'resume':
      resumeAll();
      break;

    case 'filters':
      if (frame.filters) {
        applyFilters(frame.filters);
      }
      break;
  }
});

ext.runtime.onMessage.addListener((message: RuntimeMessage | undefined, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === 'captured') {
    handleCapturedRequest(message, sender);
    return false;
  }

  respond(message)
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

ext.alarms.onAlarm.addListener((alarm) => {
  if (isKeepalive(alarm) && isActive() && !isConnected()) {
    connect();
  }
});

// A new document loses the hooks; re-inject into captured tabs.
ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!state.captureTabIds.has(tabId)) {
    return;
  }

  if (changeInfo.status === 'loading') {
    refreshIndicator(isConnected());
    injectInto(tabId).catch(() => {});
  }

  if (changeInfo.url || changeInfo.title) {
    state.captureTabMeta.set(tabId, {
      title: tab.title || '',
      url: tab.url || '',
    });
  }
});

ext.runtime.onStartup.addListener(async () => {
  await readState();

  if (!state.settings.rememberTabs) {
    return;
  }

  await captureByOrigins(await rememberedOrigins());
});

ext.tabs.onRemoved.addListener((tabId) => {
  if (!state.captureTabIds.has(tabId)) {
    return;
  }

  forgetTab(tabId);

  persistCapture().catch(() => {});

  if (state.captureTabIds.size === 0) {
    stopKeepalive();
    disconnect();
  }

  sendState();
});

function restoreCaptured(tabIds: number[]): void {
  if (!tabIds.length) {
    return;
  }

  for (const tabId of tabIds) {
    state.captureTabIds.add(tabId);
    state.captureTabMeta.set(tabId, { title: '', url: '' });

    setCaptureIcon(tabId, 'disconnected');
    setCaptureTitle(tabId, titleDisconnected());
  }

  connect();
}

(ext.storage.session.get(['captureTabIds', 'pausedOrigins']) as Promise<{
  captureTabIds?: number[];
  pausedOrigins?: string[];
}>).then(({ pausedOrigins, captureTabIds }) => {
  if (pausedOrigins?.length) {
    state.paused = true;
    state.pausedOrigins = pausedOrigins;

    startKeepalive();
    connect();

    return;
  }

  restoreCaptured(captureTabIds || []);
});

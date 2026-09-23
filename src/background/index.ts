// The background: a service worker in Chrome and Edge, an event page in Firefox. Either can be
// stopped and started again at any moment, so everything it must not forget is in storage and every
// listener is registered on the first turn.

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
import { respond } from './commands';
import { connect, disconnect, isConnected, isOpen, send, sendState, setFrameHandler } from './connection';
import { applyFilters } from './filters';
import { refreshIndicator, setCaptureIcon, setCaptureTitle, titleDisconnected } from './indicator';
import { forgetTab, isActive, loadStoredSettings, persistCapture, readPort, readState, state } from './state';

loadStoredSettings();

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
  if (!isKeepalive(alarm)) {
    return;
  }

  readPort().then((port) => {
    if (!isActive()) {
      return;
    }

    if (!isOpen()) {
      connect(port);
      return;
    }

    send({ type: 'ping' });
  });
});

ext.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || !state.captureTabIds.has(details.tabId)) {
    return;
  }

  refreshIndicator(isConnected());

  injectInto(details.tabId).catch(() => {});

  ext.tabs
      .get(details.tabId)
      .then((tab) => {
        if (!state.captureTabIds.has(details.tabId)) {
          return;
        }

        state.captureTabMeta.set(details.tabId, {
          title: tab.title || '',
          url: tab.url || '',
        });
      })
      .catch(() => {});
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

  // A listener is not a place to await: the tab is already gone and the write is bookkeeping. The
  // failure is dropped rather than left to surface as a rejection nobody asked for.
  persistCapture().catch(() => {});

  if (state.captureTabIds.size === 0) {
    stopKeepalive();
    disconnect();
  }

  sendState();
});

// A restarted worker picks up where the last one stopped: a paused capture waits for the app to
// resume it, captured tabs are captured again.
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

  readPort().then(connect);
}

(ext.storage.session.get(['captureTabIds', 'pausedOrigins']) as Promise<{
  captureTabIds?: number[];
  pausedOrigins?: string[];
}>).then(({ pausedOrigins, captureTabIds }) => {
  if (pausedOrigins?.length) {
    state.paused = true;
    state.pausedOrigins = pausedOrigins;

    startKeepalive();
    readPort().then(connect);

    return;
  }

  restoreCaptured(captureTabIds || []);
});

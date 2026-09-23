// Runs in the isolated world of a captured tab and carries what the page hook reports to the worker.
// The hook lives in the page's own world, where the extension API is not reachable.

import { ext } from '../shared/api';
import { MESSAGE_MARKER, type CapturedMessage, type HookMessage } from '../shared/types';

(() => {
  if (window.__schemoBridge) {
    return;
  }

  window.__schemoBridge = true;

  window.addEventListener('message', (event: MessageEvent<Partial<HookMessage> | null>) => {
    // Only this page's own hook may report. Any frame on a captured page can post a message with the
    // marker below, and a capture that came from one of them would be filed as this tab's — under
    // this tab's title and address, which is what makes it worth forging.
    if (event.source !== window) {
      return;
    }

    const data = event.data;

    if (data?.__schemo !== MESSAGE_MARKER || data.kind !== 'request') {
      return;
    }

    const message: CapturedMessage = {
      type: 'captured',
      method: String(data.method ?? ''),
      url: String(data.url ?? ''),
      requestHeaders: data.requestHeaders,
      requestBody: data.requestBody,
      status: Number(data.status ?? 0),
      statusText: data.statusText,
      responseHeaders: data.responseHeaders,
      responseBody: data.responseBody,
      durationMs: data.durationMs,
      hasTiming: data.hasTiming,
      waitMs: data.waitMs,
      downloadMs: data.downloadMs,
      startedAt: data.startedAt,
      tabTitle: document.title,
      tabURL: location.href,
    };

    // The extension was reloaded or updated under this page: this context is dead, and every call
    // from it throws — once per request, on a page nobody is looking at. The hook in the page cannot
    // be switched off from here (it lives in the page's own world, and this is the isolated one), so
    // the failure is swallowed and capture ends when the page is reloaded.
    try {
      ext.runtime.sendMessage(message).catch(() => {});
    } catch {
      // Swallowed on purpose, and for the reason above.
    }
  });
})();

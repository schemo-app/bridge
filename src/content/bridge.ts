import { ext } from '../shared/api';
import { MESSAGE_MARKER, type CapturedMessage, type HookMessage } from '../shared/types';

(() => {
  if (window.__schemoBridge) {
    return;
  }

  window.__schemoBridge = true;

  window.addEventListener('message', (event: MessageEvent<Partial<HookMessage> | null>) => {
    // Only this window's own hook may report, not other frames.
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

    // Throws once the extension was reloaded under this page.
    try {
      ext.runtime.sendMessage(message).catch(() => {});
    } catch {}
  });
})();

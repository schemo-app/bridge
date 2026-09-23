// Runs in the page's own (MAIN) world and wraps fetch and XMLHttpRequest. It has no extension API —
// nothing from ../shared/api may be imported here — and reports by posting to its own window, where
// the bridge picks it up.
//
// Only types are imported. A value shared with another entry makes Parcel ship its module loader,
// and in this world that loader is a global on the page's own window.

import type { HeaderMap, HookMessage, InterceptedRequest } from '../shared/types';

(() => {
  const MESSAGE_MARKER: HookMessage['__schemo'] = '__SCHEMO_CAPTURE__';
  const MAX_BODY_CHARS = 2 * 1024 * 1024;

  // Injected a second time into a page that already has the hook: the flag is turned back on, and the
  // hooks that are already there are kept — installing them twice would put two wrappers around fetch
  // and capture every request twice.
  if (window.__schemoHook) {
    window.__schemoEnabled = true;
    return;
  }

  window.__schemoHook = true;
  window.__schemoEnabled = true;

  const isCaptureEnabled = () => window.__schemoEnabled === true;

  function isBinaryContentType(contentType: string): boolean {
    if (!contentType) {
      return false;
    }

    const type = contentType.split(';')[0].trim().toLowerCase();

    return (
        type.startsWith('image/') ||
        type.startsWith('audio/') ||
        type.startsWith('video/') ||
        type.startsWith('font/') ||
        /^application\/(pdf|zip|gzip|octet-stream|wasm|x-binary|x-compressed)$/.test(type)
    );
  }

  function limitBody(body: string): string {
    if (body.length <= MAX_BODY_CHARS) {
      return body;
    }

    // In English like the other placeholders of this file ([binary body], [form data]): the page's
    // world has no access to the extension's translations.
    return `${body.slice(0, MAX_BODY_CHARS)}\n…[truncated to 2 MB]`;
  }

  function serializeHeaders(headers: HeadersInit | undefined | null): HeaderMap {
    if (!headers) {
      return {};
    }

    const result: HeaderMap = {};

    if (typeof (headers as Headers).forEach === 'function' && !Array.isArray(headers)) {
      (headers as Headers).forEach((value, key) => {
        result[key] = value;
      });

      return result;
    }

    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        result[key] = value;
      }

      return result;
    }

    for (const key of Object.keys(headers)) {
      result[key] = (headers as Record<string, string>)[key];
    }

    return result;
  }

  function parseResponseHeaders(headers: string): HeaderMap {
    if (!headers) {
      return {};
    }

    const result: HeaderMap = {};

    for (const line of headers.trim().split(/\r?\n/)) {
      const separator = line.indexOf(':');

      if (separator <= 0) {
        continue;
      }

      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();

      result[name] = value;
    }

    return result;
  }

  function bodyToString(body: unknown): string {
    if (body == null) {
      return '';
    }

    // Capped here rather than at the call sites, because this is where both of them meet: a request
    // body is copied into a frame, sent over the port and kept in the worker's buffer, and a fifty
    // megabyte upload would be carried four times over.
    if (typeof body === 'string') {
      return limitBody(body);
    }

    if (body instanceof URLSearchParams) {
      return body.toString();
    }

    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      return '[binary body]';
    }

    if (body instanceof Blob) {
      return '[blob body]';
    }

    if (body instanceof FormData) {
      return '[form data]';
    }

    try {
      return limitBody(JSON.stringify(body));
    } catch {
      return String(body);
    }
  }

  function capture(data: InterceptedRequest): void {
    if (!isCaptureEnabled()) {
      return;
    }

    try {
      window.postMessage({ __schemo: MESSAGE_MARKER, kind: 'request', ...data }, '*');
    } catch {
      // Ignore postMessage failures during navigation.
    }
  }

  function getBinaryResponseBody(contentType: string): string {
    return `[binary response: ${contentType.split(';')[0]}]`;
  }

  function phases(startedAt: number, headersAt: number, bodyAt: number) {
    return {
      hasTiming: true,
      waitMs: Math.max(0, Math.round(headersAt - startedAt)),
      downloadMs: Math.max(0, Math.round(bodyAt - headersAt)),
    };
  }

  function installFetchHook(): void {
    const originalFetch = window.fetch;

    if (typeof originalFetch !== 'function') {
      return;
    }

    window.fetch = function patchedFetch(
        this: unknown,
        input: RequestInfo | URL,
        init: RequestInit = {}
    ): Promise<Response> {
      const startedAt = Date.now();
      const startedPerf = performance.now();
      const promise = originalFetch.call(this, input, init);

      if (!isCaptureEnabled()) {
        return promise;
      }

      // A Request carries its own url, method and headers; a string or a URL carries only the address.
      const request = typeof input === 'string' ? undefined : (input as Partial<Request>);
      const url = typeof input === 'string' ? input : request?.url || String(input);
      const method = (init.method || request?.method || 'GET').toUpperCase();
      const requestHeaders = serializeHeaders(init.headers || request?.headers);
      const requestBody = bodyToString(init.body);

      promise.then(
          async (response) => {
            // Resolved means the headers are in — see phases().
            const headersPerf = performance.now();
            const responseHeaders = serializeHeaders(response.headers);
            const contentType = response.headers.get('content-type') || '';

            if (isBinaryContentType(contentType)) {
              // The body is deliberately not read here, so its download time is unknown and
              // the phases are left out rather than reported as zero.
              capture({
                method,
                url,
                requestHeaders,
                requestBody,
                status: response.status,
                statusText: response.statusText,
                responseHeaders,
                responseBody: getBinaryResponseBody(contentType),
                durationMs: Math.round(performance.now() - startedPerf),
                startedAt,
              });

              return;
            }

            let responseBody = '';

            try {
              responseBody = limitBody(await response.clone().text());
            } catch {
              // Keep empty response body when it cannot be read.
            }

            // Measured after the body, so the total stays the whole round trip and the two
            // phases above add up to it — otherwise "Всего" would silently mean "до заголовков".
            capture({
              method,
              url,
              requestHeaders,
              requestBody,
              status: response.status,
              statusText: response.statusText,
              responseHeaders,
              responseBody,
              durationMs: Math.round(performance.now() - startedPerf),
              startedAt,
              ...phases(startedPerf, headersPerf, performance.now()),
            });
          },
          (error: unknown) => {
            capture({
              method,
              url,
              requestHeaders,
              requestBody,
              status: 0,
              statusText: String((error as Error)?.message || error),
              durationMs: Math.round(performance.now() - startedPerf),
              startedAt,
            });
          }
      );

      return promise;
    };
  }

  function installXhrHook(): void {
    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open as (this: XMLHttpRequest, ...args: unknown[]) => void;
    const originalSend = proto.send;
    const originalSetRequestHeader = proto.setRequestHeader;

    proto.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      this.__schemo = {
        method: String(method).toUpperCase(),
        url: String(url),
        requestHeaders: {},
        startedAt: Date.now(),
      };

      return originalOpen.call(this, method, url, ...rest);
    } as typeof proto.open;

    proto.setRequestHeader = function patchedSetRequestHeader(this: XMLHttpRequest, name: string, value: string) {
      if (this.__schemo) {
        this.__schemo.requestHeaders[name] = value;
      }

      return originalSetRequestHeader.call(this, name, value);
    };

    proto.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const state = this.__schemo;

      if (state && isCaptureEnabled()) {
        const requestBody = bodyToString(body);
        const startedPerf = performance.now();
        // readyState 2 is HEADERS_RECEIVED — the same instant fetch()'s promise resolves at.
        let headersPerf = 0;

        const captureResponse = () => {
          const contentType = this.getResponseHeader?.('content-type') || '';

          let responseBody = '';
          let timing: ReturnType<typeof phases> | null = null;

          // `responseText` is only readable when the response type is text: any other kind throws on
          // the getter, and the throw would escape this handler and lose the capture entirely. So the
          // type is asked first, which is the only question that can be asked safely.
          const textResponse = this.responseType === '' || this.responseType === 'text';

          if (isBinaryContentType(contentType)) {
            responseBody = getBinaryResponseBody(contentType);
          } else if (textResponse) {
            responseBody = limitBody(this.responseText);
            // Only a body that was actually read has a download time to report.
            if (headersPerf) timing = phases(startedPerf, headersPerf, performance.now());
          } else if (this.responseType === 'json' && this.response != null) {
            // The parsed answer, written back out: it is the same document the server sent — the
            // browser has already thrown the original spacing away — and a row with no body at all
            // would say less than the network did.
            responseBody = limitBody(JSON.stringify(this.response));
            if (headersPerf) timing = phases(startedPerf, headersPerf, performance.now());
          }

          capture({
            method: state.method,
            url: state.url,
            requestHeaders: state.requestHeaders,
            requestBody,
            status: this.status,
            statusText: this.statusText,
            responseHeaders: parseResponseHeaders(this.getAllResponseHeaders?.() || ''),
            responseBody,
            // The duration is the round trip from the send, which is what the caller waited for; the
            // wall clock is only good enough for the moment the request left, not for measuring.
            durationMs: Math.round(performance.now() - startedPerf),
            startedAt: state.startedAt,
            ...(timing ?? {}),
          });
        };

        const captureError = () => {
          capture({
            method: state.method,
            url: state.url,
            requestHeaders: state.requestHeaders,
            requestBody,
            status: 0,
            statusText: 'network error',
            durationMs: Math.round(performance.now() - startedPerf),
            startedAt: state.startedAt,
          });
        };

        this.addEventListener('readystatechange', () => {
          if (!headersPerf && this.readyState >= 2) {
            headersPerf = performance.now();
          }
        });
        this.addEventListener('load', captureResponse, { once: true });
        this.addEventListener('error', captureError, { once: true });
      }

      return originalSend.call(this, body);
    };
  }

  installFetchHook();
  installXhrHook();
})();

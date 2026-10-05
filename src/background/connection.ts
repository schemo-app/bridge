// Link to the Schemo app through native messaging (host registered by the app).
import { ext } from '../shared/api';
import type { AppFrame, ExtensionFrame, LinkState } from '../shared/types';
import { BROWSER_NAME } from './browser';
import { refreshIndicator } from './indicator';
import { isActive, mayConnect, state } from './state';

const HOST = 'app.schemo.bridge';
const RETRY_MS = 5000;

let port: chrome.runtime.Port | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let connected = false;
let link: LinkState = 'unknown';
let onFrame: (frame: AppFrame) => void = () => {};

export function isConnected(): boolean {
  return connected;
}

export function getLinkState(): LinkState {
  return link;
}

export function setFrameHandler(handler: (frame: AppFrame) => void): void {
  onFrame = handler;
}

function hostMissing(error: string): boolean {
  return /not found|forbidden|no such native application/i.test(error);
}

function lastError(p: chrome.runtime.Port): string {
  return (
      ext.runtime.lastError?.message ||
      (p as unknown as { error?: { message?: string } }).error?.message ||
      ''
  );
}

export function connect(): void {
  clearTimeout(retryTimer);

  if (port) {
    return;
  }

  let p: chrome.runtime.Port;

  try {
    p = ext.runtime.connectNative(HOST);
  } catch {
    link = 'no-host';
    return;
  }

  port = p;

  p.onMessage.addListener((message: { type?: string }) => {
    if (port !== p) {
      return;
    }

    if (message?.type === 'unavailable') {
      link = 'no-app';
      gone(p);
      return;
    }

    if (message?.type === 'hello') {
      connected = true;
      link = 'connected';
      refreshIndicator(connected);
      sendState();
      return;
    }

    if (connected) {
      onFrame(message as AppFrame);
    }
  });

  p.onDisconnect.addListener(() => {
    if (port !== p) {
      return;
    }

    link = hostMissing(lastError(p)) ? 'no-host' : 'no-app';
    gone(p);
  });
}

function gone(p: chrome.runtime.Port): void {
  if (port === p) {
    port = null;
  }

  try {
    p.disconnect();
  } catch {}

  connected = false;
  refreshIndicator(connected);

  // The retry is the link opening itself, so it is the switch's to allow — a session a person
  // started counts as their asking, and that one is kept up.
  if (isActive() && mayConnect()) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, RETRY_MS);
  }
}

export function disconnect(): void {
  clearTimeout(retryTimer);

  const p = port;
  port = null;
  connected = false;

  try {
    p?.disconnect();
  } catch {}
}

// One-shot check for the popup that doesn't keep a connection open.
export async function probe(): Promise<boolean> {
  if (connected) {
    return true;
  }

  try {
    const answer = (await ext.runtime.sendNativeMessage(HOST, { type: 'probe' })) as {
      type?: string;
    };

    link = answer?.type === 'hello' ? 'connected' : 'no-app';
    return answer?.type === 'hello';
  } catch (err) {
    link = hostMissing(String((err as Error)?.message ?? err)) ? 'no-host' : 'no-app';
    return false;
  }
}

export function send(frame: ExtensionFrame): boolean {
  if (!connected || !port) {
    return false;
  }

  port.postMessage(frame);
  return true;
}

export function sendState(): void {
  send({
    type: 'state',
    recording: connected && state.captureTabIds.size > 0,
    paused: state.paused,
    tabs: state.captureTabIds.size,
    browser: BROWSER_NAME,
    // The extension's own version, which is what the app names it by beside the browser's name.
    version: ext.runtime.getManifest().version,
    tabList: [...state.captureTabIds]
        .filter((id) => state.captureTabSince.has(id))
        .map((id) => ({ tabId: id, since: state.captureTabSince.get(id)! })),
  });
}

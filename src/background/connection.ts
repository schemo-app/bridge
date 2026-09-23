// The socket to the desktop app on 127.0.0.1, and the buffer for what was captured while it was away.

import type { AppFrame, ExtensionFrame } from '../shared/types';
import { BROWSER_NAME } from './browser';
import { refreshIndicator } from './indicator';
import { isActive, readPort, state } from './state';

const RECONNECT_MS = 2500;
const MAX_PENDING = 200;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let pending: string[] = [];
let connected = false;
let onFrame: (frame: AppFrame) => void = () => {};

export function isConnected(): boolean {
  return connected;
}

export function isOpen(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

export function isOpenOrConnecting(): boolean {
  return isOpen() || socket?.readyState === WebSocket.CONNECTING;
}

export function bufferedCount(): number {
  return pending.length;
}

// What the app says is handled elsewhere: the connection only knows how to hear it.
export function setFrameHandler(handler: (frame: AppFrame) => void): void {
  onFrame = handler;
}

export async function isAppRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function connect(port: number): Promise<void> {
  clearTimeout(reconnectTimer);

  if (socket?.readyState === WebSocket.OPEN) {
    connected = true;
    return;
  }

  if (socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  if (socket) {
    try {
      socket.close();
    } catch {
      // Already closed.
    }

    socket = null;
  }

  connected = false;

  if (!(await isAppRunning(port))) {
    refreshIndicator(connected);
    scheduleReconnect();
    return;
  }

  let ws: WebSocket;

  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
  } catch {
    scheduleReconnect();
    return;
  }

  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) {
      return;
    }

    connected = true;
    refreshIndicator(connected);
    sendState();

    for (const message of pending.splice(0)) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  };

  ws.onclose = () => {
    if (socket !== ws) {
      return;
    }

    socket = null;
    connected = false;
    refreshIndicator(connected);
    scheduleReconnect();
  };

  ws.onerror = () => {};

  ws.onmessage = ({ data }) => {
    if (socket !== ws) {
      return;
    }

    let frame: AppFrame;

    try {
      frame = JSON.parse(String(data)) as AppFrame;
    } catch {
      return;
    }

    onFrame(frame);
  };
}

function scheduleReconnect(): void {
  clearTimeout(reconnectTimer);

  connected = false;
  refreshIndicator(connected);

  reconnectTimer = setTimeout(async () => {
    const port = await readPort();

    if (isActive()) {
      connect(port);
    }
  }, RECONNECT_MS);
}

// The buffer is deliberately left alone: it exists for exactly this moment. Frames in it were
// captured while the app was away — its window closed, another port, a socket that dropped — and the
// app is still owed them; emptying it here is what made a changed port lose everything captured so
// far. Nothing is kept forever either: the buffer has a ceiling, and the worker's memory is what it
// lives in.
export function disconnect(): void {
  clearTimeout(reconnectTimer);

  if (socket) {
    try {
      socket.close();
    } catch {
      // Already closed.
    }

    socket = null;
  }

  connected = false;
}

// Sends now if the socket is open, and returns whether it was.
export function send(frame: ExtensionFrame): boolean {
  if (socket?.readyState !== WebSocket.OPEN) {
    return false;
  }

  socket.send(JSON.stringify(frame));
  return true;
}

// Sends now, or keeps the frame for when the app is back.
export function enqueue(frame: ExtensionFrame): void {
  const message = JSON.stringify(frame);

  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(message);
    return;
  }

  pending.push(message);

  if (pending.length > MAX_PENDING) {
    pending.shift();
  }
}

export function sendState(): void {
  send({
    type: 'state',
    recording: connected && state.captureTabIds.size > 0,
    paused: state.paused,
    tabs: state.captureTabIds.size,
    browser: BROWSER_NAME,
    // The same tabs the count counts, each with the moment it was armed. A tab whose time nobody
    // knows — one restored after a restart that predates this — is left out rather than given a
    // time it never had, and the app draws it without one.
    tabList: [...state.captureTabIds]
        .filter((id) => state.captureTabSince.has(id))
        .map((id) => ({ tabId: id, since: state.captureTabSince.get(id)! })),
  });
}

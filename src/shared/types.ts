export const DEFAULT_PORT = 38761;

// The marker the page hook stamps on what it posts, so the bridge can tell its frames from the page's.
export const MESSAGE_MARKER = '__SCHEMO_CAPTURE__';

export interface Settings {
  rememberTabs: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  rememberTabs: true,
};

// The rules the app hands over. Kept here as well as in the app because the service worker is
// restarted whenever the browser feels like it, and an extension that forgot what it was told would
// start sending traffic nobody asked for. The defaults are what this extension did before the rules
// were anybody's to set: static files were skipped.
export interface CaptureFilters {
  hosts: string[];
  static: boolean;
  analytics: boolean;
  json: boolean;
}

export const DEFAULT_FILTERS: CaptureFilters = {
  hosts: [],
  static: true,
  analytics: false,
  json: false,
};

export type HeaderMap = Record<string, string>;

// One request as the page hook saw it. Timing phases are present only when the body was read.
export interface InterceptedRequest {
  method: string;
  url: string;
  requestHeaders?: HeaderMap;
  requestBody?: string;
  status: number;
  statusText?: string;
  responseHeaders?: HeaderMap;
  responseBody?: string;
  durationMs?: number;
  hasTiming?: boolean;
  waitMs?: number;
  downloadMs?: number;
  startedAt?: number;
}

// What the page hook posts on the page's window.
export interface HookMessage extends InterceptedRequest {
  __schemo: typeof MESSAGE_MARKER;
  kind: 'request';
}

// What the bridge sends on to the worker.
export interface CapturedMessage extends InterceptedRequest {
  type: 'captured';
  tabTitle: string;
  tabURL: string;
}

// ---- popup → worker --------------------------------------------------------------------------

export type PopupRequest =
  | { type: 'getState' }
  | { type: 'focusApp'; tabId?: number | null }
  | { type: 'setSetting'; key: string; value: boolean }
  | { type: 'startCapture' }
  | { type: 'stopCapture' }
  | { type: 'stopCaptureTab'; tabId: number }
  | { type: 'setPort'; port: number };

export type RuntimeMessage = PopupRequest | CapturedMessage;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface TabInfo {
  tabId: number;
  title: string;
  url: string;
  favIconUrl: string;
  count: number;
}

export interface CurrentTab extends TabInfo {
  lastAt: number;
  capturing: boolean;
}

export interface PopupState {
  ok?: undefined;
  capturing: boolean;
  activeTabId: number | null;
  port: number;
  appRunning: boolean;
  capturedTabs: TabInfo[];
  currentTab: CurrentTab | null;
  bufferedCount: number;
  settings: Settings;
  // The rules the app set. The popup shows them and cannot change them: they are decided where the
  // list they are about is read, and two places to set one rule is two places to disagree.
  filters: CaptureFilters;
  browser: string;
}

// ---- worker ↔ app (WebSocket) ----------------------------------------------------------------

export type AppFrame =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'filters'; filters: Partial<CaptureFilters> };

export interface RequestFrame extends InterceptedRequest {
  type: 'request';
  id: string;
  tabId: number;
  tabTitle: string;
  tabURL: string;
  favIconUrl: string;
}

export interface StateFrame {
  type: 'state';
  recording: boolean;
  // Whether capture is held down is ours to know: a paused capture and a connected extension with
  // nothing under it both report no tabs.
  paused: boolean;
  tabs: number;
  browser: string;
  tabList: { tabId: number; since: number }[];
}

export type ExtensionFrame =
  | RequestFrame
  | StateFrame
  | { type: 'focus'; tab: number }
  | { type: 'ping' };

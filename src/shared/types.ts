export const MESSAGE_MARKER = '__SCHEMO_CAPTURE__';

export interface Settings {
  rememberTabs: boolean;
  autoConnect: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  rememberTabs: true,
  autoConnect: false,
};

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

export interface HookMessage extends InterceptedRequest {
  __schemo: typeof MESSAGE_MARKER;
  kind: 'request';
}

export interface CapturedMessage extends InterceptedRequest {
  type: 'captured';
  tabTitle: string;
  tabURL: string;
}

export type PopupRequest =
  | { type: 'getState' }
  | { type: 'focusApp'; tabId?: number | null }
  | { type: 'setSetting'; key: string; value: boolean }
  | { type: 'startCapture' }
  | { type: 'pendingCapture'; tabId: number; pattern: string }
  | { type: 'clearPending' }
  | { type: 'setFilters'; filters: CaptureFilters }
  | { type: 'stopCapture' }
  | { type: 'stopCaptureTab'; tabId: number };

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
  paused: boolean;
}

export interface CurrentTab extends TabInfo {
  lastAt: number;
  capturing: boolean;
}

export type LinkState = 'unknown' | 'connected' | 'no-app' | 'no-host';

export interface PopupState {
  ok?: undefined;
  link: LinkState;
  capturing: boolean;
  activeTabId: number | null;
  appRunning: boolean;
  capturedTabs: TabInfo[];
  currentTab: CurrentTab | null;
  settings: Settings;
  filters: CaptureFilters;
  browser: string;
}

export type AppFrame =
  | { type: 'pause' | 'resume'; tabId?: number; browser?: string }
  | { type: 'filters'; filters: Partial<CaptureFilters> }
  | { type: 'settings'; autoConnect?: boolean; rememberTabs?: boolean };

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
  paused: boolean;
  tabs: number;
  browser: string;
  version: string;
  tabList: { tabId: number; since: number; title: string; url: string; paused: boolean }[];
}

export type ExtensionFrame =
  | RequestFrame
  | StateFrame
  | { type: 'focus'; tab: number }
  | { type: 'filters'; filters: CaptureFilters };

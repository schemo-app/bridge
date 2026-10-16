import { ext } from '../shared/api';
import {
  DEFAULT_FILTERS,
  DEFAULT_SETTINGS,
  type CaptureFilters,
  type Settings,
} from '../shared/types';

export interface CapturedTab {
  title: string;
  url: string;
  since: number;
  paused: boolean;
  count: number;
  lastAt: number;
}

export interface StoredTab {
  tabId: number;
  since: number;
  paused: boolean;
}

export const state = {
  tabs: new Map<number, CapturedTab>(),
  filters: { ...DEFAULT_FILTERS } as CaptureFilters,
  settings: { ...DEFAULT_SETTINGS } as Settings,
  // An explicit capture keeps reconnecting even when autoConnect is disabled.
  wanted: false,
};

export function isActive(): boolean {
  return state.tabs.size > 0;
}

export function mayConnect(): boolean {
  return state.settings.autoConnect || state.wanted;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  state.settings = { ...state.settings, ...patch };

  await ext.storage.local.set({ settings: state.settings });

  if (!state.settings.rememberTabs) {
    await ext.storage.local.set({ captureOrigins: [] });
  }
}

export function rememberTab(tab: chrome.tabs.Tab, saved?: StoredTab): void {
  if (tab.id === undefined) return;

  state.tabs.set(tab.id, {
    since: saved?.since ?? Date.now(),
    paused: saved?.paused ?? false,
    count: 0,
    lastAt: 0,
    ...state.tabs.get(tab.id),
    title: tab.title || '',
    url: tab.url || '',
  });
}

export async function readState(): Promise<StoredTab[]> {
  const [session, local] = await Promise.all([
    ext.storage.session.get({ captureTabs: [] }),
    ext.storage.local.get({
      settings: DEFAULT_SETTINGS,
      filters: DEFAULT_FILTERS,
    }),
  ]);

  state.settings = {
    ...DEFAULT_SETTINGS,
    ...((local.settings as Partial<Settings>) || {}),
  };

  state.filters = {
    ...DEFAULT_FILTERS,
    ...((local.filters as Partial<CaptureFilters>) || {}),
  };

  return session.captureTabs as StoredTab[];
}

export async function persistCapture(): Promise<void> {
  await ext.storage.session.set({
    captureTabs: [...state.tabs].map(([tabId, tab]) => ({ tabId, since: tab.since, paused: tab.paused })),
  });
}

export function listenForSettings(): void {
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) {
      return;
    }

    state.settings = {
      ...DEFAULT_SETTINGS,
      ...((changes.settings.newValue as Partial<Settings>) || {}),
    };
  });
}

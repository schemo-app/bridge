// What the worker knows. In memory for the drawing, and — what must survive a worker restart — in
// session and local storage.

import { ext } from '../shared/api';
import {
  DEFAULT_FILTERS,
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  type CaptureFilters,
  type Settings,
} from '../shared/types';

export interface TabMeta {
  title: string;
  url: string;
}

export const state = {
  captureTabIds: new Set<number>(),
  captureTabMeta: new Map<number, TabMeta>(),
  // When each captured tab was armed. In memory for the drawing and in session storage for the
  // restarts: a tab restored without its time is a tab nobody can say anything about, and inventing
  // one would date the capture to the restart.
  captureTabSince: new Map<number, number>(),
  capturedCounts: new Map<number, number>(),
  capturedLastAt: new Map<number, number>(),
  filters: { ...DEFAULT_FILTERS } as CaptureFilters,
  settings: { ...DEFAULT_SETTINGS } as Settings,
  pausedOrigins: [] as string[],
  paused: false,
};

export function isActive(): boolean {
  return state.captureTabIds.size > 0 || state.paused;
}

export function forgetTab(tabId: number): void {
  state.captureTabIds.delete(tabId);
  state.captureTabMeta.delete(tabId);
  state.captureTabSince.delete(tabId);
  state.capturedCounts.delete(tabId);
  state.capturedLastAt.delete(tabId);
}

export async function readState(): Promise<{ captureTabIds: number[]; port: number }> {
  const [session, local] = await Promise.all([
    ext.storage.session.get(['captureTabIds', 'captureTabSince']),
    ext.storage.local.get({
      port: DEFAULT_PORT,
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

  state.captureTabSince = new Map((session.captureTabSince as [number, number][]) ?? []);

  return {
    captureTabIds: (session.captureTabIds as number[]) ?? [],
    port: (local.port as number) || DEFAULT_PORT,
  };
}

export async function readPort(): Promise<number> {
  return (await readState()).port;
}

export async function persistCapture(): Promise<void> {
  await ext.storage.session.set({
    captureTabIds: [...state.captureTabIds],
    captureTabSince: [...state.captureTabSince],
  });
}

export function loadStoredSettings(): void {
  ext.storage.local.get(['settings', 'filters']).then(({ settings, filters }) => {
    state.settings = { ...DEFAULT_SETTINGS, ...((settings as Partial<Settings>) || {}) };
    state.filters = { ...DEFAULT_FILTERS, ...((filters as Partial<CaptureFilters>) || {}) };
  });

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

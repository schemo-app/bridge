import { ext } from '../shared/api';
import {
  DEFAULT_FILTERS,
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
  captureTabSince: new Map<number, number>(),
  capturedCounts: new Map<number, number>(),
  capturedLastAt: new Map<number, number>(),
  filters: { ...DEFAULT_FILTERS } as CaptureFilters,
  settings: { ...DEFAULT_SETTINGS } as Settings,
  pausedOrigins: [] as string[],
  paused: false,
  // Whether a person asked for the link in this browser run: capture started from the popup opens
  // it, and a link opened that way is kept up — the "connect automatically" switch is about the
  // link nobody asked for, not about dropping one that was.
  wanted: false,
};

export function isActive(): boolean {
  return state.captureTabIds.size > 0 || state.paused;
}

// Whether the extension may open the link without anybody asking: the switch says it may when both
// sides are running, and a capture a person started says it may because they did ask.
export function mayConnect(): boolean {
  return state.settings.autoConnect || state.wanted;
}

// Writes the switches down and tells the popup about them: they are read from storage when it
// opens, and a copy that only lived in memory would be a switch that flips back.
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  state.settings = { ...state.settings, ...patch };

  await ext.storage.local.set({ settings: state.settings });

  if (!state.settings.rememberTabs) {
    await ext.storage.local.set({ captureOrigins: [] });
  }
}

export function forgetTab(tabId: number): void {
  state.captureTabIds.delete(tabId);
  state.captureTabMeta.delete(tabId);
  state.captureTabSince.delete(tabId);
  state.capturedCounts.delete(tabId);
  state.capturedLastAt.delete(tabId);
}

export async function readState(): Promise<{ captureTabIds: number[] }> {
  const [session, local] = await Promise.all([
    ext.storage.session.get(['captureTabIds', 'captureTabSince']),
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

  state.captureTabSince = new Map((session.captureTabSince as [number, number][]) ?? []);

  return {
    captureTabIds: (session.captureTabIds as number[]) ?? [],
  };
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

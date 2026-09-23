// The toolbar button of each captured tab: its icon says whether capture is reaching the app, its
// title says how much has been captured.

import { ext } from '../shared/api';
import { t, tn } from '../shared/i18n';
import { state } from './state';

type IconState = 'recording' | 'disconnected' | 'normal';

function iconSet(prefix: string): Record<string, string> {
  return Object.fromEntries(
      [16, 32, 48, 128].map((size) => [String(size), `icons/${prefix}icon${size}.png`])
  );
}

const ICONS: Record<IconState, Record<string, string>> = {
  recording: iconSet(''),
  disconnected: iconSet('disconnected-'),
  normal: iconSet('off-'),
};

export const titleDisconnected = (): string => t('titleDisconnected');

export function setCaptureIcon(tabId: number, iconState: IconState): void {
  // The tab can be gone by the time this runs — a tab closed between the capture changing and the
  // badge being drawn — and the call then rejects rather than doing nothing. There is no badge to
  // fix on a tab that is not there, so the rejection is dropped where it is raised.
  ext.action.setIcon({ path: ICONS[iconState], tabId }).catch(() => {});
}

export function setCaptureTitle(tabId: number, title: string): void {
  ext.action.setTitle({ title, tabId }).catch(() => {});
}

export function captureTitleText(tabId: number): string {
  const meta = state.captureTabMeta.get(tabId);
  const label = meta?.title ? t('titleTabQuoted', [meta.title]) : t('titleTabFallback');
  const count = state.capturedCounts.get(tabId) || 0;

  return t('titleCapturing', [label, tn('requests', count)]);
}

export function refreshIndicator(connected: boolean): void {
  for (const tabId of state.captureTabIds) {
    setCaptureIcon(tabId, connected ? 'recording' : 'disconnected');
    setCaptureTitle(tabId, connected ? captureTitleText(tabId) : titleDisconnected());
  }
}

// Firefox may close the popup on the permission prompt, so the worker finishes starting capture.
import { ext } from '../shared/api';
import { sitePattern } from '../shared/sites';
import { forgetOriginsWithoutAccess, startCaptureOn, stopCaptureFor } from './capture';
import { state } from './state';

const PENDING_TTL_MS = 60_000;

interface Pending {
  tabId: number;
  pattern: string;
  at: number;
}

export async function setPendingCapture(tabId: number, pattern: string): Promise<void> {
  await ext.storage.session.set({ pendingCapture: { tabId, pattern, at: Date.now() } satisfies Pending });
}

export async function clearPendingCapture(): Promise<void> {
  await ext.storage.session.remove('pendingCapture');
}

async function takePending(): Promise<Pending | null> {
  const { pendingCapture } = (await ext.storage.session.get('pendingCapture')) as {
    pendingCapture?: Pending;
  };

  await clearPendingCapture();

  if (!pendingCapture || Date.now() - pendingCapture.at > PENDING_TTL_MS) {
    return null;
  }

  return pendingCapture;
}

// Revoking site access doesn't unload injected scripts, so capture is stopped explicitly.
async function stopWhereAccessIsGone(): Promise<void> {
  for (const tabId of [...state.tabs.keys()]) {
    let url = state.tabs.get(tabId)?.url;

    if (!url) {
      try {
        url = (await ext.tabs.get(tabId)).url;
      } catch {
        url = undefined;
      }
    }

    const pattern = sitePattern(url);

    if (!pattern || !(await ext.permissions.contains({ origins: [pattern] }))) {
      await stopCaptureFor(tabId);
    }
  }

  await forgetOriginsWithoutAccess();
}

export function listenForGrants(ready: Promise<void>): void {
  ext.permissions.onRemoved.addListener(() => {
    ready.then(stopWhereAccessIsGone).catch((err) => console.warn('[schemo] revoking capture failed:', err));
  });

  ext.permissions.onAdded.addListener(async () => {
    await ready;
    const pending = await takePending();

    if (!pending || !(await ext.permissions.contains({ origins: [pending.pattern] }))) {
      return;
    }

    try {
      await startCaptureOn(await ext.tabs.get(pending.tabId));
    } catch {}
  });
}

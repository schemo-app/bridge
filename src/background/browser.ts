// What this browser is and which of its pages the extension may not touch.

const BROWSERS: [RegExp, string][] = [
  [/Edg\/([0-9]+)/, 'Edge'],
  [/OPR\/([0-9]+)/, 'Opera'],
  [/YaBrowser\/([0-9]+)/, 'Yandex'],
  [/Firefox\/([0-9]+)/, 'Firefox'],
  [/Chrome\/([0-9]+)/, 'Chrome'],
];

// Inlined by Parcel at build time from the SCHEMO_TARGET the build script sets.
const FALLBACK_NAME: Record<string, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
};

// What the app calls this browser. The version is read once: it cannot change while the worker runs,
// and the app draws it beside the name. Chromium browsers all say "Chrome" in their user agent, so the
// ones that also say who they are are asked first.
export const BROWSER_NAME = ((): string => {
  const ua = navigator.userAgent || '';

  for (const [pattern, name] of BROWSERS) {
    const match = pattern.exec(ua);

    if (match) {
      return `${name} ${match[1]}`;
    }
  }

  return FALLBACK_NAME[process.env.SCHEMO_TARGET ?? ''] ?? 'Browser';
})();

const BLOCKED_SCHEMES = [
  'chrome:',
  'chrome-untrusted:',
  'chrome-extension:',
  'edge:',
  'devtools:',
  'about:',
  'view-source:',
  'moz-extension:',
  'resource:',
];

// Store pages: every browser keeps scripts off its own add-on gallery.
const BLOCKED_HOSTS: [string, string][] = [
  ['chromewebstore.google.com', '/'],
  ['chrome.google.com', '/webstore'],
  ['microsoftedge.microsoft.com', '/addons'],
  ['addons.mozilla.org', '/'],
];

export function isBlockedPage(url: string | undefined): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url || '');
  } catch {
    return false;
  }

  return (
      BLOCKED_SCHEMES.includes(parsed.protocol) ||
      BLOCKED_HOSTS.some(
          ([host, path]) => parsed.hostname === host && parsed.pathname.startsWith(path)
      )
  );
}

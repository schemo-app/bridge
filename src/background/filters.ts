// The rules the app set: what is worth sending on.

import { ext } from '../shared/api';
import { DEFAULT_FILTERS, type CaptureFilters, type HeaderMap, type InterceptedRequest } from '../shared/types';
import { state } from './state';

// Hosts whose requests tell somebody else what the page did. A list rather than a rule: "analytics"
// is a judgement, and a judgement belongs in a list somebody can read and disagree with.
const TRACKER_HOSTS = [
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'doubleclick.net',
  'googlesyndication.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'hotjar.com',
  'sentry.io',
  'bugsnag.com',
  'newrelic.com',
  'datadoghq.com',
  'fullstory.com',
  'smartlook.com',
  'yandex.ru',
  'mc.yandex.ru',
  'metrika.yandex.ru',
  'facebook.net',
  'connect.facebook.net',
  'clarity.ms',
  'matomo.cloud',
  'plausible.io',
  'posthog.com',
];

const ASSET_URL =
    /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|css|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg|pdf)([?#]|$)/i;

export function hostOf(url: string | undefined): string {
  try {
    return new URL(url || '').hostname;
  } catch {
    return '';
  }
}

function isTrackerHost(host: string): boolean {
  return TRACKER_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

function headerValue(headers: HeaderMap | undefined, name: string): string {
  const wanted = name.toLowerCase();

  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === wanted) {
      return String(headers![key]);
    }
  }

  return '';
}

function looksLikeAsset(message: InterceptedRequest): boolean {
  if (ASSET_URL.test(message.url || '')) {
    return true;
  }

  const accept = headerValue(message.requestHeaders, 'accept').toLowerCase();

  return accept.startsWith('image/') || accept.startsWith('font/') || accept.startsWith('text/css');
}

// A content type is all this asks: what the response *is*, not what is in it. The page's own
// placeholder for a binary body — `[binary response: image/png]` — is not JSON either, and a rule
// that kept those would keep exactly what it was meant to drop.
function answersWithJson(message: InterceptedRequest): boolean {
  return /json/i.test(headerValue(message.responseHeaders, 'content-type'));
}

// keptByFilters is the rule the app set: what is worth sending on. It runs where every captured
// request passes, before anything is counted or sent, because a filter that dropped a request after
// the app had heard about it would be a filter only of the list.
export function keptByFilters(message: InterceptedRequest, filters: CaptureFilters = state.filters): boolean {
  const host = hostOf(message.url);

  if (filters.hosts.length && !filters.hosts.includes(host)) {
    return false;
  }

  if (filters.static && looksLikeAsset(message)) {
    return false;
  }

  if (filters.analytics && isTrackerHost(host)) {
    return false;
  }

  if (filters.json && !answersWithJson(message)) {
    return false;
  }

  return true;
}

// applyFilters is the app telling this extension what to keep. Stored, so a worker restart does not
// forget it.
//
// Nothing is answered, and that is deliberate: the app answers every state frame it hears with the
// rules, so a state frame sent from here would be heard, answered with the same rules, and heard
// again — a loop with a disk write and a socket frame on every turn. The app does not need the
// answer anyway: it repeats the rules on every state frame, and this extension sends one when the
// socket opens, which is the moment it needs them.
export async function applyFilters(rules: Partial<CaptureFilters>): Promise<void> {
  state.filters = { ...DEFAULT_FILTERS, ...rules };

  await ext.storage.local.set({ filters: state.filters });
}

import { ext } from '../shared/api';
import { DEFAULT_FILTERS, type CaptureFilters, type HeaderMap, type InterceptedRequest } from '../shared/types';
import { state } from './state';

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

function answersWithJson(message: InterceptedRequest): boolean {
  return /json/i.test(headerValue(message.responseHeaders, 'content-type'));
}

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

export async function applyFilters(rules: Partial<CaptureFilters>): Promise<void> {
  state.filters = { ...DEFAULT_FILTERS, ...rules };

  await ext.storage.local.set({ filters: state.filters });
}

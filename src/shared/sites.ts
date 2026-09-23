export function sitePattern(url: string | undefined): string | null {
  let parsed: URL;

  try {
    parsed = new URL(url || '');
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  return `${parsed.protocol}//${parsed.hostname}/*`;
}

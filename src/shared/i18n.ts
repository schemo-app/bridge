// Translations come from public/_locales/<lang>/messages.json through the browser's own i18n API, which
// picks the catalogue for the browser's language and falls back to English (default_locale).
//
// That API has no plurals, so a counted phrase is stored once per plural category — `requests_one`,
// `requests_few`, … — and Intl.PluralRules picks the category. The rules are those of the catalogue
// that was actually chosen, not of the browser: a Polish browser falls back to English, and Polish rules
// would ask for forms the English catalogue does not have.

import { ext } from './api';

type En = typeof import('../../public/_locales/en/messages.json');
type Ru = typeof import('../../public/_locales/ru/messages.json');

// A key missing from either catalogue is a compile error rather than an empty label on screen.
type Assert<T extends true> = T;
export type LocalesInSync = Assert<
  [Exclude<keyof En, keyof Ru>, Exclude<keyof Ru, keyof En>] extends [never, never] ? true : false
>;

export type MessageKey = keyof En;

type PluralKey<K> = K extends `${infer Base}_other` ? Base : never;
export type PluralBase = PluralKey<MessageKey>;

export function t(key: MessageKey, substitutions: (string | number)[] = []): string {
  return ext.i18n.getMessage(key, substitutions.map(String));
}

let rules: Intl.PluralRules | null = null;

// The count in its own words: "1 request", "5 запросов".
export function tn(base: PluralBase, n: number): string {
  rules ??= new Intl.PluralRules(t('locale') || 'en');

  const category = rules.select(n);

  return (
    ext.i18n.getMessage(`${base}_${category}`, [String(n)]) || t(`${base}_other`, [n])
  );
}

// Fills the static text of a page: `data-i18n` sets the text, `data-i18n-title` and
// `data-i18n-aria-label` the attributes of the same name.
export function localizePage(root: ParentNode = document): void {
  document.documentElement.lang = t('locale');

  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }

  for (const attr of ['title', 'aria-label'] as const) {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-i18n-${attr}]`)) {
      el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`) as MessageKey));
    }
  }
}

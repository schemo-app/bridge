import { ext } from './api';

type En = typeof import('../../public/_locales/en/messages.json');
type Ru = typeof import('../../public/_locales/ru/messages.json');

// Fails typecheck when en and ru catalogues have different keys.
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

// chrome.i18n has no plurals: one key per CLDR category, picked by the catalogue's locale.
export function tn(base: PluralBase, n: number): string {
  rules ??= new Intl.PluralRules(t('locale') || 'en');

  const category = rules.select(n);

  return (
    ext.i18n.getMessage(`${base}_${category}`, [String(n)]) || t(`${base}_other`, [n])
  );
}

export function localizePage(root: ParentNode = document): void {
  document.documentElement.lang = t('locale');

  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }

  for (const attr of ['title', 'aria-label', 'placeholder'] as const) {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-i18n-${attr}]`)) {
      el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`) as MessageKey));
    }
  }
}

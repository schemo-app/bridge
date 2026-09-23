// The extension API under one name. Firefox calls it `browser` and also answers to `chrome`; Chrome
// and Edge have only `chrome`. Both return promises in Manifest V3, so the Chrome typings describe
// either — the few places where the browsers really differ are handled where they are used.
export const ext: typeof chrome =
    (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome;

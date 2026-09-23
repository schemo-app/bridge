// Firefox exposes `browser`, Chromium only `chrome`; both are promise-based in MV3.
export const ext: typeof chrome =
    (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome;

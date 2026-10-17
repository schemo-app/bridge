# Schemo Bridge

The browser extension for [Schemo](https://github.com/schemo-app/schemo).

It captures the traffic of the tabs you choose and hands it to the desktop app on the same machine.

Works in **Chrome**, **Edge** and **Firefox 142+**.

## Install

- [Chrome Web Store](https://chromewebstore.google.com/detail/dhhcdkfkobcmmhkcgmnjlanokplokkcp)
- [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/mikibdfoenbeoegoibkdmdeglbanlbbp)
- [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/schemo-bridge/)

Install [Schemo](https://github.com/schemo-app/schemo/releases) and run it once before enabling capture.

## Development requirements

- Node.js 24 (`.nvmrc`)
- pnpm 10 (`corepack enable` gives you the version pinned in `package.json`)

## Building

```sh
pnpm install
pnpm build            # dist/chrome, dist/firefox, dist/edge
pnpm build:firefox    # one browser only
pnpm zip              # build and pack artifacts/schemo-bridge-<browser>-<version>.zip + sources
pnpm check            # typecheck, build, and web-ext lint of the Firefox build
pnpm clean            # remove dist, artifacts and the Parcel cache
```

## Loading it unpacked

**Chrome / Edge**

1. Open `chrome://extensions` (`edge://extensions`) and turn on **Developer mode**.
2. **Load unpacked** → choose `dist/chrome` (`dist/edge`).

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → choose `dist/firefox/manifest.json`.

Install the application and run it once: then open the tab you want to watch and switch capture on in the popup; the browser asks for access to that site the first time. The extension connects to the app for the session on its own. Turn on **Connect automatically** in the app (Settings → Browser extension) for it to come up together with the browser and re-arm the remembered tabs.

## Releases

Push a tag such as `v1.0.1`. CI sets `package.json` from the tag before building, so browser manifests and archive names use that version. No manual version bump is required. Release tags use `vMAJOR.MINOR.PATCH` without prerelease suffixes.

## Languages

English and Russian; the extension follows the browser's language and falls back to English.

To add a language, copy `public/_locales/en` to `public/_locales/<lang>` and translate the `message` values.

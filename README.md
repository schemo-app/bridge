# Schemo Bridge

The browser extension for [Schemo](https://github.com/schemo-app/schemo).

It captures the traffic of the tabs you choose and hands it to the desktop app on the same machine.

Works in **Chrome**, **Edge** and **Firefox 142+**.

## Requirements

- Node.js 22 (`.nvmrc`)
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

Install the application and run it once: extension connects by itself.

Then open the tab you want to watch and switch capture on in the popup; the browser asks for access to that site the first time.

An unpacked build has the id `klimdljbmlanhmdjfgbilkkhpahgjmhd` in Chrome and Edge (fixed by `key` in
`manifest/chrome.json`) and `bridge@schemo.app` in Firefox. The app lets only these ids start its host;
a store assigns its own id on first publication, and that id has to be added to
`internal/infra/nativehost` in the app.

## How it is laid out

```
manifest/
  common.json      Everything the browsers agree on
  chrome.json      Chrome and Edge: background as a service worker
  firefox.json     Firefox: background as an event page, gecko id, minimum version
mergeManifest.js   Parcel reporter: common + browser manifest → dist/<browser>/manifest.json
.parcelrc          Adds the reporter to Parcel's default config
src/
  background/      The worker: socket to the app, captured tabs, filters, popup commands
  content/
    bridge.ts      Isolated world: carries captured requests to the worker
    interceptor.ts Page world: wraps fetch and XMLHttpRequest
  popup/           The toolbar popup
  shared/          Types of every message and frame, the extension API alias
public/
  _locales/<lang>/ Translations
  icons/
```

## Languages

English and Russian; the extension follows the browser's language and falls back to English.

To add a language, copy `public/_locales/en` to `public/_locales/<lang>` and translate the `message` values.

## The protocol

The extension connects through the browser's native messaging: the browser starts `schemo-host`,
a small relay shipped with the app, for this extension only, and it carries messages to the running app over a
socket in the app's data folder that only the current user can open.

The shapes are in [`src/shared/types.ts`](src/shared/types.ts) and mirror `internal/transport/extension/protocol.go` in the app — change both together.

## Releasing

Bump `version` in `package.json`, push a tag `v<version>`.
The release workflow builds and attaches the three zips and the source archive to a GitHub release.

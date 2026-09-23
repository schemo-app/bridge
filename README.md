# Schemo Bridge

The browser extension for [Schemo](https://github.com/schemo-app/schemo).

It captures the traffic of the tabs you choose and hands it to the desktop app — nothing leaves your machine.

Works in **Chrome**, **Edge** and **Firefox 140+**.

## Requirements

- Node.js 20+
- pnpm 10 (`corepack enable` gives you the version pinned in `package.json`)

## Building

```sh
pnpm install
pnpm build            # dist/chrome, dist/firefox, dist/edge
pnpm build:firefox    # one browser only
pnpm zip              # build and pack artifacts/schemo-bridge-<browser>-<version>.zip
pnpm check            # typecheck, build, and web-ext lint of the Firefox build
pnpm clean            # remove dist, artifacts and the Parcel cache
```

The bundling is Parcel's (entries are the `source` field of `package.json`), the icons are copied with
`copyfiles`, and `mergeManifest.js` — a Parcel reporter — writes the manifest after each build.

During development `pnpm dev:<browser>` rebuilds on every change; reload the extension in the browser
to pick it up. `pnpm start:firefox` opens a throwaway Firefox profile with the extension loaded.

## Loading it unpacked

**Chrome / Edge**

1. Open `chrome://extensions` (`edge://extensions`) and turn on **Developer mode**.
2. **Load unpacked** → choose `dist/chrome` (`dist/edge`).

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → choose `dist/firefox/manifest.json`.
3. If Firefox did not grant access to sites at install, the popup asks for it before the first capture.

Then open the tab you want to watch and switch capture on in the popup.
The app must be running; it listens on port `38761` by default (changeable in the popup settings).

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

The extension connects to `ws://127.0.0.1:<port>` once `GET /health` answers.

It sends `state` frames (what is being captured, which browser) and `request` frames (one per captured request),
and receives `pause`, `resume` and `filters`.

The shapes are in [`src/shared/types.ts`](src/shared/types.ts) and mirror `internal/transport/bridge/protocol.go` in the app — change both together.

## Releasing

Bump `version` in `package.json`, push a tag `v<version>`.
The release workflow builds and attaches the three zips to a GitHub release;
Upload them to the Chrome Web Store, Edge Add-ons and addons.mozilla.org.

# Schemo Bridge — Privacy Policy

_Last updated: 2026-09-23_

Schemo Bridge is a companion browser extension for the Schemo desktop app, an HTTP client.
It lets you see the network requests of a browser tab inside the app, so you can inspect and replay them.

## What the extension reads

Only on sites where **you** switch capture on, and only while it is on, the extension reads the
requests their pages make with `fetch` and `XMLHttpRequest`:

- the address, method and status of each request;
- request and response headers — these can include cookies and authorization tokens;
- request and response bodies (text only, cut at 2 MB);
- the title and address of the tab.

Capture starts on the tab you switch it on in. It also resumes on open tabs of those sites:

- after the browser restarts, if **Remember tabs** is on (turn it off in the popup's settings);
- when you resume a paused capture from the Schemo app.

It reads nothing on other sites, and nothing before you switch capture on. You can switch it off
for a tab at any time from the extension's popup.

## Where the data goes

The extension sends what it captures to the Schemo desktop app **on your own computer**, through the
browser's native messaging: the browser starts a small helper installed with application, for this
extension alone, and it passes the messages to the app. No network connection is involved. The extension
itself does not send the data anywhere else, has no servers of its own, and contains
no analytics, advertising or tracking.

In the app, captured requests become part of your request history. If you sign in to Schemo account and turn
on sync, that history — captured requests included — is synced to the Schemo server so it is available
on your other devices. There it is stored encrypted with AES-256-GCM. Without an account, or with sync
off, nothing leaves your computer.

## What the extension stores

In the browser's own extension storage: your settings, the capture filters set in the app, and the
addresses of sites where capture should resume after a browser restart (only if "Remember tabs" is on).
Captured requests are not stored: each is passed to the app at once, or dropped if the app is not running.

## What we do not do

We do not sell or transfer the data to third parties, do not use it for advertising, and do not use it
for anything other than showing your requests in the Schemo app.

## Permissions

- **Access to a site** is asked for one site at a time, when you switch capture on there. You can
  revoke it in the browser's extension settings; capture on that site then stops and the site is
  forgotten.
- **Scripting** injects the code that reads the page's requests.
- **Active tab** lets the extension work with the tab you opened the popup on.
- **Storage** keeps the settings above.
- **Alarms** reconnects to the app when it is started again.
- **Native messaging** is how the extension talks to the Schemo app on your computer.

## Contact

Questions about this policy: support@schemo.app

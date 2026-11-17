---
title: Widget
description: Embed the chat widget and control it from the host page
---

# Widget

The bot's **Install** tab generates the snippet:

```html
<script src="https://support.example.com/widget.js" data-key="pk_live_..." async></script>
```

`data-key` is the bot's public key. The loader is small; the chat bundle is fetched only when
the visitor first opens it.

## Attributes

| Attribute       | Values                    | Meaning                                                    |
| --------------- | ------------------------- | ---------------------------------------------------------- |
| `data-key`      | public key                | Required; identifies the bot                               |
| `data-position` | `right` (default), `left` | Launcher and panel side                                    |
| `data-open`     | `true`                    | Open as soon as the page loads                             |
| `data-locale`   | BCP 47 tag, e.g. `de`     | Force UI language; falls back to the browser, then English |
| `async`         | —                         | Recommended so the host page is not blocked                |

## JavaScript API

`window.AiloomChat` is available immediately after the loader runs, even before the chat
bundle has loaded. Calls are queued:

```js
AiloomChat.open();
AiloomChat.close();
const off = AiloomChat.on('message', () => console.log('new message'));
// later
off();
```

Events: `open`, `close`, `message`. `on()` returns an unsubscribe function.

```js
document.querySelector('#help')?.addEventListener('click', () => AiloomChat.open());
```

## Identifying visitors

After the host application knows its signed-in customer, attach that customer's identity to the
current widget visitor:

```js
await AiloomChat.identify({
  externalId: currentUser.id,
  email: currentUser.email,
  name: currentUser.name,
  attributes: { plan: currentUser.plan },
});
```

`identify()` is queued if the main bundle has not loaded yet. It updates only the current visitor's
contact. An `externalId` already belonging to another contact is rejected rather than merged.
Keep the identity call behind your application's authentication and authorization boundary; the
signed identity-token flow will be added before CRM synchronization is enabled for untrusted pages.

## Allowed origins

Add every host page origin to the bot's allowed origins, including scheme and port, for
example `https://shop.example.com` or `http://localhost:8090`. Origins are checked exactly;
wildcards are supported only for subdomains where the admin exposes them. A page on an
unlisted origin cannot create a session.

## Content Security Policy

If the host page sends a CSP, allow the platform origin for scripts and connections:

```text
script-src  'self' https://support.example.com;
connect-src 'self' https://support.example.com;
style-src   'self' 'unsafe-inline';
```

The widget renders inside a shadow root, so host page CSS does not leak in and widget CSS
does not leak out. The launcher is a custom element appended to `document.body`.

## Proof of work

Bots can require a proof-of-work challenge before a session is created. The widget solves it
automatically. If the bot uses challenges, set `CHALLENGE_SECRET` on the server; without it
challenge-enabled bots fail closed.

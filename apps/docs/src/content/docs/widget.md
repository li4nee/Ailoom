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
Keep the identity call behind your application's authentication and authorization boundary. The
widget visitor token is signed and workspace-bound, but it does not prove that the host-supplied
external ID belongs to the current person; only send identity data your application has verified.
Never place a workspace API key or provider credential in browser code.

## Allowed origins

Add every host page origin to the bot's allowed origins, including scheme and port, for
example `https://shop.example.com` or `http://localhost:8090`. Origins are checked exactly;
wildcards are supported only for subdomains where the admin exposes them. A page on an
unlisted origin cannot create a session.

## Welcome interactions

Admins can configure welcome cards, a horizontally scrollable card carousel, quick replies, and
one structured support form in the bot's **Interactions** tab. These appear before the visitor
sends their first message. Card destinations and images require HTTPS; optional image descriptions
let admins mark images as decorative or provide useful alternative text. Card, reply, field,
option, and text lengths are bounded by the API schema.

Quick replies send their admin-written prompt as a normal visitor message. Form submissions are
validated by the browser and sent as a plain-text visitor message through the existing conversation
endpoint. They become part of the conversation and are processed by the bot's configured AI and
support team. Do not ask for passwords, payment details, or other sensitive information. Select
fields accept only the options configured by an admin. Widget interactions do not run model-defined
actions or arbitrary URLs.

The widget uses native links, buttons, labels, and form controls with visible keyboard focus. The
cards carousel can be scrolled horizontally on touch screens or with its previous/next controls.

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

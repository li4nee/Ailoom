// SPDX-License-Identifier: AGPL-3.0-only
/* global window, document */
// The host pages are static, so the bot's public key arrives in `?key=`. Keeping the loader in
// this file (rather than an inline script) lets the strict-CSP page allow only `'self'` and the
// platform origin.
const key = new URLSearchParams(window.location.search).get('key');
if (key !== null && key !== '') {
  const script = document.createElement('script');
  script.src = 'http://localhost:18080/widget.js';
  script.async = true;
  script.dataset['key'] = key;
  document.head.append(script);
}

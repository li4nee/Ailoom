// SPDX-License-Identifier: AGPL-3.0-only

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes a string for interpolation into HTML text or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Builds an HTML fragment: every interpolation is escaped, so user data can never break out
 * of the markup. There is no "insert raw markup" escape hatch on purpose; the shell is the
 * only place that splices an already-built fragment in, and every fragment comes from here.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  for (const [index, piece] of strings.entries()) {
    out += piece;
    if (index < values.length) out += escapeHtml(String(values[index]));
  }
  return out;
}

/** Percent-encodes a query value for a link built from `PUBLIC_URL`. */
function queryValue(value: string): string {
  return encodeURIComponent(value);
}

/** The public site root without a trailing slash: `https://PUBLIC_URL.host`. */
function siteRoot(publicUrl: URL): string {
  const href = publicUrl.href;
  return href.endsWith('/') ? href.slice(0, -1) : href;
}

/** A link on the public site: `siteLink(ctx.publicUrl, '/verify-email', { token })`. */
export function siteLink(publicUrl: URL, path: string, query: Record<string, string> = {}): string {
  const search = Object.entries(query)
    .map(([key, value]) => `${queryValue(key)}=${queryValue(value)}`)
    .join('&');
  return `${siteRoot(publicUrl)}${path}${search === '' ? '' : `?${search}`}`;
}

/** Styles shared by every template. Inline CSS: email clients strip `<style>` blocks. */
export const PARA_STYLE = 'margin:0 0 16px;';
export const BUTTON_STYLE =
  'display:inline-block;background-color:#4f46e5;color:#ffffff;text-decoration:none;' +
  'padding:10px 20px;border-radius:6px;font-weight:600;margin:0 0 16px;';
export const NOTE_STYLE = 'margin:0;font-size:12px;color:#6b7280;';

const SHELL_STYLE =
  'margin:0;padding:24px;background-color:#f6f7f9;font-family:system-ui,-apple-system,' +
  'Segoe UI,Roboto,sans-serif;color:#1f2937;font-size:14px;line-height:1.6;';
const CARD_STYLE =
  'max-width:560px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e7eb;' +
  'border-radius:8px;padding:32px;';
const BRAND_STYLE = 'font-size:16px;font-weight:600;color:#111827;margin:0 0 24px;';
const FOOTER_STYLE = 'max-width:560px;margin:16px auto 0;font-size:12px;color:#6b7280;';

/** Where the email is rendered from: links point at the public site, greetings name the product. */
export interface TemplateContext {
  publicUrl: URL;
  productName: string;
}

/** A fully rendered email, ready for any `Mailer`. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Wraps a template's body in the shared email shell. `body` must come from the `html` tag;
 * the shell interpolates only the (escaped) title and the constant product name itself.
 */
export function emailDocument(ctx: TemplateContext, title: string, body: string): string {
  const root = siteLink(ctx.publicUrl, '');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    `<body style="${SHELL_STYLE}">`,
    `<div style="${CARD_STYLE}">`,
    `<p style="${BRAND_STYLE}">${escapeHtml(ctx.productName)}</p>`,
    body,
    '</div>',
    `<div style="${FOOTER_STYLE}">Sent by ${escapeHtml(ctx.productName)} · `,
    `<a href="${root}">${root}</a></div>`,
    '</body>',
    '</html>',
  ].join('');
}

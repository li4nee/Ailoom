// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { renderTemplate, type TemplateContext, type TemplateData } from '.';

const ctx: TemplateContext = {
  publicUrl: new URL('https://support.example.com'),
  productName: 'AiLoom',
};

const sampleData: TemplateData = {
  verify_email: { name: 'A', token: 'tok' },
  reset_password: { name: 'B', token: 'tok' },
  invitation: { inviterName: 'C', workspaceName: 'W', token: 'tok', role: 'agent' },
  security_alert: { name: null, reason: 'A refresh token was reused.' },
};

describe('renderTemplate', () => {
  it('escapes user data in html', () => {
    const { html } = renderTemplate(
      'invitation',
      { inviterName: '<script>x</script>', workspaceName: 'W', token: 't', role: 'agent' },
      ctx,
    );
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('builds links from PUBLIC_URL', () => {
    expect(renderTemplate('verify_email', { name: 'A', token: 'tok' }, ctx).text).toContain(
      'https://support.example.com/verify-email?token=tok',
    );
  });

  it.each(['verify_email', 'reset_password', 'invitation', 'security_alert'] as const)(
    '%s has subject, text and html',
    (name) => {
      const rendered = renderTemplate(name, sampleData[name], ctx);
      expect(rendered.subject).not.toBe('');
      expect(rendered.text).not.toBe('');
      expect(rendered.html).toContain('<html');
    },
  );

  it('rejects data that does not match the template', () => {
    expect(() => renderTemplate('verify_email', { token: 42 }, ctx)).toThrow();
    expect(() => renderTemplate('invitation', { token: 't' }, ctx)).toThrow();
  });
});

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
  spend_alert: {
    botName: 'Help',
    month: '2026-02',
    threshold: 80,
    mtdUsd: '8.000000',
    capUsd: '10.00',
    topContacts: [{ contact: 'big@example.com', conversations: 2, costUsd: '2.000000' }],
  },
  handoff_requested: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    conversationId: '00000000-0000-4000-8000-000000000002',
    botName: 'Help',
    reason: 'visitor_request',
    contactEmail: 'visitor@example.com',
    lastMessage: 'I need a person.',
  },
  agent_reply: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    conversationId: '00000000-0000-4000-8000-000000000002',
    botName: 'Help',
    messages: [
      { authorName: 'Alex', content: 'I can help.', createdAt: '2026-11-15T10:00:00.000Z' },
    ],
  },
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

  it.each([
    'verify_email',
    'reset_password',
    'invitation',
    'security_alert',
    'spend_alert',
    'handoff_requested',
    'agent_reply',
  ] as const)('%s has subject, text and html', (name) => {
    const rendered = renderTemplate(name, sampleData[name], ctx);
    expect(rendered.subject).not.toBe('');
    expect(rendered.text).not.toBe('');
    expect(rendered.html).toContain('<html');
  });

  it('rejects data that does not match the template', () => {
    expect(() => renderTemplate('verify_email', { token: 42 }, ctx)).toThrow();
    expect(() => renderTemplate('invitation', { token: 't' }, ctx)).toThrow();
  });
});

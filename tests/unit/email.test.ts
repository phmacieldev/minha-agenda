import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmail, verificationEmailHtml, resetPasswordEmailHtml } from '../../lib/email';

describe('email templates', () => {
  it('verificationEmailHtml escapes a malicious name instead of injecting markup', () => {
    const html = verificationEmailHtml('<img src=x onerror=alert(1)>', 'https://example.com/verify');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('resetPasswordEmailHtml escapes a malicious name instead of injecting markup', () => {
    const html = resetPasswordEmailHtml('"><script>alert(1)</script>', 'https://example.com/reset');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('verificationEmailHtml keeps a normal name readable', () => {
    const html = verificationEmailHtml('Ana Souza', 'https://example.com/verify');
    expect(html).toContain('Ana Souza');
    expect(html).toContain('https://example.com/verify');
  });
});

describe('sendEmail', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('does not throw and does not call fetch when RESEND_API_KEY is unset (local dev)', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    await expect(sendEmail({ to: 'a@b.com', subject: 'Oi', html: '<p>Oi</p>' })).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the Resend API with the right payload when a key is configured', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchSpy as unknown as typeof fetch;
    await sendEmail({ to: 'a@b.com', subject: 'Oi', html: '<p>Oi</p>' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body).toMatchObject({ to: 'a@b.com', subject: 'Oi', html: '<p>Oi</p>' });
  });
});

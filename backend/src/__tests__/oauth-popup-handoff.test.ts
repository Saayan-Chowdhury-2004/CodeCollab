import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app.ts';

describe('OAuth popup handoff', () => {
  const app = createApp();

  it('1. start and callback pages do not force a browsing-context-group switch', async () => {
    const callback = await request(app)
      .get('/api/auth/github/callback')
      .query({ error: 'access_denied' });
    expect(callback.headers['cross-origin-opener-policy']).toBe('unsafe-none');

    const start = await request(app)
      .get('/api/auth/github/start')
      .query({ origin: 'https://attacker.evil.com' });
    expect(start.headers['cross-origin-opener-policy']).toBe('unsafe-none');
  });

  it('2. all other API responses keep the strict app-wide COOP', async () => {
    const res = await request(app).get('/api/auth/providers');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
  });

  it('3. popup page still ships the external script with the allow-listed postMessage target', async () => {
    const res = await request(app)
      .get('/api/auth/github/callback')
      .query({ error: 'access_denied' });
    expect(res.text).toContain('<script src="/api/auth/oauth-popup.js"></script>');
    expect(res.text).toContain('"targetOrigin"');
  });

  it('4. popup script posts to the opener with a strict target origin and has a same-origin fallback', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../auth/oauth-popup.js'),
      'utf8'
    );
    expect(src).toContain('window.opener.postMessage(msg, targetOrigin)');
    expect(src).not.toContain("postMessage(msg, '*')");
    expect(src).toContain("new BroadcastChannel('codecollab-oauth')");
  });
});

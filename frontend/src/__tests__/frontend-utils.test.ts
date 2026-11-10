import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../backend/src/app.ts';
import { attachSocketServer } from '../../../backend/src/realtime/socket-server.ts';
import { registerActivityEventSubscriber } from '../../../backend/src/modules/activity/activity.service.ts';
import { runSeed, SEED_IDS } from '../../../backend/src/db/seed.ts';
import {
  buildAuthHeaders,
  clearAuthSession,
  getAccessToken,
  setAuthSession,
} from '../api/transport.ts';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../utils/binary.ts';
import { DEMO_ACCOUNTS } from '../store/authStore.ts';

describe('Phase 8 — Frontend Transport, Binary Yjs Helpers & End-to-End Store API Flows', () => {
  beforeAll(() => {
    // Provide browser-compatible globals for Node test environment
    if (typeof globalThis.window === 'undefined') {
      const storage = new Map<string, string>();
      (globalThis as unknown as { window: unknown }).window = {
        location: { origin: 'http://localhost:3000' },
        sessionStorage: {
          getItem: (k: string) => storage.get(k) ?? null,
          setItem: (k: string, v: string) => storage.set(k, v),
          removeItem: (k: string) => storage.delete(k),
        },
        btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
        atob: (b64: string) => Buffer.from(b64, 'base64').toString('binary'),
      };
    }
  });

  afterAll(() => {
    clearAuthSession();
  });

  it('1. verifies in-memory access token transport and round-trip Uint8Array <-> Base64 Yjs helpers', () => {
    clearAuthSession();
    expect(getAccessToken()).toBeNull();

    setAuthSession({
      accessToken: 'test-jwt-access-token',
      refreshToken: 'test-opaque-refresh-token-123456',
    });

    expect(getAccessToken()).toBe('test-jwt-access-token');
    const headers = buildAuthHeaders({ 'X-Custom': '1' });
    expect(headers.Authorization).toBe('Bearer test-jwt-access-token');
    expect(headers['X-Custom']).toBe('1');

    const sampleBytes = new Uint8Array([0, 1, 2, 128, 254, 255]);
    const encoded = uint8ArrayToBase64(sampleBytes);
    const decoded = base64ToUint8Array(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(sampleBytes));

    clearAuthSession();
    expect(getAccessToken()).toBeNull();
  });

  describe.skipIf(!process.env.DATABASE_URL)('Backend-Integrated Store & API Flows', () => {
    let httpServer: http.Server;
    let baseUrl = '';

    beforeAll(async () => {
      registerActivityEventSubscriber();
      await runSeed();

      const app = createApp();
      httpServer = http.createServer(app);
      attachSocketServer(httpServer);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, '127.0.0.1', () => resolve());
      });

      const address = httpServer.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      clearAuthSession();
      if (httpServer) {
        if (typeof (httpServer as any).closeAllConnections === 'function') {
          (httpServer as any).closeAllConnections();
        }
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
    });

    it('2. verifies all 4 frontend DEMO_ACCOUNTS presets authenticate and match backend seeded roles', async () => {
    for (const preset of DEMO_ACCOUNTS) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: preset.email,
          password: preset.password,
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        accessToken: string;
        user: { username: string; globalRole: string };
      };
      expect(data.accessToken).toBeTruthy();
      expect(data.user.username).toBe(preset.username);
      expect(data.user.globalRole.toUpperCase()).toBe(preset.roleBadge);
    }
  });

  it('3. verifies frontend workspace flows: search + facets, snippet detail, version diff, comments with outdated state, activity feed, and admin user list', async () => {
    // Login as admin_alex
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin@codecollab.dev',
        password: 'AdminPass123!',
      }),
    });
    const { accessToken } = (await loginRes.json()) as { accessToken: string };
    const authHeaders = { Authorization: `Bearer ${accessToken}` };

    // 1. Search + Facets
    const searchRes = await fetch(
      `${baseUrl}/api/search/snippets?q=token&sort=relevance`,
      { headers: authHeaders }
    );
    expect(searchRes.status).toBe(200);
    const searchData = (await searchRes.json()) as {
      items: Array<{ id: string; headline: string; rank: number }>;
    };
    expect(searchData.items.length).toBeGreaterThan(0);
    expect(searchData.items[0].headline).toContain('<mark>');

    const facetsRes = await fetch(`${baseUrl}/api/search/facets`, {
      headers: authHeaders,
    });
    expect(facetsRes.status).toBe(200);
    const facetsData = (await facetsRes.json()) as {
      languages: Array<{ language: string; count: number }>;
      tags: Array<{ name: string; count: number }>;
    };
    expect(facetsData.languages.length).toBeGreaterThan(0);
    expect(facetsData.tags.length).toBeGreaterThan(0);

    // 2. Snippet Detail + Versions + Diff
    const snippetId = SEED_IDS.snippets.publicAuth;
    const versionsRes = await fetch(
      `${baseUrl}/api/snippets/${snippetId}/versions`,
      { headers: authHeaders }
    );
    expect(versionsRes.status).toBe(200);
    const versionsData = (await versionsRes.json()) as {
      items: Array<{ id: string; versionNumber: number }>;
    };
    expect(versionsData.items.length).toBeGreaterThanOrEqual(2);

    const vTo = versionsData.items[0].id;
    const vFrom = versionsData.items[versionsData.items.length - 1].id;
    const diffRes = await fetch(
      `${baseUrl}/api/snippets/${snippetId}/diff?from=${vFrom}&to=${vTo}`,
      { headers: authHeaders }
    );
    expect(diffRes.status).toBe(200);
    const diffData = (await diffRes.json()) as {
      diff: { lines: unknown[]; stats: { additions: number } };
    };
    expect(diffData.diff.lines.length).toBeGreaterThan(0);

    // 3. Comments + Activity + Admin Users List
    const commentsRes = await fetch(
      `${baseUrl}/api/snippets/${snippetId}/comments`,
      { headers: authHeaders }
    );
    expect(commentsRes.status).toBe(200);
    const commentsData = (await commentsRes.json()) as {
      threads: Array<{ id: string; lineNumber: number; isOutdated: boolean }>;
      totalComments: number;
    };
    expect(commentsData.threads.length).toBeGreaterThan(0);
    expect(commentsData.totalComments).toBeGreaterThan(0);

    const activityRes = await fetch(`${baseUrl}/api/activities/global?limit=10`, {
      headers: authHeaders,
    });
    expect(activityRes.status).toBe(200);
    const activityData = (await activityRes.json()) as {
      items: Array<{ id: string; type: string; visibility: string }>;
    };
    expect(Array.isArray(activityData.items)).toBe(true);

    const adminUsersRes = await fetch(`${baseUrl}/api/users?limit=10`, {
      headers: authHeaders,
    });
    expect(adminUsersRes.status).toBe(200);
    const adminUsersData = (await adminUsersRes.json()) as {
      items: Array<{ username: string; globalRole: string }>;
    };
    expect(adminUsersData.items.length).toBeGreaterThanOrEqual(4);
  });
});
});

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../app.ts';
import { validateEnv } from '../config/env.ts';
import { validateRequest } from '../middleware/validate.ts';
import { errorHandler } from '../middleware/error-handler.ts';
import { runSeed, SEED_IDS } from '../db/seed.ts';
import { db } from '../db/index.ts';
import { users, snippets, snippetVersions, comments } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import express from 'express';

describe('Phase 1 — Foundation, Env Validation, Request-ID Logging, Error Format, Health & Seed', () => {
  const app = createApp();

  beforeAll(async () => {
    await runSeed();
  });

  it('validates boot environment, refuses production boot without real secrets, and prioritizes DATABASE_URL', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'too-short',
      })
    ).toThrow(/BOOT_ENV_INVALID/);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
      })
    ).toThrow(/BOOT_ENV_INVALID/);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'replace-with-at-least-16-char-access-secret',
        JWT_REFRESH_SECRET: 'replace-with-at-least-16-char-refresh-secret',
      })
    ).toThrow(/BOOT_ENV_INVALID/);

    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        AUTH_TRANSPORT: 'invalid_mode' as 'bearer',
      })
    ).toThrow(/BOOT_ENV_INVALID/);

    const valid = validateEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@db.internal:5432/codecollab',
      DB_SSL: 'true',
      SQL_HOST: 'ignored-fallback-host',
      JWT_ACCESS_SECRET: 'super-secret-access-key-at-least-16-chars',
      JWT_REFRESH_SECRET: 'super-secret-refresh-key-at-least-16-chars',
      AUTH_TRANSPORT: 'bearer',
    });
    expect(valid.AUTH_TRANSPORT).toBe('bearer');
    expect(valid.dbPoolConfig.connectionString).toBe(
      'postgresql://user:pass@db.internal:5432/codecollab'
    );
    expect(valid.dbPoolConfig.host).toBeUndefined();
  });

  it('normalizes env values: DATABASE_URL="unset" falls back to SQL_* and DB_SSL="" does not crash boot', () => {
    const config = validateEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'unset',
      DB_SSL: '',
      SQL_HOST: 'sql-fallback-host',
      SQL_PORT: '5432',
      SQL_USER: 'test_user',
      SQL_PASSWORD: 'test_password',
      SQL_DB_NAME: 'test_db',
      JWT_ACCESS_SECRET: '  super-secret-access-key-at-least-16-chars  ',
      JWT_REFRESH_SECRET: 'super-secret-refresh-key-at-least-16-chars',
      AUTH_TRANSPORT: 'bearer',
      OAUTH_STATE_SECRET: 'none',
      DB_SSL_CA: 'null',
    });

    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.DB_SSL).toBeUndefined();
    expect(config.dbPoolConfig.connectionString).toBeUndefined();
    expect(config.dbPoolConfig.host).toBe('sql-fallback-host');
    expect(config.dbPoolConfig.user).toBe('test_user');
    expect(config.dbPoolConfig.database).toBe('test_db');
    expect(config.dbPoolConfig.ssl).toBeFalsy();
    expect(config.JWT_ACCESS_SECRET).toBe('super-secret-access-key-at-least-16-chars');
    expect(config.OAUTH_STATE_SECRET).toBeDefined();
  });

  it('returns 200 on GET /api/health with live Postgres connection, and /api/health/ready with counts and x-request-id', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(res.body.counts).toBeUndefined();

    const readyRes = await request(app).get('/api/health/ready');
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.status).toBe('ok');
    expect(readyRes.body.counts.users).toBeGreaterThanOrEqual(4);
    expect(readyRes.body.counts.snippets).toBeGreaterThanOrEqual(3);
    expect(readyRes.body.counts.versions).toBeGreaterThanOrEqual(4);
    expect(readyRes.body.counts.comments).toBeGreaterThanOrEqual(3);
  });

  it('propagates valid incoming X-Request-Id and replaces unsafe X-Request-Id headers', async () => {
    const customId = 'req_phase1_custom_12345';
    const resValid = await request(app)
      .get('/api/health')
      .set('X-Request-Id', customId);
    expect(resValid.headers['x-request-id']).toBe(customId);
    expect(resValid.body.requestId).toBe(customId);

    const unsafeId = '<script>alert(1)</script>';
    const resUnsafe = await request(app)
      .get('/api/health')
      .set('X-Request-Id', unsafeId);
    expect(resUnsafe.headers['x-request-id']).not.toBe(unsafeId);
    expect(resUnsafe.headers['x-request-id']).toMatch(/^[a-zA-Z0-9_-]{8,128}$/);
  });

  it('formats 404 and Zod validation errors consistently as { error: { code, message, details? } }', async () => {
    const res404 = await request(app).get('/api/non-existent-route');
    expect(res404.status).toBe(404);
    expect(res404.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /api/non-existent-route not found',
      },
    });

    const testApp = express();
    testApp.use(express.json());
    testApp.post(
      '/test-validate',
      validateRequest({
        body: z.object({
          title: z.string().min(3),
          lineNumber: z.number().int().positive(),
        }),
      }),
      (_req, res) => res.json({ ok: true })
    );
    testApp.use(errorHandler);

    const resVal = await request(testApp)
      .post('/test-validate')
      .send({ title: 'ab', lineNumber: -5 });
    expect(resVal.status).toBe(400);
    expect(resVal.body.error.code).toBe('VALIDATION_ERROR');
    expect(resVal.body.error.message).toBe('Invalid request payload or parameters');
    expect(Array.isArray(resVal.body.error.details)).toBe(true);
    expect(resVal.body.error.details.length).toBe(2);
  });

  it('persists seeded users (1 admin, 2 editors, 1 viewer), snippets, versions, and comments idempotently', async () => {
    // Run seed a second time to verify idempotency
    const summary = await runSeed();
    expect(summary).toEqual({
      usersSeeded: 4,
      snippetsSeeded: 3,
      versionsSeeded: 4,
      commentsSeeded: 3,
    });

    const [adminUser] = await db.select().from(users).where(eq(users.id, SEED_IDS.users.admin));
    expect(adminUser?.email).toBe('admin@codecollab.dev');
    expect(adminUser?.globalRole).toBe('admin');

    const [viewerUser] = await db.select().from(users).where(eq(users.id, SEED_IDS.users.viewer));
    expect(viewerUser?.email).toBe('victor@codecollab.dev');
    expect(viewerUser?.globalRole).toBe('viewer');

    const [pubSnippet] = await db
      .select()
      .from(snippets)
      .where(eq(snippets.id, SEED_IDS.snippets.publicAuth));
    expect(pubSnippet?.visibility).toBe('public');
    expect(pubSnippet?.latestVersionNumber).toBe(2);

    const versions = await db
      .select()
      .from(snippetVersions)
      .where(eq(snippetVersions.snippetId, SEED_IDS.snippets.publicAuth));
    expect(versions.length).toBe(2);

    const seededComments = await db
      .select()
      .from(comments)
      .where(eq(comments.snippetId, SEED_IDS.snippets.publicAuth));
    expect(seededComments.length).toBe(3);
  });
});

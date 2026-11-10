import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.ts';
import { runSeed, SEED_IDS } from '../db/seed.ts';

describe('Phase 3 — Snippet CRUD, Visibility, Collaborators, Tags, Versions, Restore & Diff', () => {
  const app = createApp();

  let adminToken = '';
  let elenaToken = ''; // Editor 1
  let marcusToken = ''; // Editor 2
  let victorToken = ''; // Global Viewer
  let createdPrivateSnippetId = '';
  let initialVersionId = '';

  beforeAll(async () => {
    await runSeed();

    const [adminRes, elenaRes, marcusRes, victorRes] = await Promise.all([
      request(app).post('/api/auth/login').send({
        identifier: 'admin@codecollab.dev',
        password: 'AdminPass123!',
      }),
      request(app).post('/api/auth/login').send({
        identifier: 'elena@codecollab.dev',
        password: 'EditorPass123!',
      }),
      request(app).post('/api/auth/login').send({
        identifier: 'marcus@codecollab.dev',
        password: 'EditorPass123!',
      }),
      request(app).post('/api/auth/login').send({
        identifier: 'victor@codecollab.dev',
        password: 'ViewerPass123!',
      }),
    ]);

    adminToken = adminRes.body.accessToken;
    elenaToken = elenaRes.body.accessToken;
    marcusToken = marcusRes.body.accessToken;
    victorToken = victorRes.body.accessToken;
  });

  it('allows global editor to create a snippet with initial version and tags, and blocks global viewer from creating snippets', async () => {
    // 1. Global viewer ('victor_read') is blocked from creating snippets (403 FORBIDDEN)
    const viewerCreate = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${victorToken}`)
      .send({
        title: 'Viewer Attempted Snippet',
        language: 'typescript',
        visibility: 'public',
        content: 'const x = 1;',
      });
    expect(viewerCreate.status).toBe(403);
    expect(viewerCreate.body.error.code).toBe('FORBIDDEN');

    // 2. Editor ('elena_dev') creates a private snippet with tags
    const v1Content = [
      'export function calculateRateLimit(tokens: number, max: number): boolean {',
      '  return tokens <= max;',
      '}',
    ].join('\n');

    const createRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Token Bucket Rate Limiter',
        description: 'Sliding window & token bucket helper',
        language: 'TypeScript',
        visibility: 'private',
        content: v1Content,
        tags: ['TypeScript', 'Rate-Limit', 'Security'],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.snippet.title).toBe('Token Bucket Rate Limiter');
    expect(createRes.body.snippet.language).toBe('typescript');
    expect(createRes.body.snippet.visibility).toBe('private');
    expect(createRes.body.snippet.latestVersionNumber).toBe(1);
    expect(createRes.body.snippet.effectiveRole).toBe('owner');
    expect(createRes.body.snippet.tags).toEqual(
      expect.arrayContaining(['typescript', 'rate-limit', 'security'])
    );

    createdPrivateSnippetId = createRes.body.snippet.id;
    initialVersionId = createRes.body.snippet.currentVersionId;
    expect(initialVersionId).toBeTruthy();
  });

  it('enforces public, unlisted, and private visibility rules for anonymous and non-collaborator users', async () => {
    // 1. Anonymous user can list only public snippets (unlisted & private excluded from discovery list)
    const anonList = await request(app).get('/api/snippets');
    expect(anonList.status).toBe(200);
    expect(anonList.body.items.every((s: { visibility: string }) => s.visibility === 'public')).toBe(
      true
    );

    // 2. Anonymous user CAN read an unlisted snippet by direct ID ('anonymous_viewer')
    const anonUnlistedRead = await request(app).get(
      `/api/snippets/${SEED_IDS.snippets.unlistedPool}`
    );
    expect(anonUnlistedRead.status).toBe(200);
    expect(anonUnlistedRead.body.snippet.visibility).toBe('unlisted');
    expect(anonUnlistedRead.body.snippet.effectiveRole).toBe('anonymous_viewer');

    // 3. Anonymous user CANNOT read a private snippet (401 UNAUTHORIZED)
    const anonPrivateRead = await request(app).get(`/api/snippets/${createdPrivateSnippetId}`);
    expect(anonPrivateRead.status).toBe(401);

    // 4. Non-collaborator editor ('marcus_code') CANNOT read Elena's private snippet (403 FORBIDDEN)
    const marcusPrivateRead = await request(app)
      .get(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${marcusToken}`);
    expect(marcusPrivateRead.status).toBe(403);
    expect(marcusPrivateRead.body.error.code).toBe('FORBIDDEN');

    // 5. Global admin ('admin_alex') CAN read any private snippet ('admin')
    const adminPrivateRead = await request(app)
      .get(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminPrivateRead.status).toBe(200);
    expect(adminPrivateRead.body.snippet.effectiveRole).toBe('admin');
  });

  it('manages collaborators and enforces per-snippet editor vs viewer permissions', async () => {
    // 1. Owner ('elena_dev') adds 'marcus_code' as 'editor' collaborator and 'victor_read' as 'viewer' collaborator
    const addMarcusRes = await request(app)
      .post(`/api/snippets/${createdPrivateSnippetId}/collaborators`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        username: 'marcus_code',
        role: 'editor',
      });
    expect(addMarcusRes.status).toBe(201);
    expect(addMarcusRes.body.collaborator.role).toBe('editor');

    const addVictorRes = await request(app)
      .post(`/api/snippets/${createdPrivateSnippetId}/collaborators`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        username: 'victor_read',
        role: 'viewer',
      });
    expect(addVictorRes.status).toBe(201);
    expect(addVictorRes.body.collaborator.role).toBe('viewer');

    // 2. Victor ('viewer' collaborator) can now read the private snippet, but collaborator emails are hidden from non-owner/non-admin
    const victorRead = await request(app)
      .get(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${victorToken}`);
    expect(victorRead.status).toBe(200);
    expect(victorRead.body.snippet.effectiveRole).toBe('viewer');
    expect(
      victorRead.body.snippet.collaborators.every(
        (c: { email: string | null }) => c.email === null
      )
    ).toBe(true);

    // Owner ('elena_dev') CAN see collaborator emails
    const ownerRead = await request(app)
      .get(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(ownerRead.status).toBe(200);
    expect(
      ownerRead.body.snippet.collaborators.every(
        (c: { email: string | null }) => typeof c.email === 'string' && c.email.includes('@')
      )
    ).toBe(true);

    // 3. Victor ('viewer' collaborator) CANNOT edit the snippet or create a version snapshot (403 FORBIDDEN)
    const victorEditAttempt = await request(app)
      .patch(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${victorToken}`)
      .send({ content: 'hacked();' });
    expect(victorEditAttempt.status).toBe(403);

    const victorVersionAttempt = await request(app)
      .post(`/api/snippets/${createdPrivateSnippetId}/versions`)
      .set('Authorization', `Bearer ${victorToken}`)
      .send({ summary: 'Viewer snapshot attempt' });
    expect(victorVersionAttempt.status).toBe(403);

    // 4. Marcus ('editor' collaborator) CAN edit content (which creates version 2),
    //    but CANNOT change visibility, manage collaborators, or delete the snippet!
    const marcusVisibilityAttempt = await request(app)
      .patch(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${marcusToken}`)
      .send({ visibility: 'public' });
    expect(marcusVisibilityAttempt.status).toBe(403);

    const marcusDeleteAttempt = await request(app)
      .delete(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${marcusToken}`);
    expect(marcusDeleteAttempt.status).toBe(403);

    const v2Content = [
      'export function calculateRateLimit(tokens: number, max: number): boolean {',
      '  if (max <= 0) throw new Error("max must be positive");',
      '  return tokens <= max;',
      '}',
    ].join('\n');

    const marcusEditRes = await request(app)
      .patch(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${marcusToken}`)
      .send({
        content: v2Content,
        versionSummary: 'Add guard for non-positive max limit',
      });
    expect(marcusEditRes.status).toBe(200);
    expect(marcusEditRes.body.snippet.latestVersionNumber).toBe(2);
    expect(marcusEditRes.body.snippet.currentContent).toBe(v2Content);
  });

  it('creates explicit version snapshots, computes structured line diffs between two versions, and restores historical versions', async () => {
    // 1. Explicitly create v3 snapshot
    const v3Content = [
      'export function calculateRateLimit(tokens: number, max: number): boolean {',
      '  if (max <= 0) throw new Error("max must be positive");',
      '  const remaining = max - tokens;',
      '  return remaining >= 0;',
      '}',
    ].join('\n');

    const createV3Res = await request(app)
      .post(`/api/snippets/${createdPrivateSnippetId}/versions`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        content: v3Content,
        summary: 'Compute explicit remaining token balance',
      });
    expect(createV3Res.status).toBe(201);
    expect(createV3Res.body.version.versionNumber).toBe(3);
    const v3Id = createV3Res.body.version.id;

    // 2. List versions with cursor pagination
    const versionsPage1 = await request(app)
      .get(`/api/snippets/${createdPrivateSnippetId}/versions?limit=2`)
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(versionsPage1.status).toBe(200);
    expect(versionsPage1.body.items.length).toBe(2);
    expect(versionsPage1.body.items[0].versionNumber).toBe(3);
    expect(versionsPage1.body.items[1].versionNumber).toBe(2);
    expect(versionsPage1.body.hasMore).toBe(true);

    // 3. Compute diff between v1 (initialVersionId) and v3 (v3Id)
    const diffRes = await request(app)
      .get(
        `/api/snippets/${createdPrivateSnippetId}/diff?from=${initialVersionId}&to=${v3Id}`
      )
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(diffRes.status).toBe(200);
    expect(diffRes.body.diff.fromVersion.versionNumber).toBe(1);
    expect(diffRes.body.diff.toVersion.versionNumber).toBe(3);
    expect(diffRes.body.diff.stats.additions).toBeGreaterThanOrEqual(3);
    expect(diffRes.body.diff.stats.deletions).toBeGreaterThanOrEqual(1);
    expect(
      diffRes.body.diff.lines.some(
        (l: { type: string; content: string }) =>
          l.type === 'added' && l.content.includes('const remaining = max - tokens;')
      )
    ).toBe(true);

    // 4. Restore to v1 -> creates v4 with v1's content and source='restore'
    const restoreRes = await request(app)
      .post(`/api/snippets/${createdPrivateSnippetId}/versions/${initialVersionId}/restore`)
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.restoredVersion.versionNumber).toBe(4);
    expect(restoreRes.body.restoredVersion.source).toBe('restore');
    expect(restoreRes.body.snippet.latestVersionNumber).toBe(4);
    expect(restoreRes.body.snippet.currentContent).toContain('return tokens <= max;');
    expect(restoreRes.body.snippet.currentContent).not.toContain('const remaining');

    // 5. Owner deletes the test snippet
    const delRes = await request(app)
      .delete(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.status).toBe('deleted');

    const verifyGone = await request(app)
      .get(`/api/snippets/${createdPrivateSnippetId}`)
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(verifyGone.status).toBe(404);
  });
});

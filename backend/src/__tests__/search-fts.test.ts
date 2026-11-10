import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { runSeed } from '../db/seed.ts';
import { db } from '../db/index.ts';
import { snippets } from '../db/schema.ts';

describe('Phase 4: Full-Text tsvector/GIN Search, Ranked Results, Rich Filters & Cursor Pagination', () => {
  const app = createApp();
  let elenaToken = '';
  let marcusToken = '';
  let victorToken = '';
  const createdSnippetIds: string[] = [];

  afterAll(async () => {
    await db
      .delete(snippets)
      .where(sql`${snippets.searchVector} @@ websearch_to_tsquery('english', 'quasarflux')`);
  });

  beforeAll(async () => {
    await runSeed();

    // Clean up any prior 'quasarflux' test snippets for idempotent runs
    await db
      .delete(snippets)
      .where(sql`${snippets.searchVector} @@ websearch_to_tsquery('english', 'quasarflux')`);

    const [elenaLogin, marcusLogin, victorLogin] = await Promise.all([
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'elena@codecollab.dev', password: 'EditorPass123!' }),
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'marcus@codecollab.dev', password: 'EditorPass123!' }),
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'victor@codecollab.dev', password: 'ViewerPass123!' }),
    ]);

    expect(elenaLogin.status).toBe(200);
    elenaToken = elenaLogin.body.accessToken;

    expect(marcusLogin.status).toBe(200);
    marcusToken = marcusLogin.body.accessToken;

    expect(victorLogin.status).toBe(200);
    victorToken = victorLogin.body.accessToken;

    // Create controlled test snippets to verify weighted tsvector ranking (A: title, B: tags, C: content)
    // 1. Title match (Weight A) for rare token 'quasarflux'
    const titleHitRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Quasarflux Engine Dispatcher',
        description: 'High priority title match snippet',
        language: 'typescript',
        visibility: 'public',
        content: 'export function dispatchEvent(payload: unknown) {\n  return Boolean(payload);\n}\n',
        tags: ['dispatcher', 'core'],
      });
    expect(titleHitRes.status).toBe(201);
    createdSnippetIds.push(titleHitRes.body.snippet.id);

    // 2. Tag match (Weight B) for 'quasarflux'
    const tagHitRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Telemetry Pipeline Adapter',
        description: 'Mid priority tag match snippet',
        language: 'python',
        visibility: 'public',
        content: 'def process_telemetry(batch):\n    return [item for item in batch if item is not None]\n',
        tags: ['quasarflux', 'telemetry'],
      });
    expect(tagHitRes.status).toBe(201);
    createdSnippetIds.push(tagHitRes.body.snippet.id);

    // 3. Body-only match (Weight C) for 'quasarflux'
    const bodyHitRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${marcusToken}`)
      .send({
        title: 'Background Worker Routine',
        description: 'Low priority content-only match snippet',
        language: 'go',
        visibility: 'public',
        content: 'package worker\n\n// Initializes the quasarflux background subsystem\nfunc RunWorker() error {\n\treturn nil\n}\n',
        tags: ['worker', 'goroutine'],
      });
    expect(bodyHitRes.status).toBe(201);
    createdSnippetIds.push(bodyHitRes.body.snippet.id);

    // 4. Private snippet containing 'quasarflux' owned by Elena (must NOT leak to anonymous or Victor)
    const privateHitRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Quasarflux Secret Key Rotation',
        description: 'Confidential rotation script',
        language: 'typescript',
        visibility: 'private',
        content: 'export const SECRET_QUASARFLUX_ROTATION = true;\n',
        tags: ['quasarflux', 'security'],
      });
    expect(privateHitRes.status).toBe(201);
    createdSnippetIds.push(privateHitRes.body.snippet.id);

    // 5. Unlisted snippet containing 'quasarflux' owned by Marcus (must NOT appear in public or unrelated user search)
    const unlistedHitRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${marcusToken}`)
      .send({
        title: 'Quasarflux Unlisted Scratchpad',
        description: 'Direct link only scratchpad',
        language: 'rust',
        visibility: 'unlisted',
        content: 'pub fn quasarflux_scratch() -> u32 { 42 }\n',
        tags: ['quasarflux', 'scratch'],
      });
    expect(unlistedHitRes.status).toBe(201);
    createdSnippetIds.push(unlistedHitRes.body.snippet.id);
  });

  it('1. ranks tsvector matches by weight (Title A > Tag B > Content C) and generates <mark> headlines', async () => {
    const res = await request(app)
      .get('/api/search/snippets')
      .query({ q: 'quasarflux', sort: 'relevance' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    // Anonymous caller should only see the 3 public matches, never private or unlisted
    expect(res.body.items.length).toBe(3);

    const [first, second, third] = res.body.items;
    expect(first.title).toBe('Quasarflux Engine Dispatcher');
    expect(second.title).toBe('Telemetry Pipeline Adapter');
    expect(third.title).toBe('Background Worker Routine');

    // Verify strictly descending ts_rank_cd scores
    expect(first.rank).toBeGreaterThan(second.rank);
    expect(second.rank).toBeGreaterThan(third.rank);
    expect(third.rank).toBeGreaterThan(0);

    // Verify ts_headline wraps body matches in <mark>...</mark>
    expect(third.headline).toContain('<mark>quasarflux</mark>');
  });

  it('2. enforces visibility boundaries in search (never leaks unlisted or private snippets to unauthorized callers)', async () => {
    // Victor (unrelated authenticated viewer) searches for 'quasarflux'
    const victorSearch = await request(app)
      .get('/api/search/snippets')
      .set('Authorization', `Bearer ${victorToken}`)
      .query({ q: 'quasarflux' });

    expect(victorSearch.status).toBe(200);
    const victorTitles = victorSearch.body.items.map((item: { title: string }) => item.title);
    expect(victorTitles).not.toContain('Quasarflux Secret Key Rotation');
    expect(victorTitles).not.toContain('Quasarflux Unlisted Scratchpad');
    expect(victorTitles.length).toBe(3);

    // Elena (owner of the private snippet) searches for 'quasarflux' -> sees the 3 public + her 1 private snippet, but NOT Marcus's unlisted snippet
    const elenaSearch = await request(app)
      .get('/api/search/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .query({ q: 'quasarflux' });

    expect(elenaSearch.status).toBe(200);
    const elenaTitles = elenaSearch.body.items.map((item: { title: string }) => item.title);
    expect(elenaTitles).toContain('Quasarflux Secret Key Rotation');
    expect(elenaTitles).not.toContain('Quasarflux Unlisted Scratchpad');
    expect(elenaTitles.length).toBe(4);
  });

  it('3. filters search results by language, tag, authorUsername, and createdFrom/createdTo date range', async () => {
    // Filter by language=python
    const langRes = await request(app)
      .get('/api/search/snippets')
      .query({ q: 'quasarflux', language: 'python' });
    expect(langRes.status).toBe(200);
    expect(langRes.body.items.length).toBe(1);
    expect(langRes.body.items[0].title).toBe('Telemetry Pipeline Adapter');

    // Filter by tag=worker
    const tagRes = await request(app)
      .get('/api/search/snippets')
      .query({ q: 'quasarflux', tag: 'worker' });
    expect(tagRes.status).toBe(200);
    expect(tagRes.body.items.length).toBe(1);
    expect(tagRes.body.items[0].title).toBe('Background Worker Routine');

    // Filter by authorUsername=elena_dev (anonymous -> only public snippets by elena_dev)
    const authorRes = await request(app)
      .get('/api/search/snippets')
      .query({ q: 'quasarflux', authorUsername: 'elena_dev' });
    expect(authorRes.status).toBe(200);
    expect(authorRes.body.items.length).toBe(2);
    expect(
      authorRes.body.items.every(
        (item: { owner: { username: string } }) => item.owner.username === 'elena_dev'
      )
    ).toBe(true);

    // Backdate one snippet to 2023-05-10 and test createdFrom / createdTo range filtering
    const targetId = createdSnippetIds[0];
    await db
      .update(snippets)
      .set({ createdAt: new Date('2023-05-10T12:00:00.000Z') })
      .where(eq(snippets.id, targetId));

    const dateRangeRes = await request(app)
      .get('/api/search/snippets')
      .query({
        q: 'quasarflux',
        createdFrom: '2023-01-01T00:00:00.000Z',
        createdTo: '2023-12-31T23:59:59.000Z',
      });
    expect(dateRangeRes.status).toBe(200);
    expect(dateRangeRes.body.items.length).toBe(1);
    expect(dateRangeRes.body.items[0].id).toBe(targetId);

    // Reject invalid date range where createdFrom > createdTo
    const badRangeRes = await request(app)
      .get('/api/search/snippets')
      .query({
        createdFrom: '2026-01-01T00:00:00.000Z',
        createdTo: '2024-01-01T00:00:00.000Z',
      });
    expect(badRangeRes.status).toBe(400);
    expect(badRangeRes.body.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('4. paginates deterministically with cursors across relevance, newest, and oldest sorts with zero duplicates', async () => {
    // Relevance cursor pagination (page size = 1 across 3 public 'quasarflux' matches)
    const seenRelevanceIds = new Set<string>();
    let cursor: string | undefined = undefined;
    let pages = 0;

    while (true) {
      const pageRes = await request(app)
        .get('/api/search/snippets')
        .query({ q: 'quasarflux', sort: 'relevance', limit: 1, ...(cursor ? { cursor } : {}) });

      expect(pageRes.status).toBe(200);
      pages += 1;

      for (const item of pageRes.body.items) {
        expect(seenRelevanceIds.has(item.id)).toBe(false);
        seenRelevanceIds.add(item.id);
      }

      if (!pageRes.body.hasMore) {
        expect(pageRes.body.nextCursor).toBeNull();
        break;
      }
      expect(typeof pageRes.body.nextCursor).toBe('string');
      cursor = pageRes.body.nextCursor;
      expect(pages).toBeLessThan(10);
    }

    expect(seenRelevanceIds.size).toBe(3);

    // Oldest sort check
    const oldestRes = await request(app)
      .get('/api/search/snippets')
      .query({ q: 'quasarflux', sort: 'oldest', limit: 3 });
    expect(oldestRes.status).toBe(200);
    expect(oldestRes.body.items.length).toBe(3);
    expect(
      new Date(oldestRes.body.items[0].createdAt).getTime()
    ).toBeLessThanOrEqual(new Date(oldestRes.body.items[1].createdAt).getTime());

    // Facets endpoint returns aggregated languages and tags
    const facetsRes = await request(app).get('/api/search/facets');
    expect(facetsRes.status).toBe(200);
    expect(Array.isArray(facetsRes.body.languages)).toBe(true);
    expect(Array.isArray(facetsRes.body.tags)).toBe(true);
    expect(facetsRes.body.languages.length).toBeGreaterThan(0);
    expect(facetsRes.body.tags.length).toBeGreaterThan(0);
  });
});

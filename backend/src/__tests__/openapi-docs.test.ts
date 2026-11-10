import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';

describe('Phase 9 — OpenAPI (/api/docs), Documentation & Infrastructure Artifacts', () => {
  const app = createApp();

  it('1. serves valid OpenAPI 3.0.3 JSON spec at GET /api/docs.json covering all domain endpoints and security schemes', async () => {
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toContain('CodeCollab');
    expect(res.body.components.securitySchemes.bearerAuth).toBeDefined();
    expect(res.body.components.securitySchemes.cookieAuth).toBeDefined();

    // Verify core paths exist in OpenAPI spec
    const paths = Object.keys(res.body.paths);
    expect(paths).toContain('/api/health');
    expect(paths).toContain('/api/auth/login');
    expect(paths).toContain('/api/auth/refresh');
    expect(paths).toContain('/api/auth/github/url');
    expect(paths).toContain('/api/users/{id}/role');
    expect(paths).toContain('/api/snippets');
    expect(paths).toContain('/api/snippets/{id}/diff');
    expect(paths).toContain('/api/search/snippets');
    expect(paths).toContain('/api/snippets/{snippetId}/comments');
    expect(paths).toContain('/api/activities/global');
    expect(paths).toContain('/api/notifications');
  });

  it('2. serves interactive Swagger UI HTML at GET /api/docs', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('SwaggerUIBundle');
    expect(res.text).toContain('/api/docs.json');
  });

  it('3. verifies all required documentation and infrastructure files exist and are non-empty', () => {
    const rootDir = path.resolve(import.meta.dirname, '../../..');
    const requiredFiles = [
      'docs/ARCHITECTURE.md',
      'docs/REALTIME.md',
      'README.md',
      'backend/Dockerfile',
      'frontend/Dockerfile',
      'docker-compose.yml',
      '.github/workflows/ci.yml',
      'backend/drizzle/0000_init.sql',
    ];

    for (const relPath of requiredFiles) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Expected ${relPath} to exist`).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size, `Expected ${relPath} to be non-empty`).toBeGreaterThan(100);
    }
  });
});

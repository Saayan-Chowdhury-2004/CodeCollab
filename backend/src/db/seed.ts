import crypto from 'crypto';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  users,
  snippets,
  snippetVersions,
  snippetCollaborators,
  tags,
  snippetTags,
  comments,
  activities,
  notifications,
} from './schema.ts';
import { logger } from '../config/logger.ts';
import { env } from '../config/env.ts';

// Deterministic UUIDs so the seed script is 100% idempotent across restarts
export const SEED_IDS = {
  users: {
    admin: '11111111-1111-4111-8111-111111111101',
    editor1: '11111111-1111-4111-8111-111111111102',
    editor2: '11111111-1111-4111-8111-111111111103',
    viewer: '11111111-1111-4111-8111-111111111104',
  },
  snippets: {
    publicAuth: '22222222-2222-4222-8222-222222222201',
    unlistedPool: '22222222-2222-4222-8222-222222222202',
    privateCrypto: '22222222-2222-4222-8222-222222222203',
  },
  versions: {
    publicAuthV1: '33333333-3333-4333-8333-333333333301',
    publicAuthV2: '33333333-3333-4333-8333-333333333302',
    unlistedPoolV1: '33333333-3333-4333-8333-333333333303',
    privateCryptoV1: '33333333-3333-4333-8333-333333333304',
  },
  comments: {
    rootThread1: '44444444-4444-4444-8444-444444444401',
    replyThread1: '44444444-4444-4444-8444-444444444402',
    outdatedThread2: '44444444-4444-4444-8444-444444444403',
  },
};

export async function runSeed() {
  if (env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error(
      '[SEED_REFUSED] Seeding demo data in production is refused unless ALLOW_DEMO_SEED=true is explicitly set.'
    );
  }

  try {
    const adminPassword =
      process.env.SEED_ADMIN_PASSWORD ||
      (env.NODE_ENV === 'production'
        ? crypto.randomBytes(16).toString('hex')
        : 'AdminPass123!');
    if (env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
      logger.info({ adminPassword }, 'Temporary production seed admin password generated');
    }

    const adminHash = await bcrypt.hash(adminPassword, 10);
    const editorHash = await bcrypt.hash('EditorPass123!', 10);
    const viewerHash = await bcrypt.hash('ViewerPass123!', 10);

    // 1. Seed Users (1 admin, 2 editors, 1 viewer)
    const seedUsers = [
      {
        id: SEED_IDS.users.admin,
        uid: 'seed-uid-admin',
        email: 'admin@codecollab.dev',
        username: 'admin_alex',
        displayName: 'Alex Rivera (Admin)',
        passwordHash: adminHash,
        globalRole: 'admin',
      },
      {
        id: SEED_IDS.users.editor1,
        uid: 'seed-uid-editor-1',
        email: 'elena@codecollab.dev',
        username: 'elena_dev',
        displayName: 'Elena Rostova (Editor)',
        passwordHash: editorHash,
        globalRole: 'editor',
      },
      {
        id: SEED_IDS.users.editor2,
        uid: 'seed-uid-editor-2',
        email: 'marcus@codecollab.dev',
        username: 'marcus_code',
        displayName: 'Marcus Vance (Editor)',
        passwordHash: editorHash,
        globalRole: 'editor',
      },
      {
        id: SEED_IDS.users.viewer,
        uid: 'seed-uid-viewer-1',
        email: 'victor@codecollab.dev',
        username: 'victor_read',
        displayName: 'Victor Chen (Viewer)',
        passwordHash: viewerHash,
        globalRole: 'viewer',
      },
    ];

    for (const u of seedUsers) {
      await db
        .insert(users)
        .values(u)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: u.email,
            username: u.username,
            displayName: u.displayName,
            passwordHash: u.passwordHash,
            globalRole: u.globalRole,
            updatedAt: new Date(),
          },
        });
    }

    // 2. Seed Tags
    const tagNames = ['typescript', 'security', 'jwt', 'postgres', 'pooling', 'cryptography'];
    const tagMap = new Map<string, string>();

    for (const name of tagNames) {
      const [insertedTag] = await db
        .insert(tags)
        .values({ name })
        .onConflictDoUpdate({
          target: tags.name,
          set: { name },
        })
        .returning();
      tagMap.set(name, insertedTag.id);
    }

    // 3. Seed Snippets
    const publicV1Content = [
      'import crypto from "crypto";',
      '',
      'export function hashRefreshToken(rawToken: string): string {',
      '  // v1: basic sha256 digest',
      '  return crypto.createHash("sha256").update(rawToken).digest("hex");',
      '}',
    ].join('\n');

    const publicV2Content = [
      'import crypto from "crypto";',
      '',
      'export function hashRefreshToken(rawToken: string, pepper = ""): string {',
      '  if (!rawToken || rawToken.length < 32) {',
      '    throw new Error("Refresh token entropy too low");',
      '  }',
      '  return crypto.createHash("sha256").update(`${rawToken}:${pepper}`).digest("hex");',
      '}',
    ].join('\n');

    const unlistedV1Content = [
      'import { Pool } from "pg";',
      '',
      'export const createLazyPool = (host: string, user: string, database: string) => {',
      '  return new Pool({ host, user, database, max: 10, idleTimeoutMillis: 30000 });',
      '};',
    ].join('\n');

    const privateV1Content = [
      'import crypto from "crypto";',
      '',
      'export function constantTimeCompare(a: string, b: string): boolean {',
      '  const bufA = Buffer.from(a);',
      '  const bufB = Buffer.from(b);',
      '  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);',
      '}',
    ].join('\n');

    const snippetDefs = [
      {
        id: SEED_IDS.snippets.publicAuth,
        title: 'JWT Refresh Token Rotation & Reuse Guard',
        description: 'Production-grade SHA-256 token hashing with family reuse revocation.',
        language: 'typescript',
        visibility: 'public',
        ownerId: SEED_IDS.users.editor1,
        currentContent: publicV2Content,
        currentVersionId: SEED_IDS.versions.publicAuthV2,
        latestVersionNumber: 2,
        tagsText: 'typescript security jwt',
        tagList: ['typescript', 'security', 'jwt'],
      },
      {
        id: SEED_IDS.snippets.unlistedPool,
        title: 'PostgreSQL Lazy Connection Pool Factory',
        description: 'Cloud SQL socket-compatible pg.Pool configuration without eager startup probes.',
        language: 'typescript',
        visibility: 'unlisted',
        ownerId: SEED_IDS.users.editor2,
        currentContent: unlistedV1Content,
        currentVersionId: SEED_IDS.versions.unlistedPoolV1,
        latestVersionNumber: 1,
        tagsText: 'typescript postgres pooling',
        tagList: ['typescript', 'postgres', 'pooling'],
      },
      {
        id: SEED_IDS.snippets.privateCrypto,
        title: 'Constant-Time HMAC Signature Verifier',
        description: 'Internal security utility for timing-safe token comparison.',
        language: 'typescript',
        visibility: 'private',
        ownerId: SEED_IDS.users.editor1,
        currentContent: privateV1Content,
        currentVersionId: SEED_IDS.versions.privateCryptoV1,
        latestVersionNumber: 1,
        tagsText: 'typescript security cryptography',
        tagList: ['typescript', 'security', 'cryptography'],
      },
    ];

    for (const s of snippetDefs) {
      await db
        .insert(snippets)
        .values({
          id: s.id,
          title: s.title,
          description: s.description,
          language: s.language,
          visibility: s.visibility,
          ownerId: s.ownerId,
          currentContent: s.currentContent,
          currentVersionId: s.currentVersionId,
          latestVersionNumber: s.latestVersionNumber,
          tagsText: s.tagsText,
          searchVector: sql`
            setweight(to_tsvector('english', coalesce(${s.title}, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(${s.tagsText}, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(${s.currentContent}, '')), 'C')
          `,
        })
        .onConflictDoUpdate({
          target: snippets.id,
          set: {
            title: s.title,
            description: s.description,
            language: s.language,
            visibility: s.visibility,
            currentContent: s.currentContent,
            currentVersionId: s.currentVersionId,
            latestVersionNumber: s.latestVersionNumber,
            tagsText: s.tagsText,
            searchVector: sql`
              setweight(to_tsvector('english', coalesce(${s.title}, '')), 'A') ||
              setweight(to_tsvector('english', coalesce(${s.tagsText}, '')), 'B') ||
              setweight(to_tsvector('english', coalesce(${s.currentContent}, '')), 'C')
            `,
            updatedAt: new Date(),
          },
        });

      for (const tagName of s.tagList) {
        const tagId = tagMap.get(tagName);
        if (tagId) {
          await db
            .insert(snippetTags)
            .values({ snippetId: s.id, tagId })
            .onConflictDoNothing();
        }
      }
    }

    // 4. Seed Snippet Versions
    const versionDefs = [
      {
        id: SEED_IDS.versions.publicAuthV1,
        snippetId: SEED_IDS.snippets.publicAuth,
        versionNumber: 1,
        authorId: SEED_IDS.users.editor1,
        content: publicV1Content,
        summary: 'Initial SHA-256 refresh token hashing function',
        source: 'initial',
      },
      {
        id: SEED_IDS.versions.publicAuthV2,
        snippetId: SEED_IDS.snippets.publicAuth,
        versionNumber: 2,
        authorId: SEED_IDS.users.editor2,
        content: publicV2Content,
        summary: 'Add minimum entropy validation and optional pepper',
        source: 'manual',
      },
      {
        id: SEED_IDS.versions.unlistedPoolV1,
        snippetId: SEED_IDS.snippets.unlistedPool,
        versionNumber: 1,
        authorId: SEED_IDS.users.editor2,
        content: unlistedV1Content,
        summary: 'Initial lazy pg.Pool helper',
        source: 'initial',
      },
      {
        id: SEED_IDS.versions.privateCryptoV1,
        snippetId: SEED_IDS.snippets.privateCrypto,
        versionNumber: 1,
        authorId: SEED_IDS.users.editor1,
        content: privateV1Content,
        summary: 'Initial timing-safe comparison utility',
        source: 'initial',
      },
    ];

    for (const v of versionDefs) {
      await db
        .insert(snippetVersions)
        .values(v)
        .onConflictDoUpdate({
          target: snippetVersions.id,
          set: {
            content: v.content,
            summary: v.summary,
          },
        });
    }

    // 5. Seed Collaborators
    const collabDefs = [
      {
        snippetId: SEED_IDS.snippets.publicAuth,
        userId: SEED_IDS.users.editor2,
        role: 'editor',
        addedById: SEED_IDS.users.editor1,
      },
      {
        snippetId: SEED_IDS.snippets.publicAuth,
        userId: SEED_IDS.users.viewer,
        role: 'viewer',
        addedById: SEED_IDS.users.editor1,
      },
      {
        snippetId: SEED_IDS.snippets.privateCrypto,
        userId: SEED_IDS.users.editor2,
        role: 'editor',
        addedById: SEED_IDS.users.editor1,
      },
      {
        snippetId: SEED_IDS.snippets.privateCrypto,
        userId: SEED_IDS.users.viewer,
        role: 'viewer',
        addedById: SEED_IDS.users.editor1,
      },
    ];

    for (const c of collabDefs) {
      await db
        .insert(snippetCollaborators)
        .values(c)
        .onConflictDoUpdate({
          target: [snippetCollaborators.snippetId, snippetCollaborators.userId],
          set: { role: c.role },
        });
    }

    // 6. Seed Threaded & Outdated Line-Anchored Comments
    const commentDefs = [
      {
        id: SEED_IDS.comments.rootThread1,
        snippetId: SEED_IDS.snippets.publicAuth,
        authorId: SEED_IDS.users.viewer,
        parentId: null,
        lineNumber: 4,
        versionId: SEED_IDS.versions.publicAuthV2,
        anchorLineText: '  if (!rawToken || rawToken.length < 32) {',
        body: 'Good guard! Should we also reject non-hex characters here?',
        resolved: true,
        resolvedById: SEED_IDS.users.editor1,
        resolvedAt: new Date(),
      },
      {
        id: SEED_IDS.comments.replyThread1,
        snippetId: SEED_IDS.snippets.publicAuth,
        authorId: SEED_IDS.users.editor1,
        parentId: SEED_IDS.comments.rootThread1,
        lineNumber: 4,
        versionId: SEED_IDS.versions.publicAuthV2,
        anchorLineText: '  if (!rawToken || rawToken.length < 32) {',
        body: 'Agreed — Zod validates the hex format at the route boundary before calling this helper.',
        resolved: true,
        resolvedById: SEED_IDS.users.editor1,
        resolvedAt: new Date(),
      },
      {
        id: SEED_IDS.comments.outdatedThread2,
        snippetId: SEED_IDS.snippets.publicAuth,
        authorId: SEED_IDS.users.editor2,
        parentId: null,
        lineNumber: 4,
        versionId: SEED_IDS.versions.publicAuthV1,
        anchorLineText: '  // v1: basic sha256 digest',
        body: 'We should check rawToken length before hashing so empty strings fail fast.',
        resolved: false,
        resolvedById: null,
        resolvedAt: null,
      },
    ];

    for (const cm of commentDefs) {
      await db
        .insert(comments)
        .values(cm)
        .onConflictDoUpdate({
          target: comments.id,
          set: {
            body: cm.body,
            resolved: cm.resolved,
            resolvedById: cm.resolvedById,
            resolvedAt: cm.resolvedAt,
            updatedAt: new Date(),
          },
        });
    }

    // 7. Seed Initial Activity Feed Entry (if none exists for publicAuth)
    const existingAct = await db
      .select()
      .from(activities)
      .where(eq(activities.snippetId, SEED_IDS.snippets.publicAuth));

    if (existingAct.length === 0) {
      await db.insert(activities).values([
        {
          actorId: SEED_IDS.users.editor1,
          type: 'snippet.created',
          snippetId: SEED_IDS.snippets.publicAuth,
          visibility: 'public',
          metadata: { title: 'JWT Refresh Token Rotation & Reuse Guard', language: 'typescript' },
        },
        {
          actorId: SEED_IDS.users.editor2,
          type: 'snippet.edited',
          snippetId: SEED_IDS.snippets.publicAuth,
          visibility: 'public',
          metadata: { versionNumber: 2, summary: 'Add minimum entropy validation and optional pepper' },
        },
        {
          actorId: SEED_IDS.users.viewer,
          type: 'comment.added',
          snippetId: SEED_IDS.snippets.publicAuth,
          visibility: 'public',
          metadata: { lineNumber: 4, commentId: SEED_IDS.comments.rootThread1 },
        },
      ]);
    }

    // 8. Seed Initial Notification (if none exists for editor1)
    const existingNotif = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, SEED_IDS.users.editor1));

    if (existingNotif.length === 0) {
      await db.insert(notifications).values({
        recipientId: SEED_IDS.users.editor1,
        actorId: SEED_IDS.users.viewer,
        type: 'comment.added',
        snippetId: SEED_IDS.snippets.publicAuth,
        commentId: SEED_IDS.comments.rootThread1,
        title: 'New review comment on line 4',
        message: 'Victor Chen commented on "JWT Refresh Token Rotation & Reuse Guard".',
      });
    }

    logger.info('Database seed completed successfully');
    return {
      usersSeeded: seedUsers.length,
      snippetsSeeded: snippetDefs.length,
      versionsSeeded: versionDefs.length,
      commentsSeeded: commentDefs.length,
    };
  } catch (error) {
    console.error('Database seed failed:', error);
    throw new Error('Failed to seed database.', { cause: error });
  }
}

// Allow running directly via `tsx backend/src/db/seed.ts`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeed()
    .then((summary) => {
      console.log('Seed completed:', JSON.stringify(summary));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

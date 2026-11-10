import { count, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { users, snippets, snippetVersions, comments } from './schema.ts';

export interface DatabaseHealthSummary {
  connected: boolean;
  counts: {
    users: number;
    snippets: number;
    versions: number;
    comments: number;
  };
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export async function checkDatabaseHealth(): Promise<DatabaseHealthSummary> {
  try {
    const [userRow] = await db.select({ value: count() }).from(users);
    const [snippetRow] = await db.select({ value: count() }).from(snippets);
    const [versionRow] = await db.select({ value: count() }).from(snippetVersions);
    const [commentRow] = await db.select({ value: count() }).from(comments);

    return {
      connected: true,
      counts: {
        users: Number(userRow?.value ?? 0),
        snippets: Number(snippetRow?.value ?? 0),
        versions: Number(versionRow?.value ?? 0),
        comments: Number(commentRow?.value ?? 0),
      },
    };
  } catch (error) {
    console.error('Database health query failed:', error);
    throw new Error('Database health check failed. Please try again later.', { cause: error });
  }
}

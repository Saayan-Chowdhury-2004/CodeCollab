import { and, isNull, gt, lt, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { oauthStates } from '../db/schema.ts';
import type { OAuthStatePayload } from './github-oauth.ts';

export async function rememberOAuthState(payload: OAuthStatePayload): Promise<void> {
  await db.insert(oauthStates).values({
    nonce: payload.nonce,
    origin: payload.origin,
    expiresAt: new Date(payload.exp),
  });
}

export async function consumeOAuthState(payload: OAuthStatePayload): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(oauthStates)
    .set({ consumedAt: now })
    .where(
      and(
        eq(oauthStates.nonce, payload.nonce),
        isNull(oauthStates.consumedAt),
        gt(oauthStates.expiresAt, now)
      )
    )
    .returning({ nonce: oauthStates.nonce });

  // Opportunistically clean up rows expired more than 24 hours ago in the background
  db.delete(oauthStates)
    .where(lt(oauthStates.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))
    .catch((err) => {
      // Non-fatal background cleanup error
    });

  return updated.length > 0;
}


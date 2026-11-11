import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// 1. users
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    uid: text('uid').notNull().unique(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    username: varchar('username', { length: 64 }).notNull().unique(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    passwordHash: text('password_hash'),
    githubId: varchar('github_id', { length: 64 }).unique(),
    avatarUrl: text('avatar_url'),
    globalRole: varchar('global_role', { length: 16 }).notNull().default('editor'), // 'admin' | 'editor' | 'viewer'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('users_email_idx').on(table.email),
    index('users_username_idx').on(table.username),
    index('users_global_role_idx').on(table.globalRole),
    index('users_created_at_idx').on(table.createdAt),
  ]
);

// 2. refresh_tokens
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
    familyId: uuid('family_id').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_family_id_idx').on(table.familyId),
    index('refresh_tokens_token_hash_idx').on(table.tokenHash),
  ]
);

// 3. snippets
export const snippets = pgTable(
  'snippets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    language: varchar('language', { length: 40 }).notNull().default('typescript'),
    visibility: varchar('visibility', { length: 16 }).notNull().default('public'), // 'public' | 'unlisted' | 'private'
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    currentContent: text('current_content').notNull().default(''),
    currentVersionId: uuid('current_version_id'),
    latestVersionNumber: integer('latest_version_number').notNull().default(1),
    yjsState: text('yjs_state'),
    tagsText: text('tags_text').notNull().default(''),
    searchVector: tsvector('search_vector'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('snippets_owner_id_idx').on(table.ownerId),
    index('snippets_language_idx').on(table.language),
    index('snippets_visibility_idx').on(table.visibility),
    index('snippets_created_at_idx').on(table.createdAt),
    index('snippets_updated_at_idx').on(table.updatedAt),
    index('snippets_search_vector_idx').using('gin', table.searchVector),
  ]
);

// 4. snippet_versions
export const snippetVersions = pgTable(
  'snippet_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snippetId: uuid('snippet_id')
      .notNull()
      .references(() => snippets.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    yjsState: text('yjs_state'),
    summary: varchar('summary', { length: 255 }).notNull().default('Version snapshot'),
    source: varchar('source', { length: 24 }).notNull().default('manual'), // 'initial' | 'manual' | 'autosave' | 'restore'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('snippet_versions_snippet_id_idx').on(table.snippetId),
    index('snippet_versions_author_id_idx').on(table.authorId),
    index('snippet_versions_created_at_idx').on(table.createdAt),
    uniqueIndex('snippet_versions_snippet_version_uniq').on(table.snippetId, table.versionNumber),
  ]
);

// 5. snippet_collaborators
export const snippetCollaborators = pgTable(
  'snippet_collaborators',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snippetId: uuid('snippet_id')
      .notNull()
      .references(() => snippets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).notNull().default('viewer'), // 'editor' | 'viewer'
    addedById: uuid('added_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('snippet_collaborators_snippet_id_idx').on(table.snippetId),
    index('snippet_collaborators_user_id_idx').on(table.userId),
    index('snippet_collaborators_added_by_id_idx').on(table.addedById),
    uniqueIndex('snippet_collaborators_snippet_user_uniq').on(table.snippetId, table.userId),
  ]
);

// 6. tags
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 48 }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('tags_name_idx').on(table.name)]
);

// 7. snippet_tags
export const snippetTags = pgTable(
  'snippet_tags',
  {
    snippetId: uuid('snippet_id')
      .notNull()
      .references(() => snippets.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.snippetId, table.tagId] }),
    index('snippet_tags_snippet_id_idx').on(table.snippetId),
    index('snippet_tags_tag_id_idx').on(table.tagId),
  ]
);

// 8. comments
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snippetId: uuid('snippet_id')
      .notNull()
      .references(() => snippets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    lineNumber: integer('line_number').notNull(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => snippetVersions.id, { onDelete: 'cascade' }),
    anchorLineText: text('anchor_line_text').notNull().default(''),
    body: text('body').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    resolvedById: uuid('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('comments_snippet_id_idx').on(table.snippetId),
    index('comments_author_id_idx').on(table.authorId),
    index('comments_parent_id_idx').on(table.parentId),
    index('comments_version_id_idx').on(table.versionId),
    index('comments_resolved_by_id_idx').on(table.resolvedById),
    index('comments_created_at_idx').on(table.createdAt),
  ]
);

// 9. activities
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(), // 'snippet.created' | 'snippet.edited' | 'snippet.deleted' | 'comment.added' | 'comment.resolved' | 'collaborator.added'
    snippetId: uuid('snippet_id').references(() => snippets.id, { onDelete: 'set null' }),
    visibility: varchar('visibility', { length: 16 }).notNull().default('public'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('activities_actor_id_idx').on(table.actorId),
    index('activities_snippet_id_idx').on(table.snippetId),
    index('activities_visibility_idx').on(table.visibility),
    index('activities_created_at_idx').on(table.createdAt),
  ]
);

// 10. notifications
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: varchar('type', { length: 40 }).notNull(),
    snippetId: uuid('snippet_id').references(() => snippets.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    message: text('message').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_recipient_id_idx').on(table.recipientId),
    index('notifications_actor_id_idx').on(table.actorId),
    index('notifications_snippet_id_idx').on(table.snippetId),
    index('notifications_comment_id_idx').on(table.commentId),
    index('notifications_created_at_idx').on(table.createdAt),
  ]
);

// 11. oauth_states
export const oauthStates = pgTable(
  'oauth_states',
  {
    nonce: text('nonce').primaryKey(),
    origin: text('origin').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('oauth_states_expires_at_idx').on(table.expiresAt),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  snippets: many(snippets),
  refreshTokens: many(refreshTokens),
  collaborations: many(snippetCollaborators),
  comments: many(comments),
  activities: many(activities),
  notifications: many(notifications),
}));

export const snippetsRelations = relations(snippets, ({ one, many }) => ({
  owner: one(users, {
    fields: [snippets.ownerId],
    references: [users.id],
  }),
  versions: many(snippetVersions),
  collaborators: many(snippetCollaborators),
  snippetTags: many(snippetTags),
  comments: many(comments),
  activities: many(activities),
}));

export const snippetVersionsRelations = relations(snippetVersions, ({ one, many }) => ({
  snippet: one(snippets, {
    fields: [snippetVersions.snippetId],
    references: [snippets.id],
  }),
  author: one(users, {
    fields: [snippetVersions.authorId],
    references: [users.id],
  }),
  comments: many(comments),
}));

export const snippetCollaboratorsRelations = relations(snippetCollaborators, ({ one }) => ({
  snippet: one(snippets, {
    fields: [snippetCollaborators.snippetId],
    references: [snippets.id],
  }),
  user: one(users, {
    fields: [snippetCollaborators.userId],
    references: [users.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  snippet: one(snippets, {
    fields: [comments.snippetId],
    references: [snippets.id],
  }),
  author: one(users, {
    fields: [comments.authorId],
    references: [users.id],
  }),
  version: one(snippetVersions, {
    fields: [comments.versionId],
    references: [snippetVersions.id],
  }),
}));

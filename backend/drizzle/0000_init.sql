-- 0000_init.sql: Complete schema migration for Collaborative Code Snippet Sharing & Review Platform

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "uid" text NOT NULL UNIQUE,
  "email" varchar(255) NOT NULL UNIQUE,
  "username" varchar(64) NOT NULL UNIQUE,
  "display_name" varchar(120) NOT NULL,
  "password_hash" text,
  "github_id" varchar(64) UNIQUE,
  "avatar_url" text,
  "global_role" varchar(16) DEFAULT 'editor' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username");
CREATE INDEX IF NOT EXISTS "users_global_role_idx" ON "users" ("global_role");
CREATE INDEX IF NOT EXISTS "users_created_at_idx" ON "users" ("created_at");

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" varchar(128) NOT NULL UNIQUE,
  "family_id" uuid NOT NULL,
  "revoked_at" timestamptz,
  "replaced_by_id" uuid,
  "expires_at" timestamptz NOT NULL,
  "user_agent" text,
  "ip_address" varchar(64),
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_family_id_idx" ON "refresh_tokens" ("family_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_token_hash_idx" ON "refresh_tokens" ("token_hash");

CREATE TABLE IF NOT EXISTS "snippets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(200) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "language" varchar(40) DEFAULT 'typescript' NOT NULL,
  "visibility" varchar(16) DEFAULT 'public' NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "current_content" text DEFAULT '' NOT NULL,
  "current_version_id" uuid,
  "latest_version_number" integer DEFAULT 1 NOT NULL,
  "yjs_state" text,
  "tags_text" text DEFAULT '' NOT NULL,
  "search_vector" tsvector,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "snippets_owner_id_idx" ON "snippets" ("owner_id");
CREATE INDEX IF NOT EXISTS "snippets_language_idx" ON "snippets" ("language");
CREATE INDEX IF NOT EXISTS "snippets_visibility_idx" ON "snippets" ("visibility");
CREATE INDEX IF NOT EXISTS "snippets_created_at_idx" ON "snippets" ("created_at");
CREATE INDEX IF NOT EXISTS "snippets_updated_at_idx" ON "snippets" ("updated_at");
CREATE INDEX IF NOT EXISTS "snippets_search_vector_idx" ON "snippets" USING gin ("search_vector");

CREATE TABLE IF NOT EXISTS "snippet_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snippet_id" uuid NOT NULL REFERENCES "snippets"("id") ON DELETE CASCADE,
  "version_number" integer NOT NULL,
  "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "content" text NOT NULL,
  "yjs_state" text,
  "summary" varchar(255) DEFAULT 'Version snapshot' NOT NULL,
  "source" varchar(24) DEFAULT 'manual' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "snippet_versions_snippet_id_idx" ON "snippet_versions" ("snippet_id");
CREATE INDEX IF NOT EXISTS "snippet_versions_author_id_idx" ON "snippet_versions" ("author_id");
CREATE INDEX IF NOT EXISTS "snippet_versions_created_at_idx" ON "snippet_versions" ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "snippet_versions_snippet_version_uniq" ON "snippet_versions" ("snippet_id", "version_number");

CREATE TABLE IF NOT EXISTS "snippet_collaborators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snippet_id" uuid NOT NULL REFERENCES "snippets"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" varchar(16) DEFAULT 'viewer' NOT NULL,
  "added_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "snippet_collaborators_snippet_id_idx" ON "snippet_collaborators" ("snippet_id");
CREATE INDEX IF NOT EXISTS "snippet_collaborators_user_id_idx" ON "snippet_collaborators" ("user_id");
CREATE INDEX IF NOT EXISTS "snippet_collaborators_added_by_id_idx" ON "snippet_collaborators" ("added_by_id");
CREATE UNIQUE INDEX IF NOT EXISTS "snippet_collaborators_snippet_user_uniq" ON "snippet_collaborators" ("snippet_id", "user_id");

CREATE TABLE IF NOT EXISTS "tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(48) NOT NULL UNIQUE,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "tags_name_idx" ON "tags" ("name");

CREATE TABLE IF NOT EXISTS "snippet_tags" (
  "snippet_id" uuid NOT NULL REFERENCES "snippets"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  PRIMARY KEY ("snippet_id", "tag_id")
);

CREATE INDEX IF NOT EXISTS "snippet_tags_snippet_id_idx" ON "snippet_tags" ("snippet_id");
CREATE INDEX IF NOT EXISTS "snippet_tags_tag_id_idx" ON "snippet_tags" ("tag_id");

CREATE TABLE IF NOT EXISTS "comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snippet_id" uuid NOT NULL REFERENCES "snippets"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "parent_id" uuid REFERENCES "comments"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "snippet_versions"("id") ON DELETE CASCADE,
  "anchor_line_text" text DEFAULT '' NOT NULL,
  "body" text NOT NULL,
  "resolved" boolean DEFAULT false NOT NULL,
  "resolved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "comments_snippet_id_idx" ON "comments" ("snippet_id");
CREATE INDEX IF NOT EXISTS "comments_author_id_idx" ON "comments" ("author_id");
CREATE INDEX IF NOT EXISTS "comments_parent_id_idx" ON "comments" ("parent_id");
CREATE INDEX IF NOT EXISTS "comments_version_id_idx" ON "comments" ("version_id");
CREATE INDEX IF NOT EXISTS "comments_resolved_by_id_idx" ON "comments" ("resolved_by_id");
CREATE INDEX IF NOT EXISTS "comments_created_at_idx" ON "comments" ("created_at");

CREATE TABLE IF NOT EXISTS "activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(40) NOT NULL,
  "snippet_id" uuid REFERENCES "snippets"("id") ON DELETE SET NULL,
  "visibility" varchar(16) DEFAULT 'public' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "activities_actor_id_idx" ON "activities" ("actor_id");
CREATE INDEX IF NOT EXISTS "activities_snippet_id_idx" ON "activities" ("snippet_id");
CREATE INDEX IF NOT EXISTS "activities_visibility_idx" ON "activities" ("visibility");
CREATE INDEX IF NOT EXISTS "activities_created_at_idx" ON "activities" ("created_at");

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "type" varchar(40) NOT NULL,
  "snippet_id" uuid REFERENCES "snippets"("id") ON DELETE CASCADE,
  "comment_id" uuid REFERENCES "comments"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "message" text NOT NULL,
  "read_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "notifications_recipient_id_idx" ON "notifications" ("recipient_id");
CREATE INDEX IF NOT EXISTS "notifications_actor_id_idx" ON "notifications" ("actor_id");
CREATE INDEX IF NOT EXISTS "notifications_snippet_id_idx" ON "notifications" ("snippet_id");
CREATE INDEX IF NOT EXISTS "notifications_comment_id_idx" ON "notifications" ("comment_id");
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications" ("created_at");

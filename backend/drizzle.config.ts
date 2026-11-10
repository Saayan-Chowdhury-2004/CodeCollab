import { defineConfig } from 'drizzle-kit';
import { resolveDrizzleKitCredentials } from './src/config/env.ts';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: resolveDrizzleKitCredentials(process.env),
  verbose: true,
});

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import type { PoolConfig } from 'pg';
import { z } from 'zod';

// Load .env from current working directory and parent workspace root if running inside /backend
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  APP_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  OAUTH_ALLOWED_ORIGINS: z.string().optional().default(''),
  CSP_FRAME_ANCESTORS: z.string().default("'none'"),
  CSP_CONNECT_SRC: z.string().default("'self' ws: wss:"),
  CSP_SCRIPT_SRC: z.string().default("'self'"),
  CSP_STYLE_SRC: z.string().default("'self' 'unsafe-inline'"),
  AUTH_TRANSPORT: z.enum(['bearer', 'cookie']).default('bearer'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  LOCAL_DEMO: z.string().optional().default('false'),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  JWT_ACCESS_SECRET_PREVIOUS: z.string().optional(),
  JWT_REFRESH_SECRET_PREVIOUS: z.string().optional(),
  OAUTH_STATE_SECRET: z.string().optional(),
  HEALTH_CHECK_SECRET: z.string().optional().default(''),
  JWT_ACCESS_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(900), // 15 minutes
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  GITHUB_CLIENT_ID: z.string().optional().default(''),
  GITHUB_CLIENT_SECRET: z.string().optional().default(''),
  GITHUB_CALLBACK_URL: z.string().optional().default(''),
  MAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().default('noreply@codecollab.dev'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().optional(),
  DB_SSL: z.enum(['true', 'false', 'require', 'no-verify']).optional(),
  DB_SSL_CA: z.string().optional(),
  SQL_HOST: z.string().optional(),
  SQL_PORT: z.coerce.number().int().positive().default(5432),
  SQL_USER: z.string().optional(),
  SQL_PASSWORD: z.string().optional(),
  SQL_DB_NAME: z.string().optional(),
  SQL_ADMIN_USER: z.string().optional(),
  SQL_ADMIN_PASSWORD: z.string().optional(),
});

export function isPlaceholderValue(val?: string | null): boolean {
  if (val === undefined || val === null) return true;
  const lower = String(val).trim().toLowerCase();
  if (
    lower === '' ||
    lower === 'unset' ||
    lower === 'none' ||
    lower === 'null' ||
    lower === 'undefined' ||
    lower === 'changeme'
  ) {
    return true;
  }
  if (lower.startsWith('your-') || lower.startsWith('replace-with-')) {
    return true;
  }
  return false;
}

export function normalizeRawEnv(
  rawEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (value === undefined) {
      normalized[key] = undefined;
      continue;
    }
    const trimmed = typeof value === 'string' ? value.trim() : String(value).trim();
    if (isPlaceholderValue(trimmed)) {
      normalized[key] = undefined;
    } else {
      normalized[key] = trimmed;
    }
  }
  return normalized;
}

export function resolveDbSsl(
  dbSsl?: 'true' | 'false' | 'require' | 'no-verify' | string,
  dbSslCa?: string
): boolean | { rejectUnauthorized: boolean; ca?: string } {
  if (!dbSsl || dbSsl === 'false' || isPlaceholderValue(dbSsl)) {
    return false;
  }
  let caContent: string | undefined;
  if (dbSslCa && !isPlaceholderValue(dbSslCa)) {
    if (dbSslCa.includes('-----BEGIN CERTIFICATE-----')) {
      caContent = dbSslCa;
    } else {
      try {
        if (fs.existsSync(dbSslCa)) {
          caContent = fs.readFileSync(dbSslCa, 'utf8');
        } else {
          caContent = dbSslCa;
        }
      } catch {
        caContent = dbSslCa;
      }
    }
  }

  if (dbSsl === 'no-verify') {
    console.warn('[WARN] DB_SSL=no-verify is active: certificate verification is disabled');
    return { rejectUnauthorized: false, ...(caContent ? { ca: caContent } : {}) };
  }
  // 'true' or 'require' enforce valid certificate verification
  return { rejectUnauthorized: true, ...(caContent ? { ca: caContent } : {}) };
}

export function resolveDbPoolConfig(
  rawEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): PoolConfig {
  const envNorm = normalizeRawEnv(rawEnv);
  const databaseUrl = envNorm.DATABASE_URL;
  const ssl = resolveDbSsl(envNorm.DB_SSL, envNorm.DB_SSL_CA);

  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      ...(ssl ? { ssl } : {}),
      max: 10,
      connectionTimeoutMillis: 15000,
    };
  }

  return {
    host: envNorm.SQL_HOST || 'localhost',
    port: envNorm.SQL_PORT ? Number(envNorm.SQL_PORT) : 5432,
    user: envNorm.SQL_ADMIN_USER || envNorm.SQL_USER || 'codecollab',
    password: envNorm.SQL_ADMIN_PASSWORD || envNorm.SQL_PASSWORD || 'codecollab_dev_password',
    database: envNorm.SQL_DB_NAME || 'codecollab',
    ...(ssl ? { ssl } : {}),
    max: 10,
    connectionTimeoutMillis: 15000,
  };
}

export function resolveDrizzleKitCredentials(
  rawEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
) {
  const envNorm = normalizeRawEnv(rawEnv);
  const databaseUrl = envNorm.DATABASE_URL;
  const ssl = resolveDbSsl(envNorm.DB_SSL, envNorm.DB_SSL_CA);

  if (databaseUrl) {
    return {
      url: databaseUrl,
      ...(ssl ? { ssl } : {}),
    };
  }

  return {
    host: envNorm.SQL_HOST || 'localhost',
    port: envNorm.SQL_PORT ? Number(envNorm.SQL_PORT) : 5432,
    user: envNorm.SQL_ADMIN_USER || envNorm.SQL_USER || 'codecollab',
    password: envNorm.SQL_ADMIN_PASSWORD || envNorm.SQL_PASSWORD || 'codecollab_dev_password',
    database: envNorm.SQL_DB_NAME || 'codecollab',
    ssl: ssl || false,
  };
}

export type EnvConfig = Omit<z.infer<typeof envSchema>, 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'> & {
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  OAUTH_STATE_SECRET: string;
  corsOriginList: string[];
  oauthAllowedOriginList: string[];
  githubCallbackUrlResolved: string;
  dbPoolConfig: PoolConfig;
};

const INSECURE_PLACEHOLDER_SECRETS = new Set([
  'replace-with-at-least-16-char-access-secret',
  'replace-with-at-least-16-char-refresh-secret',
  'replace-with-at-least-32-char-access-secret',
  'replace-with-at-least-32-char-refresh-secret',
  'dev-jwt-access-secret-codecollab-2026-secure-key',
  'dev-jwt-refresh-secret-codecollab-2026-secure-key',
  'changeme',
  'secret',
  'password',
  '1234567890123456',
  '0123456789abcdef0123456789abcdef',
]);

export function validateEnv(
  rawEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): EnvConfig {
  const normalizedRaw = normalizeRawEnv(rawEnv);
  const parsed = envSchema.safeParse(normalizedRaw);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`[BOOT_ENV_INVALID] Environment validation failed: ${formatted}`);
  }

  const data = parsed.data;
  const rawAccess = normalizedRaw.JWT_ACCESS_SECRET;
  const rawRefresh = normalizedRaw.JWT_REFRESH_SECRET;
  const rawOAuth = normalizedRaw.OAUTH_STATE_SECRET;

  const isProduction = data.NODE_ENV === 'production';
  const isLocalDemo = data.LOCAL_DEMO === 'true';

  if (isProduction) {
    // JWT secret strength is enforced in every production boot, including LOCAL_DEMO.
    if (!rawAccess || rawAccess.length < 32 || INSECURE_PLACEHOLDER_SECRETS.has(rawAccess) || isPlaceholderValue(rawAccess)) {
      throw new Error(
        '[BOOT_ENV_INVALID] Production boot refused: a real JWT_ACCESS_SECRET (>= 32 chars) is required.'
      );
    }
    if (!rawRefresh || rawRefresh.length < 32 || INSECURE_PLACEHOLDER_SECRETS.has(rawRefresh) || isPlaceholderValue(rawRefresh)) {
      throw new Error(
        '[BOOT_ENV_INVALID] Production boot refused: a real JWT_REFRESH_SECRET (>= 32 chars) is required.'
      );
    }
    // LOCAL_DEMO may derive OAUTH_STATE_SECRET from JWT_ACCESS_SECRET when it is empty.
    if (!isLocalDemo && (!rawOAuth || rawOAuth.length < 32 || INSECURE_PLACEHOLDER_SECRETS.has(rawOAuth) || isPlaceholderValue(rawOAuth))) {
      throw new Error(
        '[BOOT_ENV_INVALID] Production boot refused: a real OAUTH_STATE_SECRET (>= 32 chars) is required.'
      );
    }
    // LOCAL_DEMO may run cookie transport without Secure cookies (plain HTTP on localhost).
    if (!isLocalDemo && data.AUTH_TRANSPORT === 'cookie') {
      if (!data.COOKIE_SECURE) {
        throw new Error(
          '[BOOT_ENV_INVALID] Production boot refused: COOKIE_SECURE must be true when AUTH_TRANSPORT=cookie.'
        );
      }
      if (data.COOKIE_SAME_SITE === 'none' && !data.COOKIE_SECURE) {
        throw new Error(
          '[BOOT_ENV_INVALID] Production boot refused: COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.'
        );
      }
    }
  }

  if (isProduction && isLocalDemo) {
    console.warn(
      '[WARN] LOCAL_DEMO=true is active in production mode: OAUTH_STATE_SECRET may be derived and Secure cookies are not enforced. Do not use LOCAL_DEMO for a real deployment.'
    );
  }

  if (rawAccess !== undefined && rawAccess.length < 16) {
    throw new Error('[BOOT_ENV_INVALID] JWT_ACCESS_SECRET must be at least 16 characters');
  }
  if (rawRefresh !== undefined && rawRefresh.length < 16) {
    throw new Error('[BOOT_ENV_INVALID] JWT_REFRESH_SECRET must be at least 16 characters');
  }

  const jwtAccessSecret = rawAccess || crypto.randomBytes(32).toString('hex');
  const jwtRefreshSecret = rawRefresh || crypto.randomBytes(32).toString('hex');

  let oauthStateSecret = rawOAuth;
  if (!oauthStateSecret) {
    oauthStateSecret = crypto
      .createHmac('sha256', jwtAccessSecret)
      .update('oauth-state')
      .digest('hex');
  }

  const normalizeOrigin = (o: string) => o.trim().replace(/\/$/, '');

  const origins = new Set<string>(
    data.CORS_ORIGINS.split(',')
      .map(normalizeOrigin)
      .filter(Boolean)
  );
  if (data.APP_URL) {
    origins.add(normalizeOrigin(data.APP_URL));
  }

  const oauthOrigins = new Set<string>(origins);
  if (data.OAUTH_ALLOWED_ORIGINS) {
    for (const o of data.OAUTH_ALLOWED_ORIGINS.split(',').map(normalizeOrigin).filter(Boolean)) {
      oauthOrigins.add(o);
    }
  }

  const githubCallbackUrlResolved =
    data.GITHUB_CALLBACK_URL || `${normalizeOrigin(data.APP_URL)}/api/auth/github/callback`;

  return {
    ...data,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    OAUTH_STATE_SECRET: oauthStateSecret,
    corsOriginList: Array.from(origins),
    oauthAllowedOriginList: Array.from(oauthOrigins),
    githubCallbackUrlResolved,
    dbPoolConfig: resolveDbPoolConfig(normalizedRaw),
  };
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowlist: string[] = env.corsOriginList
): boolean {
  if (!origin) return false;
  const normalized = origin.trim().replace(/\/$/, '');
  return allowlist.includes(normalized);
}

export function isGitHubConfigured(config: EnvConfig = env): boolean {
  return Boolean(
    config.GITHUB_CLIENT_ID &&
    config.GITHUB_CLIENT_SECRET &&
    !isPlaceholderValue(config.GITHUB_CLIENT_ID) &&
    !isPlaceholderValue(config.GITHUB_CLIENT_SECRET)
  );
}

let hasLoggedOptionalFeatures = false;
export function logOptionalFeaturesStatus(
  config: EnvConfig = env,
  logFn?: (obj: Record<string, unknown>, msg: string) => void
): void {
  if (hasLoggedOptionalFeatures) return;
  hasLoggedOptionalFeatures = true;

  const disabledFeatures: string[] = [];
  if (!isGitHubConfigured(config)) {
    disabledFeatures.push('GitHub login');
  }
  if (config.MAIL_PROVIDER !== 'smtp' || !config.SMTP_HOST || isPlaceholderValue(config.SMTP_HOST)) {
    disabledFeatures.push('SMTP mail');
  }
  if (!config.DATABASE_URL || isPlaceholderValue(config.DATABASE_URL)) {
    disabledFeatures.push('external DATABASE_URL');
  }

  if (disabledFeatures.length > 0) {
    const fn = logFn || ((obj, msg) => console.info(`[INFO] ${msg}`, obj));
    fn(
      { disabledFeatures },
      `Optional features disabled because variables are unset: ${disabledFeatures.join(', ')}`
    );
  }
}

export function _resetLoggedOptionalFeaturesForTesting(): void {
  hasLoggedOptionalFeatures = false;
}

export const env = validateEnv(process.env);

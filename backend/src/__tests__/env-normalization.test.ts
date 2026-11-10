import { describe, it, expect, vi } from 'vitest';
import {
  isPlaceholderValue,
  normalizeRawEnv,
  validateEnv,
  resolveDbPoolConfig,
  resolveDrizzleKitCredentials,
  isGitHubConfigured,
  logOptionalFeaturesStatus,
  _resetLoggedOptionalFeaturesForTesting,
} from '../config/env.ts';

describe('Environment Variable Placeholder Normalization', () => {
  it('1. isPlaceholderValue detects all required placeholder variants', () => {
    expect(isPlaceholderValue(undefined)).toBe(true);
    expect(isPlaceholderValue(null)).toBe(true);
    expect(isPlaceholderValue('')).toBe(true);
    expect(isPlaceholderValue('   ')).toBe(true);
    expect(isPlaceholderValue('unset')).toBe(true);
    expect(isPlaceholderValue('UNSET')).toBe(true);
    expect(isPlaceholderValue('none')).toBe(true);
    expect(isPlaceholderValue('NONE')).toBe(true);
    expect(isPlaceholderValue('null')).toBe(true);
    expect(isPlaceholderValue('undefined')).toBe(true);
    expect(isPlaceholderValue('changeme')).toBe(true);
    expect(isPlaceholderValue('CHANGEME')).toBe(true);
    expect(isPlaceholderValue('your-client-id')).toBe(true);
    expect(isPlaceholderValue('Your-Client-Secret')).toBe(true);
    expect(isPlaceholderValue('replace-with-jwt-secret')).toBe(true);
    expect(isPlaceholderValue('Replace-With-Secret')).toBe(true);

    // Legitimate values must NOT be treated as placeholders
    expect(isPlaceholderValue('valid_secret_123456789012345678901234567890')).toBe(false);
    expect(isPlaceholderValue('postgresql://user:pass@host:5432/db')).toBe(false);
    expect(isPlaceholderValue('587')).toBe(false);
    expect(isPlaceholderValue('true')).toBe(false);
  });

  it('2. DATABASE_URL="unset" falls back to SQL_* configuration', () => {
    const rawEnv = {
      DATABASE_URL: 'unset',
      SQL_HOST: 'custom-db-host',
      SQL_PORT: '5433',
      SQL_USER: 'custom_user',
      SQL_PASSWORD: 'custom_password',
      SQL_DB_NAME: 'custom_db',
    };

    const poolConfig = resolveDbPoolConfig(rawEnv);
    expect(poolConfig.connectionString).toBeUndefined();
    expect(poolConfig.host).toBe('custom-db-host');
    expect(poolConfig.port).toBe(5433);
    expect(poolConfig.user).toBe('custom_user');
    expect(poolConfig.password).toBe('custom_password');
    expect(poolConfig.database).toBe('custom_db');

    const drizzleCreds = resolveDrizzleKitCredentials(rawEnv);
    expect('url' in drizzleCreds ? drizzleCreds.url : undefined).toBeUndefined();
    expect(drizzleCreds.host).toBe('custom-db-host');
    expect(drizzleCreds.port).toBe(5433);
  });

  it('3. DB_SSL="" and DB_SSL="unset" do not crash boot or pool config', () => {
    const envEmpty = validateEnv({
      NODE_ENV: 'test',
      DB_SSL: '',
      JWT_ACCESS_SECRET: 'test_access_secret_32_characters_minimum_length',
      JWT_REFRESH_SECRET: 'test_refresh_secret_32_characters_minimum_length',
    });
    expect(envEmpty.DB_SSL).toBeUndefined();

    const envUnset = validateEnv({
      NODE_ENV: 'test',
      DB_SSL: 'unset',
      JWT_ACCESS_SECRET: 'test_access_secret_32_characters_minimum_length',
      JWT_REFRESH_SECRET: 'test_refresh_secret_32_characters_minimum_length',
    });
    expect(envUnset.DB_SSL).toBeUndefined();

    const poolConfig = resolveDbPoolConfig({ DB_SSL: 'unset' });
    expect(poolConfig.ssl).toBeUndefined();
  });

  it('4. SMTP_PORT="unset" gives default 587 and numeric/enum fields fall back safely', () => {
    const validated = validateEnv({
      NODE_ENV: 'test',
      SMTP_PORT: 'unset',
      JWT_ACCESS_EXPIRES_IN_SECONDS: 'none',
      REFRESH_TOKEN_TTL_DAYS: 'null',
      AUTH_TRANSPORT: 'undefined',
      COOKIE_SAME_SITE: 'changeme',
      LOG_LEVEL: 'your-level',
      MAIL_PROVIDER: 'replace-with-provider',
      JWT_ACCESS_SECRET: 'test_access_secret_32_characters_minimum_length',
      JWT_REFRESH_SECRET: 'test_refresh_secret_32_characters_minimum_length',
    });

    expect(validated.SMTP_PORT).toBe(587);
    expect(validated.JWT_ACCESS_EXPIRES_IN_SECONDS).toBe(900);
    expect(validated.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(validated.AUTH_TRANSPORT).toBe('bearer');
    expect(validated.COOKIE_SAME_SITE).toBe('lax');
    expect(validated.LOG_LEVEL).toBe('info');
    expect(validated.MAIL_PROVIDER).toBe('console');
  });

  it('5. Production mode with placeholder JWT_ACCESS_SECRET refuses to boot naming the variable', () => {
    expect(() => {
      validateEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'unset',
        JWT_REFRESH_SECRET: 'valid_refresh_secret_at_least_32_chars_long',
        OAUTH_STATE_SECRET: 'valid_oauth_secret_at_least_32_chars_long',
      });
    }).toThrowError(/JWT_ACCESS_SECRET/);

    expect(() => {
      validateEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'valid_access_secret_at_least_32_chars_long',
        JWT_REFRESH_SECRET: 'changeme',
        OAUTH_STATE_SECRET: 'valid_oauth_secret_at_least_32_chars_long',
      });
    }).toThrowError(/JWT_REFRESH_SECRET/);

    expect(() => {
      validateEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'valid_access_secret_at_least_32_chars_long',
        JWT_REFRESH_SECRET: 'valid_refresh_secret_at_least_32_chars_long',
        OAUTH_STATE_SECRET: 'your-oauth-secret',
      });
    }).toThrowError(/OAUTH_STATE_SECRET/);
  });

  it('6. GITHUB_CLIENT_ID="unset" reports GitHub as unavailable', () => {
    const configUnset = validateEnv({
      NODE_ENV: 'test',
      GITHUB_CLIENT_ID: 'unset',
      GITHUB_CLIENT_SECRET: 'valid_secret',
      JWT_ACCESS_SECRET: 'test_access_secret_32_characters_minimum_length',
      JWT_REFRESH_SECRET: 'test_refresh_secret_32_characters_minimum_length',
    });
    expect(isGitHubConfigured(configUnset)).toBe(false);

    const configBoth = validateEnv({
      NODE_ENV: 'test',
      GITHUB_CLIENT_ID: 'actual_client_id_123',
      GITHUB_CLIENT_SECRET: 'actual_client_secret_abc',
      JWT_ACCESS_SECRET: 'test_access_secret_32_characters_minimum_length',
      JWT_REFRESH_SECRET: 'test_refresh_secret_32_characters_minimum_length',
    });
    expect(isGitHubConfigured(configBoth)).toBe(true);
  });

  it('7. logOptionalFeaturesStatus logs disabled features at info level without logging secret values', () => {
    _resetLoggedOptionalFeaturesForTesting();
    const logSpy = vi.fn();

    const config = validateEnv({
      NODE_ENV: 'test',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
      MAIL_PROVIDER: 'console',
      DATABASE_URL: 'unset',
      JWT_ACCESS_SECRET: 'test_access_secret_32_characters_minimum_length',
      JWT_REFRESH_SECRET: 'test_refresh_secret_32_characters_minimum_length',
    });

    logOptionalFeaturesStatus(config, logSpy);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [logMeta, logMsg] = logSpy.mock.calls[0];
    expect(logMeta.disabledFeatures).toContain('GitHub login');
    expect(logMeta.disabledFeatures).toContain('SMTP mail');
    expect(logMeta.disabledFeatures).toContain('external DATABASE_URL');
    expect(logMsg).toContain('Optional features disabled');
    // Ensure no secret values are logged
    expect(JSON.stringify(logMeta)).not.toContain('test_access_secret');
  });

  it('8. LOCAL_DEMO never relaxes JWT secret checks in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        LOCAL_DEMO: 'true',
        JWT_ACCESS_SECRET: 'unset',
        JWT_REFRESH_SECRET: 'valid_refresh_secret_at_least_32_chars_long',
      })
    ).toThrowError(/JWT_ACCESS_SECRET/);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        LOCAL_DEMO: 'true',
        JWT_ACCESS_SECRET: 'valid_access_secret_at_least_32_chars_long',
        JWT_REFRESH_SECRET: '',
      })
    ).toThrowError(/JWT_REFRESH_SECRET/);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        LOCAL_DEMO: 'true',
        JWT_ACCESS_SECRET: 'too_short_secret_20ch',
        JWT_REFRESH_SECRET: 'valid_refresh_secret_at_least_32_chars_long',
      })
    ).toThrowError(/JWT_ACCESS_SECRET/);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        LOCAL_DEMO: 'true',
        JWT_ACCESS_SECRET: 'replace-with-at-least-32-char-access-secret',
        JWT_REFRESH_SECRET: 'valid_refresh_secret_at_least_32_chars_long',
      })
    ).toThrowError(/JWT_ACCESS_SECRET/);
  });

  it('9. LOCAL_DEMO derives OAUTH_STATE_SECRET, allows insecure cookies, and warns loudly', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const config = validateEnv({
        NODE_ENV: 'production',
        LOCAL_DEMO: 'true',
        AUTH_TRANSPORT: 'cookie',
        COOKIE_SECURE: 'false',
        JWT_ACCESS_SECRET: 'valid_access_secret_at_least_32_chars_long',
        JWT_REFRESH_SECRET: 'valid_refresh_secret_at_least_32_chars_long',
      });
      expect(config.OAUTH_STATE_SECRET).toHaveLength(64);
      expect(config.AUTH_TRANSPORT).toBe('cookie');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('LOCAL_DEMO=true is active'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('10. Production without LOCAL_DEMO still requires OAUTH_STATE_SECRET and Secure cookies', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'valid_access_secret_at_least_32_chars_long',
        JWT_REFRESH_SECRET: 'valid_refresh_secret_at_least_32_chars_long',
      })
    ).toThrowError(/OAUTH_STATE_SECRET/);

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        AUTH_TRANSPORT: 'cookie',
        COOKIE_SECURE: 'false',
        JWT_ACCESS_SECRET: 'valid_access_secret_at_least_32_chars_long',
        JWT_REFRESH_SECRET: 'valid_refresh_secret_at_least_32_chars_long',
        OAUTH_STATE_SECRET: 'valid_oauth_secret_at_least_32_chars_long',
      })
    ).toThrowError(/COOKIE_SECURE/);
  });
});

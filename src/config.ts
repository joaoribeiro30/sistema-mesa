import 'dotenv/config';
import { isIP } from 'node:net';
import { MAX_LOGIN_FAILURES } from './auth/login-guard.js';
import { loadPaymentConfig } from './payments/config.js';
import type { CaptchaConfig } from './security/captcha.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Configure ${name}.`);
  return value;
}

export function databaseUrl(): string {
  return required('DATABASE_URL');
}

function trustedProxies(): string[] {
  const entries = process.env.TRUSTED_PROXIES?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
  for (const entry of entries) {
    const [ip = '', prefix, ...extra] = entry.split('/');
    const version = isIP(ip);
    if (!version || extra.length || (prefix !== undefined &&
        (!/^[1-9][0-9]*$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error('TRUSTED_PROXIES deve conter IPs ou faixas CIDR específicas.');
    }
  }
  return entries;
}

function loadCaptcha(appUrl: URL): CaptchaConfig | undefined {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return;
  const hostname = process.env.TURNSTILE_HOSTNAME?.trim().toLowerCase() || appUrl.hostname;
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(hostname)) throw new Error('TURNSTILE_HOSTNAME inválido.');
  const loginAfter = Number(process.env.CAPTCHA_LOGIN_AFTER_FAILURES ?? 2);
  if (!Number.isInteger(loginAfter) || loginAfter < 1 || loginAfter >= MAX_LOGIN_FAILURES) {
    throw new Error(`CAPTCHA_LOGIN_AFTER_FAILURES deve estar entre 1 e ${MAX_LOGIN_FAILURES - 1}.`);
  }
  return { secret, hostname, loginAfter };
}

function parseOrigin(value: string, name: string, production: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} deve conter apenas origens HTTP ou HTTPS.`);
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.href !== `${url.origin}/` || url.hostname.includes('*')) {
    throw new Error(`${name} deve conter apenas origens HTTP ou HTTPS explícitas.`);
  }
  if (production && url.protocol !== 'https:') throw new Error(`${name} requer HTTPS em produção.`);
  return url;
}

function loadCorsOrigins(production: boolean, appOrigin: string, frontendOrigin?: string): string[] {
  const configured = process.env.CORS_ORIGINS?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
  const origins = new Set<string>([appOrigin]);
  if (frontendOrigin) origins.add(frontendOrigin);
  for (const entry of configured) {
    origins.add(parseOrigin(entry, 'CORS_ORIGINS', production).origin);
  }
  if (!production) {
    for (const devOrigin of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ]) {
      origins.add(devOrigin);
    }
  }
  return [...origins];
}

export function loadConfig() {
  const production = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida.');

  const appUrl = parseOrigin(
    process.env.APP_ORIGIN?.trim() || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`,
    'APP_ORIGIN', production,
  );
  const frontendUrl = process.env.FRONTEND_ORIGIN?.trim();
  const frontendOrigin = frontendUrl ? parseOrigin(frontendUrl, 'FRONTEND_ORIGIN', production).origin : undefined;

  const jwtSecret = required('JWT_SECRET');
  if (Buffer.byteLength(jwtSecret) < 32) throw new Error('JWT_SECRET precisa ter pelo menos 32 bytes.');

  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error('Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET juntos.');
  }

  const payments = loadPaymentConfig(production, jwtSecret);
  const demoMode = production && payments.provider === 'mock';
  const smtpUrl = process.env.SMTP_URL?.trim();
  if (production && !demoMode && !smtpUrl) throw new Error('Configure SMTP_URL em produção.');

  return {
    databaseUrl: databaseUrl(),
    host: process.env.HOST ?? '127.0.0.1',
    port,
    appOrigin: appUrl.origin,
    frontendOrigin,
    corsOrigins: loadCorsOrigins(production, appUrl.origin, frontendOrigin),
    secureCookies: appUrl.protocol === 'https:',
    trustedProxies: trustedProxies(),
    captcha: loadCaptcha(frontendOrigin ? new URL(frontendOrigin) : appUrl),
    jwtSecret,
    payments,
    demoMode,
    google: googleClientId && googleClientSecret
      ? { clientId: googleClientId, clientSecret: googleClientSecret }
      : undefined,
    smtpUrl,
    mailFrom: process.env.MAIL_FROM ?? 'Sistema Mesa <contato@example.test>',
  };
}

export type Config = ReturnType<typeof loadConfig>;

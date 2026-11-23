import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { HttpError } from '../http.js';
import { captchaVerifier, type CaptchaAction } from '../security/captcha.js';
import { accountTokens } from './account-tokens.js';
import { hashPassword, isUniqueViolation, normalizeEmail, sessionUser, userResponse } from './credentials.js';
import { googleFlow, OAUTH_AGE_SECONDS, oauthCookie, type GoogleProvider } from './google.js';
import { cleanName, Email } from './inputs.js';
import { loginGuard } from './login-guard.js';
import type { Sessions } from './session.js';

const Password = Type.String({ minLength: 1, maxLength: 72 });
const Token = Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' });
const captchaToken = Type.Optional(Type.String({ minLength: 1, maxLength: 2048, pattern: '^[!-~]+$' }));
const closed = { additionalProperties: false } as const;
const emailBody = { body: Type.Object({ email: Email, captchaToken }, closed) };
const limits = (ip: number, user = ip) => ({ securityLimits: { ip, user } });

export async function registerAuthRoutes(
  app: FastifyInstance, db: Db, config: Config, sessions: Sessions, provider?: GoogleProvider, captchaFetch?: typeof fetch,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const tokens = accountTokens(db, config, app.log);
  const google = googleFlow(db, provider);
  const login = await loginGuard(db, config);
  const verifyCaptcha = config.captcha ? captchaVerifier(config.captcha, captchaFetch) : undefined;
  const demoWithoutMail = config.demoMode && !config.smtpUrl;
  const challenge = async (action: CaptchaAction, token: string | undefined, ip: string) => verifyCaptcha?.(action, token, ip);
  const oauthCookieOptions = {
    httpOnly: true, secure: config.secureCookies, sameSite: 'lax' as const, path: '/auth/google/callback',
  };

  function browserCookie(reply: FastifyReply, attempt: Awaited<ReturnType<typeof google.start>>) {
    reply.setCookie(oauthCookie(attempt.state), attempt.browser, { ...oauthCookieOptions, maxAge: OAUTH_AGE_SECONDS });
  }

  api.post('/auth/register', {
    schema: { body: Type.Object({ email: Email, password: Password, name: Type.String({ minLength: 1, maxLength: 120 }), captchaToken }, closed) },
    config: limits(5, 3),
  }, async (request, reply) => {
    const email = normalizeEmail(request.body.email);
    const name = cleanName(request.body.name);
    if (!name) throw new HttpError(400, 'INVALID_NAME', 'Informe um nome válido.');
    await challenge('register', request.body.captchaToken, request.ip);
    const passwordHash = await hashPassword(request.body.password);
    const account = await db.user.create({
      data: { email, name, passwordHash, emailVerifiedAt: demoWithoutMail ? new Date() : undefined }, select: sessionUser,
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new HttpError(409, 'EMAIL_IN_USE', 'E-mail já cadastrado.');
      throw error;
    });
    if (!demoWithoutMail) await tokens.send(account, 'VERIFY_EMAIL');
    return reply.code(201).send({ user: userResponse(account) });
  });

  api.post('/auth/login', {
    schema: { body: Type.Object({ email: Email, password: Password, captchaToken }, closed) },
    config: limits(10, 6),
  }, async (request, reply) => {
    const { email, password, captchaToken: token } = request.body;
    const account = await login(normalizeEmail(email), password, reply, () => challenge('login', token, request.ip));
    return sessions.issue(account);
  });

  api.get('/auth/me', { preHandler: sessions.authenticate }, async (request) => ({ user: userResponse(request.account!) }));

  api.post('/auth/email/resend', { schema: emailBody, config: limits(5, 3) }, async (request, reply) => {
    await challenge('email_resend', request.body.captchaToken, request.ip);
    const account = await db.user.findUnique({ where: { email: normalizeEmail(request.body.email) }, select: sessionUser });
    if (account && !account.emailVerifiedAt) await tokens.send(account, 'VERIFY_EMAIL');
    return reply.code(202).send({ accepted: true });
  });

  api.post('/auth/email/verify', {
    schema: { body: Type.Object({ token: Token }, closed) }, config: limits(10, 5),
  }, async (request, reply) => {
    await tokens.verifyEmail(request.body.token);
    return reply.code(204).send();
  });

  api.post('/auth/password/forgot', { schema: emailBody, config: limits(5, 3) }, async (request, reply) => {
    await challenge('password_forgot', request.body.captchaToken, request.ip);
    if (demoWithoutMail) {
      throw new HttpError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'A recuperação de senha por e-mail está desativada nesta demonstração.');
    }
    const account = await db.user.findFirst({
      where: { email: normalizeEmail(request.body.email), passwordHash: { not: null } }, select: sessionUser,
    });
    if (account) await tokens.send(account, 'RESET_PASSWORD');
    return reply.code(202).send({ accepted: true });
  });

  api.post('/auth/password/reset', {
    schema: { body: Type.Object({ token: Token, password: Password }, closed) }, config: limits(5, 3),
  }, async (request, reply) => {
    const { token, password } = request.body;
    await tokens.resetPassword(token, await hashPassword(password));
    return reply.code(204).send();
  });

  api.get('/auth/google', { config: limits(10) }, async (_request, reply) => {
    const attempt = await google.start();
    browserCookie(reply, attempt);
    return reply.redirect(attempt.url);
  });

  api.post('/auth/google/link', {
    preHandler: sessions.authenticate, config: limits(5, 3),
  }, async (request, reply) => {
    const attempt = await google.start(request.account!);
    browserCookie(reply, attempt);
    return { authorizationUrl: attempt.url };
  });

  api.get('/auth/google/callback', {
    schema: { querystring: Type.Object({
      state: Type.Optional(Token), code: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, pattern: '^[!-~]+$' })),
      error: Type.Optional(Type.String({ maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' })),
    }) }, config: limits(20),
  }, async (request, reply) => {
    const name = request.query.state && oauthCookie(request.query.state);
    const browser = name ? request.cookies[name] : undefined;
    if (name) reply.clearCookie(name, oauthCookieOptions);
    const { account, created } = await google.finish(request.query, browser);
    if (created && !account.emailVerifiedAt) await tokens.send(account, 'VERIFY_EMAIL');
    sessions.setCookie(reply, account);
    const destination = config.frontendOrigin ? `${config.frontendOrigin}/auth/callback` : '/auth/me';
    return reply.redirect(destination, 303);
  });
}

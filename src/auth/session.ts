import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { UserRole } from '../generated/prisma/enums.js';
import { HttpError } from '../http.js';
import { sessionUser, userResponse, type SessionUser } from './credentials.js';

type Claims = { sub: string; role: UserRole; ver: number };
const SESSION_COOKIE = 'mesa_session';
const SESSION_SECONDS = 15 * 60;
const ISSUER = 'sistemamesa';
const AUDIENCE = 'sistemamesa-api';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Claims;
    user: Claims;
  }
}

declare module 'fastify' {
  interface FastifyRequest { account: SessionUser | null | undefined }
}

function unauthorized() {
  return new HttpError(401, 'UNAUTHORIZED', 'Sessão ausente, inválida ou expirada.');
}

export async function configureSessions(app: FastifyInstance, db: Db, config: Config) {
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { algorithm: 'HS256', iss: ISSUER, aud: AUDIENCE, expiresIn: SESSION_SECONDS },
    verify: { algorithms: ['HS256'], allowedIss: ISSUER, allowedAud: AUDIENCE, requiredClaims: ['sub', 'exp', 'ver'] },
  });
  app.decorateRequest('account');

  async function identify(request: FastifyRequest) {
    if (request.account !== undefined) return request.account;
    request.account = null;
    const authorization = request.headers.authorization;
    const useCookie = authorization === undefined;
    if (useCookie ? !request.cookies[SESSION_COOKIE] : !/^Bearer [^\s]+$/i.test(authorization)) return null;

    let claims: Claims;
    try {
      claims = await request.jwtVerify<Claims>({ onlyCookie: useCookie });
    } catch {
      return null;
    }
    if (typeof claims.sub !== 'string' || !UUID.test(claims.sub) || !Number.isInteger(claims.ver)) {
      return null;
    }
    const account = await db.user.findUnique({ where: { id: claims.sub }, select: sessionUser });
    if (!account || account.sessionVersion !== claims.ver) return null;
    return request.account = account;
  }

  async function authenticate(request: FastifyRequest) {
    const origin = request.headers.origin;
    if (request.headers.authorization === undefined && request.cookies[SESSION_COOKIE] &&
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        (!origin || (origin !== config.appOrigin && origin !== config.frontendOrigin))) {
      throw new HttpError(403, 'INVALID_ORIGIN', 'Origem da requisição inválida.');
    }
    if (!await identify(request)) throw unauthorized();
  }

  function requireRole(role: UserRole) {
    return async (request: FastifyRequest) => {
      await authenticate(request);
      if (request.account?.role !== role) throw new HttpError(403, 'FORBIDDEN', 'Acesso não permitido.');
    };
  }

  function issue(account: SessionUser) {
    return {
      accessToken: app.jwt.sign({ sub: account.id, role: account.role, ver: account.sessionVersion }),
      tokenType: 'Bearer',
      expiresIn: SESSION_SECONDS,
      user: userResponse(account),
    };
  }

  function setCookie(reply: FastifyReply, account: SessionUser) {
    reply.setCookie(SESSION_COOKIE, issue(account).accessToken, {
      httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/', maxAge: SESSION_SECONDS,
    });
  }

  return { authenticate, identify, requireRole, issue, setCookie };
}

export type Sessions = Awaited<ReturnType<typeof configureSessions>>;

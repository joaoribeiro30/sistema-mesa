import { createHash } from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../http.js';
import { isUniqueViolation, normalizeEmail, opaqueToken, sessionUser, sha256, type SessionUser } from './credentials.js';
import { cleanName, validEmail } from './inputs.js';

const CALLBACK = '/auth/google/callback';
export const OAUTH_AGE_SECONDS = 600;
export const oauthCookie = (state: string) => `mesa_oauth_${state}`;
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;

type GoogleProfile = { subject: string; email: string; name: string; authoritativeEmail: boolean };

export interface GoogleProvider {
  authorizationUrl(state: string, nonce: string, challenge: string): string;
  exchange(code: string, codeVerifier: string, nonce: string): Promise<GoogleProfile>;
}

export function configuredGoogle(config: Config): GoogleProvider | undefined {
  if (!config.google) return;
  const { clientId, clientSecret } = config.google;
  const client = new OAuth2Client(clientId, clientSecret, `${config.appOrigin}${CALLBACK}`);

  return {
    authorizationUrl(state, nonce, challenge) {
      return client.generateAuthUrl({
        scope: ['openid', 'email', 'profile'], state, nonce,
        code_challenge: challenge, code_challenge_method: CodeChallengeMethod.S256,
      });
    },
    async exchange(code, codeVerifier, nonce) {
      const { tokens } = await client.getToken({ code, codeVerifier });
      if (!tokens.id_token) throw new Error('ID token ausente.');
      const identity = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      const profile = identity.getPayload();
      if (!profile?.sub || profile.sub.length > 255 || profile.nonce !== nonce ||
          profile.email_verified !== true || !profile.email || (profile.azp && profile.azp !== clientId)) {
        throw new Error('Identidade Google inválida.');
      }
      const email = normalizeEmail(profile.email);
      if (!validEmail(email)) {
        throw new Error('E-mail Google inválido.');
      }
      const name = Array.from(cleanName(profile.name ?? '') ?? 'Usuário Google').slice(0, 120).join('');
      return { subject: profile.sub, email, name, authoritativeEmail: email.endsWith('@gmail.com') || Boolean(profile.hd) };
    },
  };
}

export function googleFlow(db: Db, provider?: GoogleProvider) {
  function getProvider(): GoogleProvider {
    if (!provider) throw new HttpError(503, 'GOOGLE_UNAVAILABLE', 'Login com Google indisponível.');
    return provider;
  }

  async function start(link?: SessionUser) {
    const google = getProvider();
    if (link && !link.emailVerifiedAt) throw new HttpError(403, 'EMAIL_UNVERIFIED', 'Verifique seu e-mail.');
    const state = opaqueToken();
    const browser = opaqueToken();
    const nonce = opaqueToken();
    const codeVerifier = opaqueToken();
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const now = new Date();
    await db.$transaction([
      db.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: now } } }),
      db.oAuthAttempt.create({ data: {
        stateHash: sha256(state), browserHash: sha256(browser), nonce, codeVerifier,
        linkUserId: link?.id, linkSessionVersion: link?.sessionVersion,
        expiresAt: new Date(now.getTime() + OAUTH_AGE_SECONDS * 1000),
      } }),
    ]);
    return { state, browser, url: google.authorizationUrl(state, nonce, challenge) };
  }

  async function identify(profile: GoogleProfile, linkUserId: string | null, linkVersion: number | null) {
    try {
      return await db.$transaction(async (tx) => {
        if (linkUserId) {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${linkUserId}::uuid FOR UPDATE`;
        }
        const identity = await tx.googleIdentity.findUnique({
          where: { subject: profile.subject }, select: { user: { select: sessionUser } },
        });
        if (!linkUserId) {
          if (identity) return { account: identity.user, created: false };
          const account = await tx.user.create({ data: {
            email: profile.email, name: profile.name,
            emailVerifiedAt: profile.authoritativeEmail ? new Date() : null,
            googleIdentity: { create: { subject: profile.subject } },
          }, select: sessionUser });
          return { account, created: true };
        }

        const account = await tx.user.findUnique({ where: { id: linkUserId }, select: sessionUser });
        if (!account?.emailVerifiedAt || account.sessionVersion !== linkVersion || account.email !== profile.email) {
          throw new HttpError(403, 'GOOGLE_LINK_FORBIDDEN', 'Use a conta Google com o mesmo e-mail verificado.');
        }
        if (identity?.user.id === account.id) return { account, created: false };
        await tx.googleIdentity.create({ data: { subject: profile.subject, userId: account.id } });
        await tx.auditLog.create({ data: {
          action: 'GOOGLE_LINKED', actorUserId: account.id, subjectUserId: account.id, details: {},
        } });
        return { account, created: false };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (!linkUserId) {
        const identity = await db.googleIdentity.findUnique({
          where: { subject: profile.subject }, select: { user: { select: sessionUser } },
        });
        if (identity) return { account: identity.user, created: false };
      }
      throw new HttpError(409, 'GOOGLE_ACCOUNT_CONFLICT', 'E-mail ou conta Google em uso. Para vincular, entre na conta existente.');
    }
  }

  async function finish(input: { state?: string; code?: string; error?: string }, browser?: string) {
    const google = getProvider();
    if (!input.state || !browser || !OPAQUE.test(input.state) || !OPAQUE.test(browser)) {
      throw new HttpError(400, 'GOOGLE_STATE_INVALID', 'Solicitação Google inválida ou expirada.');
    }
    const attempt = await db.oAuthAttempt.delete({ where: {
      stateHash: sha256(input.state), browserHash: sha256(browser), expiresAt: { gt: new Date() },
    } }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new HttpError(400, 'GOOGLE_STATE_INVALID', 'Solicitação Google inválida ou expirada.');
      }
      throw error;
    });
    if (input.error || !input.code) throw new HttpError(400, 'GOOGLE_CANCELLED', 'Login Google cancelado ou inválido.');

    let profile: GoogleProfile;
    try {
      profile = await google.exchange(input.code, attempt.codeVerifier, attempt.nonce);
    } catch {
      throw new HttpError(401, 'GOOGLE_IDENTITY_INVALID', 'Não foi possível validar a identidade Google.');
    }
    return identify(profile, attempt.linkUserId, attempt.linkSessionVersion);
  }

  return { start, finish };
}

import { HttpError } from '../http.js';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type CaptchaConfig = { secret: string; hostname: string; loginAfter: number };
export type CaptchaAction = 'login' | 'register' | 'password_forgot' | 'email_resend';

export function captchaRequired() {
  return new HttpError(403, 'CAPTCHA_REQUIRED', 'Resolva o CAPTCHA e envie captchaToken.');
}

export function captchaVerifier(config: CaptchaConfig, http = fetch) {
  return async (action: CaptchaAction, token: string | undefined, ip: string) => {
    if (!token) throw captchaRequired();
    let result: { success?: boolean; hostname?: string; action?: string } | undefined;
    try {
      const response = await http(SITEVERIFY, {
        method: 'POST',
        body: new URLSearchParams({ secret: config.secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Siteverify indisponível.');
      result = await response.json();
    } catch {
      throw new HttpError(503, 'CAPTCHA_UNAVAILABLE', 'CAPTCHA indisponível. Tente novamente.');
    }
    if (result?.success !== true || result.hostname !== config.hostname || result.action !== action) {
      throw new HttpError(403, 'CAPTCHA_INVALID', 'CAPTCHA inválido ou expirado.');
    }
  };
}

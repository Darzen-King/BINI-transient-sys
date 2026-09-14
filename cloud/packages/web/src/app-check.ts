/**
 * App Check reCAPTCHA Enterprise (score-based) site key for the deployed web app. The key is public and is the
 * only value App Check needs; the Firebase console registers the same site key (no secret key is involved). Emulator runs skip App Check, and an unset key leaves it off rather than
 * failing, so enforcement stays a console decision (monitor first, enforce later).
 */
export function appCheckSiteKey(env: { VITE_RECAPTCHA_SITE_KEY?: string | undefined; VITE_USE_EMULATORS?: string | undefined }): string | null {
  if (env.VITE_USE_EMULATORS === '1') return null;
  const key = env.VITE_RECAPTCHA_SITE_KEY?.trim();
  return key && key !== 'REPLACE_ME' ? key : null;
}

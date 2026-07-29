// The one source of truth for which terms-of-service/privacy-policy version
// a new registration is agreeing to. Deliberately never accepted from the
// client — the registration Zod schema only accepts booleans
// (termsAccepted/privacyAccepted); the *version* recorded against a
// CustomerConsent row always comes from here, injected server-side. A
// visitor cannot claim to have accepted a version different from what's
// actually live. Bump these (and update the corresponding legal copy)
// whenever the terms/privacy policy text changes — see CONTRIBUTING.md.
export const CURRENT_TERMS_VERSION = "2026-01-01";
export const CURRENT_PRIVACY_VERSION = "2026-01-01";

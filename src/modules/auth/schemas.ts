import { z } from "zod";

// Shared by client forms (react-hook-form) and, where applicable, server
// actions. These mirror the validation Better Auth itself performs
// server-side on its own endpoints — this is UX-level validation, not the
// sole line of defense.
export const loginSchema = z.object({
  email: z.email("Ingresá un email válido"),
  password: z.string().min(1, "Ingresá tu contraseña"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email("Ingresá un email válido"),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Password policy (documented in SECURITY.md): 8-128 chars, at least one
// letter and one number. Deliberately no additional complexity rules
// (uppercase/symbol requirements) — those are documented to push people
// toward predictable substitutions ("Password1!") or reuse, not real
// strength; length plus a letter+number floor is the better tradeoff.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

// .strict(): an unknown key (role, roleId, isAdmin, emailVerified, ...) is a
// validation error, not silently dropped — defense in depth beyond simply
// not declaring those fields, so a probing extra field fails loudly. See
// SECURITY.md "Public registration" / docs/adr/0003-customer-registration.md.
export const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Ingresá tu nombre").max(200, "El nombre es demasiado largo"),
    email: z.email("Ingresá un email válido"),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
      .max(PASSWORD_MAX_LENGTH, "La contraseña es demasiado larga")
      .refine((value) => /[a-zA-Z]/.test(value), "La contraseña debe tener al menos una letra")
      .refine((value) => /[0-9]/.test(value), "La contraseña debe tener al menos un número"),
    passwordConfirmation: z.string().min(1, "Confirmá tu contraseña"),
    termsAccepted: z
      .boolean()
      .refine((value) => value === true, "Tenés que aceptar los términos y condiciones"),
    privacyAccepted: z
      .boolean()
      .refine((value) => value === true, "Tenés que aceptar la política de privacidad"),
    // Optional and visually independent of the required legal acceptances
    // above — never a condition for account creation.
    marketingConsent: z.boolean().default(false),
  })
  .strict()
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "Las contraseñas no coinciden",
    path: ["passwordConfirmation"],
  });
export type RegisterInput = z.input<typeof registerSchema>;

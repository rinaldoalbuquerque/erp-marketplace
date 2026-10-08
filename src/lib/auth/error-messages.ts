// Supabase Auth error codes -> messages in Portuguese.
// Codes: https://supabase.com/docs/guides/auth/debugging/error-codes
// Messages are deliberately generic: they never reveal whether an e-mail has an account.

export const GENERIC_ERROR = "Não foi possível concluir agora. Tente novamente em instantes.";
export const INVALID_LOGIN = "E-mail ou senha incorretos.";
export const EMAIL_NOT_CONFIRMED =
  "Seu e-mail ainda não foi confirmado. Abra o link que enviamos ou peça um novo abaixo.";
export const RATE_LIMITED = "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.";
export const SIGNUP_CLOSED = "O cadastro está fechado. O acesso é feito apenas por convite.";
export const WEAK_PASSWORD =
  "Essa senha é fraca. Escolha uma senha mais longa e difícil de adivinhar.";
export const SAME_PASSWORD = "A nova senha precisa ser diferente da senha atual.";
export const LINK_INVALID = "Este link é inválido ou expirou. Peça um novo.";

const MESSAGES: Record<string, string> = {
  invalid_credentials: INVALID_LOGIN,
  email_not_confirmed: EMAIL_NOT_CONFIRMED,
  over_request_rate_limit: RATE_LIMITED,
  over_email_send_rate_limit: RATE_LIMITED,
  signup_disabled: SIGNUP_CLOSED,
  weak_password: WEAK_PASSWORD,
  same_password: SAME_PASSWORD,
  otp_expired: LINK_INVALID,
  flow_state_expired: LINK_INVALID,
  bad_jwt: LINK_INVALID,
};

/** Message for a Supabase Auth error code; unknown codes get a generic message. */
export function authErrorMessage(code: string | undefined | null): string {
  return (code && MESSAGES[code]) || GENERIC_ERROR;
}

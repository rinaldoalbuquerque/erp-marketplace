// Route paths used by the auth flow (URLs in Portuguese, code in English).
export const ROUTES = {
  home: "/painel",
  login: "/entrar",
  signup: "/cadastro",
  checkEmail: "/verifique-seu-email",
  forgotPassword: "/esqueci-a-senha",
  resetPassword: "/redefinir-senha",
  noAccess: "/sem-acesso",
  forbidden: "/sem-permissao",
  terms: "/termos",
  privacy: "/privacidade",
  emailConfirm: "/auth/confirm",
} as const;

/** Pages anyone can open without being logged in. */
const PUBLIC_PATHS: readonly string[] = [
  ROUTES.login,
  ROUTES.signup,
  ROUTES.checkEmail,
  ROUTES.forgotPassword,
  ROUTES.terms,
  ROUTES.privacy,
  ROUTES.noAccess,
];

/** Logged-in users are sent to the dashboard instead of seeing these. */
const GUEST_ONLY_PATHS: readonly string[] = [ROUTES.login, ROUTES.signup];

function matches(pathname: string, paths: readonly string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Where to redirect (if anywhere) for a request, given whether the user is logged in.
 * Everything not explicitly public requires login.
 */
export function resolveAccessRedirect(pathname: string, isLoggedIn: boolean): string | null {
  if (pathname.startsWith("/auth/")) return null; // e-mail link handlers
  if (isLoggedIn) {
    return matches(pathname, GUEST_ONLY_PATHS) ? ROUTES.home : null;
  }
  if (matches(pathname, PUBLIC_PATHS)) return null;
  const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return `${ROUTES.login}${next}`;
}

/**
 * Validates a "next" redirect target from the URL. Only internal paths are allowed,
 * so a malicious link can't send the user to another site after login.
 */
export function safeNextPath(next: string | null | undefined, fallback: string = ROUTES.home) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  try {
    // Resolving against a dummy origin catches tricks like "/%2F%2Fevil.com".
    const url = new URL(next, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return fallback;
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.startsWith("//") || decoded.includes("\\")) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

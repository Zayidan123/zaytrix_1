// Client-side auth API client.
// Talks to the real server-side auth endpoints implemented by SEC-BACKEND
// (see /home/z/my-project/src/server/auth.ts) + SEC2-AUTH additions.
// The `zaytrix_session` cookie is httpOnly so JS cannot read it — auth state
// is determined exclusively by calling GET /api/auth/me.

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  twoFactorEnabled: boolean;
  // SEC2-AUTH additions (additive — older code that doesn't read these still works):
  emailVerified?: boolean;
  oauthProvider?: string | null;
}

export type AuthResult = {
  success: boolean;
  user?: AuthUser;
  error?: string;
  // SEC2-AUTH: 2FA challenge during login. If success=false + requiresTwoFactor=true,
  // the caller should prompt for a 6-digit TOTP code and call loginWith2FA(tempToken, code).
  requiresTwoFactor?: boolean;
  tempToken?: string;
  message?: string;
};

// SEC2-AUTH: generic result type for the new endpoints (2FA setup/verify,
// email verification, password reset, sessions, CSRF).
export type ApiResult = {
  success: boolean;
  error?: string;
  message?: string;
  [key: string]: any;
};

const NETWORK_ERROR_MSG = "Gagal terhubung ke server. Periksa koneksi Anda.";

/**
 * Check the current session by calling GET /api/auth/me.
 * Returns the AuthUser if a valid session cookie is present, otherwise null.
 * Never throws — network/parsing errors are treated as "not authenticated".
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.success && data.user ? (data.user as AuthUser) : null;
  } catch {
    return null;
  }
}

/**
 * Register a new user via POST /api/auth/register.
 * On success the server sets the `zaytrix_session` httpOnly cookie and
 * returns the public user object.
 */
export async function registerUser(
  email: string,
  password: string,
  displayName: string
): Promise<AuthResult> {
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, displayName }),
    });
    const data = await res.json();
    return data as AuthResult;
  } catch {
    return {
      success: false,
      error: NETWORK_ERROR_MSG,
    };
  }
}

/**
 * Login an existing user via POST /api/auth/login.
 * On success the server sets the `zaytrix_session` httpOnly cookie and
 * returns the public user object. If the user has 2FA enabled, success will
 * be false but requiresTwoFactor=true with a tempToken — the caller should
 * then call loginWith2FA(tempToken, code).
 */
export async function loginUser(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    return data as AuthResult;
  } catch {
    return {
      success: false,
      error: NETWORK_ERROR_MSG,
    };
  }
}

/**
 * Logout the current user via POST /api/auth/logout.
 * Clears the `zaytrix_session` cookie server-side. Never throws — callers
 * (e.g. App.tsx's Firebase signOut listener) treat this as fire-and-forget.
 */
export async function logoutUser(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // swallowed — logout is best-effort; the client state is cleared regardless
  }
}

// ============================================================================
// SEC2-AUTH additions — 2FA, email verification, password reset, CSRF,
// sessions, OAuth (client-side wrappers). All use credentials:"include" so
// the httpOnly session cookie is sent automatically. None of these throw —
// network errors are returned as { success:false, error: NETWORK_ERROR_MSG }.
// ============================================================================

/**
 * Complete login with a 2FA code. The tempToken comes from loginUser() when
 * requiresTwoFactor=true. On success, the server sets the real session cookie.
 */
export async function loginWith2FA(tempToken: string, code: string): Promise<AuthResult> {
  try {
    const res = await fetch("/api/auth/login/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tempToken, code }),
    });
    const data = await res.json();
    return data as AuthResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Begin 2FA setup. Server generates a fresh TOTP secret, encrypts + persists
 * it, and returns the plaintext secret + otpauthUri for the user to add to
 * their authenticator app. 2FA is NOT enabled yet — call verify2FA(code) next.
 */
export async function setup2FA(): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/2fa/setup", {
      method: "POST",
      credentials: "include",
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Verify a TOTP code from the user's authenticator app. On success, 2FA is
 * enabled + 8 one-time backup codes are returned (only displayed ONCE).
 */
export async function verify2FA(code: string): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/2fa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Disable 2FA. Requires a valid TOTP code as confirmation.
 */
export async function disable2FA(code: string): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Verify the user's email with a token from a verification email link.
 * Public endpoint (no auth required).
 */
export async function verifyEmail(token: string): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Request a new email verification link (requires auth).
 */
export async function resendVerification(): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      credentials: "include",
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Request a password reset email. ALWAYS returns success (no user enumeration).
 * Public endpoint.
 */
export async function forgotPassword(email: string): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Reset password using a token from a reset email. Public endpoint.
 */
export async function resetPassword(token: string, newPassword: string): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token, newPassword }),
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Fetch a CSRF token + set the zaytrix_csrf cookie. The returned token should
 * be sent as the x-csrf-token header on subsequent mutating requests. Note:
 * the server currently ENFORCES CSRF only when the cookie is present (backward
 * compat) — calling this is opt-in but recommended for all new mutation flows.
 */
export async function getCsrfToken(): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/csrf-token", { credentials: "include" });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * List the current user's active sessions (each = a logged-in device/browser).
 * The current session is flagged with `current:true`.
 */
export async function getSessions(): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/sessions", { credentials: "include" });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Revoke a single session by id. The current session cannot be revoked this
 * way (use logoutUser() instead).
 */
export async function revokeSession(id: string): Promise<ApiResult> {
  try {
    const res = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

/**
 * Revoke all sessions EXCEPT the current one. Returns the count of revoked
 * sessions in `revoked`.
 */
export async function revokeOtherSessions(): Promise<ApiResult> {
  try {
    const res = await fetch("/api/auth/sessions/logout-others", {
      method: "POST",
      credentials: "include",
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { success: false, error: NETWORK_ERROR_MSG };
  }
}

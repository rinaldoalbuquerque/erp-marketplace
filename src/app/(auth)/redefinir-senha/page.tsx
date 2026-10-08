import type { Metadata } from "next";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Criar nova senha" };

/**
 * Reached from the password reset e-mail (via /auth/confirm), which logs the
 * user in with a recovery session. The proxy blocks it for logged-out users and
 * the Server Action checks the session again.
 */
export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-gray-900">Criar nova senha</h1>
      <ResetPasswordForm />
    </div>
  );
}

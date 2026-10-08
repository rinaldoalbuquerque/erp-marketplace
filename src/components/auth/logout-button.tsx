import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/(auth)/actions";

/** "Sair" button. A form (not a link) so logout can't be triggered by a prefetch. */
export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
      >
        <LogOut className="size-4" aria-hidden="true" />
        Sair
      </button>
    </form>
  );
}

import { logoutAction } from "@/app/(auth)/actions";

/** "Sair" button. A form (not a link) so logout can't be triggered by a prefetch. */
export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className={
          className ??
          "rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        }
      >
        Sair
      </button>
    </form>
  );
}

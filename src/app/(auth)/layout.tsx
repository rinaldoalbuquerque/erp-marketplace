import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Frame of the public auth pages (login, sign-up...): petrol brand panel on
 * large screens, form column on the right (alone on mobile).
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="relative hidden w-[42%] max-w-xl flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-ink lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark className="size-9" />
          <span className="font-display text-xl font-semibold">ERP Marketplace</span>
        </div>

        <div className="relative z-10 max-w-sm">
          <p className="font-display text-4xl leading-tight font-semibold">
            Anúncios, estoque e pedidos dos seus marketplaces num só lugar.
          </p>
          <p className="mt-4 text-sidebar-muted">
            Crie, replique e acompanhe anúncios em todas as suas contas, com o estoque sempre em
            dia.
          </p>
        </div>

        <p className="text-sm text-sidebar-muted">Começando pelo Mercado Livre.</p>

        {/* Oversized tag in the background: the brand's one decorative element. */}
        <BrandMark
          mono
          className="pointer-events-none absolute -right-24 -bottom-20 size-96 text-sidebar-hover"
        />
      </aside>

      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end lg:p-6">
          <span className="flex items-center gap-2 text-ink lg:hidden">
            <BrandMark className="size-7 text-brand" />
            <span className="font-display text-lg font-semibold">ERP Marketplace</span>
          </span>
          <ThemeToggle />
        </div>
        <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-12 sm:items-center sm:pt-0">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}

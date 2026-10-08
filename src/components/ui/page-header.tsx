import Link from "next/link";

/** Title of an internal page, with optional back link and actions on the right. */
export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-1 inline-block text-sm text-muted hover:text-brand">
            ‹ {back.label}
          </Link>
        ) : null}
        <h1 className="truncate text-3xl font-semibold text-ink">{title}</h1>
        {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Link styled as the primary button. */
export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
        variant === "primary"
          ? "bg-brand text-on-brand hover:bg-brand-hover"
          : "border border-border bg-surface text-ink hover:bg-surface-2"
      }`}
    >
      {children}
    </Link>
  );
}

/** Centered card used by the public auth pages (login, sign-up...). */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-xl font-semibold text-gray-900">ERP Marketplace</p>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}

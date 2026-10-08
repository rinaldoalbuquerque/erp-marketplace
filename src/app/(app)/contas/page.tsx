import { Plug, RefreshCw, Unplug } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ButtonLink, PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { listAccounts } from "@/server/marketplaces/accounts";
import { env } from "@/server/env";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { disconnectAccountAction, testConnectionAction } from "./actions";

export const metadata: Metadata = { title: "Contas de marketplace" };

const CONNECT_URL = "/contas/mercadolivre/conectar";

const ERRORS: Record<string, string> = {
  "nao-configurado":
    "A integração com o Mercado Livre ainda não está configurada (faltam variáveis no servidor).",
  "autorizacao-cancelada": "A autorização foi cancelada no Mercado Livre. Nada foi conectado.",
  "link-invalido": "Não foi possível confirmar a conexão. Comece de novo pelo botão Conectar.",
  expirado: "A autorização demorou mais de 10 minutos. Comece de novo pelo botão Conectar.",
  "outra-empresa": "Essa conta do Mercado Livre já está conectada a outra empresa.",
  "autorizacao-recusada":
    "O Mercado Livre recusou a autorização. Entre com a conta principal (não colaborador) e tente de novo.",
  "mercadolivre-indisponivel": "O Mercado Livre não respondeu. Tente de novo em instantes.",
};

const TEST_MESSAGES: Record<string, { tone: "success" | "error"; text: string }> = {
  reconnect: { tone: "error", text: "A conta precisa ser reconectada." },
  error: { tone: "error", text: "O Mercado Livre não respondeu. Tente de novo em instantes." },
  not_found: { tone: "error", text: "Conta não encontrada." },
};

const LISTING_MODEL_LABELS = {
  traditional: "Tradicional (com variações)",
  user_products: "User Products",
  unknown: "A confirmar",
} as const;

const DATE = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export default function AccountsPage({ searchParams }: PageProps<"/contas">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <Accounts searchParams={searchParams} />
    </Suspense>
  );
}

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

async function Accounts({ searchParams }: Pick<PageProps<"/contas">, "searchParams">) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  const accounts = await listAccounts(tdb);
  const query = await searchParams;

  const configured = Boolean(
    env.ML_CLIENT_ID && env.ML_CLIENT_SECRET && env.ML_REDIRECT_URI && env.TOKEN_ENCRYPTION_KEY,
  );

  let notice: { tone: "success" | "error"; text: string } | null = null;
  if (param(query.conectada)) {
    notice = { tone: "success", text: `Conta ${param(query.conectada)} conectada.` };
  } else if (param(query.erro)) {
    notice = { tone: "error", text: ERRORS[param(query.erro)] ?? "Não foi possível conectar." };
  } else if (param(query.teste) === "ok") {
    notice = { tone: "success", text: `Conexão com ${param(query.conta)} funcionando.` };
  } else if (param(query.teste)) {
    notice = TEST_MESSAGES[param(query.teste)] ?? null;
  } else if (param(query.desconectada)) {
    notice = { tone: "success", text: "Conta desconectada. Os tokens foram apagados do ERP." };
  }

  return (
    <>
      <PageHeader
        title="Contas de marketplace"
        description="Conecte quantas contas quiser. Cada uma tem sua própria autorização."
        actions={
          configured ? (
            <ButtonLink href={CONNECT_URL}>
              <Plug className="size-4" aria-hidden="true" />
              Conectar conta do Mercado Livre
            </ButtonLink>
          ) : null
        }
      />

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mb-5 rounded-lg border-l-4 px-3 py-2 text-sm ${
            notice.tone === "error"
              ? "border-danger bg-danger-soft text-danger"
              : "border-success bg-success-soft text-success"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {!configured ? (
        <p className="mb-5 rounded-lg border-l-4 border-signal bg-signal-soft px-3 py-2 text-sm text-signal-ink">
          Integração ainda não configurada: preencha ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI
          e TOKEN_ENCRYPTION_KEY no servidor.
        </p>
      ) : null}

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">Nenhuma conta conectada</p>
          <p className="mt-1 text-sm text-muted">
            Ao conectar, você entra no Mercado Livre com a conta principal (não colaborador) e
            autoriza o ERP.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted">Mercado Livre</p>
                  <p className="truncate font-display text-xl font-semibold text-ink">
                    {account.nickname}
                  </p>
                  <p className="text-xs text-muted tabular-nums">ID {account.externalUserId}</p>
                </div>
                <StatusBadge status={account.status} />
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Tipo de anúncio</dt>
                <dd className="text-ink">{LISTING_MODEL_LABELS[account.listingModel]}</dd>
                <dt className="text-muted">Conectada em</dt>
                <dd className="text-ink">
                  {DATE.format(account.createdAt)}
                  {account.connectedBy ? ` por ${account.connectedBy.fullName.split(" ")[0]}` : ""}
                </dd>
                <dt className="text-muted">Última sincronização</dt>
                <dd className="text-ink">
                  {account.lastSyncAt ? DATE.format(account.lastSyncAt) : "Ainda não sincronizada"}
                </dd>
              </dl>

              {account.lastError ? (
                <p className="rounded-lg bg-signal-soft px-3 py-2 text-sm text-signal-ink">
                  {account.lastError}
                </p>
              ) : null}

              <div className="mt-auto flex flex-wrap gap-2">
                {account.status === "active" ? (
                  <>
                    <form action={testConnectionAction.bind(null, account.id)}>
                      <SecondaryButton icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                        Testar conexão
                      </SecondaryButton>
                    </form>
                    <form action={disconnectAccountAction.bind(null, account.id)}>
                      <SecondaryButton icon={<Unplug className="size-4" aria-hidden="true" />}>
                        Desconectar
                      </SecondaryButton>
                    </form>
                  </>
                ) : configured ? (
                  <ButtonLink href={CONNECT_URL}>
                    <Plug className="size-4" aria-hidden="true" />
                    Reconectar
                  </ButtonLink>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: "active" | "needs_reauth" | "disconnected" }) {
  const styles = {
    active: "bg-success-soft text-success",
    needs_reauth: "bg-signal-soft text-signal-ink",
    disconnected: "bg-surface-2 text-muted",
  } as const;
  const labels = {
    active: "Conectada",
    needs_reauth: "Precisa reconectar",
    disconnected: "Desconectada",
  } as const;
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function SecondaryButton({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
    >
      {icon}
      {children}
    </button>
  );
}

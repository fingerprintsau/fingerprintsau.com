import { trpc } from "@/lib/trpc";

export default function AdminProviders() {
  const settings = trpc.admin.providerSettings.useQuery(undefined, { retry: false });
  if (settings.isLoading) return <main className="admin-provider-page"><p>Loading provider settings…</p></main>;
  if (settings.isError) return <main className="admin-provider-page"><h1>Provider settings</h1><p>Admin access required.</p></main>;
  const data = settings.data;
  return <main className="admin-provider-page"><div className="view-header"><div><div className="eyebrow">Admin only</div><h1>Provider settings</h1></div><div className="hero-note">Customer-facing screens use neutral product labels.</div></div><section className="panel"><div className="panel-head"><div><div className="panel-title">Internal configuration</div><div className="panel-meta">Provider names and readiness are visible only to administrators.</div></div></div><div className="provider-list">{Object.entries(data ?? {}).flatMap(([group, providers]) => (providers as readonly { id: string; label: string; mode: string; configured: boolean }[]).map((provider) => <div className="provider-row" key={`${group}-${provider.id}`}><span className={`provider-dot ${provider.configured ? "ready" : ""}`} /><strong>{provider.label}</strong><span className="provider-state">{provider.configured ? "Ready" : "Not configured"}</span></div>))}</div></section></main>;
}

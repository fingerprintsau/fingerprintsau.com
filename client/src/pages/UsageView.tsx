import { useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, CheckCircle2, CreditCard, Gauge, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function UsageView() {
  const catalog = trpc.product.catalog.useQuery();
  const usage = trpc.usage.summary.useQuery(undefined, { retry: false });
  const checkout = trpc.billing.createCheckout.useMutation();
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const pricing = catalog.data?.pricing;
  const freeTrials = usage.data?.freeTrials ?? { modelImage: 2, listingCopy: 2, conditionReport: 2, video: 2 };

  const buy = async (packId: string) => {
    setSelectedPack(packId);
    try {
      const result = await checkout.mutateAsync({ packId });
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
      toast.success("Opening secure checkout.");
    } catch {
      toast.error("Something went wrong, you haven't been charged");
    } finally {
      setSelectedPack(null);
    }
  };

  const allowances = [
    ["Model images", freeTrials.modelImage, pricing?.modelImage?.priceCents ?? 89],
    ["Listing write-ups", freeTrials.listingCopy, pricing?.listingCopy?.priceCents ?? 19],
    ["Condition reports", freeTrials.conditionReport, pricing?.conditionReport?.priceCents ?? 39],
    ["Video generations", freeTrials.video, pricing?.video?.priceCents ?? 149],
  ] as const;

  return <>
    <div className="view-header"><div><div className="eyebrow">Straightforward by design</div><h1>Usage & credits</h1></div><div className="hero-note"><strong>2 free tries</strong> on each creative tool, then pay as you grow.</div></div>
    <section className="usage-hero"><div><div className="feature-kicker">Fingerprints economics</div><div className="usage-hero-title">You only pay when<br /><span>the work happens.</span></div><p>Every creative tool is metered. Your first two tries are included, then you pay only for work you run.</p></div><div className="usage-score"><Gauge size={18} /><strong>{usage.data?.credits ?? 0}</strong><span>credits ready</span></div></section>
    <section className="panel"><div className="panel-head"><div><div className="panel-title">Included allowances</div><div className="panel-meta">Your first two uses are on us.</div></div><Sparkles size={16} color="#f0442f" /></div><div className="allowance-list">{allowances.map(([label, remaining, cents]) => <div className="allowance-row" key={label}><div><strong>{label}</strong><span>{remaining} free remaining · then {money(cents)}</span></div><span className="allowance-count">{remaining}</span></div>)}<div className="allowance-row"><div><strong>Single background removal</strong><span>Always free when processing one image</span></div><CheckCircle2 size={16} color="#4e915e" /></div><div className="allowance-row"><div><strong>Batch background removal</strong><span>12¢ per image after checkout</span></div><span className="allowance-count muted">$</span></div></div></section>
    <section className="panel credit-panel"><div className="panel-head"><div><div className="panel-title">Add credits</div><div className="panel-meta">Secure checkout · AUD</div></div><CreditCard size={16} color="#aaa89f" /></div><div className="credit-grid">{(catalog.data?.creditPacks ?? [{ id: "starter", name: "Starter credits", credits: 10, amountCents: 1200, description: "A small boost for your next drop." }, { id: "studio", name: "Studio credits", credits: 30, amountCents: 2900, description: "For sellers with a weekly rhythm." }, { id: "pro", name: "Pro credits", credits: 80, amountCents: 6900, description: "More room to create, clean and publish." }]).map((pack, index) => <div className={`credit-card ${index === 1 ? "featured" : ""}`} key={pack.id}><div className="credit-card-top"><span className="credit-kicker">{index === 1 ? "Most popular" : "Credit pack"}</span><ArrowUpRight size={15} /></div><div className="credit-amount">{pack.credits}<span> credits</span></div><p>{pack.description}</p><div className="credit-buy-row"><strong>{money(pack.amountCents)}</strong><button className="primary-button" onClick={() => buy(pack.id)} disabled={selectedPack === pack.id}>{selectedPack === pack.id ? "Opening…" : "Add credits"}</button></div></div>)}</div></section>
  </>;
}

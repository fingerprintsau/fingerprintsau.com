import type { ReactNode } from "react";
import { LEGAL_DRAFTS } from "@/content/legalContent";
import { LegalLayout } from "@/components/LegalShell";
import { useEffect } from "react";

const TITLES: Record<string, string> = {
  terms: "Terms of Use",
  "seller-agreement": "Seller Agreement",
  privacy: "Privacy Policy",
  refunds: "Refunds and Credits Policy",
  "prohibited-items": "Prohibited Items Policy",
  "community-guidelines": "Community Guidelines",
  "promotions-terms": "Promotions and Prize Draw Terms",
  cookies: "Cookie Notice",
  contact: "Contact",
  about: "About Fingerprints",
};
const LAST_UPDATED = "25 September 2026";

export default function LegalPage({ slug }: { slug: keyof typeof LEGAL_DRAFTS }) {
  const text = LEGAL_DRAFTS[slug];
  useEffect(() => {
    let node = document.head.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!node) { node = document.createElement("meta"); node.name = "robots"; document.head.appendChild(node); }
    const previous = node.content;
    node.content = slug === "promotions-terms" ? "noindex, nofollow" : "index, follow";
    return () => { node!.content = previous; };
  }, [slug]);
  return <LegalLayout><div className="draft-banner">Draft – not yet in effect</div><article className="legal-card"><div className="eyebrow">Fingerprints legal</div><h1>{TITLES[slug]}</h1><p className="legal-updated">Last updated: {LAST_UPDATED}</p><pre className="legal-copy">{text}</pre></article></LegalLayout>;
}

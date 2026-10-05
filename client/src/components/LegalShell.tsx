import type { ReactNode } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

export const FOOTER_GROUPS = [
  { title: "Shop", links: [["Home", "/"], ["Browse", "/"], ["Sell on Fingerprints", "/dashboard"]] },
  { title: "Legal", links: [["Terms", "/terms"], ["Privacy", "/privacy"], ["Seller Agreement", "/seller-agreement"], ["Refunds and Credits", "/refunds"], ["Prohibited Items", "/prohibited-items"], ["Community Guidelines", "/community-guidelines"], ["Cookies", "/cookies"], ["Contact", "/contact"]] },
];

export function SiteFooter() {
  const siteConfig = trpc.site.config.useQuery();
  return <footer className="site-footer"><div className="footer-grid"><div className="footer-brand"><Link href="/" className="footer-wordmark">fingerprints<span>au</span><small>™</small></Link><p>Good pieces leave a mark.</p><a href="mailto:shop@fingerprintsau.com">shop@fingerprintsau.com</a></div>{FOOTER_GROUPS.map((group) => <div className="footer-group" key={group.title}><strong>{group.title}</strong>{group.links.map(([label, href]) => <Link href={href} key={label}>{label}</Link>)}</div>)}<div className="footer-group"><strong>Social</strong><a href="#">Instagram</a><a href="#">Facebook</a><a href="#">TikTok (@fingerprintsau)</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Fingerprints · Bendigo, Victoria{siteConfig.data?.businessAbn ? ` · ABN ${siteConfig.data.businessAbn}` : ""} · Payments secured by Stripe</span><button type="button" onClick={() => window.dispatchEvent(new Event("fp:open-cookie-settings"))}>Cookie settings</button></div></footer>;
}

export function LegalLayout({ children }: { children: ReactNode }) {
  return <div className="legal-site"><main className="legal-main"><Link href="/" className="legal-back">← Back to Fingerprints</Link>{children}</main></div>;
}

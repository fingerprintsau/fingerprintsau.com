import { ArrowLeft, ArrowUpRight, Check, MapPin, Store } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useJsonLd, usePublicMeta } from "./PublicMeta";

export default function PublicListing({ id }: { id: number }) {
  const listing = trpc.storefront.listing.useQuery({ id }, { retry: false });
  const siteConfig = trpc.site.config.useQuery();
  const [activeImage, setActiveImage] = useState(0);
  const metaTitle = listing.data ? `${listing.data.title} — ${listing.data.seller.displayName || listing.data.seller.name || "Independent seller"} | Fingerprints` : "Piece — Fingerprints";
  const metaDescription = listing.data?.description || "Discover an independent piece on Fingerprints.";
  usePublicMeta({ title: metaTitle, description: metaDescription, image: listing.data?.imageUrls[0], path: `/listing/${id}`, type: "article" });
  const siteUrl = siteConfig.data?.publicSiteUrl || "https://fingerprintsau.com";
  const jsonLd = listing.data ? { "@context": "https://schema.org", "@type": "Product", name: listing.data.title, image: listing.data.imageUrls.map((url) => url.startsWith("http") ? url : `${siteUrl}${url}`), description: (listing.data.description || `${listing.data.title}, available from ${listing.data.seller.displayName || listing.data.seller.name || "Independent seller"} on Fingerprints.`).replace(/<[^>]*>/g, ""), brand: { "@type": "Brand", name: listing.data.seller.displayName || listing.data.seller.name || "Independent seller" }, offers: { "@type": "Offer", url: `${siteUrl}/listing/${listing.data.id}`, price: (listing.data.priceCents / 100).toFixed(2), priceCurrency: "AUD", availability: "https://schema.org/InStock", itemCondition: listing.data.condition.toLowerCase() === "new" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition" } } : null;
  useJsonLd(jsonLd, `fingerprints-product-${id}`);
  if (listing.isLoading) return <div className="public-store-loading">Opening piece…</div>;
  if (!listing.data) {
    return <div className="public-store-loading"><h1>Piece not found</h1><p>This listing is no longer live.</p><a href="/">Back to the edit</a></div>;
  }
  const item = listing.data;
  const sellerName = item.seller.displayName || item.seller.name || "Independent seller";
  const description = item.description || `${item.title}, available from ${sellerName} on Fingerprints.`;
  const image = item.imageUrls[activeImage];
  const report = item.conditionReport as { rating?: string; summary?: string; checks?: string[] } | null;
  return <div className="public-market"><header className="market-header"><a className="market-brand" href="/">fingerprints<sup>™</sup></a><a className="market-sell-link" href="/">Back to shop <ArrowUpRight size={13} /></a></header><main className="listing-detail-main"><a className="listing-back" href="/"><ArrowLeft size={14} /> Back to live edit</a><div className="listing-detail-grid"><section className="listing-gallery"><div className="listing-main-image">{image ? <img src={image} alt={item.title} /> : <Store size={26} />}</div>{item.imageUrls.length > 1 && <div className="listing-thumbs">{item.imageUrls.map((url, index) => <button type="button" className={activeImage === index ? "active" : ""} key={url} onClick={() => setActiveImage(index)}><img src={url} alt={`${item.title} ${index + 1}`} /></button>)}</div>}{item.videoStatus === "ready" && item.videoUrl && <video className="listing-video" controls playsInline poster={item.imageUrls[0]}><source src={item.videoUrl} type="video/mp4" /></video>}</section><section className="listing-detail-copy"><div className="eyebrow">{item.category || "The edit"}</div><h1>{item.title}</h1><div className="listing-price">${(item.priceCents / 100).toFixed(0)} <span>AUD</span></div><p className="listing-description">{description}</p><div className="listing-facts"><span>Condition <strong>{item.condition}</strong></span>{item.size && <span>Size <strong>{item.size}</strong></span>}{report && <span className="condition-checked"><Check size={12} /> Condition checked</span>}</div>{report && <section className="public-condition-report"><strong>{report.rating || "Condition checked"}</strong><p>{report.summary}</p>{report.checks?.length ? <ul>{report.checks.map((check) => <li key={check}>{check}</li>)}</ul> : null}</section>}<div className="seller-mini"><div className="seller-mini-photo">{item.seller.profileImageUrl ? <img src={item.seller.profileImageUrl} alt={sellerName} /> : sellerName.slice(0, 1)}</div><div><span>Sold by</span><strong>{sellerName}</strong>{item.seller.foundingSeller && <span className="founding-badge">Founding Seller</span>}{(item.seller.suburb || item.seller.state) && <small><MapPin size={11} /> {[item.seller.suburb, item.seller.state].filter(Boolean).join(", ")}</small>}</div><a href={item.seller.storeSlug ? `/${item.seller.storeSlug}` : "/"} aria-label={`Visit ${sellerName}'s storefront`}><ArrowUpRight size={15} /></a></div><button className="listing-action" type="button">Message seller <ArrowUpRight size={14} /></button><p className="listing-note">A considered piece from an independent Fingerprints storefront.</p></section></div></main><footer className="market-footer"><span>fingerprintsau.com</span><span>Leave a little life in it.</span></footer></div>;
}

export { PublicListing };

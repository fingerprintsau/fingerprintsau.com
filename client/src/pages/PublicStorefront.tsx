import { useEffect } from "react";
import { ArrowUpRight, MapPin, Store } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function PublicStorefront({ slug }: { slug: string }) {
  const storefront = trpc.storefront.public.useQuery({ slug }, { retry: false });
  useEffect(() => {
    const redirectSlug = storefront.data?.redirectSlug;
    if (redirectSlug && redirectSlug !== slug) window.location.replace(`/${redirectSlug}`);
  }, [storefront.data?.redirectSlug, slug]);

  if (storefront.isLoading || (storefront.data?.redirectSlug && storefront.data.redirectSlug !== slug)) return <div className="public-store-loading">Opening storefront…</div>;
  if (!storefront.data) return <div className="public-store-loading"><h1>Storefront not found</h1><p>This seller address may have moved or no longer exists.</p><a href="/">Return to Fingerprints</a></div>;

  const { seller, listings, blocks } = storefront.data;
  const displayName = seller.displayName || seller.name || "Seller";
  return <div className="public-storefront"><header className="public-store-header"><a className="public-store-brand" href="/">fingerprints<sup>™</sup></a><div className="public-store-address">fingerprintsau.com/{seller.storeSlug}</div></header><main className="public-store-main"><section className="public-profile-hero"><div className="public-profile-photo">{seller.profileImageUrl ? <img src={seller.profileImageUrl} alt={displayName} /> : <span>{displayName.slice(0, 1).toUpperCase()}</span>}</div><div><div className="eyebrow">Seller storefront</div><h1>{displayName} {seller.foundingSeller && <span className="founding-badge">Founding Seller</span>}</h1>{(seller.suburb || seller.state) && <div className="public-location"><MapPin size={13} /> {[seller.suburb, seller.state].filter(Boolean).join(", ")}</div>}{seller.bio && <p>{seller.bio}</p>}</div></section>{blocks.filter((block) => block.blockType === "hero" || block.blockType === "story").slice(0, 1).map((block) => <section className="public-story-card" key={block.id}><div className="eyebrow">{block.blockType}</div><h2>{block.title}</h2>{block.body && <p>{block.body}</p>}</section>)}<section className="public-listings-section"><div className="public-section-head"><div><div className="eyebrow">The edit</div><h2>Available now</h2></div><span>{listings.length} live piece{listings.length === 1 ? "" : "s"}</span></div>{listings.length ? <div className="public-listing-grid">{listings.map((listing) => <article className="public-listing-card" key={listing.id}>{listing.imageUrls[0] ? <img src={listing.imageUrls[0]} alt={listing.title} /> : <div className="public-listing-empty"><Store size={20} /></div>}<div className="public-listing-copy"><h3>{listing.title}</h3><p>{[listing.size ? `Size ${listing.size}` : null, listing.condition, listing.category].filter(Boolean).join(" · ")}</p><strong>${(listing.priceCents / 100).toFixed(0)} AUD</strong><button type="button"><span>View piece</span><ArrowUpRight size={13} /></button></div></article>)}</div> : <div className="public-empty">This storefront is getting its first pieces ready.</div>}</section></main><footer className="public-store-footer">Powered by <strong>fingerprintsau.com</strong></footer></div>;
}

export { PublicStorefront };

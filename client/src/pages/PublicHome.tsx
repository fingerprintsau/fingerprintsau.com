import { ArrowUpRight, Search, Store, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useJsonLd, usePublicMeta } from "./PublicMeta";

type BrowseItem = { id: number; title: string; priceCents: number; imageUrls: string[]; seller: { name: string | null; displayName: string | null; storeSlug?: string | null } };

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    search: params.get("q") ?? "",
    category: params.get("cat") ?? "",
    condition: params.get("condition") ?? "",
    size: params.get("size") ?? "",
    minPrice: params.get("min") ?? "",
    maxPrice: params.get("max") ?? "",
    sort: params.get("sort") ?? "newest",
    page: Number(params.get("page") ?? "1") || 1,
  };
}

export default function PublicHome() {
  const [urlState, setUrlState] = useState(readUrl);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState<BrowseItem[]>([]);
  const queryInput = useMemo(() => ({ search: urlState.search || undefined, category: urlState.category || undefined, condition: urlState.condition || undefined, size: urlState.size || undefined, minPrice: urlState.minPrice ? Math.round(Number(urlState.minPrice) * 100) : undefined, maxPrice: urlState.maxPrice ? Math.round(Number(urlState.maxPrice) * 100) : undefined, sort: urlState.sort === "newest" ? undefined : urlState.sort as "price-low-high" | "price-high-low" | undefined, page: urlState.page }), [urlState]);
  const browse = trpc.storefront.browse.useQuery(queryInput);
  const siteConfig = trpc.site.config.useQuery();

  useEffect(() => {
    const onPopState = () => setUrlState(readUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!browse.data) return;
    setItems((current) => urlState.page === 1 ? browse.data.items : [...current, ...browse.data.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
  }, [browse.data, urlState.page]);

  const updateUrl = (changes: Partial<ReturnType<typeof readUrl>>, resetPage = true) => {
    const next = { ...urlState, ...changes, ...(resetPage ? { page: 1 } : {}) };
    const params = new URLSearchParams();
    if (next.search) params.set("q", next.search);
    if (next.category) params.set("cat", next.category);
    if (next.condition) params.set("condition", next.condition);
    if (next.size) params.set("size", next.size);
    if (next.minPrice) params.set("min", next.minPrice);
    if (next.maxPrice) params.set("max", next.maxPrice);
    if (next.sort !== "newest") params.set("sort", next.sort);
    if (next.page > 1) params.set("page", String(next.page));
    window.history.pushState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    setUrlState(next);
  };

  const clearFilters = () => updateUrl({ search: "", category: "", condition: "", size: "", minPrice: "", maxPrice: "", sort: "newest" });
  const hasFilters = Boolean(urlState.search || urlState.category || urlState.condition || urlState.size || urlState.minPrice || urlState.maxPrice || urlState.sort !== "newest");
  usePublicMeta({ title: "Fingerprints — The only hub a seller needs", description: "Fingerprints — The only hub a seller needs", image: items[0]?.imageUrls[0] });
  const siteUrl = siteConfig.data?.publicSiteUrl || "https://fingerprintsau.com";
  useJsonLd({ "@context": "https://schema.org", "@type": "Organization", name: "Fingerprints", url: siteUrl, logo: `${siteUrl}/icon-512.png` }, "fingerprints-organization");

  return <div className="public-market"><header className="market-header"><a className="market-brand" href="/">fingerprints<sup>™</sup></a><nav><a href="#shop">Shop</a><a href="#about">About</a></nav><a className="market-sell-link" href="/dashboard">Sell with Fingerprints <ArrowUpRight size={13} /></a></header><main><section className="market-hero"><div><div className="eyebrow">fingerprintsau.com</div><h1>Good pieces<br /><em>leave a mark.</em></h1><p>Pre-loved fashion, dance wear and jewellery from sellers with a point of view.</p></div><div className="market-hero-art"><div className="market-art-orb" /><span>wear it<br />well.</span></div></section><section className="market-shop" id="shop"><div className="market-section-head"><div><div className="eyebrow">The open edit</div><h2>Live now</h2></div><label className="market-search"><Search size={14} /><input value={urlState.search} onChange={(event) => updateUrl({ search: event.target.value })} placeholder="Search pieces, sellers or brands" aria-label="Search live listings" /></label></div><div className="market-toolbar"><div className="market-chips"><button className={!urlState.category ? "active" : ""} onClick={() => updateUrl({ category: "" })}>All</button>{(browse.data?.categories ?? []).map((category) => <button className={urlState.category === category ? "active" : ""} key={category} onClick={() => updateUrl({ category })}>{category}</button>)}</div><button className="filter-button" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={14} /> Filters</button><label className="market-sort">Sort <select value={urlState.sort} onChange={(event) => updateUrl({ sort: event.target.value })}><option value="newest">Newest</option><option value="price-low-high">Price low to high</option><option value="price-high-low">Price high to low</option></select></label></div><div className={`market-filters ${filtersOpen ? "open" : ""}`}><label>Condition<input value={urlState.condition} onChange={(event) => updateUrl({ condition: event.target.value })} placeholder="e.g. Good" /></label><label>Size<input value={urlState.size} onChange={(event) => updateUrl({ size: event.target.value })} placeholder="e.g. M" /></label><label>Min price<input inputMode="decimal" value={urlState.minPrice} onChange={(event) => updateUrl({ minPrice: event.target.value })} placeholder="$0" /></label><label>Max price<input inputMode="decimal" value={urlState.maxPrice} onChange={(event) => updateUrl({ maxPrice: event.target.value })} placeholder="$500" /></label>{hasFilters && <button className="text-button" onClick={clearFilters}><X size={14} /> Clear filters</button>}</div><div className="market-results-meta"><span>{browse.data?.total ?? 0} live {browse.data?.total === 1 ? "piece" : "pieces"}</span>{browse.isFetching && <span>Updating…</span>}</div>{browse.isLoading ? <div className="market-empty">Loading the edit…</div> : items.length ? <div className="market-grid">{items.map((item) => <a className="market-card" href={`/listing/${item.id}`} key={item.id}>{item.imageUrls[0] ? <img loading="lazy" src={item.imageUrls[0]} alt={item.title} /> : <div className="market-card-placeholder"><Store size={20} /></div>}<div className="market-card-copy"><div><h3>{item.title}</h3><p>{item.seller.displayName || item.seller.name || "Independent seller"}</p></div><strong>${(item.priceCents / 100).toFixed(0)}</strong><span className="market-card-detail">View piece <ArrowUpRight size={12} /></span></div></a>)}</div> : <div className="market-empty">No live pieces match those filters.</div>}{browse.data?.hasMore && items.length > 0 && <button className="load-more-button" disabled={browse.isFetching} onClick={() => updateUrl({ page: urlState.page + 1 }, false)}>Load more</button>}</section><section className="market-about" id="about"><div className="eyebrow">A softer marketplace</div><h2>Every seller gets<br /><em>their own corner.</em></h2><p>Fingerprints keeps the familiar rhythm of a resale marketplace, then gives every seller a storefront that feels like them.</p></section></main><footer className="market-footer"><span>fingerprintsau.com</span><span>Independent wardrobes, everywhere.</span></footer></div>;
}

export { PublicHome };

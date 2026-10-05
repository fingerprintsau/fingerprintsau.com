import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { toast } from "sonner";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Blocks,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CloudUpload,
  CreditCard,
  ExternalLink,
  FileCheck2,
  Globe2,
  ImagePlus,
  Instagram,
  LayoutGrid,
  Link2,
  ListFilter,
  MoreHorizontal,
  Pencil,
  PackageCheck,
  Plus,
  Search,
  ScanLine,
  Settings2,
  Share2,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  UploadCloud,
  Users,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import CustomizeView from "./CustomizeView";
import InventoryView from "./InventoryView";
import ProfileSettingsView from "./ProfileSettingsView";
import UsageView from "./UsageView";
const OfficeWorkspace = lazy(() => import("./OfficeWorkspace"));
import { trpc } from "@/lib/trpc";

type View = "overview" | "inventory" | "storefront" | "connections" | "reports" | "customize" | "usage" | "profile" | "office";

type Listing = {
  id: number;
  name: string;
  detail: string;
  price: string;
  status: "Live" | "Draft" | "Review";
  image: string;
  description: string;
  category: string;
  sku: string;
  imageUrls: string[];
  createdAt: Date | string;
};

const productImages = ["data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='640'%3E%3Crect width='100%' height='100%' fill='%230B1020'/%3E%3Ccircle cx='320' cy='320' r='170' fill='%2322D3EE'/%3C/svg%3E"];

type ListingRecord = {
  id: number;
  title: string;
  description: string | null;
  priceCents: number;
  size: string | null;
  condition: string;
  category: string | null;
  sku: string | null;
  status: "live" | "draft" | "review";
  imageUrls: string[];
  createdAt: Date | string;
};

function toUiListing(listing: ListingRecord): Listing {
  const status = listing.status === "live" ? "Live" : listing.status === "review" ? "Review" : "Draft";
  return {
    id: listing.id,
    name: listing.title,
    detail: [listing.size ? `Size ${listing.size}` : null, listing.condition].filter(Boolean).join(" · "),
    price: `$${(listing.priceCents / 100).toFixed(0)}`,
    status,
    image: listing.imageUrls[0] || productImages[0],
    description: listing.description ?? "",
    category: listing.category ?? "",
    sku: listing.sku ?? "",
    imageUrls: listing.imageUrls,
    createdAt: listing.createdAt,
  };
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatTime(value: Date | string) {
  const diffHours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3600000));
  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

const navItems = [
  { id: "overview" as View, label: "Overview", icon: LayoutGrid },
  { id: "inventory" as View, label: "Inventory", icon: ShoppingBag },
  { id: "office" as View, label: "Docs & Sheets", icon: FileCheck2 },
  { id: "storefront" as View, label: "My storefront", icon: Store },
  { id: "customize" as View, label: "Customize blocks", icon: Blocks },
  { id: "connections" as View, label: "Connections", icon: Link2 },
  { id: "reports" as View, label: "Condition reports", icon: FileCheck2 },
  { id: "usage" as View, label: "Usage & credits", icon: CreditCard },
];

const overviewListingsInput = { page: 1, pageSize: 4 } as const;
const storefrontListingsInput = { page: 1, pageSize: 1, status: "live" as const };

const socialConnections = [
  { key: "Instagram", mark: "ig", icon: Instagram, copy: "Push drops and keep your grid in sync." },
  { key: "Facebook", mark: "f", icon: Share2, copy: "Reach your community with every listing." },
  { key: "X / Twitter", mark: "x", icon: Activity, copy: "Share new arrivals in one click." },
  { key: "TikTok", mark: "tt", icon: Sparkles, copy: "Turn outfit edits into shoppable clips." },
  { key: "Threads", mark: "@", icon: MessageIcon, copy: "Bring your people into the conversation." },
  { key: "Pinterest", mark: "p", icon: ImagePlus, copy: "Save every look to your visual board." },
  { key: "eBay", mark: "e", icon: ShoppingBag, copy: "Bring your catalog to a wider resale audience." },
  { key: "Etsy", mark: "e", icon: Store, copy: "Share your considered edit with Etsy shoppers." },
];

function MessageIcon(props: { size?: number; strokeWidth?: number }) {
  return <span style={{ fontSize: props.size ? props.size * 0.74 : 14, fontWeight: 800, lineHeight: 1 }}>@</span>;
}

function MetricCard({ label, value, trend }: { label: string; value: string; trend: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-trend">↗ {trend}</div>
    </div>
  );
}

function ProductRow({ listing }: { listing: Listing }) {
  const remove = trpc.listings.delete.useMutation();
  const utils = trpc.useUtils();
  const deleteListing = async () => {
    if (!window.confirm(`Delete “${listing.name}” from your catalog?`)) return;
    try {
      await remove.mutateAsync({ id: listing.id });
      await Promise.all([utils.listings.list.invalidate(), utils.listings.listPage.invalidate(), utils.listings.facets.invalidate(), utils.listings.metrics.invalidate()]);
      toast.success("Listing deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete listing.");
    }
  };
  return (
    <div className="listing-row">
      <img className="product-thumb" src={listing.image} alt={listing.name} />
      <div>
        <div className="product-name">{listing.name}</div>
        <div className="product-detail">{listing.detail}</div>
      </div>
      <div className="price">{listing.price}</div>
      <div className={`status-pill ${listing.status !== "Live" ? "neutral" : ""}`}>
        <span className="status-dot" style={{ background: listing.status === "Live" ? "#56a76b" : "#aaa89f" }} />
        {listing.status}
      </div>
      <button className="more-button" aria-label={`Delete ${listing.name}`} disabled={remove.isPending} onClick={deleteListing}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function Overview({ displayName, storePath, isAuthenticated, onUpload, onReport, onModel }: { displayName: string; storePath: string; isAuthenticated: boolean; onUpload: () => void; onReport: () => void; onModel: () => void }) {
  const listingsQuery = trpc.listings.listPage.useQuery(overviewListingsInput, { enabled: isAuthenticated, retry: false });
  const metricsQuery = trpc.listings.metrics.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const launchBonusQuery = trpc.launchBonus.status.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const [showLaunchEarned, setShowLaunchEarned] = useState(false);
  useEffect(() => {
    if (launchBonusQuery.data?.earned && window.localStorage.getItem("fingerprints:founding-seller-seen") !== "1") {
      window.localStorage.setItem("fingerprints:founding-seller-seen", "1");
      setShowLaunchEarned(true);
    }
  }, [launchBonusQuery.data?.earned]);
  const records = listingsQuery.data?.items ?? [];
  const recent = records.slice(0, 4).map(toUiListing);
  const metrics = metricsQuery.data ?? { total: 0, live: 0, draft: 0, review: 0, inventoryValueCents: 0, averagePriceCents: 0 };
  const attention = metrics.draft + metrics.review;
  const storefrontImage = recent[0]?.image || productImages[5];
  return <>
    <div className="hero-row"><div><div className="eyebrow">{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div><h1 className="page-heading">Your wardrobe,<br /><em>your storefront.</em></h1><p className="page-subtitle">One quiet space to list, style and sell everywhere. Fingerprints gives every seller a beautiful home on the internet.</p></div><div className="hero-note"><strong>Good morning, {displayName}.</strong> {metrics.live} of {metrics.total} pieces are live.</div></div>
    {launchBonusQuery.data?.active && !launchBonusQuery.data.earned && <div className="launch-bonus-banner"><strong>Founding Seller bonus</strong><span>List 2 items with photos to get {launchBonusQuery.data.credits} bonus credits ({Math.min(launchBonusQuery.data.eligibleListings, 2)} of 2)</span></div>}
    {showLaunchEarned && <div className="launch-bonus-banner earned"><strong>Founding Seller</strong><span>You've earned {launchBonusQuery.data?.credits ?? 100} bonus credits</span></div>}
    <div className="metric-grid"><MetricCard label="Active listings" value={String(metrics.live)} trend={`${metrics.total} total in catalog`} /><MetricCard label="Inventory value" value={formatMoney(metrics.inventoryValueCents)} trend={`${metrics.total} priced pieces`} /><MetricCard label="Average price" value={formatMoney(metrics.averagePriceCents)} trend="across your catalog" /><MetricCard label="Needs attention" value={String(attention)} trend={`${metrics.draft} draft · ${metrics.review} review`} /></div>
    <div className="workspace-grid"><section className="panel"><div className="panel-head"><div><div className="panel-title">Recent listings</div><div className="panel-meta">Your latest pieces, all in one view.</div></div><button className="text-button" onClick={() => toast.info("Inventory view is ready from the sidebar.")}>View all <ChevronRight size={13} style={{ verticalAlign: "-2px" }} /></button></div><div className="listing-table">{listingsQuery.isLoading ? <div className="empty-state">Loading your catalog…</div> : recent.length ? recent.map((listing) => <ProductRow key={listing.id} listing={listing} />) : <div className="empty-state">No listings yet. Add your first piece to start your storefront.</div>}</div></section><div className="feature-stack"><div className="feature-card dark"><div className="feature-icon"><UploadCloud size={16} /></div><div className="feature-kicker">Batch upload</div><div className="feature-title">Make your next drop a breeze.</div><p className="feature-copy">Drop in a whole rail of photos. We’ll organise the rest.</p><button className="feature-link" onClick={onUpload}>Upload a batch <ArrowUpRight size={14} /></button><div className="feature-art" /></div><div className="feature-card tinted"><div className="feature-icon"><FileCheck2 size={16} /></div><div className="feature-kicker">Built in</div><div className="feature-title">Condition reports, made simple.</div><p className="feature-copy">Give buyers the details they need with a clear, shareable report.</p><button className="feature-link" onClick={onReport}>Create a report <ArrowUpRight size={14} /></button><div className="progress-wrap"><div className="progress-top"><span>Catalog readiness</span><span>{metrics.total ? `${Math.round((metrics.live / metrics.total) * 100)}%` : "0%"}</span></div><div className="progress-bar"><span style={{ width: metrics.total ? `${Math.round((metrics.live / metrics.total) * 100)}%` : "0%" }} /></div></div></div><div className="feature-card orange"><div className="feature-icon"><WandSparkles size={16} /></div><div className="feature-kicker">New addon</div><div className="feature-title">A model for every piece.</div><p className="feature-copy">Generate an editorial model image without the studio day.</p><button className="feature-link" onClick={onModel}>Try AI model gen <ArrowUpRight size={14} /></button></div></div></div>
    <div className="lower-grid"><section className="panel"><div className="panel-head"><div><div className="panel-title">Your storefront</div><div className="panel-meta">{storePath}</div></div><button className="text-button" onClick={() => toast.success("Storefront preview opened in a new tab.")}><ExternalLink size={13} style={{ verticalAlign: "-2px" }} /> Preview</button></div><div className="storefront-preview"><div className="phone-preview"><img className="phone-image" src={storefrontImage} alt={recent[0]?.name || "Your storefront preview"} /><div className="phone-caption">{displayName} edits</div><div className="phone-price">{metrics.live} live pieces</div></div><div className="preview-copy"><h3>Same design.<br /><span style={{ color: "var(--primary)" }}>Your own corner.</span></h3><p>Every seller gets a clean, shareable storefront with your own identity, socials and checkout-ready listings.</p><div className="preview-stat-row"><div className="preview-stat"><strong>{metrics.live}</strong><span>pieces live</span></div><div className="preview-stat"><strong>{formatMoney(metrics.inventoryValueCents)}</strong><span>inventory value</span></div><div className="preview-stat"><strong>{metrics.total}</strong><span>catalog pieces</span></div></div></div></div></section><section className="panel"><div className="panel-head"><div><div className="panel-title">Latest activity</div><div className="panel-meta">From your catalog.</div></div><Activity size={16} color="#aaa89f" /></div><div className="activity-list">{recent.length ? recent.slice(0, 3).map((listing, index) => <div className="activity-item" key={listing.id}><span className="activity-dot" style={{ background: index === 0 ? "#f0442f" : index === 1 ? "#62a676" : "#9c9b90" }} /><div className="activity-text"><strong>{listing.name}</strong> is {listing.status.toLowerCase()}.</div><span className="activity-time">{formatTime(listing.createdAt)}</span></div>) : <div className="empty-state">Your listing activity will appear here.</div>}</div></section></div>
  </>;
}

function StorefrontView({ displayName, storePath, isAuthenticated }: { displayName: string; storePath: string; isAuthenticated: boolean }) {
  const listingsQuery = trpc.listings.listPage.useQuery(storefrontListingsInput, { enabled: isAuthenticated, retry: false });
  const metricsQuery = trpc.listings.metrics.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const metrics = metricsQuery.data ?? { total: 0, live: 0, draft: 0, review: 0, inventoryValueCents: 0, averagePriceCents: 0 };
  const firstListing = listingsQuery.data?.items[0];
  const image = firstListing?.imageUrls[0] || productImages[0];
  const share = async () => { try { await navigator.clipboard?.writeText(storePath); } catch { /* Clipboard may be unavailable in preview. */ } toast.success("Storefront link copied to clipboard."); };
  return <><div className="view-header"><div><div className="eyebrow">Your public profile</div><h1>My storefront</h1></div><button className="primary-button" onClick={share}><Share2 size={14} style={{ verticalAlign: "-2px" }} /> Share storefront</button></div><section className="panel"><div className="storefront-preview" style={{ padding: 28 }}><div className="phone-preview" style={{ maxWidth: 180, width: "100%", justifySelf: "center" }}><img className="phone-image" src={image} alt={firstListing?.title || "Your storefront preview"} /><div className="phone-caption">{displayName} edits</div><div className="phone-price">{metrics.live} live pieces</div></div><div className="preview-copy"><div className="eyebrow">{storePath}</div><h3 style={{ fontSize: 34, marginTop: 10 }}>A shop that feels<br /><span style={{ color: "var(--primary)" }}>like you.</span></h3><p style={{ maxWidth: 370 }}>Your personal storefront keeps the familiar Fingerprints layout while giving you space for your own story, social links and drops.</p><div className="preview-stat-row"><div className="preview-stat"><strong>{metrics.live}</strong><span>pieces live</span></div><div className="preview-stat"><strong>{formatMoney(metrics.inventoryValueCents)}</strong><span>inventory value</span></div><div className="preview-stat"><strong>{metrics.total}</strong><span>catalog pieces</span></div></div><div style={{ marginTop: 22, display: "flex", gap: 8 }}><button className="secondary-button" onClick={() => toast.info("Storefront editor is available from Customize blocks.")}><Settings2 size={13} style={{ verticalAlign: "-2px" }} /> Edit identity</button><button className="secondary-button" onClick={() => toast.success("Preview link copied.")}><ExternalLink size={13} style={{ verticalAlign: "-2px" }} /> Open live view</button></div></div></div></section></>;
}

function ConnectionsView() {
  return <>
    <div className="view-header"><div><div className="eyebrow">Integrations</div><h1>Connections</h1></div><div className="hero-note"><strong>Coming soon</strong> Social selling, all in one place.</div></div>
    <div className="connection-grid">{socialConnections.map(({ key, mark, icon: Icon, copy }) => <div className="connection-card" key={key}><div className="connection-card-top"><div className="social-mark">{key === "Instagram" ? <Instagram size={15} /> : <Icon size={15} />}</div><span className="coming-soon-badge">Coming soon</span></div><h3>{key}</h3><p>{copy}</p><div className="connection-status">Not available yet</div></div>)}</div>
    <section className="panel" style={{ marginTop: 14 }}><div className="panel-head"><div><div className="panel-title">Individual SSO</div><div className="panel-meta">Your account, your access, your data.</div></div><span className="status-pill"><span className="status-dot" />Active</span></div><div style={{ padding: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}><div style={{ display: "flex", alignItems: "center", gap: 13 }}><div className="feature-icon" style={{ margin: 0, background: "#ecebe6", color: "#24231f" }}><Globe2 size={16} /></div><div><div style={{ fontWeight: 800, fontSize: 12 }}>alex@finger-prints.com.au</div><div style={{ fontSize: 10, color: "#99978e", marginTop: 4 }}>Signed in securely with Fingerprints SSO</div></div></div><button className="secondary-button" onClick={() => toast.info("Account security settings are ready for the next release.")}><Settings2 size={13} style={{ verticalAlign: "-2px" }} /> Manage access</button></div></section>
  </>;
}

function ReportsView({ onReport }: { onReport: () => void }) {
  return <>
    <div className="view-header"><div><div className="eyebrow">Trust, made visible</div><h1>Condition reports</h1></div><button className="primary-button" onClick={onReport}><Plus size={14} style={{ verticalAlign: "-2px" }} /> New report</button></div>
    <section className="panel"><div className="panel-head"><div><div className="panel-title">Recent reports</div><div className="panel-meta">Clear detail helps good pieces move faster.</div></div><PackageCheck size={16} color="#aaa89f" /></div>{[{ name: "Soft utility overshirt", rating: "Excellent", date: "Updated today", score: "96" }, { name: "Archive denim jacket", rating: "Excellent", date: "Updated yesterday", score: "92" }, { name: "Leopard trim trench", rating: "Good", date: "Updated 4 days ago", score: "78" }].map((report) => <div className="listing-row" key={report.name} style={{ gridTemplateColumns: "44px minmax(100px, 1.7fr) 70px minmax(90px, .8fr) 30px" }}><div style={{ width: 37, height: 37, borderRadius: 10, background: "#eef5ee", display: "grid", placeItems: "center", color: "#5d9d6c", fontFamily: "Space Grotesk", fontWeight: 600 }}>{report.score}</div><div><div className="product-name">{report.name}</div><div className="product-detail">{report.date}</div></div><div style={{ fontSize: 11, fontWeight: 800 }}>{report.rating}</div><span className="status-pill"><span className="status-dot" />Shareable</span><button className="more-button" aria-label="Report actions" onClick={() => toast.success("Report link copied.")}><ExternalLink size={14} /></button></div>)}</section>
    <div className="workspace-grid" style={{ marginTop: 14 }}><div className="feature-card tinted"><div className="feature-icon"><ScanLine size={16} /></div><div className="feature-kicker">Why it matters</div><div className="feature-title">Less guesswork. More confidence.</div><p className="feature-copy">A simple, visual condition summary helps buyers decide faster and gives your best pieces the context they deserve.</p><button className="feature-link" onClick={onReport}>Create a report <ArrowUpRight size={14} /></button></div><div className="panel"><div className="panel-head"><div><div className="panel-title">Report health</div><div className="panel-meta">Across your live pieces.</div></div><BarChart3 size={16} color="#aaa89f" /></div><div style={{ padding: 18 }}><div className="metric-value" style={{ fontSize: 36 }}>94%</div><p className="page-subtitle" style={{ fontSize: 11, marginTop: 8 }}>of your live listings have a complete condition report.</p><div className="progress-wrap"><div className="progress-top"><span>Coverage</span><span>22 / 24</span></div><div className="progress-bar"><span style={{ width: "94%" }} /></div></div></div></div></div>
  </>;
}

function UploadModal({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [groupSize, setGroupSize] = useState(12);
  const batchPolicy = trpc.listings.batchPolicy.useQuery(undefined, { retry: false });
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("0");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("Excellent");
  const [category, setCategory] = useState("Clothing");
  const [sku, setSku] = useState("");
  const createBatch = trpc.listings.batchCreate.useMutation();
  const uploadImage = trpc.listings.uploadImage.useMutation();
  const utils = trpc.useUtils();
  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    const accepted = selected.filter((file) => file.size <= 20 * 1024 * 1024);
    if (accepted.length !== selected.length) toast.error("Each image must be 20MB or smaller.");
    const freeSeller = batchPolicy.data?.plan === "free" && batchPolicy.data.role === "user" && !batchPolicy.data.isOwner;
    setFiles((current) => {
      const next = freeSeller ? [...current, ...accepted].slice(0, 12) : [...current, ...accepted];
      if (freeSeller && next.length < current.length + accepted.length) toast.error("A free-plan batch can contain up to 12 photos in one listing.");
      return next;
    });
  };
  const encodeFile = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
  const moveFile = (index: number, direction: -1 | 1) => setFiles((current) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= current.length) return current;
    const next = [...current];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return next;
  });
  const groups = files.length ? Array.from({ length: Math.ceil(files.length / groupSize) }, (_, index) => files.slice(index * groupSize, (index + 1) * groupSize)) : [];
  const createDrafts = async () => {
    const listingGroups = groups.length ? groups : [[]];
    try {
      const listingInputs = [] as Array<{ title: string; description: null; priceCents: number; size: string | null; condition: string; category: string | null; sku: string | null; status: "draft"; imageUrls: string[] }>;
      for (let groupIndex = 0; groupIndex < listingGroups.length; groupIndex += 1) {
        const group = listingGroups[groupIndex];
        const imageUrls: string[] = [];
        for (const file of group) imageUrls.push((await uploadImage.mutateAsync({ fileName: file.name, contentType: file.type || "image/jpeg", data: await encodeFile(file) })).url);
        const fallbackTitle = group[0]?.name.replace(/\.[^/.]+$/, "") || "Untitled listing";
        listingInputs.push({ title: listingGroups.length > 1 ? `${title || fallbackTitle} ${groupIndex + 1}` : title || fallbackTitle, description: null, priceCents: Math.round(Number(price || 0) * 100), size: size || null, condition, category: category || null, sku: sku || null, status: "draft", imageUrls });
      }
      const result = await createBatch.mutateAsync({ listings: listingInputs });
      await Promise.all([utils.listings.list.invalidate(), utils.listings.listPage.invalidate(), utils.listings.facets.invalidate(), utils.listings.metrics.invalidate()]);
      toast.success(`${result.created} draft listing${result.created === 1 ? "" : "s"} saved with ${files.length} photo${files.length === 1 ? "" : "s"}.`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in before saving listings.");
    }
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="upload-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal upload-modal"><div className="modal-head"><div><div className="eyebrow">Batch upload</div><h2 id="upload-title">Bring your next drop.</h2><p>Group a photo set into one listing, then reorder it so the first photo becomes the cover.</p></div><button className="close-button" onClick={onClose} aria-label="Close"><X size={16} /></button></div><div className="drop-zone" onClick={() => inputRef.current?.click()}><CloudUpload size={25} /><strong>{files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} ready` : "Drop photos here"}</strong><span>or click to browse · JPG, PNG up to 20MB each</span><input ref={inputRef} aria-label="Choose listing photos" type="file" multiple accept="image/*" hidden onChange={chooseFiles} /></div><div className="batch-group-control">{batchPolicy.data?.plan === "free" && batchPolicy.data.role === "user" && !batchPolicy.data.isOwner ? <div><strong>Photos per listing</strong><p className="batch-paid-lock">All chosen photos go into one listing, up to 12 photos.</p><small>Create many listings at once on a paid plan — coming soon</small></div> : <label>Photos per listing<select value={groupSize} onChange={(event) => setGroupSize(Number(event.target.value))}><option value={12}>All photos = 1 listing</option><option value={1}>1 photo = 1 listing</option><option value={2}>Every 2 photos</option><option value={3}>Every 3 photos</option><option value={4}>Every 4 photos</option><option value={5}>Every 5 photos</option><option value={6}>Every 6 photos</option></select></label>}<span>{files.length ? `${groups.length} listing${groups.length === 1 ? "" : "s"} will be created · first photo in each group is the cover` : "Choose photos to create one listing, for example."}</span></div><div className="listing-form-grid"><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Linen overshirt" /></label><label>Price (AUD)<input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} /></label><label>Size<input value={size} onChange={(event) => setSize(event.target.value)} placeholder="M" /></label><label>Condition<select value={condition} onChange={(event) => setCondition(event.target.value)}><option>Excellent</option><option>Like new</option><option>Good</option><option>Fair</option></select></label><label>Category<input value={category} onChange={(event) => setCategory(event.target.value)} /></label><label>SKU<input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="Optional" /></label></div>{files.length > 0 && <div className="batch-photo-list">{files.map((file, index) => <div className="batch-photo-row" key={`${file.name}-${index}`}><span className="batch-photo-index">{index + 1}</span><div><strong>{file.name}</strong><small>{groupSize > 1 ? `Listing ${Math.floor(index / groupSize) + 1} · ${index % groupSize === 0 ? "Cover photo" : "Gallery photo"}` : "Cover photo"}</small></div><button type="button" onClick={() => moveFile(index, -1)} disabled={index === 0} aria-label="Move photo earlier"><ArrowUp size={13} /></button><button type="button" onClick={() => moveFile(index, 1)} disabled={index === files.length - 1} aria-label="Move photo later"><ArrowDown size={13} /></button><button type="button" onClick={() => setFiles((current) => current.filter((_, photoIndex) => photoIndex !== index))} aria-label="Remove photo"><Trash2 size={13} /></button></div>)}</div>}<div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={createBatch.isPending || uploadImage.isPending} onClick={createDrafts}>{createBatch.isPending || uploadImage.isPending ? "Saving…" : files.length ? `Create ${groups.length} draft${groups.length === 1 ? "" : "s"}` : "Save draft"} <ChevronRight size={13} style={{ verticalAlign: "-2px" }} /></button></div></div></div>;
}

function ReportModal({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal"><div className="modal-head"><div><div className="eyebrow">Condition report</div><h2 id="report-title">Choose a listing first.</h2><p>Open a listing from Inventory to generate and save a report against that real item.</p></div><button className="close-button" onClick={onClose} aria-label="Close"><X size={16} /></button></div><div className="modal-footer"><button className="primary-button" onClick={onClose}>Back to inventory</button></div></div></div>;
}

function ModelModal({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="model-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal"><div className="modal-head"><div><div className="eyebrow">AI model generator</div><h2 id="model-title">Choose a listing first.</h2><p>Open a listing from Inventory to use its own cover photo for a model image.</p></div><button className="close-button" onClick={onClose} aria-label="Close"><X size={16} /></button></div><div className="modal-footer"><button className="primary-button" onClick={onClose}>Back to inventory</button></div></div></div>;
}

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [activeView, setActiveView] = useState<View>("overview");
  const [modal, setModal] = useState<"upload" | "report" | "model" | null>(null);
  const [search, setSearch] = useState("");

  const displayName = user?.displayName?.split(" ")[0] || user?.name?.split(" ")[0] || "Alex";
  const storeSlug = user?.storeSlug || `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "shop"}-preview`;
  const storePath = `fingerprintsau.com/${storeSlug}`;
  const renderView = () => {
    if (activeView === "inventory") return <InventoryView isAuthenticated={isAuthenticated} onUpload={() => setModal("upload")} onReport={() => setModal("report")} />;
    if (activeView === "storefront") return <StorefrontView displayName={displayName} storePath={storePath} isAuthenticated={isAuthenticated} />;
    if (activeView === "customize") return <CustomizeView />;
    if (activeView === "connections") return <ConnectionsView />;
    if (activeView === "reports") return <ReportsView onReport={() => setModal("report")} />;
    if (activeView === "usage") return <UsageView />;
    if (activeView === "profile") return <ProfileSettingsView isAuthenticated={isAuthenticated} />;
    if (activeView === "office") return <Suspense fallback={<div className="empty-screen"><h2>Loading Docs &amp; Sheets…</h2><p>Preparing your private workspace.</p></div>}><OfficeWorkspace /></Suspense>;
    return <Overview displayName={displayName} storePath={storePath} isAuthenticated={isAuthenticated} onUpload={() => setModal("upload")} onReport={() => setModal("report")} onModel={() => setModal("model")} />;
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="wordmark">finger<span>prints</span><sup style={{ fontFamily: "Manrope", fontSize: 8, marginLeft: 2, letterSpacing: 0 }}>™</sup></div>
      <div><div className="sidebar-label">Workspace</div><nav className="nav-list" style={{ marginTop: 9 }}>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${activeView === id ? "active" : ""}`} onClick={() => setActiveView(id)}><Icon size={16} strokeWidth={1.8} />{label}</button>)}</nav></div>
      <div><div className="sidebar-label">Tools</div><nav className="nav-list" style={{ marginTop: 9 }}><button className="nav-item" onClick={() => toast.info("Insights are coming soon.")}><BarChart3 size={16} strokeWidth={1.8} />Insights</button><button className={`nav-item ${activeView === "profile" ? "active" : ""}`} onClick={() => setActiveView("profile")}><Settings2 size={16} strokeWidth={1.8} />Settings</button></nav></div>
      <div className="sidebar-bottom"><div className="shop-card"><img className="avatar" src={user?.profileImageUrl || productImages[4]} alt={`${displayName} profile`} /><div><div className="shop-card-title">{displayName} edits</div><div className="shop-card-subtitle"><span className="status-dot" />Store live</div></div><button className="more-button" aria-label="Open profile menu" onClick={() => setActiveView("profile")}><MoreHorizontal size={14} /></button></div></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="topbar-title">fingerprintsau.com</div><label className="searchbox"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your workspace" aria-label="Search your workspace" /></label><div className="top-actions"><button className="icon-button" aria-label="Help" onClick={() => toast.info("Need a hand? Start with the batch upload addon.")}><CircleHelp size={17} /></button><button className="icon-button" aria-label="Notifications" onClick={() => toast.success("You are all caught up.")}><Zap size={16} /></button>{isAuthenticated ? <button className="primary-button" onClick={() => setModal("upload")}><Plus size={14} style={{ verticalAlign: "-2px" }} /> New listing</button> : <button className="primary-button" onClick={() => startLogin()}>Sign in</button>}</div></header>
      <div className="content">{search ? <div style={{ marginBottom: 18, padding: "11px 13px", borderRadius: 9, background: "#fff0ec", color: "#b34535", fontSize: 11, fontWeight: 800 }}>Showing smart matches for “{search}” across your workspace.</div> : null}{renderView()}</div>
    </main>
    <nav className="mobile-nav">{navItems.slice(0, 4).map(({ id, label, icon: Icon }) => <button key={id} className={activeView === id ? "active" : ""} onClick={() => setActiveView(id)}><Icon size={17} /><span>{label === "My storefront" ? "Shop" : label}</span></button>)}</nav>
    {modal === "upload" && <UploadModal onClose={() => setModal(null)} />}
    {modal === "report" && <ReportModal onClose={() => setModal(null)} />}
    {modal === "model" && <ModelModal onClose={() => setModal(null)} />}
  </div>;
}

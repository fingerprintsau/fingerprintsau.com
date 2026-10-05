import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckSquare, ChevronLeft, ChevronRight, Copy, FileCheck2, FileSpreadsheet, ImagePlus, Pencil, Plus, Search, Sparkles, Square, Trash2, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import CsvImportView from "./CsvImportView";
import ListingAiTools from "./ListingAiTools";

type Status = "live" | "draft" | "review";
type FilterStatus = "all" | Status;

type InventoryItem = {
  id: number;
  title: string;
  description: string | null;
  priceCents: number;
  size: string | null;
  condition: string;
  category: string | null;
  sku: string | null;
  status: Status;
  imageUrls: string[];
  photoStatus?: "ok" | "photo_missing";
  tags?: string[];
  conditionReport?: Record<string, unknown> | null;
  videoStatus?: "none" | "queued" | "ready" | "failed";
  videoUrl?: string | null;
};

type EditForm = {
  title: string;
  description: string;
  price: string;
  size: string;
  condition: string;
  category: string;
  sku: string;
  status: Status;
  imageUrls: string[];
};

const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "live", label: "Live" },
];

const MAX_IMAGES = 12;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const formatPrice = (cents: number) => `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const statusLabel = (status: Status) => status.charAt(0).toUpperCase() + status.slice(1);

function emptyForm(): EditForm {
  return { title: "", description: "", price: "0", size: "", condition: "Excellent", category: "", sku: "", status: "draft", imageUrls: [] };
}

function moveImage(images: string[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= images.length) return images;
  const next = [...images];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export default function InventoryView({ isAuthenticated, onUpload, onReport }: { isAuthenticated: boolean; onUpload: () => void; onReport: () => void }) {
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FilterStatus>("all");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<EditForm>(emptyForm);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const editImageInput = useRef<HTMLInputElement>(null);

  const input = useMemo(() => ({
    page,
    pageSize: 50,
    ...(search ? { search } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(category ? { category } : {}),
    ...(condition ? { condition } : {}),
  }), [page, search, status, category, condition]);
  const listingsQuery = trpc.listings.listPage.useQuery(input, { enabled: isAuthenticated, retry: false, placeholderData: (previous) => previous });
  const facetsQuery = trpc.listings.facets.useQuery(undefined, { enabled: isAuthenticated, retry: false, staleTime: 60_000 });
  const utils = trpc.useUtils();
  const update = trpc.listings.update.useMutation();
  const remove = trpc.listings.delete.useMutation();
  const duplicate = trpc.listings.duplicate.useMutation();
  const bulkStatus = trpc.listings.bulkStatus.useMutation();
  const bulkDelete = trpc.listings.bulkDelete.useMutation();
  const bulkReports = trpc.ai.bulkConditionReports.useMutation();
  const bulkBackground = trpc.ai.bulkRemoveBackground.useMutation();
  const bulkModels = trpc.ai.bulkModelImages.useMutation();
  const bulkVideoJobs = trpc.ai.bulkVideos.useMutation();
  const bulkWriteupsMutation = trpc.ai.bulkListingCopy.useMutation();
  const resumeAiJob = trpc.ai.resumeJob.useMutation();
  const latestAiJob = trpc.ai.latestJob.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 2000, retry: false });
  const uploadImage = trpc.listings.uploadImage.useMutation();
  const rows = (listingsQuery.data?.items ?? []) as InventoryItem[];
  const total = listingsQuery.data?.total ?? 0;
  const pageCount = listingsQuery.data?.pageCount ?? 0;
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));
  const busy = update.isPending || remove.isPending || duplicate.isPending || bulkStatus.isPending || bulkDelete.isPending || bulkReports.isPending || bulkBackground.isPending || bulkModels.isPending || bulkVideoJobs.isPending || bulkWriteupsMutation.isPending || resumeAiJob.isPending || uploadingImages;

  const refresh = async () => {
    await Promise.all([
      utils.listings.listPage.invalidate(),
      utils.listings.facets.invalidate(),
      utils.listings.metrics.invalidate(),
      utils.listings.list.invalidate(),
    ]);
  };

  const resetToFirstPage = () => {
    setPage(1);
    setSelectedIds(new Set());
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(searchDraft.trim());
    resetToFirstPage();
  };

  const changeFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    resetToFirstPage();
  };

  const toggleRow = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allSelected) rows.forEach((row) => next.delete(row.id)); else rows.forEach((row) => next.add(row.id));
      return next;
    });
  };

  const openEdit = (row: InventoryItem) => {
    setEditing(row);
    setForm({ title: row.title, description: row.description ?? "", price: String(row.priceCents / 100), size: row.size ?? "", condition: row.condition, category: row.category ?? "", sku: row.sku ?? "", status: row.status, imageUrls: [...row.imageUrls] });
  };

  const encodeFile = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(file);
  });

  const addEditImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    if (!selected.length) return;
    const available = MAX_IMAGES - form.imageUrls.length;
    const accepted = selected.filter((file) => file.size <= MAX_FILE_BYTES).slice(0, available);
    if (selected.some((file) => file.size > MAX_FILE_BYTES)) toast.error("Each image must be 20MB or smaller.");
    if (selected.length > available) toast.info(`A listing can have up to ${MAX_IMAGES} photos.`);
    if (!accepted.length) return;
    setUploadingImages(true);
    try {
      const urls: string[] = [];
      for (const file of accepted) {
        const stored = await uploadImage.mutateAsync({ fileName: file.name, contentType: file.type || "image/jpeg", data: await encodeFile(file) });
        urls.push(stored.url);
      }
      setForm((current) => ({ ...current, imageUrls: [...current.imageUrls, ...urls].slice(0, MAX_IMAGES) }));
      toast.success(`${urls.length} photo${urls.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload photos.");
    } finally {
      setUploadingImages(false);
    }
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    try {
      await update.mutateAsync({ id: editing.id, title: form.title.trim(), description: form.description.trim() || null, priceCents: Math.round(Number(form.price || 0) * 100), size: form.size.trim() || null, condition: form.condition.trim(), category: form.category.trim() || null, sku: form.sku.trim() || null, status: form.status, imageUrls: form.imageUrls });
      setEditing(null);
      await refresh();
      toast.success("Listing updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update listing.");
    }
  };

  const deleteOne = async (row: InventoryItem) => {
    if (!window.confirm(`Delete “${row.title}” permanently? This cannot be undone.`)) return;
    try {
      await remove.mutateAsync({ id: row.id });
      setSelectedIds((current) => { const next = new Set(current); next.delete(row.id); return next; });
      await refresh();
      toast.success("Listing deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete listing.");
    }
  };

  const duplicateOne = async (row: InventoryItem) => {
    try {
      await duplicate.mutateAsync({ id: row.id });
      await refresh();
      toast.success("Draft copy created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not duplicate listing.");
    }
  };

  const changeStatus = async (row: InventoryItem, nextStatus: Status) => {
    if (row.status === nextStatus) return;
    try {
      await update.mutateAsync({ id: row.id, status: nextStatus });
      await refresh();
      toast.success(`Moved to ${statusLabel(nextStatus)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change status.");
    }
  };

  const bulkChangeStatus = async (nextStatus: Status) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await bulkStatus.mutateAsync({ ids, status: nextStatus });
      setSelectedIds(new Set());
      await refresh();
      toast.success(`${ids.length} listing${ids.length === 1 ? "" : "s"} moved to ${statusLabel(nextStatus)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update selected listings.");
    }
  };

  const bulkDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected listing${ids.length === 1 ? "" : "s"} permanently? This cannot be undone.`)) return;
    try {
      await bulkDelete.mutateAsync({ ids });
      setSelectedIds(new Set());
      await refresh();
      toast.success(`${ids.length} listing${ids.length === 1 ? "" : "s"} deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete selected listings.");
    }
  };

  const bulkConditionReports = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try { await bulkReports.mutateAsync({ listingIds: ids }); setSelectedIds(new Set()); toast.success("Condition reports started in the background."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not create selected reports."); }
  };

  const bulkRemoveBackgrounds = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try { const result = await bulkBackground.mutateAsync({ listingIds: ids }); setSelectedIds(new Set()); await refresh(); toast.success(`${result.results.filter((item) => item.status === "saved").length} listing${result.results.length === 1 ? "" : "s"} updated with new photos.`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not remove backgrounds."); }
  };

  const bulkModelImages = async () => {
    const ids = Array.from(selectedIds);
    try { await bulkModels.mutateAsync({ listingIds: ids }); setSelectedIds(new Set()); toast.success("Model images started in the background."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not generate model images."); }
  };

  const bulkVideos = async () => {
    const ids = Array.from(selectedIds);
    try { const result = await bulkVideoJobs.mutateAsync({ listingIds: ids }); if (result.status === "coming_soon") toast.info("Coming soon"); else { setSelectedIds(new Set()); toast.success("Video jobs started in the background."); } }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not queue videos."); }
  };

  const bulkWriteups = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try { await bulkWriteupsMutation.mutateAsync({ listingIds: ids }); setSelectedIds(new Set()); toast.success("Listing write-ups started in the background."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not start listing write-ups."); }
  };

  const resumeBulkAi = async () => {
    if (!latestAiJob.data?.id) return;
    try { await resumeAiJob.mutateAsync({ id: latestAiJob.data.id }); toast.success("AI job resumed."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not resume the AI job."); }
  };

  return <>
    <div className="view-header"><div><div className="eyebrow">Your catalog</div><h1>Inventory</h1><p className="view-helper">Manage up to 10,000 listings without loading the whole catalog.</p></div><div style={{ display: "flex", gap: 8 }}><button className="secondary-button" onClick={() => setShowCsv(true)}><FileSpreadsheet size={13} style={{ verticalAlign: "-2px" }} /> CSV tools</button><button className="secondary-button" onClick={onReport}><FileCheck2 size={13} style={{ verticalAlign: "-2px" }} /> New report</button><button className="primary-button" onClick={onUpload}><Plus size={14} style={{ verticalAlign: "-2px" }} /> Add listings</button></div></div>
    <div className="inventory-toolbar"><form className="inventory-search" onSubmit={submitSearch}><Search size={15} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search title, SKU or category" aria-label="Search inventory" /><button type="submit" className="secondary-button">Search</button></form><select value={status} onChange={(event) => { setStatus(event.target.value as FilterStatus); resetToFirstPage(); }} aria-label="Filter by status"><option value="all">All statuses</option>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><select value={category} onChange={(event) => changeFilter(setCategory, event.target.value)} aria-label="Filter by category"><option value="">All categories</option>{(facetsQuery.data?.categories ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={condition} onChange={(event) => changeFilter(setCondition, event.target.value)} aria-label="Filter by condition"><option value="">All conditions</option>{(facetsQuery.data?.conditions ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
    {latestAiJob.data && latestAiJob.data.status !== "completed" && latestAiJob.data.status !== "failed" && <div className="ai-job-progress"><div className="ai-job-progress-head"><strong>AI {latestAiJob.data.feature} job</strong><span>{latestAiJob.data.processedItems} / {latestAiJob.data.totalItems}</span></div><div className="progress-track"><span style={{ width: `${latestAiJob.data.totalItems ? Math.round((latestAiJob.data.processedItems / latestAiJob.data.totalItems) * 100) : 0}%` }} /></div><div className="ai-job-progress-foot"><span>{latestAiJob.data.status === "interrupted" ? "Interrupted; ready to resume." : "Runs in the background — you can leave this page."}</span>{latestAiJob.data.status === "interrupted" && <button className="secondary-button" onClick={() => void resumeBulkAi()} disabled={resumeAiJob.isPending}>Resume</button>}</div></div>}
    {latestAiJob.data?.status === "completed" && latestAiJob.data.processedItems > 0 && <div className="ai-job-summary"><strong>Last AI job complete</strong><span>{latestAiJob.data.succeededItems} succeeded · {latestAiJob.data.skippedItems} skipped · {latestAiJob.data.failedItems} failed</span></div>}
    {selectedIds.size > 0 && <div className="bulk-bar"><strong>{selectedIds.size} selected</strong><span>Bulk actions</span><select defaultValue="" onChange={(event) => { if (event.target.value) void bulkChangeStatus(event.target.value as Status); event.currentTarget.value = ""; }} disabled={busy} aria-label="Change status for selected listings"><option value="">Change status…</option>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>Move to {option.label}</option>)}</select><button className="secondary-button" onClick={() => void bulkConditionReports()} disabled={busy}><FileCheck2 size={13} /> Reports · $0.39 · first 2 free</button><button className="secondary-button" onClick={() => void bulkModelImages()} disabled={busy}><WandSparkles size={13} /> Model · $0.89 · first 2 free</button><button className="secondary-button" onClick={() => void bulkVideos()} disabled={busy}><Sparkles size={13} /> Video · $1.49 · first 2 free</button><button className="secondary-button" onClick={() => void bulkWriteups()} disabled={busy}><Sparkles size={13} /> Write-ups · $0.19 · first 2 free</button><button className="secondary-button" onClick={() => void bulkRemoveBackgrounds()} disabled={busy}><ImagePlus size={13} /> Backgrounds · 1 free / batch $0.12</button><button className="danger-button" onClick={bulkDeleteSelected} disabled={busy}><Trash2 size={14} /> Delete selected</button><button className="icon-button" onClick={() => setSelectedIds(new Set())} aria-label="Clear selection"><X size={15} /></button></div>}
    <div className="inventory-list-head"><button className="select-all-button" onClick={togglePage} disabled={!rows.length} aria-label={allSelected ? "Deselect current page" : "Select current page"}>{allSelected ? <CheckSquare size={16} /> : <Square size={16} />}<span>{allSelected ? "Page selected" : "Select page"}</span></button><span>{listingsQuery.isFetching ? "Refreshing…" : `${total.toLocaleString("en-AU")} listing${total === 1 ? "" : "s"}`}</span></div>
    <div className="inventory-grid">{listingsQuery.isLoading ? <div className="empty-state">Loading your catalog…</div> : rows.length ? rows.map((row) => <article className={`inventory-card ${selectedIds.has(row.id) ? "selected" : ""}`} key={row.id}><button className="card-select" onClick={() => toggleRow(row.id)} aria-label={`${selectedIds.has(row.id) ? "Deselect" : "Select"} ${row.title}`}>{selectedIds.has(row.id) ? <CheckSquare size={17} /> : <Square size={17} />}</button><div className="inventory-image-wrap">{row.imageUrls[0] ? <img className="inventory-image" src={row.imageUrls[0]} alt={row.title} /> : <div className="inventory-image inventory-image-empty">No image</div>}{row.imageUrls.length > 1 && <span className="photo-count">{row.imageUrls.length} photos</span>}</div><div className="inventory-info"><h3>{row.title}</h3><p>{[row.size ? `Size ${row.size}` : null, row.condition, row.category].filter(Boolean).join(" · ")}</p>{row.photoStatus === "photo_missing" && <span className="photo-missing-flag">Photo missing</span>}<div className="inventory-bottom"><strong className="price">{formatPrice(row.priceCents)}</strong><select className={`inventory-status-select status-${row.status}`} value={row.status} onChange={(event) => void changeStatus(row, event.target.value as Status)} disabled={busy} aria-label={`Change status for ${row.title}`}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div className="inventory-card-actions"><button onClick={() => openEdit(row)} disabled={busy}><Pencil size={13} /> Edit</button><button onClick={() => void duplicateOne(row)} disabled={busy}><Copy size={13} /> Duplicate</button><button className="delete-action" onClick={() => void deleteOne(row)} disabled={busy}><Trash2 size={13} /> Delete</button></div></div></article>) : <div className="empty-state">No listings match these filters.</div>}</div>
    <div className="inventory-pagination"><span>Page {pageCount ? page : 0} of {pageCount || 0}</span><div><button className="secondary-button" onClick={() => { setPage((current) => Math.max(1, current - 1)); setSelectedIds(new Set()); }} disabled={page <= 1 || listingsQuery.isFetching}><ChevronLeft size={14} /> Previous</button><button className="secondary-button" onClick={() => { setPage((current) => Math.min(pageCount, current + 1)); setSelectedIds(new Set()); }} disabled={!pageCount || page >= pageCount || listingsQuery.isFetching}>Next <ChevronRight size={14} /></button></div></div>
    {showCsv && <CsvImportView isAuthenticated={isAuthenticated} filters={{ ...(search ? { search } : {}), ...(status !== "all" ? { status: status as Status } : {}), ...(category ? { category } : {}), ...(condition ? { condition } : {}) }} onClose={() => setShowCsv(false)} />}
    {editing && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-listing-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><form className="modal edit-listing-modal" onSubmit={saveEdit}><div className="modal-head"><div><div className="eyebrow">Listing editor</div><h2 id="edit-listing-title">Edit listing</h2><p className="modal-hint">Up to {MAX_IMAGES} photos. The first image is the cover.</p></div><button type="button" className="close-button" onClick={() => setEditing(null)} aria-label="Close"><X size={16} /></button></div><div className="gallery-editor"><div className="gallery-editor-head"><strong>{form.imageUrls.length}/{MAX_IMAGES} photos</strong><button type="button" className="secondary-button" onClick={() => editImageInput.current?.click()} disabled={uploadingImages || form.imageUrls.length >= MAX_IMAGES}><ImagePlus size={13} /> Add photos</button><input ref={editImageInput} aria-label="Choose listing photos" type="file" accept="image/*" multiple hidden onChange={addEditImages} /></div>{form.imageUrls.length ? <div className="gallery-grid">{form.imageUrls.map((url, index) => <div className={`gallery-item ${index === 0 ? "is-cover" : ""}`} key={`${url}-${index}`}><img src={url} alt={`${form.title || "Listing"} photo ${index + 1}`} /><div className="gallery-item-badge">{index === 0 ? "Cover" : index + 1}</div><div className="gallery-item-actions"><button type="button" onClick={() => setForm((current) => ({ ...current, imageUrls: moveImage(current.imageUrls, index, -1) }))} disabled={index === 0} aria-label="Move photo left"><ArrowUp size={12} /></button><button type="button" onClick={() => setForm((current) => ({ ...current, imageUrls: moveImage(current.imageUrls, index, 1) }))} disabled={index === form.imageUrls.length - 1} aria-label="Move photo right"><ArrowDown size={12} /></button><button type="button" className="gallery-remove" onClick={() => setForm((current) => ({ ...current, imageUrls: current.imageUrls.filter((_, photoIndex) => photoIndex !== index) }))} aria-label="Remove photo"><Trash2 size={12} /></button></div></div>)}</div> : <div className="gallery-empty"><ImagePlus size={20} /> Add up to {MAX_IMAGES} listing photos</div>}</div><ListingAiTools listing={{ ...editing, imageUrls: form.imageUrls }} onUpdated={refresh} /><div className="listing-form-grid"><label>Title<input required maxLength={180} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Price (AUD)<input required type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label><label>Size<input value={form.size} onChange={(event) => setForm({ ...form, size: event.target.value })} /></label><label>Condition<input required value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} /></label><label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label><label>SKU<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label><label className="wide-field">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Status })}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="wide-field">Description<textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div><div className="modal-footer"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="primary-button" disabled={update.isPending || uploadingImages}>{update.isPending ? "Saving…" : "Save changes"}</button></div></form></div>}
  </>;
}

export { InventoryView };

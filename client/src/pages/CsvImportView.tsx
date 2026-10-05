import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type CsvField = "title" | "price" | "size" | "condition" | "category" | "sku" | "description" | "photoUrls";
type CsvMapping = Record<CsvField, string[]>;
type Filters = { search?: string; status?: "live" | "draft" | "review"; category?: string; condition?: string };
const fields: Array<{ key: CsvField; label: string; required?: boolean; multi?: boolean }> = [
  { key: "title", label: "Title", required: true }, { key: "price", label: "Price", required: true }, { key: "size", label: "Size" }, { key: "condition", label: "Condition", required: true }, { key: "category", label: "Category" }, { key: "sku", label: "SKU" }, { key: "description", label: "Description" }, { key: "photoUrls", label: "Photo URLs", multi: true },
];
const emptyMapping = (): CsvMapping => ({ title: [], price: [], size: [], condition: [], category: [], sku: [], description: [], photoUrls: [] });
const autoMap = (headers: string[], saved: CsvMapping | null | undefined) => {
  const result = emptyMapping();
  for (const field of fields) {
    const savedHeaders = saved?.[field.key]?.filter((header) => headers.includes(header)) ?? [];
    if (savedHeaders.length) result[field.key] = savedHeaders;
    else {
      const matches = headers.filter((header) => {
        const normalized = header.toLowerCase().replace(/[^a-z]/g, "");
        return field.key === "photoUrls" ? /^(pic|photo|image|url)/.test(normalized) : normalized.includes(field.key.replace("Urls", "").toLowerCase());
      });
      result[field.key] = field.multi ? matches : matches.slice(0, 1);
    }
  }
  return result;
};

function readCsvSample(text: string) {
  const lines: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length && lines.length <= 20; index += 1) {
    const char = text[index];
    if (quoted) { if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); lines.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell); lines.push(row); }
  const headers = (lines.shift() ?? []).map((header, index) => header.trim() || `Column ${index + 1}`);
  return { headers, rows: lines.filter((values) => values.some((value) => value.trim())).slice(0, 20) };
}

function downloadText(name: string, text: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function CsvImportView({ isAuthenticated, filters, onClose }: { isAuthenticated: boolean; filters: Filters; onClose: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<CsvMapping>(emptyMapping);
  const [jobId, setJobId] = useState<number | null>(null);
  const savedMapping = trpc.csv.savedMapping.useQuery(undefined, { enabled: isAuthenticated, staleTime: 300_000 });
  const preview = trpc.csv.preview.useMutation();
  const startImport = trpc.csv.startImport.useMutation();
  const resumeImport = trpc.csv.resume.useMutation();
  const saveMapping = trpc.csv.saveMapping.useMutation();
  const latestJob = trpc.csv.latestJob.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: (query) => query.state.data?.status === "processing" || query.state.data?.status === "queued" ? 1500 : false });
  const activeJobId = jobId ?? latestJob.data?.id ?? null;
  const jobInput = useMemo(() => activeJobId ? { id: activeJobId } : undefined, [activeJobId]);
  const job = trpc.csv.job.useQuery(jobInput!, { enabled: Boolean(activeJobId), refetchInterval: (query) => query.state.data?.status === "processing" || query.state.data?.status === "queued" ? 1500 : false });
  const exportInput = useMemo(() => ({ ...filters }), [filters.search, filters.status, filters.category, filters.condition]);
  const exportQuery = trpc.csv.export.useQuery(exportInput, { enabled: false });
  const exportAllQuery = trpc.csv.export.useQuery({}, { enabled: false });

  useEffect(() => { if (headers.length && savedMapping.data) setMapping(autoMap(headers, savedMapping.data as CsvMapping)); }, [headers, savedMapping.data]);
  useEffect(() => { if (job.data?.status === "completed") { void latestJob.refetch(); toast.success(`CSV import complete: ${job.data.importedRows} imported, ${job.data.skippedRows} skipped, ${job.data.failedRows} failed.`); } }, [job.data?.status]);

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (file.size > 20_000_000) { toast.error("CSV must be 20MB or smaller."); return; }
    const text = await file.text();
    try { const sample = readCsvSample(text); setFileName(file.name); setCsvText(text); setHeaders(sample.headers); setSampleRows(sample.rows); setMapping(autoMap(sample.headers, savedMapping.data as CsvMapping | undefined)); }
    catch { toast.error("Could not read this CSV."); }
  };
  const setColumn = (field: CsvField, value: string | string[]) => setMapping((current) => ({ ...current, [field]: Array.isArray(value) ? value : value ? [value] : [] }));
  const runPreview = async () => {
    if (!csvText) { toast.error("Choose a CSV first."); return; }
    try { await saveMapping.mutateAsync(mapping); await preview.mutateAsync({ csvText, mapping }); toast.success("Preview ready."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not preview this CSV."); }
  };
  const runImport = async () => {
    if (!csvText || !preview.data || preview.data.validRows === 0) return;
    try { const result = await startImport.mutateAsync({ fileName, csvText, mapping }); setJobId(result.id); toast.success("Import started in the background."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not start the import."); }
  };
  const downloadExport = async (all: boolean) => {
    const result = await (all ? exportAllQuery : exportQuery).refetch();
    if (result.data) downloadText(all ? "fingerprints-inventory-all.csv" : "fingerprints-inventory-filtered.csv", result.data);
  };
  const resume = async () => {
    if (!currentJob) return;
    try { await resumeImport.mutateAsync({ id: currentJob.id }); setJobId(currentJob.id); await latestJob.refetch(); toast.success("Import resumed in the background."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not resume this import."); }
  };
  const currentJob = job.data ?? (latestJob.data?.id === activeJobId ? latestJob.data : null);
  const progress = currentJob?.totalRows ? Math.round((currentJob.processedRows / currentJob.totalRows) * 100) : 0;

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="csv-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal csv-modal">
    <div className="modal-head"><div><div className="eyebrow">Inventory tools</div><h2 id="csv-title">CSV import & export</h2><p>Bring in up to 10,000 listings. Nothing saves until you press Import.</p></div><button className="close-button" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
    <div className="csv-section"><div className="csv-section-head"><div><strong>Import inventory</strong><span>Map your columns, preview the result, then import valid rows as drafts.</span></div><button className="secondary-button" onClick={() => fileInput.current?.click()}><UploadCloud size={14} /> Choose CSV</button><input ref={fileInput} aria-label="Choose inventory CSV file" type="file" accept=".csv,text/csv" hidden onChange={(event) => void chooseFile(event)} /></div>{fileName && <div className="csv-file"><FileSpreadsheet size={16} /><span>{fileName}</span><small>{headers.length} columns · {sampleRows.length ? "first 20 rows loaded" : "ready"}</small></div>}
      {headers.length > 0 && <><div className="csv-mapping-grid">{fields.map(({ key, label, required, multi }) => <label key={key}>{label}{required ? " *" : ""}<select multiple={multi} size={multi ? 3 : 1} value={mapping[key]} onChange={(event) => setColumn(key, multi ? Array.from(event.target.selectedOptions).map((option) => option.value) : event.target.value)} aria-label={`Map ${label}`}>{!multi && <option value="">Not mapped</option>}{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select>{multi && <small>Choose one or more columns; split values with |</small>}</label>)}</div><div className="csv-actions"><button className="secondary-button" onClick={() => void runPreview()} disabled={preview.isPending || saveMapping.isPending}>{preview.isPending ? <><Loader2 size={13} className="spin" /> Checking…</> : "Preview before saving"}</button></div></>}
      {sampleRows.length > 0 && !preview.data && <div className="csv-sample"><strong>Sample preview · first 20 rows</strong><div className="csv-table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{sampleRows.map((row, index) => <tr key={index}>{headers.map((header, column) => <td key={header}>{row[column] ?? ""}</td>)}</tr>)}</tbody></table></div></div>}
      {preview.data && <div className="csv-preview"><div className="csv-stat-grid"><div><strong>{preview.data.validRows.toLocaleString()}</strong><span>OK to import</span></div><div><strong>{preview.data.errorRows.toLocaleString()}</strong><span>Rows with errors</span></div><div><strong>{preview.data.duplicateRows.toLocaleString()}</strong><span>Duplicate SKUs skipped</span></div><div><strong>{preview.data.totalRows.toLocaleString()}</strong><span>Total rows</span></div></div><div className="csv-table-wrap"><table><thead><tr><th>Row</th><th>Title</th><th>Price</th><th>SKU</th><th>Result</th></tr></thead><tbody>{preview.data.previewRows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.values[mapping.title[0]] ?? ""}</td><td>{row.values[mapping.price[0]] ?? ""}</td><td>{row.values[mapping.sku[0]] ?? ""}</td><td className={row.valid ? "csv-ok" : "csv-error"}>{row.valid ? "OK" : row.errors.join("; ")}</td></tr>)}</tbody></table></div><div className="csv-actions"><button className="secondary-button" onClick={() => downloadText("fingerprints-import-errors.csv", preview.data?.errorCsv ?? "")} disabled={!preview.data.errorRows}><Download size={13} /> Download error rows</button><button className="primary-button" onClick={() => void runImport()} disabled={startImport.isPending || !preview.data.validRows}>{startImport.isPending ? "Starting…" : `Import ${preview.data.validRows.toLocaleString()} valid rows`}</button></div></div>}
    </div>
    {currentJob && (currentJob.status === "queued" || currentJob.status === "processing") && <div className="csv-progress"><div><strong>Import running in the background</strong><span>{currentJob.processedRows.toLocaleString()} of {currentJob.totalRows.toLocaleString()} rows processed</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>}
    {currentJob?.status === "interrupted" && <div className="csv-complete csv-interrupted"><div><strong>Import interrupted</strong><span>{currentJob.processedRows.toLocaleString()} of {currentJob.totalRows.toLocaleString()} rows processed. No duplicate rows will be created.</span></div><button className="primary-button" onClick={() => void resume()} disabled={resumeImport.isPending}>{resumeImport.isPending ? "Resuming…" : "Resume import"}</button></div>}
    {currentJob?.status === "completed" && <div className="csv-complete"><strong>Import complete</strong><span>{currentJob.importedRows.toLocaleString()} imported · {currentJob.skippedRows.toLocaleString()} skipped · {currentJob.failedRows.toLocaleString()} failed</span></div>}
    <div className="csv-section csv-export"><div><strong>Export inventory</strong><span>Download all listings or exactly the current filtered view.</span></div><div className="csv-export-actions"><button className="secondary-button" onClick={() => void downloadExport(true)} disabled={exportAllQuery.isFetching || exportQuery.isFetching}><Download size={13} /> {exportAllQuery.isFetching ? "Preparing…" : "Download all"}</button><button className="secondary-button" onClick={() => void downloadExport(false)} disabled={exportQuery.isFetching || exportAllQuery.isFetching}><Download size={13} /> {exportQuery.isFetching ? "Preparing…" : "Download current view"}</button></div></div>
  </div></div>;
}

import { useEffect, useRef, useState } from "react";
import { FileDown, FilePlus2, FileUp, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createUniver } from "@univerjs/presets";
import { UniverInstanceType } from "@univerjs/core";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-docs-core/lib/index.css";
import { trpc } from "@/lib/trpc";

const blankSheet = { id: "workbook", name: "Workbook", sheetOrder: ["sheet1"], sheets: { sheet1: { id: "sheet1", name: "Sheet1", cellData: {} } } };
const blankDoc = { id: "document", body: { dataStream: "\n", textRuns: {}, paragraphs: [{ startIndex: 0, paragraphStyle: {} }] }, documentStyle: {} };

type OfficeFile = { id: number; name: string; fileType: "doc" | "sheet"; snapshotJson?: string | null };

function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }

export default function OfficeWorkspace() {
  const files = trpc.office.list.useQuery(undefined, { retry: false });
  const usage = trpc.office.usage.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const createFile = trpc.office.create.useMutation();
  const uploadFile = trpc.office.upload.useMutation();
  const saveFile = trpc.office.save.useMutation();
  const deleteFile = trpc.office.delete.useMutation();
  const [selected, setSelected] = useState<OfficeFile | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"doc" | "sheet">("sheet");
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ univer: any; unit: any } | null>(null);

  const mount = (file: OfficeFile | null, snapshot?: string | null) => {
    if (!containerRef.current) return;
    editorRef.current?.univer.dispose();
    containerRef.current.innerHTML = "";
    const parsed = snapshot ? JSON.parse(snapshot) : (file?.fileType === "doc" ? blankDoc : blankSheet);
    const preset = file?.fileType === "doc" ? UniverDocsCorePreset({ container: containerRef.current }) : UniverSheetsCorePreset({ container: containerRef.current });
    const created = createUniver({ darkMode: false, presets: [preset] });
    const kind = file?.fileType === "doc" ? UniverInstanceType.UNIVER_DOC : UniverInstanceType.UNIVER_SHEET;
    const unit = created.univer.createUnit(kind, parsed);
    editorRef.current = { univer: created.univer, unit };
  };

  useEffect(() => () => editorRef.current?.univer.dispose(), []);

  const open = async (file: OfficeFile) => { try { const full = await utils.office.get.fetch({ id: file.id }); setSelected(full); setName(full.name); setType(full.fileType); mount(full, full.snapshotJson); } catch { toast.error("Could not open that file."); } };
  const newFile = async () => { try { const created = await createFile.mutateAsync({ name: name.trim() || (type === "sheet" ? "Untitled sheet" : "Untitled document"), fileType: type, snapshotJson: JSON.stringify(type === "sheet" ? blankSheet : blankDoc) }); if (created) { await files.refetch(); await open(created as OfficeFile); toast.success("File created."); } } catch { toast.error("Could not create the file."); } };
  const save = async () => { if (!selected || !editorRef.current) return; try { const snapshotJson = JSON.stringify(editorRef.current.unit.getSnapshot()); await saveFile.mutateAsync({ id: selected.id, name: name.trim() || selected.name, snapshotJson, sizeBytes: new TextEncoder().encode(snapshotJson).byteLength }); await files.refetch(); await usage.refetch(); toast.success("Saved."); } catch { toast.error("Could not save the file."); } };
  const remove = async () => { if (!selected || !window.confirm(`Delete “${selected.name}”?`)) return; try { await deleteFile.mutateAsync({ id: selected.id }); editorRef.current?.univer.dispose(); editorRef.current = null; setSelected(null); setName(""); await files.refetch(); toast.success("File deleted."); } catch { toast.error("Could not delete the file."); } };

  const importFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!(ext === "csv" || ext === "xlsx" || ext === "docx")) { toast.error("Use .docx, .xlsx, or .csv files."); return; }
    if (file.size > 100 * 1024 * 1024) { toast.error("This file exceeds the 100 MB storage limit."); return; }
    const data = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...Array.from(new Uint8Array(data))));
    if (ext === "csv" || ext === "xlsx") {
      const XLSX = await import("xlsx");
      const workbook = ext === "csv" ? XLSX.read(await file.text(), { type: "string" }) : XLSX.read(data, { type: "array" });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
      const snapshot = { ...blankSheet, sheets: { sheet1: { ...blankSheet.sheets.sheet1, cellData: Object.fromEntries(rows.map((row, r) => [r, Object.fromEntries(row.map((v, c) => [c, { v }]))])) } } };
      const created = await uploadFile.mutateAsync({ name: file.name.replace(/\.(csv|xlsx)$/i, ""), fileType: "sheet", extension: ext, contentType: ext === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: base64, snapshotJson: JSON.stringify(snapshot) }); if (created) { await files.refetch(); await usage.refetch(); await open(created as OfficeFile); }
    } else if (ext === "docx") {
      const mammoth = await import("mammoth"); const result = await mammoth.extractRawText({ arrayBuffer: data }); const snapshot = { ...blankDoc, body: { ...blankDoc.body, dataStream: `${result.value}\n` } }; const created = await uploadFile.mutateAsync({ name: file.name.replace(/\.docx$/i, ""), fileType: "doc", extension: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: base64, snapshotJson: JSON.stringify(snapshot) }); if (created) { await files.refetch(); await usage.refetch(); await open(created as OfficeFile); }
    }
  };
  const exportFile = async () => { if (!selected || !editorRef.current) return; const snapshot = editorRef.current.unit.getSnapshot(); if (selected.fileType === "sheet") { const XLSX = await import("xlsx"); const rows = Object.values((snapshot as any).sheets?.sheet1?.cellData ?? {}).map((row: any) => Object.values(row).map((cell: any) => cell?.v ?? "")); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1"); downloadBlob(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })]), `${name || selected.name}.xlsx`); } else { const { Document, Packer, Paragraph } = await import("docx"); const doc = new Document({ sections: [{ children: [new Paragraph((snapshot as any).body?.dataStream?.replace(/\n$/, "") || "")] }] }); downloadBlob(await Packer.toBlob(doc), `${name || selected.name}.docx`); } };

  return <div className="office-workspace"><div className="view-header"><div><div className="eyebrow">Seller workspace</div><h1>Docs &amp; Sheets</h1><p className="page-subtitle">Private business files, saved to your seller account.</p><p className="panel-meta">{((usage.data?.usedBytes ?? 0) / (1024 * 1024)).toFixed(1)} MB of 100 MB used · {usage.data?.fileCount ?? 0} of 200 files</p></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><label className="secondary-button"><FileUp size={14} /> Import<input hidden aria-label="Import DOCX, XLSX or CSV file" type="file" accept=".docx,.xlsx,.csv" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} /></label><button className="secondary-button" disabled={!selected} onClick={() => void exportFile()}><FileDown size={14} /> Export</button><button className="primary-button" onClick={() => void newFile()}><FilePlus2 size={14} /> New</button></div></div><div className="office-layout"><aside className="panel office-files"><div className="panel-head"><div><div className="panel-title">My files</div><div className="panel-meta">Only you can access these files.</div></div></div>{files.isLoading ? <div className="empty-state">Loading…</div> : files.data?.length ? files.data.map((file) => <button key={file.id} className={`office-file ${selected?.id === file.id ? "active" : ""}`} onClick={() => void open(file)}><span>{file.fileType === "sheet" ? "▦" : "▤"}</span><span>{file.name}</span></button>) : <div className="empty-state">No files yet.</div>}<div style={{ display: "grid", gap: 8, marginTop: 16 }}><input className="input" aria-label="New file name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New file name" /><select className="input" aria-label="New file type" value={type} onChange={(e) => setType(e.target.value as "doc" | "sheet")}><option value="sheet">Spreadsheet</option><option value="doc">Document</option></select></div></aside><section className="panel office-editor"><div className="panel-head"><div><div className="panel-title">{selected?.name || "Choose a file"}</div><div className="panel-meta">{selected ? "Edits stay private to your seller account." : "Create or import a file to begin."}</div></div><div style={{ display: "flex", gap: 8 }}>{selected && <><button className="secondary-button" onClick={() => void save()}><Save size={14} /> Save</button><button className="secondary-button" onClick={() => void remove()}><Trash2 size={14} /></button></>}</div></div><div className="office-canvas" ref={containerRef}>{!selected && <div className="empty-state">Your Univer editor will appear here.</div>}</div></section></div></div>;
}

export { blankSheet, blankDoc };

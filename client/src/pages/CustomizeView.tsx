import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Blocks, Check, Eye, EyeOff, GripVertical, Pencil, Plus, Save, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";

type DraftBlock = { id: number; blockType: string; title: string; body: string | null; isVisible: boolean; sortOrder: number };

const blockLabels: Record<string, string> = { hero: "Hero intro", drop: "Featured drop", story: "Seller story", social: "Social links" };

export default function CustomizeView() {
  const blocksQuery = trpc.storefront.blocks.useQuery(undefined, { retry: false });
  const updateBlock = trpc.storefront.updateBlock.useMutation();
  const [blocks, setBlocks] = useState<DraftBlock[]>([]);
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    if (blocksQuery.data) setBlocks(blocksQuery.data as DraftBlock[]);
  }, [blocksQuery.data]);

  const save = async (block: DraftBlock) => {
    try {
      await updateBlock.mutateAsync({ id: block.id, title: block.title, body: block.body, isVisible: block.isVisible, sortOrder: block.sortOrder });
      setEditing(null);
      toast.success("Block saved to your storefront.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in to save storefront blocks.");
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setBlocks(next.map((block, position) => ({ ...block, sortOrder: position })));
  };

  return <>
    <div className="view-header"><div><div className="eyebrow">Make it yours</div><h1>Customize blocks</h1></div><button className="primary-button" onClick={() => toast.success("Preview updated with your visible blocks.")}><Eye size={14} style={{ verticalAlign: "-2px" }} /> Preview page</button></div>
    <div className="customize-intro"><div className="customize-intro-icon"><Blocks size={18} /></div><div><strong>Same design system. Your point of view.</strong><p>Reorder, rewrite, hide or add to your public page without touching code. Changes are saved per storefront.</p></div><Sparkles size={18} color="#f0442f" /></div>
    <div className="block-editor">{blocks.map((block, index) => <article className={`block-row ${!block.isVisible ? "hidden-block" : ""}`} key={block.id}><div className="block-handle"><GripVertical size={17} /></div><div className="block-meta"><span className="block-type">{blockLabels[block.blockType] ?? block.blockType}</span><span className="block-order">Block {index + 1}</span></div><div className="block-content">{editing === block.id ? <><input aria-label={`Block ${index + 1} title`} value={block.title} onChange={(event) => setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, title: event.target.value } : item))} /><textarea aria-label={`Block ${index + 1} body`} value={block.body ?? ""} onChange={(event) => setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, body: event.target.value } : item))} rows={2} /><button className="text-button" onClick={() => save(block)}><Save size={13} style={{ verticalAlign: "-2px" }} /> Save copy</button></> : <><strong>{block.title}</strong><p>{block.body}</p></>}</div><div className="block-actions">{editing === block.id ? <button className="small-action" onClick={() => setEditing(null)}>Cancel</button> : <button className="small-action" onClick={() => setEditing(block.id)}><Pencil size={14} /></button>}<button className="small-action" onClick={() => setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, isVisible: !item.isVisible } : item))} aria-label={block.isVisible ? "Hide block" : "Show block"}>{block.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}</button><button className="small-action" onClick={() => move(index, -1)} aria-label="Move block up"><ArrowUp size={14} /></button><button className="small-action" onClick={() => move(index, 1)} aria-label="Move block down"><ArrowDown size={14} /></button></div></article>)}<button className="add-block-button" onClick={() => toast.info("New block templates are being added to the library.")}><Plus size={15} /> Add a block</button></div>
    <section className="panel block-tips"><div className="panel-head"><div><div className="panel-title">Block ideas that bring sellers back</div><div className="panel-meta">Keep your page alive without making it noisy.</div></div><Check size={16} color="#56a76b" /></div><div className="tip-grid"><div><strong>Drop countdown</strong><span>Build a weekly habit around a small release.</span></div><div><strong>Closet notes</strong><span>Share care, provenance and styling context.</span></div><div><strong>Social shelf</strong><span>Bring each platform back to one storefront.</span></div></div></section>
  </>;
}

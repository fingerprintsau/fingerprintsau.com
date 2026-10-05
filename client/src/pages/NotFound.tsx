import { ArrowLeft, SearchX } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return <main className="not-found-page"><div className="not-found-card"><div className="not-found-icon"><SearchX size={28} /></div><div className="eyebrow">Fingerprints</div><h1>That page has wandered off.</h1><p>We couldn't find what you were looking for, but there are plenty of good pieces waiting in the marketplace.</p><Link href="/" className="primary-button"><ArrowLeft size={15} /> Back to the marketplace</Link></div></main>;
}

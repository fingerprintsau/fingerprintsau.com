import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, MapPin, Save, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const states = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];
const MAX_PROFILE_PHOTO_BYTES = 10 * 1024 * 1024;

function encodeFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

export default function ProfileSettingsView({ isAuthenticated }: { isAuthenticated: boolean }) {
  const profileQuery = trpc.profile.me.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const utils = trpc.useUtils();
  const uploadPhoto = trpc.profile.uploadPhoto.useMutation();
  const updateProfile = trpc.profile.update.useMutation();
  const photoInput = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [suburb, setSuburb] = useState("");
  const [state, setState] = useState("");
  const [storeSlug, setStoreSlug] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [showInCatalog, setShowInCatalog] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!profileQuery.data || hydrated) return;
    setDisplayName(profileQuery.data.displayName || profileQuery.data.name || "");
    setBio(profileQuery.data.bio || "");
    setSuburb(profileQuery.data.suburb || "");
    setState(profileQuery.data.state || "");
    setStoreSlug(profileQuery.data.storeSlug || "");
    setProfileImageUrl(profileQuery.data.profileImageUrl || null);
    setShowInCatalog(profileQuery.data.showInCatalog !== false);
    setHydrated(true);
  }, [profileQuery.data, hydrated]);

  const slugInput = useMemo(() => ({ slug: storeSlug }), [storeSlug]);
  const slugQuery = trpc.profile.checkSlug.useQuery(slugInput, { enabled: isAuthenticated && hydrated && storeSlug.length > 2, retry: false, staleTime: 500, refetchOnWindowFocus: false });
  const slugAvailable = slugQuery.data?.available === true;
  const slugReserved = slugQuery.data?.reserved === true;
  const slugHasError = hydrated && storeSlug.length > 2 && !slugQuery.isFetching && slugQuery.data?.available === false;

  const choosePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      toast.error("Profile photos must be 10MB or smaller.");
      return;
    }
    try {
      const result = await uploadPhoto.mutateAsync({ fileName: file.name, contentType: file.type || "image/jpeg", data: await encodeFile(file) });
      setProfileImageUrl(result.url);
      toast.success("Profile photo ready to save.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload profile photo.");
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (slugReserved) {
      toast.error("This address is reserved");
      return;
    }
    if (!slugAvailable || slugHasError || slugQuery.isFetching) {
      toast.error("Choose an available store address before saving.");
      return;
    }
    try {
      await updateProfile.mutateAsync({ displayName: displayName.trim(), bio: bio.trim() || null, suburb: suburb.trim() || null, state: state || null, profileImageUrl, storeSlug, showInCatalog });
      await utils.profile.me.invalidate();
      toast.success("Seller profile saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your profile.");
    }
  };

  if (!isAuthenticated) return <div className="empty-state">Sign in to edit your seller profile.</div>;
  if (profileQuery.isLoading) return <div className="empty-state">Loading your seller profile…</div>;

  return <>
    <div className="view-header"><div><div className="eyebrow">Your identity</div><h1>Seller profile</h1><p className="view-helper">This is the profile buyers see alongside your storefront.</p></div><div className="profile-address-chip"><MapPin size={13} /> fingerprintsau.com/{storeSlug || "your-address"}</div></div>
    <form className="profile-settings-layout" onSubmit={save}>
      <section className="panel profile-card"><div className="panel-head"><div><div className="panel-title">Profile details</div><div className="panel-meta">Keep your corner of Fingerprints unmistakably yours.</div></div></div><div className="profile-form-body"><div className="profile-photo-row"><div className="profile-photo-large">{profileImageUrl ? <img src={profileImageUrl} alt="Seller profile" /> : <span>{displayName.slice(0, 1).toUpperCase() || "F"}</span>}</div><div><strong>Profile photo</strong><p>Use a clear image buyers will recognise. JPG, PNG up to 10MB.</p><button type="button" className="secondary-button" onClick={() => photoInput.current?.click()} disabled={uploadPhoto.isPending}><ImagePlus size={13} /> {uploadPhoto.isPending ? "Uploading…" : "Choose photo"}</button><input ref={photoInput} aria-label="Choose seller profile photo" type="file" accept="image/*" hidden onChange={choosePhoto} /></div></div><div className="profile-form-grid"><label>Display name<input required maxLength={160} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. Alex edits" /></label><label>Suburb<input maxLength={120} value={suburb} onChange={(event) => setSuburb(event.target.value)} placeholder="e.g. Fitzroy" /></label><label>State<select value={state} onChange={(event) => setState(event.target.value)}><option value="">Select state</option>{states.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="wide-field">Bio<textarea maxLength={1000} rows={5} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Tell buyers a little about your edit, style or sourcing." /><small>{bio.length}/1000</small></label></div></div></section>
      <aside className="profile-side-stack"><section className="panel address-card"><div className="panel-head"><div><div className="panel-title">Store address</div><div className="panel-meta">Your public URL is yours to edit.</div></div><MapPin size={16} color="#aaa89f" /></div><div className="address-form"><label>Address<input required maxLength={120} value={storeSlug} onChange={(event) => setStoreSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="your-store-name" aria-describedby="slug-status" /></label><div className={`slug-status ${slugAvailable ? "available" : slugReserved || slugHasError ? "taken" : ""}`} id="slug-status">{slugQuery.isFetching ? <><Loader2 size={12} className="spin" /> Checking address…</> : slugReserved ? <><X size={12} /> This address is reserved</> : slugAvailable ? <><Check size={12} /> Available</> : slugHasError ? <><X size={12} /> Taken — try another</> : "Use lowercase letters, numbers and hyphens."}</div><p className="address-note">If you change it, your old storefront address will redirect automatically.</p></div></section><section className="panel catalog-visibility-card"><label className="catalog-visibility-toggle"><input type="checkbox" checked={showInCatalog} onChange={(event) => setShowInCatalog(event.target.checked)} /><span><strong>Show my listings on Google, Facebook and Instagram</strong><small>When off, your live listings are left out of the public product feed.</small></span></label></section><section className="profile-save-card"><div><strong>Ready to leave a mark?</strong><p>Save your profile and keep your storefront link up to date.</p></div><button className="primary-button" type="submit" disabled={updateProfile.isPending || uploadPhoto.isPending || !slugAvailable || slugReserved}>{updateProfile.isPending ? <><Loader2 size={13} className="spin" /> Saving…</> : <><Save size={13} /> Save profile</>}</button></section></aside>
    </form>
  </>;
}

export { ProfileSettingsView };

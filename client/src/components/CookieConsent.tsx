import { useEffect, useState } from "react";

const KEY = "fp_cookie_consent";
type Choice = "accepted" | "declined" | null;

export function CookieConsent() {
  const [choice, setChoice] = useState<Choice>(() => localStorage.getItem(KEY) as Choice);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener("fp:open-cookie-settings", open);
    return () => window.removeEventListener("fp:open-cookie-settings", open);
  }, []);

  const save = (next: Exclude<Choice, null>) => {
    localStorage.setItem(KEY, next);
    setChoice(next);
    setSettingsOpen(false);
  };

  if (choice && !settingsOpen) return null;
  return <aside className="cookie-banner" role="dialog" aria-label="Cookie settings"><div><strong>Cookies on Fingerprints</strong><p>Essential cookies keep you logged in and the site working. Analytics and advertising cookies are only used if you accept.</p></div><div className="cookie-actions"><button className="cookie-decline" onClick={() => save("declined")}>Decline non-essential</button><button className="primary-button" onClick={() => save("accepted")}>Accept</button></div></aside>;
}

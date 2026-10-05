import { useEffect } from "react";

const SITE = "fingerprintsau.com";
const ORIGIN = "https://www.fingerprintsau.com";

function setMeta(attribute: "name" | "property", key: string, content: string) {
  let node = document.head.querySelector(`meta[${attribute}="${key}"]`) as HTMLMetaElement | null;
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attribute, key);
    document.head.appendChild(node);
  }
  node.content = content;
}

export function usePublicMeta(input: { title: string; description: string; image?: string; path?: string; type?: "website" | "article" }) {
  useEffect(() => {
    document.title = input.title;
    setMeta("name", "description", input.description);
    setMeta("property", "og:title", input.title);
    setMeta("property", "og:description", input.description);
    setMeta("property", "og:type", input.type || "website");
    setMeta("property", "og:url", `${ORIGIN}${input.path || window.location.pathname}`);
    setMeta("property", "og:site_name", SITE);
    setMeta("name", "twitter:card", input.image ? "summary_large_image" : "summary");
    setMeta("name", "twitter:title", input.title);
    setMeta("name", "twitter:description", input.description);
    if (input.image) {
      setMeta("property", "og:image", input.image.startsWith("http") ? input.image : `${ORIGIN}${input.image}`);
      setMeta("name", "twitter:image", input.image.startsWith("http") ? input.image : `${ORIGIN}${input.image}`);
    }
  }, [input.description, input.image, input.path, input.title, input.type]);
}

export function useJsonLd(data: unknown, id: string) {
  const serialized = JSON.stringify(data);
  useEffect(() => {
    let node = document.head.querySelector(`script[data-json-ld="${id}"]`) as HTMLScriptElement | null;
    if (!node) {
      node = document.createElement("script");
      node.type = "application/ld+json";
      node.dataset.jsonLd = id;
      document.head.appendChild(node);
    }
    node.textContent = serialized;
    return () => node?.remove();
  }, [id, serialized]);
}

export { SITE };

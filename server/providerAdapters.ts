import { generateImage } from "./_core/imageGeneration";
import { ENV } from "./_core/env";
import { storageGetSignedUrl, storagePut } from "./storage";

export type MediaProvider = "manus" | "nano_banana";

export type MediaGenerationResult = {
  provider: MediaProvider;
  status: "completed" | "queued";
  imageUrl?: string;
  requestId?: string;
  statusUrl?: string;
};

export async function generateModelImage(options: {
  provider: MediaProvider;
  prompt: string;
  originalImageUrl?: string;
}): Promise<MediaGenerationResult> {
  if (options.provider === "manus") {
    const result = await generateImage({
      prompt: options.prompt,
      originalImages: options.originalImageUrl ? [{ url: options.originalImageUrl, mimeType: "image/jpeg" }] : [],
    });
    return { provider: "manus", status: "completed", imageUrl: result.url };
  }

  if (options.provider === "nano_banana") {
    if (!ENV.geminiApiKey) throw new Error("Nano Banana is not configured yet. Add GEMINI_API_KEY in project secrets.");
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": ENV.geminiApiKey, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3.1-flash-image",
        input: options.prompt,
        generation_config: { thinking_level: "minimal" },
        response_format: [{ type: "image" }],
      }),
    });
    if (!response.ok) throw new Error(`Nano Banana request failed (${response.status})`);
    const result = await response.json() as { output_image?: { data?: string; mime_type?: string } };
    if (!result.output_image?.data) throw new Error("Nano Banana returned no image output.");
    const buffer = Buffer.from(result.output_image.data, "base64");
    const stored = await storagePut(`generated/nano-banana-${Date.now()}.png`, buffer, result.output_image.mime_type ?? "image/png");
    return { provider: "nano_banana", status: "completed", imageUrl: stored.url };
  }

  throw new Error("Unsupported model image provider.");
}

export async function generateListingVideo(options: { imageUrls: string[]; prompt: string }): Promise<{ status: "queued" | "coming_soon"; requestId?: string; statusUrl?: string }> {
  if (!ENV.higgsfieldApiKeyId || !ENV.higgsfieldApiKeySecret) return { status: "coming_soon" };
  const response = await fetch("https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard", {
    method: "POST",
    headers: { Authorization: `Key ${ENV.higgsfieldApiKeyId}:${ENV.higgsfieldApiKeySecret}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: options.prompt, image_url: options.imageUrls[0] }),
  });
  if (!response.ok) throw new Error(`Video request failed (${response.status})`);
  const result = await response.json() as { request_id?: string; status_url?: string };
  return { status: "queued", requestId: result.request_id, statusUrl: result.status_url };
}

export async function pollListingVideo(statusUrl: string): Promise<{ status: "queued" | "ready" | "failed"; videoUrl?: string }> {
  if (!ENV.higgsfieldApiKeyId || !ENV.higgsfieldApiKeySecret) return { status: "failed" };
  const response = await fetch(statusUrl, { headers: { Authorization: `Key ${ENV.higgsfieldApiKeyId}:${ENV.higgsfieldApiKeySecret}` } });
  if (!response.ok) throw new Error(`Video status request failed (${response.status})`);
  const result = await response.json() as { status?: string; video_url?: string; output_url?: string; url?: string };
  const videoUrl = result.video_url ?? result.output_url ?? result.url;
  if (videoUrl) return { status: "ready", videoUrl };
  if (["failed", "error", "cancelled"].includes((result.status ?? "").toLowerCase())) return { status: "failed" };
  return { status: "queued" };
}

export async function storeListingVideo(videoUrl: string, listingId: number) {
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`Could not download the completed video (${response.status}).`);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "video/mp4";
  if (!contentType.startsWith("video/")) throw new Error("Completed provider output was not a video.");
  const bytes = Buffer.from(await response.arrayBuffer());
  const stored = await storagePut(`listings/${listingId}/videos/${Date.now()}.mp4`, bytes, contentType);
  return stored.url;
}

export async function removeBackground(options: { imageUrls: string[] }) {
  if (!ENV.clipdropApiKey) throw new Error("Background removal is not configured yet. Add CLIPDROP_API_KEY in project secrets.");
  const urls: string[] = [];
  for (const imageUrl of options.imageUrls) {
    if (!imageUrl.startsWith("/manus-storage/") || imageUrl.includes("..")) throw new Error("Background removal only accepts images stored by Fingerprints.");
    const signedUrl = await storageGetSignedUrl(imageUrl);
    const input = await fetch(signedUrl);
    if (!input.ok) throw new Error("Could not fetch the source image for background removal.");
    const bytes = await input.arrayBuffer();
    const form = new FormData();
    form.append("image_file", new Blob([bytes], { type: input.headers.get("content-type") ?? "image/jpeg" }), "source.jpg");
    form.append("transparency_handling", "return_input_if_non_opaque");
    const response = await fetch("https://clipdrop-api.co/remove-background/v1", {
      method: "POST",
      headers: { "x-api-key": ENV.clipdropApiKey, accept: "image/png" },
      body: form,
    });
    if (!response.ok) throw new Error(`Background removal failed (${response.status})`);
    const output = Buffer.from(await response.arrayBuffer());
    const stored = await storagePut(`background-removed/${Date.now()}.png`, output, "image/png");
    urls.push(stored.url);
  }
  return { urls, charged: options.imageUrls.length > 1, provider: "clipdrop" };
}

export function getProviderCatalog() {
  return {
    image: [
      { id: "manus", label: "Manus Image", mode: "Built in", configured: Boolean(ENV.forgeApiKey) },
      { id: "nano_banana", label: "Nano Banana 2", mode: "Google API", configured: Boolean(ENV.geminiApiKey) },
    ],
    video: [
      { id: "higgsfield", label: "Higgsfield", mode: "External API", configured: Boolean(ENV.higgsfieldApiKeyId && ENV.higgsfieldApiKeySecret) },
    ],
    cleanup: [
      { id: "clipdrop", label: "Clipdrop Remove Background", mode: "External API", configured: Boolean(ENV.clipdropApiKey) },
    ],
  } as const;
}

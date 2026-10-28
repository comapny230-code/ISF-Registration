const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

/** Returns an escaped http(s) URL, or null for any other scheme (e.g. javascript:, data:). */
export function safeHttpUrl(value: unknown): string | null {
  const text = String(value ?? "").trim();
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? escapeHtml(url.toString()) : null;
  } catch {
    return null;
  }
}

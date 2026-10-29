/**
 * Limits for the registration request and the files it carries. The form sends photos as
 * compressed JPEG data URLs and the project report (≤ 20 MB) as a data URL or a link; the
 * server accepts exactly that and nothing scriptable (HTML, SVG, javascript: URLs).
 */
import { HttpError } from "../http";

/** The 20 MB report as base64 (~26.7 MB) plus six compressed photos and the form fields. */
export const MAX_REGISTRATION_BODY_BYTES = 32 * 1024 * 1024;
const MAX_PHOTO_CHARS = 2 * 1024 * 1024;
const MAX_REPORT_CHARS = Math.ceil((20 * 1024 * 1024 * 4) / 3) + 1024;
const MAX_URL_CHARS = 2048;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const REPORT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isHttpsUrl(value: string): boolean {
  if (value.length > MAX_URL_CHARS || /\s/.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isDataUrl(value: string, types: Set<string>, maxChars: number): boolean {
  if (value.length > maxChars) return false;
  const match = /^data:([a-z0-9.+/-]+);base64,/.exec(value);
  return Boolean(match && types.has(match[1]) && BASE64.test(value.slice(match[0].length)));
}

export const isAcceptablePhoto = (value: string): boolean => isHttpsUrl(value) || isDataUrl(value, PHOTO_TYPES, MAX_PHOTO_CHARS);
export const isAcceptableReport = (value: string): boolean => isHttpsUrl(value) || isDataUrl(value, REPORT_TYPES, MAX_REPORT_CHARS);

/** Reads the body as text, refusing (413) anything larger than the limit before it is all buffered. */
export async function readLimitedText(request: Request, maxBytes = MAX_REGISTRATION_BODY_BYTES): Promise<string> {
  const tooLarge = () => new HttpError(413, "PAYLOAD_TOO_LARGE", "The registration is too large. Use a project report under 20 MB.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

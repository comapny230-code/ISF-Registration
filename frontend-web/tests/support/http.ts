export const ORIGIN = "http://localhost:3000";

let ipCounter = 0;
/** A distinct documentation-range address per call, so rate limits only apply where a test wants them. */
export function nextIp(): string {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}`;
}

export interface RequestOptions {
  method?: string;
  cookie?: string;
  origin?: string | null;
  contentType?: string;
  fetchSite?: string;
  ip?: string;
}

export function apiRequest(path: string, body?: unknown, options: RequestOptions = {}): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.set("origin", origin);
  headers.set("content-type", options.contentType ?? "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.fetchSite) headers.set("sec-fetch-site", options.fetchSite);
  headers.set("x-forwarded-for", options.ip ?? nextIp());
  return new Request(`${ORIGIN}${path}`, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function call(handler: (req: Request) => Promise<Response>, request: Request) {
  const res = await handler(request);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as Record<string, any>) : null };
}

/** "name=value" for a Set-Cookie header, ready to send back in a Cookie header. */
export function cookiePair(headers: Headers, name: string): string | null {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${name.replace(/[-]/g, "\\-")}=([^;]*)`));
  return match ? `${name}=${match[1]}` : null;
}

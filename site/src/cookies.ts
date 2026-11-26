export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

type CookieOptions = { maxAge: number; path?: string; sharedAcrossSubdomains?: boolean };

export function cookie(url: URL, name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (url.protocol === "https:") parts.push("Secure");
  if (options.sharedAcrossSubdomains && url.hostname.endsWith("makeworlds.dev")) parts.push("Domain=makeworlds.dev");
  return parts.join("; ");
}

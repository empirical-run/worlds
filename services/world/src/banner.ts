import type { World } from "@worlds/db";

const STYLE = `
:root { --worlds-banner-height: 32px; }
.worlds-banner { box-sizing: border-box; height: var(--worlds-banner-height); display: flex; align-items: center; gap: 10px; padding: 0 16px; background: #1f2328; color: #e6edf3; font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; overflow: hidden; position: relative; z-index: 2147483647; }
.worlds-banner .worlds-text { overflow: hidden; text-overflow: ellipsis; color: #c9d1d9; }
.worlds-banner .worlds-text strong { color: #fff; font-weight: 600; }
.worlds-banner a { margin-left: auto; flex-shrink: 0; color: #fff; text-decoration: underline; text-underline-offset: 2px; }
`;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function bannerHtml(name: string, world: World, makeworldsUrl: string): string {
  return `<div class="worlds-banner" role="note"><span class="worlds-text">Replica of ${name} in the world <strong>${escapeHtml(world.name)}</strong></span><a href="${escapeHtml(makeworldsUrl)}/worlds">Back to Worlds</a></div>`;
}

export function withBanner(
  response: Response,
  name: string,
  world: World,
  makeworldsUrl: string,
  serviceStyle = "",
): Response {
  if (
    !response.headers.get("content-type")?.includes("text/html") ||
    response.headers.get("x-worlds-banner") === "off"
  ) {
    return response;
  }
  const banner = bannerHtml(name, world, makeworldsUrl);
  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(`<style>${STYLE}${serviceStyle}</style>`, { html: true });
      },
    })
    .on("body", {
      element(element) {
        element.prepend(banner, { html: true });
      },
    })
    .transform(response);
}

export function signInPage(name: string, world: World, makeworldsUrl: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to see this ${name}</title><style>body { margin: 0; font: 14px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #172b4d; } main { max-width: 420px; margin: 96px auto; padding: 0 20px; text-align: center; } h1 { font-size: 20px; font-weight: 600; } a { color: #0c66e4; } @media (prefers-color-scheme: dark) { body { background: #1d2125; color: #b6c2cf; } a { color: #579dff; } }</style></head><body><main><h1>Sign in to see this ${name}</h1><p>Only members of the team that owns this world can see its ${name} pages.</p><p><a href="${escapeHtml(makeworldsUrl)}/account">Sign in to Worlds</a></p></main></body></html>`,
    {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";

const services = new URL("../../", import.meta.url);
const out = new URL("../dist/ui/", import.meta.url);

rmSync(out, { recursive: true, force: true });
for (const entry of readdirSync(services, { withFileTypes: true })) {
  const dir = entry.name;
  const manifestUrl = new URL(`${dir}/package.json`, services);
  if (!entry.isDirectory() || !existsSync(manifestUrl)) {
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  if (!manifest.scripts?.["build:ui"]) {
    continue;
  }
  execFileSync("pnpm", ["--filter", manifest.name, "build:ui"], { stdio: "inherit" });
  cpSync(new URL(`${dir}/ui/dist/`, services), new URL(`${dir}/`, out), { recursive: true });
}

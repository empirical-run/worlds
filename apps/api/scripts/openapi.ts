import { writeFileSync } from "node:fs";
import app from "../src/index";

const [outPath] = process.argv.slice(2);
const response = await app.request("/api/openapi.json", {}, { DB: {} });
writeFileSync(outPath, `${JSON.stringify(await response.json(), null, 2)}\n`);

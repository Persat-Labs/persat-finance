import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/app/marketplace", import.meta.url);
const forbidden = [/<textarea\b/i, /name=["'](?:message|description|contact|url|social)["']/i, /placeholder=["'][^"']*(?:message|describe|telegram|whatsapp|email|url)[^"']*["']/i];
function files(path) { return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]); }
const violations = [];
for (const file of files(root.pathname)) { const source = readFileSync(file, "utf8"); for (const rule of forbidden) if (rule.test(source)) violations.push(`${file}: ${rule}`); }
if (violations.length) { console.error("Marketplace free-text policy failed:\n" + violations.join("\n")); process.exit(1); }
console.log("Marketplace free-text policy passed.");

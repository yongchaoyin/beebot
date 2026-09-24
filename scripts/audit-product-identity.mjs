import { auditProductIdentity } from "./lib/product-identity-audit.mjs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--json")) throw new Error("Usage: node scripts/audit-product-identity.mjs [--json output-path]");
const report = await auditProductIdentity(fileURLToPath(new URL("../", import.meta.url)));
if (args.length) await writeFile(args[1], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ indexedFiles: report.indexedFiles, filesWithReferences: report.filesWithReferences, counts: report.counts, violations: report.violations }, null, 2));
if (report.violations.length) process.exitCode = 1;

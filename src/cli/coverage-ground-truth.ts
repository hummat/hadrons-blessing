import { buildCoverageReport } from "../lib/coverage.js";

if (import.meta.main) {
  const report = buildCoverageReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

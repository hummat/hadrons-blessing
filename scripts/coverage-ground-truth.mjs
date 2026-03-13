import { buildCoverageReport } from "./ground-truth/lib/coverage.mjs";

if (import.meta.main) {
  const report = buildCoverageReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

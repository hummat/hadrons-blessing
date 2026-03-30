// @ts-nocheck
import { runCliMain } from "../lib/cli.js";
import { auditBuildFile } from "../lib/audit-build-file.js";

if (import.meta.main) {
  await runCliMain("audit", async () => {
    const buildPath = process.argv[2];
    if (!buildPath) {
      throw new Error("build path is required");
    }

    const result = await auditBuildFile(buildPath);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}

export { auditBuildFile };

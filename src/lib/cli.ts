const SETUP_HINTS: Record<string, string> = {
  resolve:
    'GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run resolve -- --query "Warp Rider" --context \'{"kind":"talent","class":"psyker"}\'',
  audit:
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run audit -- data/builds/09-psyker-2026.json",
  canonicalize:
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run canonicalize -- data/builds/09-psyker-2026.json",
  "edges:build":
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run edges:build",
  "effects:build":
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run effects:build",
  "index:build":
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run index:build",
  report:
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run report -- data/builds/09-psyker-2026.json",
  "breeds:build":
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run breeds:build",
  "profiles:build":
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run profiles:build",
  calc:
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run calc -- data/builds/09-psyker-2026.json",
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function isSourceSetupError(message: string): boolean {
  return message.includes("GROUND_TRUTH_SOURCE_ROOT")
    || message.includes("Pinned source snapshot mismatch");
}

function formatCliError(commandName: string, error: unknown): string {
  const message = errorMessage(error);

  if (isSourceSetupError(message)) {
    const setupHint = SETUP_HINTS[commandName] ?? "See README.md for required setup.";
    return [
      `Setup error: \`${commandName}\` requires GROUND_TRUTH_SOURCE_ROOT to point to the pinned Aussiemon/Darktide-Source-Code checkout.`,
      `Run: ${setupHint}`,
      `Cause: ${message}`,
      "",
    ].join("\n");
  }

  return `${message}\n`;
}

async function runCliMain(commandName: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(formatCliError(commandName, error).trimEnd());
    process.exitCode = 1;
  }
}

export { formatCliError, runCliMain };

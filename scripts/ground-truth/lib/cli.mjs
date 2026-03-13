const SETUP_HINTS = {
  resolve:
    'GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run resolve -- --query "Warp Rider" --context \'{"kind":"talent","class":"psyker"}\'',
  audit:
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run audit -- scripts/builds/08-gandalf-melee-wizard.json",
  "index:build":
    "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run index:build",
};

function errorMessage(error) {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function isSourceSetupError(message) {
  return message.includes("GROUND_TRUTH_SOURCE_ROOT")
    || message.includes("Pinned source snapshot mismatch");
}

function formatCliError(commandName, error) {
  const message = errorMessage(error);

  if (isSourceSetupError(message)) {
    return [
      `Setup error: \`${commandName}\` requires GROUND_TRUTH_SOURCE_ROOT to point to the pinned Aussiemon/Darktide-Source-Code checkout.`,
      `Run: ${SETUP_HINTS[commandName]}`,
      `Cause: ${message}`,
      "",
    ].join("\n");
  }

  return `${message}\n`;
}

async function runCliMain(commandName, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(formatCliError(commandName, error).trimEnd());
    process.exitCode = 1;
  }
}

export { formatCliError, runCliMain };

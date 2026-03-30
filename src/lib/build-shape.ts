import AjvModule from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import { join } from "node:path";
import { SCHEMAS_ROOT, loadJsonFile } from "./load.js";

// TS6 + module:Node16 resolves the CJS default export as the module namespace.
const Ajv = AjvModule as unknown as typeof AjvModule.default;

interface BuildValidationResult {
  ok: boolean;
  errors: ErrorObject[];
}

interface WeaponSlotError {
  instancePath: string;
  message: string;
}

let _buildValidator: ValidateFunction | null = null;

function loadBuildValidator(): ValidateFunction {
  if (_buildValidator) {
    return _buildValidator;
  }

  const ajv = new Ajv({
    allErrors: true,
    strict: false,
  });

  for (const file of [
    "build-selection.schema.json",
    "canonical-build.schema.json",
  ]) {
    const schema = loadJsonFile(join(SCHEMAS_ROOT, file)) as Record<string, unknown>;
    ajv.addSchema(schema);
    ajv.addSchema(schema, `/${file}`);
  }

  _buildValidator = ajv.getSchema("canonical-build.schema.json") as ValidateFunction;
  return _buildValidator;
}

function customWeaponSlotErrors(build: unknown): WeaponSlotError[] {
  const typed = build as { weapons?: unknown[] } | null | undefined;
  if (!Array.isArray(typed?.weapons)) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const weapon of typed!.weapons) {
    const slot = (weapon as { slot?: unknown })?.slot;
    if (typeof slot !== "string") {
      continue;
    }
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }

  const errors: WeaponSlotError[] = [];
  for (const slot of ["melee", "ranged"]) {
    const count = counts.get(slot) ?? 0;
    if (count !== 1) {
      errors.push({
        instancePath: "/weapons",
        message: `must contain exactly one ${slot} weapon entry`,
      });
    }
  }

  return errors;
}

function validateCanonicalBuild(build: unknown): BuildValidationResult {
  const validator = loadBuildValidator();
  validator(build);

  const schemaErrors = validator.errors ?? [];
  const slotErrors = schemaErrors.length === 0 ? customWeaponSlotErrors(build) : [];
  const errors: Array<ErrorObject | WeaponSlotError> = [...schemaErrors, ...slotErrors];

  return {
    ok: errors.length === 0,
    errors: errors as ErrorObject[],
  };
}

function formatValidationErrors(errors: Array<{ instancePath?: string; message?: string }>): string {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? ""}`.trim())
    .join("; ");
}

function assertValidCanonicalBuild(build: unknown): void {
  const result = validateCanonicalBuild(build);
  if (!result.ok) {
    throw new Error(`Invalid canonical build: ${formatValidationErrors(result.errors)}`);
  }
}

export {
  assertValidCanonicalBuild,
  validateCanonicalBuild,
};

// @ts-nocheck
import Ajv from "ajv";
import { join } from "node:path";
import { SCHEMAS_ROOT, loadJsonFile } from "./load.js";

let _buildValidator = null;

function loadBuildValidator() {
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
    const schema = loadJsonFile(join(SCHEMAS_ROOT, file));
    ajv.addSchema(schema);
    ajv.addSchema(schema, `/${file}`);
  }

  _buildValidator = ajv.getSchema("canonical-build.schema.json");
  return _buildValidator;
}

function customWeaponSlotErrors(build) {
  if (!Array.isArray(build?.weapons)) {
    return [];
  }

  const counts = new Map();
  for (const weapon of build.weapons) {
    const slot = weapon?.slot;
    if (typeof slot !== "string") {
      continue;
    }
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }

  const errors = [];
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

function validateCanonicalBuild(build) {
  const validator = loadBuildValidator();
  validator(build);

  const schemaErrors = validator.errors ?? [];
  const slotErrors = schemaErrors.length === 0 ? customWeaponSlotErrors(build) : [];
  const errors = [...schemaErrors, ...slotErrors];

  return {
    ok: errors.length === 0,
    errors,
  };
}

function formatValidationErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`.trim())
    .join("; ");
}

function assertValidCanonicalBuild(build) {
  const result = validateCanonicalBuild(build);
  if (!result.ok) {
    throw new Error(`Invalid canonical build: ${formatValidationErrors(result.errors)}`);
  }
}

export {
  assertValidCanonicalBuild,
  validateCanonicalBuild,
};

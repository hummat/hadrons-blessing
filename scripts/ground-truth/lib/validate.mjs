import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import Ajv from "ajv";
import {
  ENTITY_KINDS_ROOT,
  SCHEMAS_ROOT,
  loadJsonFile,
  loadSourceSnapshotManifest,
} from "./load.mjs";

let _validators;

function resolveGitDir(repoRoot) {
  const dotGitPath = join(repoRoot, ".git");
  if (!existsSync(dotGitPath)) {
    throw new Error(`Not a git checkout: ${repoRoot}`);
  }

  if (lstatSync(dotGitPath).isDirectory()) {
    return dotGitPath;
  }

  const dotGitContent = readFileSync(dotGitPath, "utf8").trim();
  if (!dotGitContent.startsWith("gitdir:")) {
    return dotGitPath;
  }

  const gitDir = dotGitContent.replace(/^gitdir:\s*/, "");
  return isAbsolute(gitDir) ? gitDir : resolve(repoRoot, gitDir);
}

function readPackedRef(gitDir, refName) {
  const packedRefsPath = join(gitDir, "packed-refs");
  if (!existsSync(packedRefsPath)) {
    return null;
  }

  for (const line of readFileSync(packedRefsPath, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("^")) {
      continue;
    }

    const [sha, packedRefName] = line.trim().split(" ");
    if (packedRefName === refName) {
      return sha;
    }
  }

  return null;
}

function readGitRevision(repoRoot) {
  const gitDir = resolveGitDir(repoRoot);
  const headPath = join(gitDir, "HEAD");
  const headContent = readFileSync(headPath, "utf8").trim();

  if (!headContent.startsWith("ref:")) {
    return headContent;
  }

  const refName = headContent.replace(/^ref:\s*/, "");
  const refPath = join(gitDir, refName);
  if (existsSync(refPath)) {
    return readFileSync(refPath, "utf8").trim();
  }

  const packedRef = readPackedRef(gitDir, refName);
  if (packedRef) {
    return packedRef;
  }

  throw new Error(`Unable to resolve git ref ${refName} in ${gitDir}`);
}

function buildResult(validate) {
  return {
    ok: validate.errors == null,
    errors: validate.errors ?? [],
  };
}

function loadSchemas() {
  if (_validators) {
    return _validators;
  }

  const ajv = new Ajv({
    allErrors: true,
    strict: false,
  });

  for (const file of [
    "query-context.schema.json",
    "condition.schema.json",
    "entity-base.schema.json",
    "alias.schema.json",
    "edge.schema.json",
    "evidence.schema.json",
  ]) {
    const schema = loadJsonFile(join(SCHEMAS_ROOT, file));
    ajv.addSchema(schema);
    ajv.addSchema(schema, `/${file}`);
  }

  const kindSchemas = new Map();

  for (const file of readdirSync(ENTITY_KINDS_ROOT).filter((name) =>
    name.endsWith(".json"),
  )) {
    const schema = loadJsonFile(join(ENTITY_KINDS_ROOT, file));
    ajv.addSchema(schema);
    ajv.addSchema(schema, `/entity-kinds/${file}`);
    kindSchemas.set(file.replace(".schema.json", ""), ajv.getSchema(schema.$id));
  }

  _validators = {
    alias: ajv.getSchema("alias.schema.json"),
    edge: ajv.getSchema("edge.schema.json"),
    entityBase: ajv.getSchema("entity-base.schema.json"),
    evidence: ajv.getSchema("evidence.schema.json"),
    kindSchemas,
    queryContext: ajv.getSchema("query-context.schema.json"),
  };

  return _validators;
}

function validateEntityRecord(record) {
  const { entityBase, kindSchemas } = loadSchemas();

  entityBase(record);
  if (entityBase.errors != null) {
    return buildResult(entityBase);
  }

  const validator = kindSchemas.get(record.kind.replace("_", "-"));
  if (!validator) {
    return { ok: true, errors: [] };
  }

  validator(record);
  return buildResult(validator);
}

function validateAliasRecord(record) {
  const { alias } = loadSchemas();
  alias(record);
  return buildResult(alias);
}

function validateEdgeRecord(record) {
  const { edge } = loadSchemas();
  edge(record);
  return buildResult(edge);
}

function validateEvidenceRecord(record) {
  const { evidence } = loadSchemas();
  evidence(record);
  return buildResult(evidence);
}

function validateSourceSnapshot(sourceRoot) {
  loadSchemas();

  const resolvedSourceRoot = sourceRoot ?? process.env.GROUND_TRUTH_SOURCE_ROOT;
  if (!resolvedSourceRoot) {
    throw new Error("GROUND_TRUTH_SOURCE_ROOT is required");
  }

  if (!existsSync(resolvedSourceRoot)) {
    throw new Error(
      `GROUND_TRUTH_SOURCE_ROOT does not exist: ${resolvedSourceRoot}`,
    );
  }

  const manifest = loadSourceSnapshotManifest();
  const gitRevision = readGitRevision(resolvedSourceRoot);

  if (gitRevision !== manifest.git_revision) {
    throw new Error(
      `Pinned source snapshot mismatch: expected ${manifest.git_revision}, got ${gitRevision}`,
    );
  }

  return {
    ...manifest,
    git_revision: gitRevision,
  };
}

export {
  loadSchemas,
  validateAliasRecord,
  validateEdgeRecord,
  validateEntityRecord,
  validateEvidenceRecord,
  validateSourceSnapshot,
};

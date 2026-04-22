import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import AjvModule from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import {
  ENTITY_KINDS_ROOT,
  SCHEMAS_ROOT,
  loadJsonFile,
  loadSourceSnapshotManifest,
  resolveSourceRoot,
} from "./load.js";

// TS6 + module:Node16 resolves the CJS default export as the module namespace.
const Ajv = AjvModule as unknown as typeof AjvModule.default;

export interface ValidationResult {
  ok: boolean;
  errors: ErrorObject[];
}

interface Validators {
  alias: ValidateFunction;
  edge: ValidateFunction;
  entityBase: ValidateFunction;
  evidence: ValidateFunction;
  knownUnresolved: ValidateFunction;
  kindSchemas: Map<string, ValidateFunction>;
  queryContext: ValidateFunction;
}

export interface SourceSnapshotManifest {
  id: string;
  [key: string]: unknown;
}

export interface SourceSnapshotInfo extends SourceSnapshotManifest {
  git_revision: string;
  source_root: string;
}

let _validators: Validators | undefined;

function resolveGitDir(repoRoot: string): string {
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

function readPackedRef(gitDir: string, refName: string): string | null {
  const packedRefsPath = join(gitDir, "packed-refs");
  if (!existsSync(packedRefsPath)) {
    return null;
  }

  for (const line of readFileSync(packedRefsPath, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("^")) {
      continue;
    }

    const parts = line.trim().split(" ");
    const sha = parts[0];
    const packedRefName = parts[1];
    if (packedRefName === refName) {
      return sha ?? null;
    }
  }

  return null;
}

function readGitRevision(repoRoot: string): string {
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

function hasTrackedGitChanges(repoRoot: string): boolean {
  try {
    const output = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    return output.trim().length > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to inspect git worktree state for ${repoRoot}: ${message}`);
  }
}

function buildResult(validate: ValidateFunction): ValidationResult {
  return {
    ok: validate.errors == null,
    errors: validate.errors ?? [],
  };
}

function loadSchemas(): Validators {
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
    "calc.schema.json",
    "entity-base.schema.json",
    "alias.schema.json",
    "known-unresolved.schema.json",
    "edge.schema.json",
    "evidence.schema.json",
  ]) {
    const schema = loadJsonFile(join(SCHEMAS_ROOT, file)) as Record<string, unknown>;
    ajv.addSchema(schema);
    ajv.addSchema(schema, `/${file}`);
  }

  const kindSchemas = new Map<string, ValidateFunction>();

  for (const file of readdirSync(ENTITY_KINDS_ROOT).filter((name: string) =>
    name.endsWith(".json"),
  )) {
    const schema = loadJsonFile(join(ENTITY_KINDS_ROOT, file)) as Record<string, unknown>;
    ajv.addSchema(schema);
    ajv.addSchema(schema, `/entity-kinds/${file}`);
    const validator = ajv.getSchema(schema.$id as string);
    if (validator) {
      kindSchemas.set(file.replace(".schema.json", ""), validator);
    }
  }

  _validators = {
    alias: ajv.getSchema("alias.schema.json")!,
    edge: ajv.getSchema("edge.schema.json")!,
    entityBase: ajv.getSchema("entity-base.schema.json")!,
    evidence: ajv.getSchema("evidence.schema.json")!,
    knownUnresolved: ajv.getSchema("known-unresolved.schema.json")!,
    kindSchemas,
    queryContext: ajv.getSchema("query-context.schema.json")!,
  };

  return _validators;
}

function validateEntityRecord(record: unknown): ValidationResult {
  const { entityBase, kindSchemas } = loadSchemas();

  entityBase(record);
  if (entityBase.errors != null) {
    return buildResult(entityBase);
  }

  const typedRecord = record as { kind: string };
  const validator = kindSchemas.get(typedRecord.kind.replace("_", "-"));
  if (!validator) {
    return { ok: true, errors: [] };
  }

  validator(record);
  return buildResult(validator);
}

function validateAliasRecord(record: unknown): ValidationResult {
  const { alias } = loadSchemas();
  alias(record);
  return buildResult(alias);
}

function validateEdgeRecord(record: unknown): ValidationResult {
  const { edge } = loadSchemas();
  edge(record);
  return buildResult(edge);
}

function validateKnownUnresolvedRecord(record: unknown): ValidationResult {
  const { knownUnresolved } = loadSchemas();
  knownUnresolved(record);
  return buildResult(knownUnresolved);
}

function validateEvidenceRecord(record: unknown): ValidationResult {
  const { evidence } = loadSchemas();
  evidence(record);
  return buildResult(evidence);
}

function validateSourceSnapshot(
  sourceRoot?: string,
  manifestOverride?: Record<string, unknown>,
): SourceSnapshotInfo {
  loadSchemas();

  const resolvedSourceRoot = resolveSourceRoot(sourceRoot);
  if (!resolvedSourceRoot) {
    throw new Error("GROUND_TRUTH_SOURCE_ROOT is required (set env var or create .source-root)");
  }

  if (!existsSync(resolvedSourceRoot)) {
    throw new Error(
      `GROUND_TRUTH_SOURCE_ROOT does not exist: ${resolvedSourceRoot}`,
    );
  }

  const manifest = (manifestOverride ?? loadSourceSnapshotManifest()) as Record<string, unknown>;
  const gitRevision = readGitRevision(resolvedSourceRoot);

  if (gitRevision !== manifest.git_revision) {
    throw new Error(
      `Pinned source snapshot mismatch: expected ${manifest.git_revision as string}, got ${gitRevision}`,
    );
  }

  if (hasTrackedGitChanges(resolvedSourceRoot)) {
    throw new Error(`Pinned source snapshot check failed: dirty git worktree at ${resolvedSourceRoot}`);
  }

  return {
    ...manifest,
    git_revision: gitRevision,
    source_root: resolvedSourceRoot,
  } as SourceSnapshotInfo;
}

export {
  loadSchemas,
  validateAliasRecord,
  validateEdgeRecord,
  validateEntityRecord,
  validateEvidenceRecord,
  validateKnownUnresolvedRecord,
  validateSourceSnapshot,
};

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { REPO_ROOT } from "./load.js";

const sourceRoot = process.env.GROUND_TRUTH_SOURCE_ROOT
  ? resolve(process.env.GROUND_TRUTH_SOURCE_ROOT)
  : undefined;
const FIXTURE_SOURCE_DIRS = ["src", "data"];
const FIXTURE_SOURCE_FILES = ["package.json", "tsconfig.json"];

let fixtureRepoRoot: string | null = null;

function ensureFixtureRepo(): string {
  if (fixtureRepoRoot) {
    return fixtureRepoRoot;
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "hb-effects-build-"));

  for (const dir of FIXTURE_SOURCE_DIRS) {
    cpSync(join(REPO_ROOT, dir), join(tempRoot, dir), { recursive: true });
  }

  for (const file of FIXTURE_SOURCE_FILES) {
    cpSync(join(REPO_ROOT, file), join(tempRoot, file));
  }

  symlinkSync(join(REPO_ROOT, "node_modules"), join(tempRoot, "node_modules"), "dir");
  writeFileSync(join(tempRoot, ".source-root"), `${sourceRoot}\n`);
  fixtureRepoRoot = tempRoot;
  return tempRoot;
}

function fixtureEntitiesRoot(): string {
  return join(ensureFixtureRepo(), "data", "ground-truth", "entities");
}

function fixtureEdgesRoot(): string {
  return join(ensureFixtureRepo(), "data", "ground-truth", "edges");
}

function runEffectsBuildFixture() {
  const fixtureRoot = ensureFixtureRepo();
  return spawnSync("tsx", [join(fixtureRoot, "src", "cli", "extract-buff-effects.ts")], {
    cwd: fixtureRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, GROUND_TRUTH_SOURCE_ROOT: sourceRoot },
  });
}

function snapshotJsonFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();

  for (const file of readdirSync(root).filter((name) => name.endsWith(".json")).sort()) {
    snapshot.set(file, readFileSync(join(root, file), "utf8"));
  }

  return snapshot;
}

describe("effects:build pipeline", () => {
  it("runs without errors", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);
    assert.ok(result.stdout.includes("Populated:"), "Expected summary output");
  });

  it("populates calc on known psyker talent", { skip: !sourceRoot }, () => {
    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "psyker.json"), "utf8"),
    );
    const talent = entities.find(
      (e) => e.internal_name === "psyker_brain_burst_improved",
    );
    assert.ok(talent, "Expected to find psyker talent");
    assert.ok(talent.calc.effects?.length > 0, "Expected non-empty calc.effects");
    assert.ok(talent.calc.buff_template_names?.length > 0, "Expected buff_template_names");
  });

  it("populates calc on known psyker coherency aura", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "psyker.json"), "utf8"),
    );
    const aura = entities.find(
      (e) => e.internal_name === "psyker_cooldown_aura_improved",
    );
    assert.ok(aura, "Expected to find psyker aura");
    assert.ok(aura.calc.effects?.length > 0, "Expected non-empty calc.effects");
    assert.deepEqual(
      aura.calc.buff_template_names,
      ["psyker_aura_ability_cooldown_improved"],
      "Expected coherency buff template to be linked into calc metadata",
    );
  });

  it("models veteran ammo aura as a procedural source-backed effect", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "veteran.json"), "utf8"),
    );
    const aura = entities.find(
      (e) => e.internal_name === "veteran_aura_gain_ammo_on_elite_kill_improved",
    );

    assert.ok(aura, "Expected to find veteran ammo aura");
    assert.ok(
      aura.calc.effects.some((effect) =>
        effect.stat === "ammo_replenishment_percent"
        && effect.magnitude === 0.01
        && effect.trigger === "on_minion_death"
      ),
      "Expected procedural ammo aura to emit ammo_replenishment_percent",
    );
  });

  it("models veteran grenade replenishment as a procedural grenade effect", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "veteran.json"), "utf8"),
    );
    const talent = entities.find(
      (e) => e.internal_name === "veteran_replenish_grenades",
    );

    assert.ok(talent, "Expected to find veteran replenish grenades talent");
    assert.ok(
      talent.calc.effects.some((effect) =>
        effect.stat === "grenade_charge_restored"
        && effect.magnitude === 1
      ),
      "Expected grenade replenishment to emit grenade_charge_restored",
    );
  });

  it("populates calc on the Warp Siphon max-souls modifier", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "psyker.json"), "utf8"),
    );
    const modifier = entities.find(
      (e) => e.internal_name === "psyker_increased_max_souls",
    );
    assert.ok(modifier, "Expected to find Warp Siphon max-souls modifier");
    assert.deepEqual(modifier.calc.effects, [
      {
        stat: "max_souls",
        magnitude: 6,
        magnitude_expr: null,
        magnitude_min: null,
        magnitude_max: null,
        condition: null,
        trigger: null,
        type: "stat_buff",
      },
    ]);
  });

  it("populates tiers on known weapon trait", { skip: !sourceRoot }, () => {
    const allFiles = readdirSync(fixtureEntitiesRoot()).filter((f) => f.endsWith(".json"));
    let found = false;
    for (const file of allFiles) {
      const entities = JSON.parse(
        readFileSync(join(fixtureEntitiesRoot(), file), "utf8"),
      );
      const trait = entities.find(
        (e) => e.kind === "weapon_trait" && e.calc?.tiers?.length === 4,
      );
      if (trait) {
        assert.ok(trait.calc.tiers[0].effects.length > 0, "Expected effects in tier 0");
        found = true;
        break;
      }
    }
    assert.ok(found, "Expected at least one weapon trait with 4 tiers");
  });

  it("preserves all four tiers for weapon perks and exposes the max tier in calc.effects", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const perk = entities.find(
      (e) => e.id === "shared.weapon_perk.ranged.weapon_trait_ranged_increase_crit_chance",
    );

    assert.ok(perk, "Expected to find ranged crit chance weapon perk");
    assert.equal(perk.calc?.tiers?.length, 4, "Expected all four perk tiers to be preserved");
    assert.equal(perk.calc?.tiers?.[0]?.effects?.[0]?.magnitude, 0.02);
    assert.equal(perk.calc?.tiers?.[3]?.effects?.[0]?.magnitude, 0.05);
    assert.equal(
      perk.calc?.effects?.[0]?.magnitude,
      0.05,
      "Expected calc.effects to use the endgame-tier perk magnitude",
    );
  });

  it("follows internally spawned child buffs for chemical dependency", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "hive_scum.json"), "utf8"),
    );
    const keystone = entities.find(
      (e) => e.internal_name === "broker_keystone_chemical_dependency",
    );

    assert.ok(keystone, "Expected to find broker chemical dependency keystone");
    const stats = new Set((keystone.calc.effects ?? []).map((effect) => effect.stat));
    assert.ok(
      stats.has("combat_ability_cooldown_regen_modifier"),
      "Expected chemical dependency to inherit stack buff effects",
    );
    assert.ok(
      stats.has("critical_strike_chance"),
      "Expected chemical dependency crit branch to be modeled from child buff",
    );
    assert.ok(
      stats.has("toughness_damage_taken_multiplier"),
      "Expected chemical dependency toughness branch to be modeled from child buff",
    );
  });

  it("models ammo-from-reserve blessing tiers from external base templates", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const trait = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_ogryn_heavystubber_p1_ammo_from_reserve_on_crit",
    );

    assert.ok(trait, "Expected to find heavystubber ammo-from-reserve blessing");
    assert.equal(trait.calc?.tiers?.[3]?.effects?.[0]?.stat, "ammo_to_clip_on_crit");
    assert.equal(trait.calc?.tiers?.[3]?.effects?.[0]?.magnitude, 5);
    assert.equal(trait.calc?.effects?.[0]?.magnitude, 5);
  });

  it("models debuff-stack blessing tiers through target_buff_data indirection", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const skullcrusher = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_combataxe_p3_staggered_targets_receive_increased_damage_debuff",
    );
    const shatteringImpact = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_bolter_p1_targets_receive_rending_debuff",
    );

    assert.ok(skullcrusher, "Expected to find Skullcrusher blessing trait");
    assert.equal(skullcrusher.calc?.tiers?.[3]?.effects?.[0]?.stat, "damage_vs_staggered");
    assert.equal(skullcrusher.calc?.tiers?.[3]?.effects?.[0]?.magnitude, 0.4);

    assert.ok(shatteringImpact, "Expected to find Shattering Impact blessing trait");
    assert.equal(shatteringImpact.calc?.tiers?.[3]?.effects?.[0]?.stat, "rending_multiplier");
    assert.equal(shatteringImpact.calc?.tiers?.[3]?.effects?.[0]?.magnitude, 0.1);
  });

  it("models keyword-only and overheat blessings instead of leaving their tiers empty", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const strippedDown = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_increased_sprint_speed",
    );
    const heatsink = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_powersword_2h_p1_reduce_fixed_overheat_amount_parent",
    );

    assert.ok(strippedDown, "Expected to find Stripped Down blessing trait");
    assert.equal(strippedDown.calc?.tiers?.[3]?.effects?.[0]?.stat, "count_as_dodge_vs_ranged");
    assert.equal(strippedDown.calc?.tiers?.[3]?.effects?.[0]?.magnitude, 0);
    assert.equal(strippedDown.calc?.tiers?.[3]?.effects?.[0]?.type, "stat_buff");

    assert.ok(heatsink, "Expected to find Heatsink blessing trait");
    assert.equal(heatsink.calc?.tiers?.[3]?.effects?.[0]?.stat, "overheat_immediate_reduction");
    assert.equal(heatsink.calc?.tiers?.[3]?.effects?.[0]?.magnitude, 0.1);
    assert.equal(heatsink.calc?.tiers?.[3]?.effects?.[0]?.type, "proc_stat_buff");
  });

  it("models charged-shot target debuffs that derive stack count from thresholds", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const noRespite = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_lasgun_p2_targets_receive_rending_debuff_on_charged_shots",
    );

    assert.ok(noRespite, "Expected to find No Respite blessing trait");
    assert.equal(noRespite.calc?.tiers?.[0]?.effects?.[0]?.stat, "rending_multiplier");
    assert.ok(Math.abs((noRespite.calc?.tiers?.[0]?.effects?.[0]?.magnitude ?? 0) - 0.15) < 1e-9);
    assert.ok(Math.abs((noRespite.calc?.tiers?.[3]?.effects?.[0]?.magnitude ?? 0) - 0.3) < 1e-9);
    assert.ok(Math.abs((noRespite.calc?.effects?.[0]?.magnitude ?? 0) - 0.3) < 1e-9);
  });

  it("preserves inherited local condition helpers for follow-up-shot blessings cloned from base weapon traits", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const sustainedFire = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_shotgun_p4_followup_shots_ranged_damage",
    );

    assert.ok(sustainedFire, "Expected to find Sustained Fire blessing trait");
    assert.equal(sustainedFire.calc?.effects?.[0]?.condition, "follow_up_shots");
    assert.equal(sustainedFire.calc?.tiers?.[3]?.effects?.[0]?.condition, "follow_up_shots");
  });

  it("tags Warp Siphon toughness regen gating as threshold:warp_charge", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "psyker.json"), "utf8"),
    );
    const warpSiphon = entities.find(
      (e) => e.id === "psyker.keystone.psyker_passive_souls_from_elite_kills",
    );

    assert.ok(warpSiphon, "Expected to find Warp Siphon keystone");
    const toughnessEffect = warpSiphon.calc?.effects?.find(
      (effect) => effect.stat === "toughness_replenish_modifier",
    );
    assert.equal(toughnessEffect?.condition, "threshold:warp_charge");
  });

  it("refreshes existing generated buff entities instead of leaving stale unknown conditions", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-buffs.json"), "utf8"),
    );
    const warpSiphonBuff = entities.find(
      (e) => e.id === "psyker.buff.psyker_passive_souls_from_elite_kills",
    );
    const brokerStaminaBuff = entities.find(
      (e) => e.id === "hive_scum.buff.broker_passive_improved_dodges_at_full_stamina",
    );

    assert.ok(warpSiphonBuff, "Expected to find shared buff entity for Warp Siphon");
    assert.ok(brokerStaminaBuff, "Expected to find shared buff entity for broker stamina dodge buff");
    assert.equal(
      warpSiphonBuff.calc?.effects?.find((effect) => effect.stat === "toughness_replenish_modifier")?.condition,
      "threshold:warp_charge",
    );
    assert.equal(
      brokerStaminaBuff.calc?.effects?.find((effect) => effect.stat === "dodge_cooldown_reset_modifier")?.condition,
      "threshold:stamina_full",
    );
  });

  it("tags Adhesive Charge as wielded instead of unknown_condition", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const adhesiveCharge = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_ogryn_thumper_p2_grenades_stick_to_monsters",
    );

    assert.ok(adhesiveCharge, "Expected to find Adhesive Charge blessing trait");
    const conditionalEffect = adhesiveCharge.calc?.effects?.find(
      (effect) => effect.type === "conditional_stat_buff",
    );
    assert.equal(conditionalEffect?.condition, "wielded");
  });

  it("tags Carapace Armor upgrade gating by special rule instead of unknown_condition", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "ogryn.json"), "utf8"),
    );
    const carapaceArmor = entities.find(
      (e) => e.id === "ogryn.keystone.ogryn_carapace_armor",
    );

    assert.ok(carapaceArmor, "Expected to find Carapace Armor keystone");
    const conditionalEffect = carapaceArmor.calc?.effects?.find(
      (effect) => effect.type === "conditional_stat_buff" && effect.stat === "toughness_replenish_modifier",
    );
    assert.equal(conditionalEffect?.condition, "special_rule:ogryn_carapace_armor_more_toughness");
  });

  it("tags toxined-enemy proximity checks instead of unknown_condition", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "hive_scum.json"), "utf8"),
    );
    const toxinedDamage = entities.find(
      (e) => e.id === "hive_scum.talent.broker_passive_damage_after_toxined_enemies",
    );

    assert.ok(toxinedDamage, "Expected to find toxin-nearby damage talent");
    const conditionalEffect = toxinedDamage.calc?.effects?.find(
      (effect) => effect.type === "conditional_stat_buff" && effect.stat === "damage",
    );
    assert.equal(conditionalEffect?.condition, "threshold:toxined_nearby");
  });

  it("tags crit-active weapon traits instead of leaving pass-past-armor blessings partially unknown", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const chainsword = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_chainsword_2h_p1_pass_past_armor_on_crit",
    );

    assert.ok(chainsword, "Expected to find chainsword pass-past-armor blessing trait");
    assert.equal(chainsword.calc?.effects?.[0]?.condition, "all:wielded+critical_strike_active");
    assert.equal(chainsword.calc?.tiers?.[3]?.effects?.[0]?.condition, "all:wielded+critical_strike_active");
  });

  it("tags action-allowlist weapon traits instead of leaving them unknown", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const flamer = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_flamer_p1_negate_stagger_reduction_with_primary_on_burning",
    );
    const forceStaff = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_forcestaff_p1_uninterruptable_while_charging",
    );

    assert.ok(flamer, "Expected to find flamer stagger-reduction blessing trait");
    assert.ok(forceStaff, "Expected to find force staff charging blessing trait");
    assert.equal(flamer.calc?.effects?.[0]?.condition, "all:wielded+action_allowed");
    assert.equal(forceStaff.calc?.effects?.[0]?.condition, "all:wielded+action_allowed");
  });

  it("tags internal-buff activation conditions for shotgun special-kill reload buffs", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const shotgun = entities.find(
      (e) => e.id === "shared.weapon_trait.weapon_trait_bespoke_shotgun_p2_reload_speed_on_ranged_weapon_special_kill",
    );

    assert.ok(shotgun, "Expected to find shotgun special-kill reload blessing trait");
    assert.equal(
      shotgun.calc?.effects?.[0]?.condition,
      "internal_buff:weapon_trait_bespoke_shotgun_p2_reload_speed_on_ranged_weapon_special_kill_effect",
    );
  });

  it("tags disabled-ally movement buffs as ally_requires_help_ahead", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "veteran.json"), "utf8"),
    );
    const movementBuff = entities.find(
      (e) => e.id === "veteran.talent.veteran_movement_speed_towards_downed",
    );

    assert.ok(movementBuff, "Expected to find veteran movement-speed-to-downed talent");
    const movementEffect = movementBuff.calc?.effects?.find(
      (effect) => effect.stat === "movement_speed" && effect.type === "conditional_stat_buff",
    );
    assert.equal(movementEffect?.condition, "ally_requires_help_ahead");
  });

  it("tags template_data.is_active helper-driven buffs when alternate fire with stamina gates them", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-buffs.json"), "utf8"),
    );
    const veteranAds = entities.find(
      (e) => e.id === "veteran.buff.veteran_ads_stamina_boost",
    );
    const ogrynAds = entities.find(
      (e) => e.id === "ogryn.buff.ogryn_drain_stamina_for_handling",
    );

    assert.ok(veteranAds, "Expected to find veteran ADS stamina buff entity");
    assert.ok(ogrynAds, "Expected to find ogryn ADS stamina buff entity");
    assert.equal(veteranAds.calc?.effects?.[0]?.condition, "ads_with_stamina");
    assert.equal(ogrynAds.calc?.effects?.[0]?.condition, "ads_with_stamina");
  });

  it("generates grants_buff edges", { skip: !sourceRoot }, () => {
    const edgeFiles = readdirSync(fixtureEdgesRoot()).filter((f) => f.endsWith(".json"));
    let grantsBuff = 0;
    for (const file of edgeFiles) {
      const edges = JSON.parse(
        readFileSync(join(fixtureEdgesRoot(), file), "utf8"),
      );
      grantsBuff += edges.filter((e) => e.type === "grants_buff").length;
    }
    assert.ok(grantsBuff > 0, `Expected grants_buff edges, got ${grantsBuff}`);
  });

  it("is idempotent", { skip: !sourceRoot }, () => {
    const beforeEntities = snapshotJsonFiles(fixtureEntitiesRoot());
    const beforeEdges = snapshotJsonFiles(fixtureEdgesRoot());

    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Second pipeline run failed:\n${result.stderr}`);

    assert.deepEqual(
      snapshotJsonFiles(fixtureEntitiesRoot()),
      beforeEntities,
      "Expected entity shards to remain unchanged after second run",
    );
    assert.deepEqual(
      snapshotJsonFiles(fixtureEdgesRoot()),
      beforeEdges,
      "Expected edge shards to remain unchanged after second run",
    );
  });
});

process.on("exit", () => {
  if (fixtureRepoRoot) {
    rmSync(fixtureRepoRoot, { recursive: true, force: true });
  }
});

// @ts-nocheck
// @ts-check
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  resolveCleaveBudget,
  simulateCleave,
  computeCleaveMatrix,
  HORDE_COMPOSITIONS,
} from "./cleave-calculator.js";

// ---------- helpers ----------
const approx = (actual, expected, tol = 0.001) =>
  assert.ok(
    Math.abs(actual - expected) < tol,
    `expected ~${expected}, got ${actual} (tol ${tol})`,
  );

// ---------- resolveCleaveBudget ----------
describe("resolveCleaveBudget", () => {
  it("returns scalar value unchanged", () => {
    assert.equal(resolveCleaveBudget(5, 0.8), 5);
  });

  it("returns scalar zero unchanged", () => {
    assert.equal(resolveCleaveBudget(0, 0.8), 0);
  });

  it("lerps [min, max] array by quality", () => {
    // lerp(2, 6, 0.8) = 2 + (6-2)*0.8 = 2 + 3.2 = 5.2
    approx(resolveCleaveBudget([2, 6], 0.8), 5.2);
  });

  it("lerps [min, max] at quality 0 → returns min", () => {
    assert.equal(resolveCleaveBudget([2, 6], 0), 2);
  });

  it("lerps [min, max] at quality 1 → returns max", () => {
    assert.equal(resolveCleaveBudget([2, 6], 1), 6);
  });

  it("lerps [min, max] at quality 0.5 → returns midpoint", () => {
    approx(resolveCleaveBudget([2, 6], 0.5), 4);
  });

  it("returns 0 when entry is null", () => {
    assert.equal(resolveCleaveBudget(null, 0.8), 0);
  });

  it("returns 0 when entry is undefined", () => {
    assert.equal(resolveCleaveBudget(undefined, 0.8), 0);
  });
});

// ---------- simulateCleave ----------
describe("simulateCleave", () => {
  it("hits all targets when budget is sufficient", () => {
    const result = simulateCleave({
      cleaveBudget: 10,
      targets: [
        { breed_id: "a", hit_mass: 2, hp: 100 },
        { breed_id: "b", hit_mass: 2, hp: 100 },
        { breed_id: "c", hit_mass: 2, hp: 100 },
      ],
      computeDamageForTarget: (_target, _index) => 150,
    });

    assert.equal(result.targets_hit, 3);
    assert.equal(result.targets_killed, 3);
    assert.equal(result.per_target.length, 3);
    for (const t of result.per_target) {
      assert.equal(t.damage, 150);
      assert.equal(t.killed, true);
    }
  });

  it("stops hitting when budget is exhausted", () => {
    const result = simulateCleave({
      cleaveBudget: 3,
      targets: [
        { breed_id: "a", hit_mass: 2, hp: 100 },
        { breed_id: "b", hit_mass: 2, hp: 100 },
        { breed_id: "c", hit_mass: 2, hp: 100 },
      ],
      computeDamageForTarget: (_target, _index) => 150,
    });

    // Budget 3: target 0 consumes 2 (remaining 1), target 1 consumes 2 (exceeds),
    // so only target 0 and 1 are hit (budget not enough for target 2 after consuming target 1)
    // Actually: budget=3, target0 costs 2 → remaining=1, target1 costs 2 → remaining=-1 → stop
    // But target 0 is always hit. Target 1: remaining after t0 = 1, t1 costs 2 → 1 < 2 → not hit
    assert.equal(result.targets_hit, 1);
  });

  it("first target is always hit regardless of budget", () => {
    const result = simulateCleave({
      cleaveBudget: 0,
      targets: [
        { breed_id: "a", hit_mass: 5, hp: 100 },
        { breed_id: "b", hit_mass: 1, hp: 100 },
      ],
      computeDamageForTarget: (_target, _index) => 150,
    });

    assert.equal(result.targets_hit, 1);
    assert.equal(result.per_target[0].breed_id, "a");
    assert.equal(result.per_target[0].killed, true);
  });

  it("first target always hit even with negative budget", () => {
    const result = simulateCleave({
      cleaveBudget: -1,
      targets: [
        { breed_id: "a", hit_mass: 10, hp: 200 },
      ],
      computeDamageForTarget: () => 250,
    });

    assert.equal(result.targets_hit, 1);
    assert.equal(result.per_target[0].killed, true);
  });

  it("tracks per-target killed status correctly", () => {
    const result = simulateCleave({
      cleaveBudget: 20,
      targets: [
        { breed_id: "a", hit_mass: 1, hp: 100 },
        { breed_id: "b", hit_mass: 1, hp: 500 },
        { breed_id: "c", hit_mass: 1, hp: 100 },
      ],
      computeDamageForTarget: (_target, _index) => 150,
    });

    assert.equal(result.targets_hit, 3);
    assert.equal(result.targets_killed, 2); // a and c killed, b survives
    assert.equal(result.per_target[0].killed, true);
    assert.equal(result.per_target[1].killed, false);
    assert.equal(result.per_target[2].killed, true);
  });

  it("uses per-target damage callback correctly", () => {
    const damages = [100, 50, 25];
    const result = simulateCleave({
      cleaveBudget: 20,
      targets: [
        { breed_id: "a", hit_mass: 1, hp: 80 },
        { breed_id: "b", hit_mass: 1, hp: 80 },
        { breed_id: "c", hit_mass: 1, hp: 80 },
      ],
      computeDamageForTarget: (_target, index) => damages[index],
    });

    assert.equal(result.per_target[0].damage, 100);
    assert.equal(result.per_target[0].killed, true);
    assert.equal(result.per_target[1].damage, 50);
    assert.equal(result.per_target[1].killed, false);
    assert.equal(result.per_target[2].damage, 25);
    assert.equal(result.per_target[2].killed, false);
  });

  it("returns empty result for empty target list", () => {
    const result = simulateCleave({
      cleaveBudget: 10,
      targets: [],
      computeDamageForTarget: () => 100,
    });

    assert.equal(result.targets_hit, 0);
    assert.equal(result.targets_killed, 0);
    assert.deepEqual(result.per_target, []);
  });

  it("handles exact budget match — consumes budget exactly, next target not hit", () => {
    const result = simulateCleave({
      cleaveBudget: 4,
      targets: [
        { breed_id: "a", hit_mass: 2, hp: 100 },
        { breed_id: "b", hit_mass: 2, hp: 100 },
        { breed_id: "c", hit_mass: 2, hp: 100 },
      ],
      computeDamageForTarget: () => 150,
    });

    // Budget 4: t0 costs 2 → remaining 2, t1 costs 2 → remaining 0, t2 costs 2 → 0 < 2, not hit
    assert.equal(result.targets_hit, 2);
  });
});

// ---------- HORDE_COMPOSITIONS ----------
describe("HORDE_COMPOSITIONS", () => {
  it("has mixed_melee_horde composition with 6 targets", () => {
    assert.ok(HORDE_COMPOSITIONS.mixed_melee_horde, "missing mixed_melee_horde");
    assert.equal(HORDE_COMPOSITIONS.mixed_melee_horde.length, 6);
  });

  it("has elite_mixed composition with 4 targets", () => {
    assert.ok(HORDE_COMPOSITIONS.elite_mixed, "missing elite_mixed");
    assert.equal(HORDE_COMPOSITIONS.elite_mixed.length, 4);
  });

  it("compositions are sorted by hit_mass ascending (damnation)", () => {
    for (const [name, targets] of Object.entries(HORDE_COMPOSITIONS)) {
      for (let i = 1; i < targets.length; i++) {
        assert.ok(
          targets[i].hit_mass_damnation >= targets[i - 1].hit_mass_damnation,
          `${name}: target ${i} (${targets[i].breed_id}, mass=${targets[i].hit_mass_damnation}) ` +
            `should be >= target ${i - 1} (${targets[i - 1].breed_id}, mass=${targets[i - 1].hit_mass_damnation})`,
        );
      }
    }
  });
});

// ---------- Integration with mock data ----------
describe("integration: simulateCleave with realistic mock data", () => {
  it("simulates a medium-cleave weapon against mixed horde", () => {
    // Simulate a weapon with cleave budget 5.2 against poxwalkers and renegade melee
    const targets = [
      { breed_id: "chaos_poxwalker", hit_mass: 1.5, hp: 300 },
      { breed_id: "chaos_poxwalker", hit_mass: 1.5, hp: 300 },
      { breed_id: "renegade_melee", hit_mass: 3.5, hp: 650 },
      { breed_id: "renegade_assault", hit_mass: 1.5, hp: 500 },
    ];

    const result = simulateCleave({
      cleaveBudget: 5.2,
      targets,
      computeDamageForTarget: (target, _index) => {
        // Mock damage: 350 for poxwalkers, 200 for renegade_melee, 250 for renegade_assault
        if (target.breed_id === "chaos_poxwalker") return 350;
        if (target.breed_id === "renegade_melee") return 200;
        return 250;
      },
    });

    // Budget 5.2: pox0 (1.5) → remaining 3.7, pox1 (1.5) → remaining 2.2,
    // renegade_melee (3.5) → 2.2 < 3.5, not hit
    assert.equal(result.targets_hit, 2);
    assert.equal(result.targets_killed, 2); // both poxwalkers killed (350 > 300)
    assert.equal(result.per_target[0].breed_id, "chaos_poxwalker");
    assert.equal(result.per_target[1].breed_id, "chaos_poxwalker");
  });

  it("simulates a high-cleave weapon sweeping through the horde", () => {
    const targets = [
      { breed_id: "chaos_poxwalker", hit_mass: 1.5, hp: 300 },
      { breed_id: "chaos_poxwalker", hit_mass: 1.5, hp: 300 },
      { breed_id: "renegade_melee", hit_mass: 3.5, hp: 650 },
      { breed_id: "renegade_assault", hit_mass: 1.5, hp: 500 },
    ];

    const result = simulateCleave({
      cleaveBudget: 20,
      targets,
      computeDamageForTarget: (target, _index) => {
        if (target.breed_id === "chaos_poxwalker") return 350;
        if (target.breed_id === "renegade_melee") return 200;
        return 250;
      },
    });

    assert.equal(result.targets_hit, 4); // all hit with budget 20
    assert.equal(result.targets_killed, 2); // poxwalkers killed, melee/assault survive
  });
});

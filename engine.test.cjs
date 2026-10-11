'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, 'engine.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function boot(random = () => 0.5, storage) {
  const intervals = new Map();
  const listeners = new Set();
  const logs = [];
  const warnings = [];
  let nextTimerId = 1;
  const math = Object.create(Math);
  math.random = random;
  const context = vm.createContext({
    Math: math,
    ...(storage ? { localStorage: storage } : {}),
    module: { exports: {} },
    console: { log: (...args) => logs.push(args), warn: (...args) => warnings.push(args) },
    setInterval: (callback, delay) => {
      const id = nextTimerId++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval: id => intervals.delete(id),
    addEventListener: (name, listener) => {
      assert.equal(name, 'keydown');
      listeners.add(listener);
    },
    removeEventListener: (name, listener) => listeners.delete(listener)
  });
  vm.runInContext(source, context, { filename: 'engine.js' });
  return {
    context, intervals, listeners, logs, warnings,
    press: (key, extra = {}) => {
      for (const listener of listeners) listener({ key, ...extra });
    }
  };
}

function advance(context, seconds) {
  for (let index = 0; index < seconds; index++) context.tick();
}

function pin(context, id, potency, yieldUnits, minutes) {
  assert.ok(context.setCompoundSetting(id, 'potency', potency));
  assert.ok(context.setCompoundSetting(id, 'yield', yieldUnits));
  assert.ok(context.setCompoundSetting(id, 'baseMinutes', minutes));
}

function pinAffordable(context) {
  for (const compound of context.compounds) pin(context, compound.id, 1, 8, 10);
}

test('initial globals and exactly five fictional compound definitions', () => {
  const { context: e, intervals } = boot();
  const state = e.playerState;
  assert.deepEqual(plain({
    cash: state.cash, launderedCash: state.launderedCash, suspicion: state.suspicion,
    timeTicks: state.timeTicks, heatRate: state.heatRate, inventory: state.inventory
  }), { cash: 1000, launderedCash: 0, suspicion: 0, timeTicks: 0, heatRate: 0.5, inventory: {} });
  assert.equal(e.compounds.length, 5);
  assert.equal(new Set(e.compounds.map(compound => compound.id)).size, 5);
  for (const compound of e.compounds) {
    assert.deepEqual(Object.keys(compound).sort(),
      ['id', 'name', 'potency', 'yield', 'productionTime', 'stability'].sort());
    assert.ok(e.compoundOptions.potency.includes(compound.potency));
    assert.ok(e.compoundOptions.yield.includes(compound.yield));
    assert.ok(e.compoundOptions.baseMinutes.includes(compound.productionTime / 60));
    assert.ok(compound.stability >= 0 && compound.stability <= 1);
  }
  for (const name of ['startCook', 'sellBatch', 'launderCash', 'tick', 'rollDealerGacha', 'triggerRaid']) {
    assert.equal(typeof e[name], 'function');
  }
  assert.equal(e.module.exports, e.BreakingBadEngine);
  assert.equal(intervals.size, 1);
  assert.equal([...intervals.values()][0].delay, 1000);
});

test('each scheduled tick logs a distinct snapshot and idle time adds no heat', () => {
  const { context: e, intervals, logs } = boot();
  [...intervals.values()][0].callback();
  [...intervals.values()][0].callback();
  assert.equal(e.playerState.timeTicks, 2);
  assert.equal(e.playerState.suspicion, 0);
  assert.equal(logs.length, 2);
  assert.equal(logs[0][1].timeTicks, 1);
  assert.equal(logs[1][1].timeTicks, 2);
  e.playerState.cash = 0;
  assert.equal(logs[0][1].cash, 1000);
});

for (const [workflow, time, yieldUnits] of [
  ['Rapid', 300, 6], ['Standard', 600, 8], ['Precision', 900, 12]
]) {
  test(`${workflow} applies duration/yield and completes once at the correct tick`, () => {
    let rolls = 0;
    const { context: e } = boot(() => { rolls++; return 0.5; });
    pin(e, 'amber', 1, 8, 10);
    e.playerState.heatRate = 0;
    const batch = e.startCook('amber', workflow);
    assert.equal(batch.productionTime, time);
    assert.equal(batch.quantity, yieldUnits);
    assert.equal(batch.unitPrice, 20000);
    assert.equal(batch.cost, Math.round((300 * (time / 60) / yieldUnits + Number.EPSILON) * 100) / 100);
    assert.equal(e.playerState.cash, 1000 - batch.cost);
    advance(e, time - 1);
    assert.equal(e.playerState.completedBatches.length, 0);
    assert.equal(rolls, 0);
    e.tick();
    assert.equal(e.playerState.inventory.amber, yieldUnits);
    assert.equal(e.playerState.activeBatches.length, 0);
    assert.equal(rolls, 1);
    advance(e, 3);
    assert.equal(rolls, 1);
    assert.equal(e.playerState.inventory.amber, yieldUnits);
  });
}

test('default workflow is Standard; invalid IDs/workflows/funds/equipment do not mutate state', () => {
  const { context: e } = boot();
  const before = plain(e.playerState);
  for (const [id, workflow] of [
    ['missing', 'Rapid'], ['amber', 'missing'], ['amber', null],
    ['amber', 'constructor'], ['amber', '__proto__']
  ]) assert.equal(e.startCook(id, workflow), null);
  assert.deepEqual(plain(e.playerState), before);
  pin(e, 'amber', 1, 8, 10);
  assert.equal(e.startCook('amber').workflowType, 'Standard');
  e.playerState.labEquipment = { basicLab: 1 };
  const busy = plain(e.playerState);
  assert.equal(e.startCook('neon'), null);
  assert.deepEqual(plain(e.playerState), busy);
  e.loadJudgePreset('Early');
  e.playerState.cash = 49;
  assert.equal(e.startCook('amber'), null);
  e.playerState.cash = 1000;
  e.playerState.labEquipment = {};
  assert.equal(e.startCook('amber'), null);
});

test('a fresh game starts with three slots, rejects a fourth cook, and presets restore capacity', () => {
  const { context: e } = boot();
  const slots = state => Object.values(state.labEquipment).reduce((total, quantity) =>
    total + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0), 0);
  assert.equal(e.playerState.cash, 1000);
  assert.deepEqual(plain(e.playerState.labEquipment), { basicLab: 3 });
  assert.equal(slots(e.playerState), 3);
  assert.equal(e.playerState.activeBatches.length, 0);
  pin(e, 'amber', 1, 8, 10);
  for (const id of ['neon', 'violet', 'ember', 'azure']) pin(e, id, 1, 8, 40);
  e.playerState.cash = 100000;
  e.playerState.heatRate = 0;
  assert.ok(e.startCook('amber', 'Rapid'));
  assert.ok(e.startCook('neon', 'Rapid'));
  assert.ok(e.startCook('violet', 'Rapid'));
  assert.equal(e.playerState.activeBatches.length, 3);
  const cash = e.playerState.cash;
  const nextBatchId = e.playerState.nextBatchId;
  assert.equal(e.startCook('ember', 'Rapid'), null);
  assert.equal(e.playerState.cash, cash);
  assert.equal(e.playerState.activeBatches.length, 3);
  assert.equal(e.playerState.nextBatchId, nextBatchId);
  advance(e, 300);
  assert.equal(e.playerState.inventory.amber, 6);
  assert.equal(e.playerState.activeBatches.length, 2);
  assert.ok(e.startCook('ember', 'Rapid'));
  assert.equal(e.playerState.activeBatches.length, 3);
  e.loadJudgePreset('Early');
  e.playerState.cash = 49;
  assert.equal(slots(e.playerState), 3);
  assert.equal(e.startCook('amber'), null);
  assert.equal(e.playerState.cash, 49);
  assert.equal(e.playerState.activeBatches.length, 0);
  for (const [name, expected] of [['Early', 3], ['Mid', 3], ['Late', 4]]) {
    e.playerState.labEquipment = {};
    e.playerState.activeBatches.push({ id: 99 });
    e.loadJudgePreset(name);
    assert.equal(e.playerState.activeBatches.length, 0);
    assert.equal(slots(e.playerState), expected);
  }
  e.loadJudgePreset('Early');
  e.startCook('amber');
  e.triggerRaid();
  assert.deepEqual(plain(e.playerState.labEquipment), {});
  assert.equal(e.playerState.cash, 0);
  assert.equal(e.startCook('amber'), null);
});

test('the second, third, and fourth lab slots cost 5000, 30000, and 50000', () => {
  const { context: e } = boot();
  assert.deepEqual(plain(e.gameConfig.slotPrices), { 2: 5000, 3: 30000, 4: 50000 });
  assert.equal(e.nextSlotCost(), 50000);
  const short = plain(e.playerState);
  assert.equal(e.buyLabSlot(), null);
  assert.deepEqual(plain(e.playerState), short);
  e.playerState.cash = 49999;
  assert.equal(e.buyLabSlot(), null);
  assert.equal(e.playerState.labEquipment.basicLab, 3);
  e.playerState.cash = 50000;
  assert.equal(e.playerState.launderedCash, 0);
  assert.equal(e.buyLabSlot(), 4);
  assert.equal(e.playerState.cash, 0);
  assert.equal(e.playerState.launderedCash, 0);
  assert.equal(e.nextSlotCost(), null);
  e.playerState.cash = 50000;
  const maxed = plain(e.playerState);
  assert.equal(e.buyLabSlot(), null);
  assert.deepEqual(plain(e.playerState), maxed);

  e.playerState.labEquipment = { basicLab: 1 };
  e.playerState.cash = 4999;
  assert.equal(e.nextSlotCost(), 5000);
  assert.equal(e.buyLabSlot(), null);
  assert.equal(e.playerState.cash, 4999);
  e.playerState.cash = 5000;
  assert.equal(e.buyLabSlot(), 2);
  assert.equal(e.playerState.cash, 0);

  e.playerState.labEquipment = { basicLab: 2 };
  e.playerState.cash = 30000;
  assert.equal(e.nextSlotCost(), 30000);
  assert.equal(e.buyLabSlot(), 3);
  assert.equal(e.playerState.cash, 0);

  e.triggerRaid();
  e.playerState.cash = 50000;
  assert.equal(e.nextSlotCost(), null);
  assert.equal(e.buyLabSlot(), null);
  assert.deepEqual(plain(e.playerState.labEquipment), {});
});

test('concurrent batches complete independently and only active processes add heat', () => {
  const { context: e } = boot();
  e.playerState.labEquipment.basicLab = 2;
  pin(e, 'amber', 1, 8, 10);
  pin(e, 'neon', 2, 8, 24);
  e.playerState.cash = 100000;
  e.startCook('amber', 'Rapid');
  e.startCook('neon', 'Rapid');
  advance(e, 300);
  assert.equal(e.playerState.inventory.amber, 6);
  assert.equal(e.playerState.inventory.neon, undefined);
  assert.equal(e.playerState.suspicion, 100);
  advance(e, 420);
  assert.equal(e.playerState.inventory.neon, 6);
  assert.equal(e.playerState.suspicion, 100);
  e.tick();
  assert.equal(e.playerState.suspicion, 100);
});

for (const [roll, quality, multiplier] of [
  [0, 'Flawless Blue', 10], [0.049999, 'Flawless Blue', 10],
  [0.05, 'Standard', 1], [0.99, 'Standard', 1]
]) {
  test(`completion roll ${roll} preserves ${quality} pricing for manual sales`, () => {
    const { context: e } = boot(() => roll);
    pin(e, 'amber', 1, 8, 10);
    e.playerState.heatRate = 0;
    e.startCook('amber', 'Rapid');
    advance(e, 300);
    const lot = e.playerState.completedBatches[0];
    assert.equal(lot.quality, quality);
    assert.equal(lot.valueMultiplier, multiplier);
    assert.equal(e.sellBatch(), 6 * 20000 * multiplier);
    assert.equal(e.playerState.cash, 750 + 6 * 20000 * multiplier);
    assert.deepEqual(plain(e.playerState.inventory), {});
    assert.equal(e.playerState.completedBatches.length, 0);
    assert.equal(e.sellBatch(), 0);
  });
}

test('partial dealer assignments preserve premium pricing and cannot double-sell stock', () => {
  const { context: e } = boot(() => 0);
  pin(e, 'amber', 1, 8, 10);
  e.playerState.heatRate = 0;
  e.startCook('amber', 'Rapid');
  advance(e, 300);
  const lot = e.playerState.completedBatches[0];
  const dealer = e.hireDealer('Common');
  const before = plain(e.playerState);
  for (const [dealerId, lotId, quantity] of [
    [99, lot.id, 1], [dealer.id, 99, 1], [dealer.id, lot.id, 0],
    [dealer.id, lot.id, -1], [dealer.id, lot.id, 7], [dealer.id, lot.id, 1.5]
  ]) assert.equal(e.assignDealerInventory(dealerId, lotId, quantity), null);
  assert.deepEqual(plain(e.playerState), before);
  const assigned = e.assignDealerInventory(dealer.id, lot.id, 2);
  assert.equal(assigned.quality, 'Flawless Blue');
  assert.equal(e.playerState.inventory.amber, 6);
  assert.equal(e.assignDealerInventory(dealer.id, assigned.id), null);
  assert.equal(e.sellBatch(), 4 * 20000 * 10);
  assert.equal(e.playerState.inventory.amber, 2);
  e.tick();
  assert.equal(e.playerState.cash, 1000750);
  assert.equal(e.playerState.inventory.amber, 1);
  e.tick();
  assert.equal(e.playerState.cash, 1200750);
  assert.equal(e.playerState.inventory.amber, undefined);
  const heat = e.playerState.suspicion;
  e.tick();
  assert.equal(e.playerState.cash, 1200750);
  assert.equal(e.playerState.suspicion, heat);
});

for (const [tier, rate] of [['Common', 1], ['Rare', 2], ['Legendary', 4]]) {
  test(`${tier} dealer respects its per-second capacity across multiple lots`, () => {
    const { context: e } = boot();
    e.playerState.labEquipment.basicLab = 2;
    pin(e, 'amber', 1, 8, 10);
    pin(e, 'neon', 2, 16, 10);
    e.playerState.cash = 10000;
    e.startCook('amber', 'Rapid');
    e.startCook('neon', 'Rapid');
    advance(e, 300);
    const dealer = e.hireDealer(tier);
    for (const lot of e.playerState.completedBatches) e.assignDealerInventory(dealer.id, lot.id);
    assert.equal(e.sellBatch(), 0);
    const startingCash = e.playerState.cash;
    e.tick();
    assert.equal(e.playerState.cash, startingCash + rate * 20000);
    advance(e, 20);
    assert.deepEqual(plain(e.playerState.inventory), {});
    assert.equal(e.playerState.cash, startingCash + 6 * 20000 + 12 * 80000);
    assert.equal(e.playerState.completedBatches.length, 0);
  });
}

test('laundering moves dirty cash once with a 10% fee and rejects overdrafts/nonfinite amounts', () => {
  const { context: e } = boot();
  for (const amount of [-1, 0, 1001, NaN, Infinity, '100']) assert.equal(e.launderCash(amount), 0);
  assert.equal(e.playerState.cash, 1000);
  assert.equal(e.launderCash(100), 90);
  assert.equal(e.playerState.cash, 900);
  assert.equal(e.launderCash(), 810);
  assert.equal(e.playerState.cash, 0);
  assert.equal(e.playerState.launderedCash, 900);
  assert.equal(e.launderCash(), 0);
});

test('dealer gacha weight boundaries and rolls have no recruitment/cash side effects', () => {
  let value = 0;
  const { context: e } = boot(() => value);
  for (const [roll, tier] of [[0, 'Common'], [0.699999, 'Common'], [0.7, 'Rare'],
    [0.949999, 'Rare'], [0.95, 'Legendary'], [0.999999, 'Legendary']]) {
    value = roll;
    assert.equal(e.rollDealerGacha(), tier);
  }
  assert.equal(e.playerState.cash, 1000);
  assert.equal(e.playerState.dealers.length, 0);
  assert.equal(e.hireDealer('constructor'), null);
  assert.equal(e.hireDealer('missing'), null);
  assert.equal(e.hireDealer().tier, 'Legendary');
});

test('raid random roll occurs once per tick strictly above 80, including idle time', () => {
  let rolls = 0;
  const { context: e } = boot(() => { rolls++; return 0.5; });
  e.playerState.suspicion = 80;
  advance(e, 3);
  assert.equal(rolls, 0);
  e.playerState.suspicion = 80.01;
  advance(e, 3);
  assert.equal(rolls, 3);
  assert.equal(e.playerState.raidCount, 0);
});

test('successful raid wipes dirty cash/equipment/cooks while preserving clean cash and completed stock', () => {
  const { context: e, warnings, logs } = boot(() => 0.009999);
  e.loadJudgePreset('Mid');
  e.startCook('amber');
  e.playerState.suspicion = 81;
  e.tick();
  assert.equal(e.playerState.cash, 0);
  assert.equal(e.playerState.launderedCash, 10000);
  assert.deepEqual(plain(e.playerState.labEquipment), {});
  assert.equal(e.playerState.activeBatches.length, 0);
  assert.equal(e.playerState.suspicion, 0);
  assert.equal(e.playerState.raidCount, 1);
  assert.equal(e.playerState.inventory.neon, 22);
  assert.deepEqual(plain(e.playerState.dealers), [], 'raid wipes the roster');
  assert.equal(e.playerState.bribeCost, 1000);
  assert.ok(e.playerState.completedBatches.every(lot => lot.dealerId === null), 'no stock stranded on a dead dealer');
  assert.equal(e.startCook('amber'), null);
  assert.equal(warnings.length, 1);
  assert.equal(logs[0][1].cash, 0);
  advance(e, 20);
  assert.equal(e.playerState.inventory.amber, undefined);
  assert.equal(e.playerState.raidCount, 1);
});

test('a raid roll of exactly 1% does not raid; active heat caps suspicion at 100', () => {
  const { context: e } = boot(() => 0.01);
  pin(e, 'amber', 1, 8, 10);
  e.startCook('amber');
  e.playerState.suspicion = 99.9;
  e.tick();
  assert.equal(e.playerState.suspicion, 100);
  assert.equal(e.playerState.raidCount, 0);
  assert.equal(e.playerState.cash, 625);
});

test('Judge Mode uses complete isolated presets, replaces stale fields and preserves state identity', () => {
  const { context: e, intervals } = boot();
  const original = e.playerState;
  e.playerState.cash = 100000;
  assert.ok(e.startCook('amber'));
  e.playerState.staleDemoField = true;
  for (const name of ['Mid', 'Late', 'Early', 'Mid']) {
    assert.equal(e.loadJudgePreset(name), original);
    assert.equal(e.playerState.activeBatches.length, 0);
    assert.equal(e.playerState.staleDemoField, undefined);
    assert.equal(intervals.size, 1);
    const totals = {};
    for (const lot of e.playerState.completedBatches) {
      totals[lot.compoundId] = (totals[lot.compoundId] || 0) + lot.quantity;
    }
    assert.deepEqual(plain(e.playerState.inventory), totals);
  }
  e.playerState.inventory.neon = 0;
  e.playerState.completedBatches[0].quantity = 0;
  e.loadJudgePreset('Mid');
  assert.equal(e.playerState.inventory.neon, 24);
  assert.equal(e.playerState.completedBatches[0].quantity, 12);
  assert.equal(e.loadJudgePreset('constructor'), null);
  assert.equal(e.loadJudgePreset('missing'), null);
});

test('hidden keyboard shortcuts load presets but ignore typing, modifiers, and held keys', () => {
  const { context: e, press } = boot();
  press('2');
  assert.equal(e.playerState.cash, 25000);
  for (const extra of [
    { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    { target: { isContentEditable: true } }, { target: { closest: () => ({}) } }
  ]) {
    press('3', extra);
    assert.equal(e.playerState.cash, 25000);
  }
  press('3', { target: { closest: () => null } });
  assert.equal(e.playerState.cash, 250000);
  press('1');
  assert.equal(e.playerState.cash, 1000);
});

test('start/stop/reload clean up timers and keyboard listeners without duplicate loops', () => {
  const { context: e, intervals, listeners } = boot();
  e.startGameLoop();
  e.startGameLoop();
  assert.equal(intervals.size, 1);
  e.stopGameLoop();
  e.stopGameLoop();
  assert.equal(intervals.size, 0);
  e.startGameLoop();
  assert.equal(intervals.size, 1);
  vm.runInContext(source, e);
  assert.equal(intervals.size, 1);
  assert.equal(listeners.size, 1);
  e.BreakingBadEngine.destroy();
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
});

test('Node runtime works without a browser event API', () => {
  let callback;
  const context = vm.createContext({
    console: { log() {}, warn() {} },
    setInterval: fn => { callback = fn; return 1; },
    clearInterval() {}
  });
  vm.runInContext(source, context);
  callback();
  assert.equal(context.playerState.timeTicks, 1);
  context.stopGameLoop();
});


test('Judge bonus grants an identified sellable Flawless lot without cost, slots or RNG', () => {
  const { context: e } = boot(() => { throw new Error('bonus must not roll'); });
  const before = e.playerState.cash;
  e.playerState.labEquipment = {};
  pin(e, 'neon', 2, 16, 10);
  const lot = e.grantFlawlessBatch('neon', 'Precision');
  assert.equal(lot.quality, 'Flawless Blue');
  assert.equal(lot.quantity, 24);
  assert.equal(lot.valueMultiplier, 10);
  assert.equal(e.playerState.inventory.neon, 24);
  assert.equal(e.playerState.cash, before);
  assert.equal(e.playerState.activeBatches.length, 0);
  assert.equal(e.playerState.nextBatchId, 2);
  assert.equal(e.grantFlawlessBatch('missing'), null);
  assert.equal(e.grantFlawlessBatch('neon', 'constructor'), null);
  assert.equal(e.playerState.nextBatchId, 2);
});

// ----- Meth quality grade from the cooking-result score -----

test('gradeForScore uses the unrounded score; 1, 3 and 10 enter the higher grade', () => {
  const { context: e } = boot();
  const cases = [[0, 1], [0.999999, 1], [1, 2], [1.000001, 2], [2.999999, 2], [3, 3], [3.000001, 3],
    [9.999999, 3], [10, 4], [10.000001, 4], [25, 4], [1e9, 4]];
  for (const [score, grade] of cases) assert.equal(e.gradeForScore(score), grade, `score ${score}`);
  for (const bad of [undefined, null, NaN, Infinity, -Infinity, -0.5, -10, '12', {}]) {
    assert.equal(e.gradeForScore(bad), 1, `invalid ${String(bad)} never earns a higher grade`);
  }
});

test('every ordinary grade is reachable from the supported settings and workflows', () => {
  const { context: e } = boot();
  const seen = new Set();
  for (const potency of e.compoundOptions.potency) {
    for (const yieldUnits of e.compoundOptions.yield) {
      for (const minutes of e.compoundOptions.baseMinutes) {
        for (const workflow of ['Rapid', 'Standard', 'Precision']) {
          pin(e, 'amber', potency, yieldUnits, minutes);
          seen.add(e.gradeForScore(e.cookQuote('amber', workflow).performance));
        }
      }
    }
  }
  assert.deepEqual(plain([...seen].sort()), [1, 2, 3, 4]);
});

test('a lot keeps the grade of its cook-start score through option changes, the Flawless override and dealer splits', () => {
  const { context: e } = boot(() => 0.5);
  e.playerState.cash = 1e6;
  pin(e, 'amber', 5, 8, 40); // 5 * 40 min / 8 = 25 -> grade 4
  const quoted = e.cookQuote('amber').performance;
  e.startCook('amber');
  pin(e, 'amber', 1, 24, 10); // a later change would score far lower
  advance(e, 2400);
  const lot = e.playerState.completedBatches[0];
  assert.equal(lot.quality, 'Standard');
  assert.equal(lot.performance, quoted);
  assert.equal(lot.grade, 4);
  pin(e, 'amber', 1, 24, 10);
  assert.equal(lot.grade, 4, 'later settings never regrade stock');

  const dealer = e.hireDealer('Common');
  const split = e.assignDealerInventory(dealer.id, lot.id, 5);
  assert.equal(split.grade, 4);
  assert.equal(split.performance, quoted);
  assert.equal(lot.grade, 4);

  // The rare outcome overrides the ordinary tier; the explicit bonus is grade 5 as well.
  const { context: f } = boot(() => 0);
  f.playerState.cash = 1e6;
  f.playerState.heatRate = 0;
  pin(f, 'amber', 1, 8, 40);
  f.startCook('amber');
  advance(f, 2400);
  assert.equal(f.playerState.completedBatches[0].quality, 'Flawless Blue');
  assert.equal(f.playerState.completedBatches[0].grade, 5);
  assert.equal(f.grantFlawlessBatch('amber').grade, 5);
});

test('Judge presets carry fixed grades: Mid 2, Late 4, preset Flawless 5, dealer stock included', () => {
  const { context: e } = boot();
  const grades = name => {
    e.loadJudgePreset(name);
    return plain(e.playerState.completedBatches.map(lot => [lot.quality, lot.grade]));
  };
  assert.deepEqual(grades('Mid'), [['Standard', 2], ['Standard', 2]]);
  assert.deepEqual(grades('Late'), [['Standard', 4], ['Standard', 4], ['Flawless Blue', 5]]);
  assert.deepEqual(grades('Early'), []);
});

// ----- Roguelite legacy funds -----

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
};
const throwingStorage = () => {
  const fail = () => { throw new Error('storage blocked'); };
  return { getItem: fail, setItem: fail, removeItem: fail };
};

test('a raid saves the exact laundered balance, including zero', () => {
  const storage = memoryStorage();
  const { context: e } = boot(undefined, storage);
  e.triggerRaid();
  assert.equal(storage.data.get('blueSkyLegacyFunds'), '0');
  e.playerState.cash = 100;
  e.launderCash();
  e.triggerRaid();
  assert.equal(storage.data.get('blueSkyLegacyFunds'), '90');
  assert.equal(e.playerState.cash, 0);
});

test('saved funds are added once on load, support decimals and ignore invalid values', () => {
  assert.equal(boot(undefined, memoryStorage({ blueSkyLegacyFunds: '1234.56' })).context.playerState.launderedCash, 1234.56);
  assert.equal(boot(undefined, memoryStorage({ blueSkyLegacyFunds: '0' })).context.playerState.launderedCash, 0);
  for (const bad of ['', '  ', 'abc', '-5', 'Infinity', 'NaN']) {
    assert.equal(boot(undefined, memoryStorage({ blueSkyLegacyFunds: bad })).context.playerState.launderedCash, 0, bad);
  }
  const { context: e, press } = boot(undefined, memoryStorage({ blueSkyLegacyFunds: '500' }));
  e.tick(); e.tick(); press('1');
  assert.equal(e.playerState.launderedCash, 0, 'Early preset keeps its isolated balance');
  press('2');
  assert.equal(e.playerState.launderedCash, 10000);
});

test('later saves replace the stored total and presets neither save nor restore', () => {
  const storage = memoryStorage({ blueSkyLegacyFunds: '500' });
  const { context: e, press } = boot(undefined, storage);
  press('3');
  assert.equal(storage.data.get('blueSkyLegacyFunds'), '500');
  e.triggerRaid();
  assert.equal(storage.data.get('blueSkyLegacyFunds'), '100000');
});

test('clearSave removes only the legacy key and leaves the active run alone', () => {
  const storage = memoryStorage({ blueSkyLegacyFunds: '500', other: 'keep' });
  const { context: e } = boot(undefined, storage);
  e.clearSave();
  assert.deepEqual([...storage.data.keys()], ['other']);
  assert.equal(e.playerState.launderedCash, 500);
  assert.equal(boot(undefined, storage).context.playerState.launderedCash, 0);
});

test('missing or throwing localStorage never breaks startup, raids, saves or clearing', () => {
  for (const storage of [undefined, throwingStorage()]) {
    const { context: e } = boot(undefined, storage);
    assert.equal(e.playerState.launderedCash, 0);
    e.triggerRaid();
    assert.equal(e.playerState.raidCount, 1);
    assert.equal(e.saveLegacyFunds(), false);
    assert.equal(e.clearSave(), false);
  }
});

test('bribeDEA escalates $1k -> $2k -> $4k, drops 25 points, floors at 0; unaffordable changes nothing', () => {
  const { context: e } = boot();
  assert.equal(e.playerState.bribeCost, 1000);
  Object.assign(e.playerState, { cash: 999.99, suspicion: 60 });
  assert.equal(e.bribeDEA(), false);
  assert.deepEqual(plain([e.playerState.cash, e.playerState.suspicion, e.playerState.bribeCost]), [999.99, 60, 1000]);
  Object.assign(e.playerState, { cash: 10000, suspicion: 80 });
  const seen = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(e.bribeDEA(), true);
    seen.push([e.playerState.cash, e.playerState.suspicion, e.playerState.bribeCost]);
  }
  assert.deepEqual(seen, [[9000, 55, 2000], [7000, 30, 4000], [3000, 5, 8000]]);
  Object.assign(e.playerState, { cash: 8000, suspicion: 3 });
  assert.equal(e.bribeDEA(), true, 'cash equal to the cost succeeds');
  assert.deepEqual(plain([e.playerState.cash, e.playerState.suspicion, e.playerState.bribeCost]), [0, 0, 16000]);
  Object.assign(e.playerState, { cash: 20000, suspicion: 0 });
  assert.equal(e.bribeDEA(), true, 'zero heat still charges and doubles');
  assert.equal(e.playerState.bribeCost, 32000);
});

test('every Judge preset starts bribeCost at 1000', () => {
  const { context: e } = boot();
  for (const name of ['Early', 'Mid', 'Late']) {
    e.playerState.bribeCost = 8000;
    e.loadJudgePreset(name);
    assert.equal(e.playerState.bribeCost, 1000, name);
  }
});

test('a raid resets an escalated bribeCost and un-assigns dealer stock', () => {
  const { context: e } = boot(() => 0.009999);
  e.loadJudgePreset('Late');
  e.playerState.bribeCost = 16000;
  e.playerState.suspicion = 90;
  e.tick();
  assert.equal(e.playerState.raidCount, 1);
  assert.equal(e.playerState.bribeCost, 1000);
  assert.deepEqual(plain(e.playerState.dealers), []);
  assert.equal(e.playerState.launderedCash, 100000);
  assert.equal(e.playerState.inventory.ember + e.playerState.inventory.azure, 64, 'only the tick sale (4 units) is gone');
  assert.ok(e.playerState.completedBatches.every(lot => lot.dealerId === null));
});

test('fresh settings are allowed mixed draws and stay put across ticks and Judge presets', () => {
  const { context: e } = boot();
  const before = e.compounds.map(compound => ({
    id: compound.id, potency: compound.potency, yield: compound.yield, productionTime: compound.productionTime
  }));
  assert.equal(before.length, 5);
  e.tick();
  e.loadJudgePreset('Late');
  e.loadJudgePreset('Early');
  assert.deepEqual(e.compounds.map(compound => ({
    id: compound.id, potency: compound.potency, yield: compound.yield, productionTime: compound.productionTime
  })), before);
});

test('each compound accepts all 45 option combinations independently', () => {
  const { context: e } = boot();
  const other = plain(e.compounds.find(compound => compound.id === 'neon'));
  for (const potency of e.compoundOptions.potency) {
    for (const yieldUnits of e.compoundOptions.yield) {
      for (const minutes of e.compoundOptions.baseMinutes) {
        pin(e, 'amber', potency, yieldUnits, minutes);
        const quote = e.cookQuote('amber', 'Precision');
        assert.equal(quote.duration, Math.ceil(minutes * 60 * 1.5));
        assert.equal(quote.quantity, Math.floor(yieldUnits * 1.5));
        const performance = (potency * (quote.duration / 60)) / quote.quantity;
        assert.equal(quote.unitPrice, potency * yieldUnits * 2500);
        assert.equal(quote.performance, performance);
        assert.equal(quote.cost, Math.round((300 * performance + Number.EPSILON) * 100) / 100);
      }
    }
  }
  assert.deepEqual(plain(e.compounds.find(compound => compound.id === 'neon')), other);
  assert.equal(e.setCompoundSetting('amber', 'yield', 12), null);
  assert.equal(e.setCompoundSetting('amber', 'potency', 6), null);
  assert.equal(e.setCompoundSetting('amber', 'baseMinutes', 16), null);
  assert.equal(e.setCompoundSetting('missing', 'potency', 1), null);
  assert.equal(e.compounds.find(compound => compound.id === 'amber').yield, 24);
  pin(e, 'amber', 1, 8, 10);
  const standard = e.cookQuote('amber', 'Standard');
  assert.equal(standard.performance, 1.25);
  assert.equal(standard.cost, 375);
});

test('a started cook and completed lot keep the settings from cook start', () => {
  const { context: e } = boot(() => 0.5);
  pin(e, 'amber', 1, 8, 10);
  e.playerState.cash = 100000;
  const batch = e.startCook('amber', 'Standard');
  const quote = { quantity: batch.quantity, productionTime: batch.productionTime, unitPrice: batch.unitPrice, cost: batch.cost };
  pin(e, 'amber', 5, 24, 40);
  assert.deepEqual({
    quantity: batch.quantity, productionTime: batch.productionTime, unitPrice: batch.unitPrice, cost: batch.cost
  }, quote);
  advance(e, quote.productionTime);
  const lot = e.playerState.completedBatches[0];
  assert.equal(lot.quantity, 8);
  assert.equal(lot.unitPrice, 20000);
  const next = e.startCook('amber', 'Standard');
  assert.equal(next.quantity, 24);
  assert.equal(next.productionTime, 2400);
  assert.equal(next.unitPrice, 300000);
  const beforeBonus = e.playerState.cash;
  const bonus = e.grantFlawlessBatch('amber', 'Rapid');
  assert.equal(bonus.quantity, 18);
  assert.equal(bonus.unitPrice, 300000);
  assert.equal(e.playerState.cash, beforeBonus);
});

test('performance 1 costs $300 and performance 2 costs $600; unit price is $2,500 × potency × yield', () => {
  const { context: e } = boot();
  pin(e, 'amber', 1, 24, 24);
  const one = e.cookQuote('amber', 'Standard');
  assert.equal(one.performance, 1);
  assert.equal(one.cost, 300);
  assert.equal(one.unitPrice, 60000);
  e.playerState.cash = 299.99;
  const short = plain(e.playerState);
  assert.equal(e.startCook('amber', 'Standard'), null);
  assert.deepEqual(plain(e.playerState), short);
  e.playerState.cash = 300;
  const batch = e.startCook('amber', 'Standard');
  assert.equal(batch.cost, 300);
  assert.equal(e.playerState.cash, 0);
  pin(e, 'neon', 2, 24, 24);
  const two = e.cookQuote('neon', 'Standard');
  assert.equal(two.performance, 2);
  assert.equal(two.cost, 600);
  assert.equal(two.unitPrice, 120000);
  pin(e, 'violet', 5, 8, 40);
  assert.equal(e.cookQuote('violet', 'Standard').unitPrice, 100000);
  pin(e, 'ember', 3, 8, 10);
  const priced = e.cookQuote('ember', 'Standard').unitPrice;
  pin(e, 'ember', 3, 8, 40);
  assert.equal(e.cookQuote('ember', 'Precision').unitPrice, priced);
  pin(e, 'ember', 3, 24, 40);
  assert.equal(e.cookQuote('ember', 'Standard').unitPrice, 180000);
  e.loadJudgePreset('Mid');
  assert.deepEqual(plain(e.playerState.completedBatches.map(lot => lot.unitPrice)), [50, 50]);
  e.loadJudgePreset('Late');
  assert.equal(e.playerState.completedBatches[2].unitPrice, 125);
  assert.equal(e.playerState.completedBatches[2].valueMultiplier, 10);
});

test('keys 5 and 6 toggle 20x/50x cooking speed without touching other cadence', () => {
  const { context: e, press, intervals } = boot();
  const speed = () => e.getCookSpeed();
  assert.equal(speed(), 1);
  press('5'); assert.equal(speed(), 20);
  press('6'); assert.equal(speed(), 50);
  press('6'); assert.equal(speed(), 1);
  press('5'); press('5'); assert.equal(speed(), 1);
  press('5', { repeat: true }); press('5', { ctrlKey: true }); press('5', { isComposing: true });
  press('5', { target: { isContentEditable: true } });
  assert.equal(speed(), 1);
  e.playerState.activeBatches.push({ id: 90, compoundId: 'neon', remainingTicks: 100, productionTime: 100, quantity: 1, unitPrice: 1 });
  press('5');
  const ticks = e.playerState.timeTicks;
  advance(e, 4);
  assert.equal(e.playerState.activeBatches[0].remainingTicks, 20);
  assert.equal(e.playerState.timeTicks, ticks + 4);
  advance(e, 1);
  assert.equal(e.playerState.activeBatches.length, 0);
  press('6'); e.loadJudgePreset('Early'); assert.equal(speed(), 1);
  press('6'); e.stopGameLoop(); press('5'); assert.equal(speed(), 50);
  assert.equal(intervals.size, 0);
});

// ----- Dealer wear-out -----

function stockedDealer(e, tier, quantity, cookCount = 1) {
  e.playerState.labEquipment.basicLab = cookCount;
  e.playerState.cash = 100000;
  for (let i = 0; i < cookCount; i++) {
    pin(e, 'amber', 1, 24, 10);
    e.startCook('amber', 'Rapid');
  }
  advance(e, 300);
  const dealer = e.hireDealer(tier);
  return dealer;
}

test('new dealers have tier capacity limits and independent counters', () => {
  const { context: e } = boot();
  assert.deepEqual([e.dealerTiers.Common.capacity, e.dealerTiers.Rare.capacity, e.dealerTiers.Legendary.capacity], [100, 300, 1000]);
  const a = e.hireDealer('Common');
  const b = e.hireDealer('Common');
  assert.equal(a.unitsSold, 0);
  assert.equal(e.dealerRemainingCapacity(a), 100);
  a.unitsSold = 40;
  assert.equal(e.dealerRemainingCapacity(a), 60);
  assert.equal(e.dealerRemainingCapacity(b), 100);
  assert.equal(e.dealerRemainingCapacity({ id: 9, tier: 'Rare' }), 300, 'no counter means full capacity');
});

test('idle dealers, assignment and direct sales do not consume capacity', () => {
  const { context: e } = boot();
  const dealer = stockedDealer(e, 'Common');
  const [lot] = e.playerState.completedBatches;
  advance(e, 5);
  assert.equal(dealer.unitsSold, 0);
  e.assignDealerInventory(dealer.id, lot.id, 4);
  assert.equal(dealer.unitsSold, 0);
  e.sellBatch();
  assert.equal(dealer.unitsSold, 0);
  advance(e, 1);
  assert.equal(dealer.unitsSold, 1);
});

test('a worn-out dealer makes a capped final sale, leaves, and releases stock unchanged', () => {
  const { context: e } = boot();
  const dealer = stockedDealer(e, 'Legendary');
  const other = e.hireDealer('Common');
  const lot = e.playerState.completedBatches[0];
  const total = lot.quantity;
  e.assignDealerInventory(dealer.id, lot.id, 10);
  dealer.unitsSold = 998; // 2 left, normal rate is 4
  const held = e.playerState.completedBatches.find(entry => entry.dealerId === dealer.id);
  const { quality, grade, unitPrice, valueMultiplier } = held;
  const cash = e.playerState.cash;
  advance(e, 1);
  assert.equal(e.playerState.dealers.some(entry => entry.id === dealer.id), false);
  assert.ok(e.playerState.dealers.some(entry => entry.id === other.id));
  assert.deepEqual(plain(e.playerState.dealerDepartures), [{ id: dealer.id, tier: 'Legendary' }]);
  const sold = 2;
  assert.equal(e.playerState.cash, Math.round((cash + sold * unitPrice * valueMultiplier) * 100) / 100);
  assert.equal(e.playerState.inventory.amber, total - sold);
  const released = e.playerState.completedBatches.find(entry => entry.id === held.id);
  assert.equal(released.dealerId, null);
  assert.equal(released.quantity, 8);
  assert.deepEqual([released.quality, released.grade, released.unitPrice, released.valueMultiplier],
    [quality, grade, unitPrice, valueMultiplier]);
  advance(e, 3);
  assert.equal(released.quantity, 8, 'no further sales after departure');
});

test('a dealer exhausts across several lots and several dealers can leave in one tick', () => {
  const { context: e } = boot();
  const first = stockedDealer(e, 'Rare', 0, 2);
  const second = e.hireDealer('Common');
  for (const lot of e.playerState.completedBatches.slice()) {
    if (lot.dealerId === null) e.assignDealerInventory(lot.id % 2 ? first.id : second.id, lot.id);
  }
  first.unitsSold = 299;
  second.unitsSold = 99;
  advance(e, 1);
  assert.equal(e.playerState.dealers.length, 0);
  assert.equal(e.playerState.dealerDepartures.length, 2);
  assert.ok(e.playerState.completedBatches.every(lot => lot.dealerId === null));
  assert.equal(first.unitsSold + second.unitsSold, 400);
});

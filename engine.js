/* Breaking Bad — standalone, fictional arcade game engine.
 * Run: node engine.js, or load this file as a classic browser script later.
 * The one-second loop starts automatically and logs a state snapshot every tick.
 * Console example:
 *   startCook('amber', 'Rapid');
 *   // After completion: sellBatch(); launderCash();
 *   const dealer = hireDealer(rollDealerGacha());
 *   assignDealerInventory(dealer.id, playerState.completedBatches[0].id);
 *   // Browser only: hidden keys 1 / 2 / 3 load Early / Mid / Late presets.
 *   stopGameLoop(); startGameLoop(); // Safe to call repeatedly.
 *   // Roguelite legacy funds: raids save Laundered Cash to localStorage and the
 *   // next page load starts with it. A win clears that save. Judge demo reset: clearSave(), then reload.
 */
(function (root) {
  'use strict';

  // Loading the script again replaces the engine without duplicating timers/listeners.
  if (root.BreakingBadEngine) root.BreakingBadEngine.destroy();

  const compoundOptions = Object.freeze({
    potency: Object.freeze([1, 2, 3, 4, 5]),
    yield: Object.freeze([8, 16, 24]),
    baseMinutes: Object.freeze([10, 24, 40])
  });

  const compoundIdentities = Object.freeze([
    Object.freeze({ id: 'amber', name: 'Compound AM-01', stability: 0.95 }),
    Object.freeze({ id: 'neon', name: 'Compound NE-02', stability: 0.90 }),
    Object.freeze({ id: 'violet', name: 'Compound VI-03', stability: 0.85 }),
    Object.freeze({ id: 'ember', name: 'Compound EM-04', stability: 0.80 }),
    Object.freeze({ id: 'azure', name: 'Compound AZ-05', stability: 0.75 })
  ]);

  function runRandom() {
    let seed = 0x6d2b79f5;
    try { seed = (seed ^ Date.now()) >>> 0; } catch (error) { /* isolated runtimes have no Date */ }
    seed = (seed + (root.__bbRunNonce = (root.__bbRunNonce || 0) + 1)) >>> 0 || 1;
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function pickOption(list, rng) {
    return list[Math.floor(rng() * list.length)];
  }

  const draw = runRandom();
  const compounds = compoundIdentities.map(identity => ({
    id: identity.id,
    name: identity.name,
    stability: identity.stability,
    potency: pickOption(compoundOptions.potency, draw),
    yield: pickOption(compoundOptions.yield, draw),
    productionTime: pickOption(compoundOptions.baseMinutes, draw) * 60
  }));

  const workflows = Object.freeze({
    rapid: Object.freeze({ name: 'Rapid', timeModifier: 0.5, yieldModifier: 0.75 }),
    standard: Object.freeze({ name: 'Standard', timeModifier: 1, yieldModifier: 1 }),
    precision: Object.freeze({ name: 'Precision', timeModifier: 1.5, yieldModifier: 1.5 })
  });

  const dealerTiers = Object.freeze({
    Common: Object.freeze({ probability: 0.70, salesPerTick: 1, capacity: 100 }),
    Rare: Object.freeze({ probability: 0.25, salesPerTick: 2, capacity: 300 }),
    Legendary: Object.freeze({ probability: 0.05, salesPerTick: 4, capacity: 1000 })
  });

  const BRIBE_COST = 1000;
  const BRIBE_SUSPICION_DROP = 25;

  // All monetary amounts use two decimal places. Cook cost is $300 × overall performance.
  const gameConfig = {
    unitPriceFactor: 2500,
    performanceCost: 300,
    launderingFee: 0.10,
    flawlessChance: 0.05,
    flawlessValueMultiplier: 10,
    raidThreshold: 80,
    raidChancePerTick: 0.01,
    // Cost of the slot being bought. Slot 1 is the free starter; 5+ is not for sale.
    slotPrices: Object.freeze({ 2: 5000, 3: 30000, 4: 50000 })
  };

  function initialState() {
    return {
      cash: 1000,
      launderedCash: 0,
      suspicion: 0,
      timeTicks: 0,
      heatRate: 0.5,
      inventory: {}, // Compound ID -> total remaining units, including dealer stock.
      activeBatches: [],
      completedBatches: [], // Individual lots retain quality, price, and ownership.
      dealers: [],
      dealerDepartures: [], // Append-only log of dealers who wore out: { id, tier }.
      labEquipment: { basicLab: 3 }, // Each equipment unit provides one cooking slot.
      nextBatchId: 1,
      nextDealerId: 1,
      raidCount: 0,
      bribeCost: BRIBE_COST // Doubles after every successful bribe; a raid resets it.
    };
  }

  const playerState = initialState();
  let intervalId = null;
  const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const snapshot = value => JSON.parse(JSON.stringify(value));
  const compoundById = id => compounds.find(compound => compound.id === id);

  // ----- Roguelite legacy funds (browser localStorage; every access may throw or be absent) -----

  const LEGACY_KEY = 'blueSkyLegacyFunds';

  function saveLegacyFunds() {
    try {
      root.localStorage.setItem(LEGACY_KEY, String(playerState.launderedCash));
      return true;
    } catch (error) {
      return false;
    }
  }

  function readLegacyFunds() {
    try {
      const raw = root.localStorage.getItem(LEGACY_KEY);
      if (typeof raw !== 'string' || raw.trim() === '') return 0;
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? money(value) : 0;
    } catch (error) {
      return 0;
    }
  }

  // Hidden demo reset: removes only the legacy key. Does not reload or touch the active run.
  function clearSave() {
    try {
      root.localStorage.removeItem(LEGACY_KEY);
      return true;
    } catch (error) {
      return false;
    }
  }

  function resolveWorkflow(workflowType) {
    const workflow = typeof workflowType === 'string'
      ? workflows[workflowType.toLowerCase()] : undefined;
    if (!workflow || !Object.values(workflows).includes(workflow)) return null;
    return workflow;
  }

  // Meth quality grade (1-4) of an ordinary cook from its unrounded overall performance score.
  // Boundaries 1, 3 and 10 enter the higher grade. Grade 5 is only the Flawless Blue outcome.
  // Missing, invalid or negative scores get the lowest grade, never a fabricated higher one.
  const GRADE_SCORE_FLOORS = Object.freeze([1, 3, 10]);

  function gradeForScore(score) {
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) return 1;
    return 1 + GRADE_SCORE_FLOORS.filter(floor => score >= floor).length;
  }

  function pricedCook(compound, workflow) {
    const unitPrice = money(compound.potency * compound.yield * gameConfig.unitPriceFactor);
    const duration = Math.max(1, Math.ceil(compound.productionTime * workflow.timeModifier));
    const quantity = Math.max(1, Math.floor(compound.yield * workflow.yieldModifier));
    const minutes = duration / 60;
    const performance = quantity > 0 ? (compound.potency * minutes) / quantity : 0;
    const cost = money(gameConfig.performanceCost * performance);
    return {
      potency: compound.potency,
      baseYield: compound.yield,
      baseSeconds: compound.productionTime,
      unitPrice,
      cost,
      duration,
      quantity,
      minutes,
      performance,
      workflowType: workflow.name
    };
  }

  function setCompoundSetting(compoundId, setting, value) {
    const compound = compoundById(compoundId);
    const allowed = compoundOptions[setting];
    if (!compound || !allowed || !allowed.includes(value)) return null;
    if (setting === 'baseMinutes') compound.productionTime = value * 60;
    else compound[setting] = value;
    return compound;
  }

  function cookQuote(compoundId, workflowType = 'Standard') {
    const compound = compoundById(compoundId);
    const workflow = resolveWorkflow(workflowType);
    if (!compound || !workflow) return null;
    return pricedCook(compound, workflow);
  }

  function startCook(compoundId, workflowType = 'Standard') {
    const compound = compoundById(compoundId);
    const workflow = resolveWorkflow(workflowType);
    if (!compound || !workflow) return null;
    const slots = Object.values(playerState.labEquipment).reduce((total, quantity) =>
      total + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0), 0);
    if (playerState.activeBatches.length >= slots) return null;

    const priced = pricedCook(compound, workflow);
    if (playerState.cash < priced.cost) return null;

    const batch = {
      id: playerState.nextBatchId++,
      compoundId: compound.id,
      workflowType: workflow.name,
      remainingTicks: priced.duration,
      productionTime: priced.duration,
      quantity: priced.quantity,
      unitPrice: priced.unitPrice,
      cost: priced.cost,
      performance: priced.performance // Snapshot: later option changes never regrade this batch.
    };
    playerState.cash = money(playerState.cash - priced.cost);
    playerState.activeBatches.push(batch);
    return batch;
  }

  function completeBatch(batch, flawless = Math.random() < gameConfig.flawlessChance) {
    // Normal completions roll once. The explicit Judge bonus bypasses this roll.
    const lot = {
      id: batch.id,
      compoundId: batch.compoundId,
      quantity: batch.quantity,
      quality: flawless ? 'Flawless Blue' : 'Standard',
      valueMultiplier: flawless ? gameConfig.flawlessValueMultiplier : 1,
      unitPrice: batch.unitPrice,
      performance: batch.performance,
      // Graded once, after the Flawless roll; dealer splits copy it with the rest of the lot.
      grade: flawless ? 5 : gradeForScore(batch.performance),
      dealerId: null
    };
    playerState.completedBatches.push(lot);
    playerState.inventory[lot.compoundId] =
      (playerState.inventory[lot.compoundId] || 0) + lot.quantity;
    return lot;
  }

  // Debug/Judge bonus: credits spendable (dirty) cash only.
  function grantCash(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    playerState.cash = money(playerState.cash + amount);
    return amount;
  }

  function grantFlawlessBatch(compoundId, workflowType = 'Standard') {
    const compound = compoundById(compoundId);
    const workflow = resolveWorkflow(workflowType);
    if (!compound || !workflow) return null;
    const priced = pricedCook(compound, workflow);
    return completeBatch({
      id: playerState.nextBatchId++, compoundId: compound.id,
      quantity: priced.quantity,
      unitPrice: priced.unitPrice,
      performance: priced.performance
    }, true);
  }

  function consumeLot(lot, quantity) {
    const units = Math.min(quantity, lot.quantity);
    const revenue = money(units * lot.unitPrice * lot.valueMultiplier);
    lot.quantity -= units;
    playerState.inventory[lot.compoundId] -= units;
    if (playerState.inventory[lot.compoundId] === 0) delete playerState.inventory[lot.compoundId];
    playerState.cash = money(playerState.cash + revenue);
    return revenue;
  }

  function removeEmptyLots() {
    playerState.completedBatches = playerState.completedBatches.filter(lot => lot.quantity > 0);
  }

  // No arguments: sell all completed stock that is not assigned to a dealer.
  function sellBatch() {
    let revenue = 0;
    for (const lot of playerState.completedBatches) {
      if (lot.dealerId === null) revenue = money(revenue + consumeLot(lot, lot.quantity));
    }
    removeEmptyLots();
    return revenue;
  }

  // No arguments: launder all dirty cash. Invalid/overdrawn requests change nothing.
  function launderCash(amount = playerState.cash) {
    if (!Number.isFinite(amount) || amount <= 0 || amount > playerState.cash) return 0;
    amount = money(amount);
    if (amount <= 0 || amount > playerState.cash) return 0;
    const cleanCash = money(amount * (1 - gameConfig.launderingFee));
    playerState.cash = money(playerState.cash - amount);
    playerState.launderedCash = money(playerState.launderedCash + cleanCash);
    return cleanCash;
  }

  // Costs the current bribeCost (starts at $1,000) and cuts suspicion by 25 points (floored at 0),
  // then doubles the next price. Returns false, changing nothing, if unaffordable.
  function bribeDEA() {
    const cost = Number.isFinite(playerState.bribeCost) && playerState.bribeCost > 0
      ? playerState.bribeCost : BRIBE_COST;
    if (!(playerState.cash >= cost)) return false;
    playerState.cash = money(playerState.cash - cost);
    playerState.suspicion = Math.max(0, playerState.suspicion - BRIBE_SUSPICION_DROP);
    playerState.bribeCost = cost * 2;
    return true;
  }

  // A roll only returns a tier; it neither charges cash nor hires a dealer.
  function rollDealerGacha() {
    const roll = Math.random();
    if (roll < dealerTiers.Common.probability) return 'Common';
    if (roll < dealerTiers.Common.probability + dealerTiers.Rare.probability) return 'Rare';
    return 'Legendary';
  }

  function equipmentSlots() {
    const equipment = playerState.labEquipment;
    if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) return 0;
    return Object.values(equipment).reduce((total, quantity) =>
      total + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0), 0);
  }

  function nextSlotCost() {
    const cost = gameConfig.slotPrices[equipmentSlots() + 1];
    return Number.isFinite(cost) && cost >= 0 ? cost : null;
  }

  function buyLabSlot() {
    const cost = nextSlotCost();
    if (cost === null || playerState.cash < cost) return null;
    if (!playerState.labEquipment || typeof playerState.labEquipment !== 'object' ||
        Array.isArray(playerState.labEquipment)) {
      playerState.labEquipment = {};
    }
    const current = playerState.labEquipment.basicLab;
    const quantity = Number.isSafeInteger(current) && current > 0 ? current : 0;
    playerState.cash = money(playerState.cash - cost);
    playerState.labEquipment.basicLab = quantity + 1;
    return playerState.labEquipment.basicLab;
  }

  function hireDealer(tier = rollDealerGacha()) {
    if (!Object.prototype.hasOwnProperty.call(dealerTiers, tier)) return null;
    const dealer = { id: playerState.nextDealerId++, tier, unitsSold: 0 };
    playerState.dealers.push(dealer);
    return dealer;
  }

  // Reserve all or part of an unassigned lot; assignment does not create inventory.
  function assignDealerInventory(dealerId, batchId, quantity) {
    const dealer = playerState.dealers.find(entry => entry.id === dealerId);
    const lot = playerState.completedBatches.find(entry => entry.id === batchId);
    if (!dealer || !lot || lot.dealerId !== null) return null;
    if (quantity === undefined) quantity = lot.quantity;
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > lot.quantity) return null;
    if (quantity === lot.quantity) {
      lot.dealerId = dealer.id;
      return lot;
    }
    lot.quantity -= quantity;
    const assignedLot = { ...lot, id: playerState.nextBatchId++, quantity, dealerId: dealer.id };
    playerState.completedBatches.push(assignedLot);
    return assignedLot;
  }

  // Units a dealer can still sell. Dealers without a counter (old presets) start at full capacity.
  function dealerRemainingCapacity(dealer) {
    const sold = Number.isFinite(dealer.unitsSold) && dealer.unitsSold > 0 ? dealer.unitsSold : 0;
    return Math.max(0, dealerTiers[dealer.tier].capacity - sold);
  }

  function processDealerSales() {
    let sellingDealers = 0;
    const active = [];
    for (const dealer of playerState.dealers) {
      let remaining = Math.min(dealerTiers[dealer.tier].salesPerTick, dealerRemainingCapacity(dealer));
      let unitsSold = 0;
      for (const lot of playerState.completedBatches) {
        if (remaining === 0) break;
        if (lot.dealerId !== dealer.id || lot.quantity === 0) continue;
        const units = Math.min(remaining, lot.quantity);
        consumeLot(lot, units);
        remaining -= units;
        unitsSold += units;
      }
      if (unitsSold > 0) sellingDealers++;
      dealer.unitsSold = (Number.isFinite(dealer.unitsSold) && dealer.unitsSold > 0 ? dealer.unitsSold : 0) + unitsSold;
      if (dealerRemainingCapacity(dealer) > 0) {
        active.push(dealer);
        continue;
      }
      // Worn out: unsold stock goes back to the unassigned pool; inventory totals are unchanged.
      for (const lot of playerState.completedBatches) if (lot.dealerId === dealer.id) lot.dealerId = null;
      if (!Array.isArray(playerState.dealerDepartures)) playerState.dealerDepartures = [];
      playerState.dealerDepartures.push({ id: dealer.id, tier: dealer.tier });
    }
    playerState.dealers = active;
    removeEmptyLots();
    return sellingDealers;
  }

  function triggerRaid() {
    playerState.cash = 0;
    playerState.labEquipment = {};
    playerState.activeBatches = [];
    playerState.suspicion = 0;
    playerState.raidCount++;
    // The network is wiped and the next bribe starts cheap again. Surviving stock is un-assigned
    // so no lot stays reserved for a dealer who no longer exists.
    playerState.dealers = [];
    playerState.bribeCost = BRIBE_COST;
    for (const lot of playerState.completedBatches) lot.dealerId = null;
    saveLegacyFunds();
    // Completed stock survives; laundered cash is protected.
    console.warn('[Breaking Bad] RAID: dirty cash and lab equipment lost.');
  }

  // Cooking-only multiplier (1x, 20x or 50x). Sales, heat and raids still run once per tick.
  let cookSpeed = 1;
  const COOK_SPEED_KEYS = { '5': 20, '6': 50 };

  function getCookSpeed() { return cookSpeed; }

  function toggleCookSpeed(speed) {
    cookSpeed = speed > 1 && cookSpeed !== speed ? speed : 1;
    return cookSpeed;
  }

  function tick() {
    playerState.timeTicks++;
    const cookingBatches = playerState.activeBatches.length;
    const pending = [];
    for (const batch of playerState.activeBatches) {
      batch.remainingTicks = Math.max(0, batch.remainingTicks - cookSpeed);
      if (batch.remainingTicks <= 0) completeBatch(batch);
      else pending.push(batch);
    }
    playerState.activeBatches = pending;
    const sellingDealers = processDealerSales();
    // Idle time generates no heat. A finishing cook still generated heat this tick.
    playerState.suspicion = Math.min(100, playerState.suspicion +
      playerState.heatRate * (cookingBatches + sellingDealers));
    if (playerState.suspicion > gameConfig.raidThreshold &&
        Math.random() < gameConfig.raidChancePerTick) triggerRaid();
    console.log('[Breaking Bad] tick', snapshot(playerState));
    return playerState;
  }

  function startGameLoop() {
    if (intervalId === null) intervalId = setInterval(tick, 1000);
    return intervalId;
  }

  function stopGameLoop() {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = null;
  }

  // Hardcoded demo states; each load deep-copies the chosen preset.
  const judgePresets = {
    Early: initialState(),
    Mid: {
      cash: 25000, launderedCash: 10000, suspicion: 35, timeTicks: 600, heatRate: 0.5,
      inventory: { neon: 24 }, activeBatches: [],
      completedBatches: [
        { id: 1, compoundId: 'neon', quantity: 12, quality: 'Standard', grade: 2, valueMultiplier: 1, unitPrice: 50, dealerId: null },
        { id: 2, compoundId: 'neon', quantity: 12, quality: 'Standard', grade: 2, valueMultiplier: 1, unitPrice: 50, dealerId: 1 }
      ],
      dealers: [{ id: 1, tier: 'Rare' }], labEquipment: { basicLab: 3 },
      nextBatchId: 3, nextDealerId: 2, raidCount: 0, bribeCost: BRIBE_COST
    },
    Late: {
      cash: 250000, launderedCash: 100000, suspicion: 75, timeTicks: 3600, heatRate: 0.5,
      inventory: { ember: 60, azure: 8 }, activeBatches: [],
      completedBatches: [
        { id: 1, compoundId: 'ember', quantity: 20, quality: 'Standard', grade: 4, valueMultiplier: 1, unitPrice: 100, dealerId: null },
        { id: 2, compoundId: 'ember', quantity: 40, quality: 'Standard', grade: 4, valueMultiplier: 1, unitPrice: 100, dealerId: 1 },
        { id: 3, compoundId: 'azure', quantity: 8, quality: 'Flawless Blue', grade: 5, valueMultiplier: 10, unitPrice: 125, dealerId: null }
      ],
      dealers: [{ id: 1, tier: 'Legendary' }], labEquipment: { basicLab: 4 },
      nextBatchId: 4, nextDealerId: 2, raidCount: 0, bribeCost: BRIBE_COST
    }
  };

  function loadJudgePreset(name) {
    if (!Object.prototype.hasOwnProperty.call(judgePresets, name)) return null;
    const nextState = snapshot(judgePresets[name]);
    // Replace every field while preserving the globally exposed object identity.
    for (const key of Object.keys(playerState)) delete playerState[key];
    Object.assign(playerState, nextState);
    cookSpeed = 1;
    return playerState;
  }

  function handleJudgeKey(event) {
    const target = event.target;
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
        (target && (target.isContentEditable ||
          (typeof target.closest === 'function' && target.closest('input, textarea, select'))))) return;
    const speed = COOK_SPEED_KEYS[event.key];
    // Speed shortcuts never act on an ended run (its game loop is stopped).
    if (speed) {
      if (!event.isComposing && intervalId !== null) toggleCookSpeed(speed);
      return;
    }
    const name = { '1': 'Early', '2': 'Mid', '3': 'Late' }[event.key];
    if (name) loadJudgePreset(name);
  }

  function destroy() {
    stopGameLoop();
    if (typeof root.removeEventListener === 'function') {
      root.removeEventListener('keydown', handleJudgeKey);
    }
  }

  // Applied once per engine load, so UI re-initialization and render frames never re-credit it.
  playerState.launderedCash = money(playerState.launderedCash + readLegacyFunds());

  const api = {
    saveLegacyFunds, clearSave,
    playerState, compounds, compoundOptions, workflows, dealerTiers, gameConfig,
    tick, getCookSpeed, toggleCookSpeed, startCook, cookQuote, gradeForScore, setCompoundSetting, grantCash, grantFlawlessBatch, sellBatch, launderCash, bribeDEA, rollDealerGacha, triggerRaid, nextSlotCost, buyLabSlot,
    hireDealer, assignDealerInventory, dealerRemainingCapacity, loadJudgePreset, startGameLoop, stopGameLoop, destroy
  };
  Object.assign(root, api);
  root.BreakingBadEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root.addEventListener === 'function') root.addEventListener('keydown', handleJudgeKey);
  startGameLoop();
})(globalThis);

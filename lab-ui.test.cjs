'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLabUI, batchProgress, secondsLeft, slotCapacity } = require('./lab-ui.js');

// Minimal DOM double: just the surface lab-ui.js uses.
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.parent = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  querySelector() { return null; }
  addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); }
  removeEventListener(type, handler) {
    this.listeners[type] = (this.listeners[type] || []).filter(entry => entry !== handler);
  }
  click() { if (!this.disabled) (this.listeners.click || []).slice().forEach(handler => handler({})); }
  listenerCount() { return Object.values(this.listeners).reduce((n, list) => n + list.length, 0); }
}

function buildDom() {
  const ids = {};
  for (const id of ['lab-panel', 'lab-scene', 'lab-engine-status', 'lab-compound', 'lab-compound-info',
    'lab-feedback', 'lab-production', 'lab-idle', 'lab-batches', 'lab-slots', 'lab-slots-count', 'lab-slots-state']) ids[id] = new FakeElement();
  const buttons = ['Rapid', 'Standard', 'Precision'].map(name => {
    const button = new FakeElement('button');
    button.setAttribute('data-workflow', name);
    return button;
  });
  const doc = {
    getElementById: id => ids[id] || null,
    querySelectorAll: () => buttons,
    createElement: tag => new FakeElement(tag)
  };
  return { doc, ids, buttons };
}

const compounds = [
  { id: 'amber', name: 'Amber Spark', potency: 1, yield: 8, productionTime: 10 },
  { id: 'neon', name: 'Neon Dust', potency: 2, yield: 12, productionTime: 16 }
];

function visibleText(node) {
  return [node.textContent, ...(node.children || []).map(visibleText)].join(' ');
}

function setup(overrides = {}) {
  const dom = buildDom();
  const calls = [];
  const timers = [];
  const engine = {
    playerState: { activeBatches: [] },
    compounds,
    workflows: {},
    startCook: (...args) => { calls.push(args); return { id: calls.length }; },
    ...overrides
  };
  const ui = createLabUI({
    document: dom.doc,
    engine,
    setInterval: fn => { timers.push(fn); return timers.length; },
    clearInterval: id => { timers[id - 1] = null; }
  });
  return { ...dom, engine, calls, timers, ui };
}

const batch = (id, productionTime, remainingTicks, extra = {}) =>
  ({ id, compoundId: 'neon', workflowType: 'Rapid', productionTime, remainingTicks, ...extra });

test('batchProgress computes clamped percentages from workflow-adjusted time', () => {
  assert.equal(batchProgress(batch(1, 8, 8)), 0);
  assert.equal(batchProgress(batch(1, 8, 6)), 25);
  assert.equal(batchProgress(batch(1, 24, 0)), 100);
  assert.equal(batchProgress(batch(1, 8, -3)), 100);
  assert.equal(batchProgress(batch(1, 8, 20)), 0);
});

test('batchProgress and secondsLeft handle invalid durations safely', () => {
  for (const bad of [0, -5, NaN, Infinity, undefined, null, '10']) {
    assert.equal(batchProgress(batch(1, bad, 3)), 0);
  }
  assert.equal(batchProgress(null), 0);
  assert.equal(batchProgress(batch(1, 10, undefined)), 0);
  assert.equal(secondsLeft(batch(1, 10, undefined)), null);
  assert.equal(secondsLeft(batch(1, 10, -2)), 0);
  assert.equal(secondsLeft(batch(1, 10, 4.2)), 5);
});

test('workflow buttons only select; they never start a cook', () => {
  const { ui, buttons, calls, ids } = setup();
  assert.equal(ui.init(), true);
  assert.equal(ids['lab-compound'].value, 'amber');
  assert.deepEqual(ui.getSelection(), { compoundId: 'amber', workflowType: 'Standard' });
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  ids['lab-compound'].value = 'neon';
  buttons[0].click();
  assert.deepEqual(ui.getSelection(), { compoundId: 'neon', workflowType: 'Rapid' });
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  buttons[2].click();
  assert.equal(ui.getSelection().workflowType, 'Precision');
  assert.equal(calls.length, 0);
});

test('compound selector is populated from the engine and keeps a valid selection', () => {
  const { ui, ids } = setup();
  ui.init();
  const cards = ids['lab-compound'].children.map(row => row.children[0]);
  assert.deepEqual(cards.map(card => [card.value, card.children[1].children[0].textContent, card.getAttribute('role')]),
    [['amber', 'Amber Spark', 'radio'], ['neon', 'Neon Dust', 'radio']]);
  assert.equal(cards[0].getAttribute('aria-checked'), 'true');
  assert.equal(cards[0].children[1].children[1].textContent, '■ SELECTED');
  const potency = ids['lab-compound'].children[0].children[1].children[0];
  assert.equal(potency.getAttribute('aria-label'), 'Potency for Amber Spark');
  assert.equal(potency.children[1].textContent, '■ 1');
  assert.equal(potency.children[1].getAttribute('aria-checked'), 'true');
  const info = visibleText(ids['lab-compound-info']);
  assert.match(info, /Overall performance/);
  assert.doesNotMatch(info, /potency-units\/min/);
  assert.match(info, /potency × cook time \(min\) ÷ effective yield/);
  assert.match(info, /Upfront cost per batch/);
  assert.match(info, /Selling price per unit \$20,000\.00/);
  assert.match(info, /\$300 × overall performance/);
  assert.match(info, /\$2,500 × potency × yield/);
});

test('compound cards select without starting a cook and keep that selection', () => {
  const { ui, ids, calls } = setup();
  ui.init();
  const neon = ids['lab-compound'].children[1].children[0];
  neon.click();
  assert.equal(ids['lab-compound'].value, 'neon');
  assert.equal(neon.getAttribute('aria-checked'), 'true');
  assert.equal(neon.children[1].children[1].textContent, '■ SELECTED');
  assert.equal(ids['lab-compound'].children[0].children[0].children[1].children[1].textContent, '□');
  assert.deepEqual(ui.getSelection(), { compoundId: 'neon', workflowType: 'Standard' });
  assert.equal(calls.length, 0);
  ui.render();
  assert.equal(ids['lab-compound'].value, 'neon');
  assert.equal(ids['lab-compound'].children[1].children[0].getAttribute('aria-checked'), 'true');
  ids['lab-compound'].listeners.keydown[0]({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(ui.getSelection().compoundId, 'amber');
  assert.equal(calls.length, 0);
});

test('option buttons change one setting, keep the others, and never start a cook', () => {
  const { ui, ids, calls, engine } = setup();
  engine.setCompoundSetting = (id, setting, value) => {
    const compound = engine.compounds.find(entry => entry.id === id);
    if (!compound) return null;
    if (setting === 'baseMinutes') compound.productionTime = value * 60;
    else compound[setting] = value;
    return compound;
  };
  engine.cookQuote = (id, workflowType) => {
    const compound = engine.compounds.find(entry => entry.id === id);
    const modifiers = { Rapid: [0.5, 0.75], Standard: [1, 1], Precision: [1.5, 1.5] }[workflowType];
    const duration = Math.max(1, Math.ceil(compound.productionTime * modifiers[0]));
    const quantity = Math.max(1, Math.floor(compound.yield * modifiers[1]));
    return {
      duration, quantity,
      performance: (compound.potency * (duration / 60)) / quantity,
      cost: Math.round((300 * compound.potency * (duration / 60) / quantity + Number.EPSILON) * 100) / 100
    };
  };
  ui.init();
  const groups = ids['lab-compound'].children[0].children[1].children;
  const yieldGroup = groups[1];
  const beforeBase = engine.compounds[0].productionTime;
  yieldGroup.children[2].click();
  assert.equal(engine.compounds[0].yield, 16);
  assert.equal(engine.compounds[0].potency, 1);
  assert.equal(engine.compounds[0].productionTime, beforeBase);
  assert.equal(yieldGroup.children[2].getAttribute('aria-checked'), 'true');
  assert.equal(yieldGroup.children[1].getAttribute('aria-checked'), 'false');
  assert.match(visibleText(ids['lab-compound-info']), /Effective yield 16 units/);
  assert.match(visibleText(ids['lab-compound-info']), /Selling price per unit \$40,000\.00/);
  groups[0].children[5].click();
  assert.equal(engine.compounds[0].potency, 5);
  assert.match(visibleText(ids['lab-compound-info']), /Selling price per unit \$200,000\.00/);
  assert.equal(calls.length, 0);
  yieldGroup.children[2].listeners.keydown[0]({
    key: 'ArrowLeft', preventDefault() {}, stopPropagation() {}
  });
  assert.equal(engine.compounds[0].yield, 8);
  assert.equal(calls.length, 0);
});

test('feedback is shown for main.js and cleared by an empty message', () => {
  const { ui, ids } = setup();
  ui.init();
  ui.feedback('Cook rejected.', 'error');
  assert.equal(ids['lab-feedback'].textContent, 'Cook rejected.');
  assert.equal(ids['lab-feedback'].getAttribute('data-kind'), 'error');
  ui.feedback('', 'info');
  assert.equal(ids['lab-feedback'].textContent, '');
});

test('unavailable engine locks controls and prevents calls', () => {
  const { ui, buttons, calls, ids, engine } = setup({ startCook: undefined });
  ui.init();
  assert.ok(buttons.every(button => button.disabled));
  assert.equal(ids['lab-compound'].disabled, true);
  assert.equal(ids['lab-engine-status'].textContent, 'ENGINE OFFLINE');
  assert.match(ids['lab-feedback'].textContent, /unavailable/);
  buttons[0].click();
  assert.equal(calls.length, 0);
  assert.equal(ui.getSelection(), null);

  // Engine with no compounds is also unavailable.
  engine.startCook = (...args) => { calls.push(args); return {}; };
  engine.compounds = [];
  ui.render();
  assert.ok(buttons.every(button => button.disabled));

  // Recovers once the engine appears.
  engine.compounds = compounds;
  ui.render();
  assert.ok(buttons.every(button => !button.disabled));
  assert.equal(ids['lab-engine-status'].textContent, 'ENGINE ONLINE');
});

test('progress rows reflect engine batches, accessibility values, and concurrency', () => {
  const { ui, ids, engine } = setup();
  ui.init();
  engine.playerState.activeBatches = [batch(1, 8, 8), batch(2, 24, 6, { workflowType: 'Precision' })];
  ui.render();
  const [first, second] = ids['lab-batches'].children;
  assert.equal(ids['lab-batches'].children.length, 2);
  const bar = row => row.children[1];
  assert.equal(bar(first).children[0].style.width, '0%');
  assert.equal(bar(first).getAttribute('aria-valuenow'), '0');
  assert.equal(bar(first).getAttribute('role'), 'progressbar');
  assert.equal(bar(second).children[0].style.width, '75%');
  assert.equal(bar(second).getAttribute('aria-valuenow'), '75');
  assert.equal(bar(second).getAttribute('aria-valuetext'), '75% complete, 6 sec left');
  assert.equal(second.children[0].children[0].textContent, 'Neon Dust · Precision');
  assert.equal(ids['lab-idle'].hidden, true);
  assert.equal(ids['lab-production'].getAttribute('data-state'), 'cooking');

  // Engine replaces the batch array and decrements; the same DOM row is reused.
  engine.playerState.activeBatches = [batch(1, 8, 4), batch(2, 24, 5, { workflowType: 'Precision' })];
  ui.render();
  assert.equal(ids['lab-batches'].children[0], first);
  assert.equal(bar(first).children[0].style.width, '50%');
});

test('invalid batch durations render safely at zero', () => {
  const { ui, ids, engine } = setup();
  ui.init();
  engine.playerState.activeBatches = [batch(1, 0, 5), batch(2, 10, undefined)];
  assert.doesNotThrow(() => ui.render());
  const [first, second] = ids['lab-batches'].children;
  assert.equal(first.children[1].getAttribute('aria-valuenow'), '0');
  assert.equal(second.children[0].children[1].textContent, '--');
});

test('stale batches are removed and the lab returns to idle', () => {
  const { ui, ids, engine } = setup();
  ui.init();
  engine.playerState.activeBatches = [batch(1, 8, 4), batch(2, 8, 4)];
  ui.render();
  engine.playerState.activeBatches = [batch(2, 8, 3)]; // batch 1 completed
  ui.render();
  assert.equal(ids['lab-batches'].children.length, 1);
  engine.playerState.activeBatches = []; // raid or Judge Mode reset
  ui.render();
  assert.equal(ids['lab-batches'].children.length, 0);
  assert.equal(ids['lab-idle'].hidden, false);
  assert.equal(ids['lab-scene'].getAttribute('data-state'), 'idle');
  engine.playerState = { activeBatches: [batch(9, 8, 8)] }; // state object replaced
  ui.render();
  assert.equal(ids['lab-batches'].children.length, 1);
});

test('the UI never writes engine state', () => {
  const { ui, buttons, engine } = setup();
  const state = Object.freeze({ activeBatches: Object.freeze([Object.freeze(batch(1, 8, 4))]) });
  engine.playerState = state;
  ui.init();
  buttons[0].click();
  ui.render();
  assert.equal(state.activeBatches[0].remainingTicks, 4);
});

test('re-initialization does not duplicate listeners, timers, or calls', () => {
  const { ui, buttons, calls, timers, ids } = setup();
  ui.init();
  ui.init();
  ui.init();
  assert.equal(timers.filter(Boolean).length, 1);
  buttons.forEach(button => assert.equal(button.listenerCount(), 1));
  assert.equal(ids['lab-compound'].listenerCount(), 1);
  buttons[0].click();
  assert.equal(ui.getSelection().workflowType, 'Rapid');
  assert.equal(calls.length, 0);
  ui.destroy();
  assert.equal(timers.filter(Boolean).length, 0);
  buttons.forEach(button => assert.equal(button.listenerCount(), 0));
});

test('init reports false when the markup is missing', () => {
  const { ui, ids } = setup();
  delete ids['lab-batches'];
  assert.equal(ui.init(), false);
});

test('works against the real engine: reflects batches the engine starts', () => {
  const engine = require('./engine.js');
  engine.stopGameLoop();
  const { ui, buttons, ids } = setup({
    playerState: engine.playerState, compounds: engine.compounds,
    workflows: engine.workflows, startCook: engine.startCook
  });
  ui.init();
  ids['lab-compound'].value = 'amber';
  buttons[0].click();
  const selection = ui.getSelection();
  assert.deepEqual(selection, { compoundId: 'amber', workflowType: 'Rapid' });
  engine.setCompoundSetting('amber', 'potency', 1);
  engine.setCompoundSetting('amber', 'yield', 8);
  engine.setCompoundSetting('amber', 'baseMinutes', 10);
  engine.startCook(selection.compoundId, selection.workflowType);
  ui.render();
  assert.equal(engine.playerState.activeBatches.length, 1);
  assert.equal(ids['lab-batches'].children.length, 1);
  assert.equal(ids['lab-batches'].children[0].children[1].getAttribute('aria-valuenow'), '0');
  assert.deepEqual(engine.compounds.map(compound => compound.name), [
    'Compound AM-01', 'Compound NE-02', 'Compound VI-03', 'Compound EM-04', 'Compound AZ-05'
  ]);
  const originalLog = console.log;
  console.log = () => {};
  try { engine.tick(); engine.tick(); } finally { console.log = originalLog; }
  ui.render();
  const cooking = engine.playerState.activeBatches[0];
  assert.equal(ids['lab-batches'].children[0].children[1].getAttribute('aria-valuenow'),
    String(Math.round((200 / cooking.productionTime))));
  engine.playerState.labEquipment = { basicLab: 1 };
  assert.equal(engine.startCook('amber', 'Rapid'), null); // occupied slot rejects another cook
  assert.equal(engine.playerState.activeBatches.length, 1);
  engine.loadJudgePreset('Early');
  ui.render();
  assert.equal(ids['lab-batches'].children.length, 0);
  assert.equal(ids['lab-idle'].hidden, false);
});

const slotText = ids => [ids['lab-slots-count'].textContent, ids['lab-slots-state'].textContent,
  ids['lab-slots'].getAttribute('data-state')];

test('slotCapacity sums positive safe-integer equipment like the engine and never goes negative', () => {
  const cap = (labEquipment, count = 0) =>
    slotCapacity({ labEquipment, activeBatches: Array.from({ length: count }, (_, i) => ({ id: i })) });
  assert.deepEqual(cap({ basicLab: 1 }), { total: 1, occupied: 0, available: 1, status: 'available' });
  assert.deepEqual(cap({ basicLab: 1 }, 1), { total: 1, occupied: 1, available: 0, status: 'full' });
  assert.deepEqual(cap({ basicLab: 2, proLab: 3 }, 2), { total: 5, occupied: 2, available: 3, status: 'available' });
  assert.equal(cap({ a: 2, b: 3 }, 5).status, 'full');
  assert.deepEqual(cap({}), { total: 0, occupied: 0, available: 0, status: 'none' });
  // Invalid quantities do not inflate capacity.
  const bad = cap({ a: -2, b: 1.5, c: NaN, d: Infinity, e: '3', f: null, g: Number.MAX_SAFE_INTEGER + 1, h: 2 });
  assert.equal(bad.total, 2);
  // More batches than slots (equipment lost) keeps availability at zero.
  assert.deepEqual(cap({ a: 1 }, 3), { total: 1, occupied: 3, available: 0, status: 'full' });
  assert.equal(cap({}, 2).available, 0);
});

test('slotCapacity reports unavailable for missing or malformed engine state', () => {
  for (const state of [undefined, null, {}, { activeBatches: [] }, { labEquipment: {} },
    { labEquipment: null, activeBatches: [] }, { labEquipment: { a: 1 }, activeBatches: 'x' }, 'state']) {
    assert.equal(slotCapacity(state), null);
  }
});

test('lab slots display covers initial, full, concurrent, none and unavailable states', () => {
  const { ui, ids, engine } = setup({ playerState: { labEquipment: { basicLab: 1 }, activeBatches: [] } });
  ui.init();
  assert.deepEqual(slotText(ids), ['0/1 occupied · 1 available', 'Slot available', 'available']);
  engine.playerState.activeBatches.push(batch(1, 10, 10));
  ui.render();
  assert.deepEqual(slotText(ids), ['1/1 occupied · 0 available', 'Lab full', 'full']);
  engine.playerState.activeBatches.length = 0; // cook finished
  ui.render();
  assert.deepEqual(slotText(ids), ['0/1 occupied · 1 available', 'Slot available', 'available']);
  engine.playerState.labEquipment = { basicLab: 2, other: 1, junk: -4 };
  engine.playerState.activeBatches.push(batch(2, 10, 10), batch(3, 10, 10));
  ui.render();
  assert.deepEqual(slotText(ids), ['2/3 occupied · 1 available', 'Slot available', 'available']);
  engine.playerState.labEquipment = {}; // raid
  engine.playerState.activeBatches.length = 0;
  ui.render();
  assert.deepEqual(slotText(ids), ['0/0 occupied · 0 available', 'No lab equipment', 'none']);
  engine.playerState = undefined;
  ui.render();
  assert.deepEqual(slotText(ids), ['-- slots · unavailable', 'Slot status unavailable', 'unavailable']);
});

test('lab slots track the real engine through cook, completion, raid and Judge Mode', () => {
  const engine = require('./engine.js');
  engine.stopGameLoop();
  const { ui, ids } = setup({
    playerState: engine.playerState, compounds: engine.compounds,
    workflows: engine.workflows, startCook: engine.startCook
  });
  engine.loadJudgePreset('Early');
  engine.setCompoundSetting('amber', 'potency', 1);
  engine.setCompoundSetting('amber', 'yield', 8);
  engine.setCompoundSetting('amber', 'baseMinutes', 10);
  engine.setCompoundSetting('neon', 'potency', 1);
  engine.setCompoundSetting('neon', 'yield', 8);
  engine.setCompoundSetting('neon', 'baseMinutes', 40);
  engine.setCompoundSetting('violet', 'potency', 1);
  engine.setCompoundSetting('violet', 'yield', 8);
  engine.setCompoundSetting('violet', 'baseMinutes', 40);
  engine.setCompoundSetting('ember', 'potency', 1);
  engine.setCompoundSetting('ember', 'yield', 8);
  engine.setCompoundSetting('ember', 'baseMinutes', 10);
  engine.playerState.heatRate = 0;
  engine.playerState.cash = 10000;
  ui.init();
  assert.deepEqual(slotText(ids), ['0/3 occupied · 3 available', 'Slot available', 'available']);
  engine.startCook('amber', 'Rapid');
  ui.render();
  assert.deepEqual(slotText(ids), ['1/3 occupied · 2 available', 'Slot available', 'available']);
  engine.startCook('neon', 'Rapid');
  engine.startCook('violet', 'Rapid');
  ui.render();
  assert.deepEqual(slotText(ids), ['3/3 occupied · 0 available', 'Lab full', 'full']);
  const cash = engine.playerState.cash;
  assert.equal(engine.startCook('ember', 'Rapid'), null);
  assert.equal(engine.playerState.cash, cash);
  const originalLog = console.log;
  console.log = () => {};
  try {
    const amberTime = engine.playerState.activeBatches[0].productionTime;
    for (let i = 0; i < amberTime; i++) engine.tick();
  } finally { console.log = originalLog; }
  ui.render();
  assert.equal(engine.playerState.activeBatches.length, 2);
  assert.deepEqual(slotText(ids), ['2/3 occupied · 1 available', 'Slot available', 'available']);
  assert.ok(engine.startCook('ember', 'Rapid'));
  engine.triggerRaid();
  ui.render();
  assert.deepEqual(slotText(ids), ['0/0 occupied · 0 available', 'No lab equipment', 'none']);
  engine.loadJudgePreset('Mid');
  ui.render();
  assert.deepEqual(slotText(ids), ['0/3 occupied · 3 available', 'Slot available', 'available']);
  engine.loadJudgePreset('Late');
  ui.render();
  assert.deepEqual(slotText(ids), ['0/4 occupied · 4 available', 'Slot available', 'available']);
  engine.loadJudgePreset('Early');
  ui.render();
  assert.deepEqual(slotText(ids), ['0/3 occupied · 3 available', 'Slot available', 'available']);
});

test('lab slots rendering writes no engine state and adds no timers on reinit', () => {
  const state = { labEquipment: { basicLab: 1 }, activeBatches: [] };
  const { ui, timers } = setup({ playerState: state });
  const before = JSON.stringify(state);
  ui.init();
  ui.init();
  ui.render();
  assert.equal(JSON.stringify(state), before);
  assert.equal(timers.filter(Boolean).length, 1);
});

test('index.html wires the lab: ids, buttons, script order, palette, and font', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const id of ['lab-panel', 'lab-scene', 'lab-compound', 'lab-feedback', 'lab-batches', 'lab-idle', 'lab-slots', 'lab-slots-count', 'lab-slots-state', 'street-panel']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /data-workflow=/); // Rapid/Standard/Precision buttons removed; Standard stays the default
  assert.match(html, /id="cook-start-btn"/);
  assert.ok(html.indexOf('src="engine.js"') > -1 && html.indexOf('src="engine.js"') < html.indexOf('src="lab-ui.js"'));
  for (const token of ['#1a1a1a', '#39ff14', '#00f3ff', 'VT323', 'monospace', 'box-shadow']) assert.ok(html.includes(token), token);
  assert.match(html, /id="lab-compound"[^>]*role="radiogroup"/);
  assert.doesNotMatch(html, /<select[^>]*id="lab-compound"/);
});

test('index.html places Lab Slots in the same row as Start Cook, with text states and narrow-screen wrapping', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const row = html.match(/<div class="lab-start-row">([\s\S]*?)<\/div>\s*<p id="cook-selection"/);
  assert.ok(row, 'start row wraps Start Cook and Lab Slots');
  assert.match(row[1], /id="cook-start-btn"/);
  assert.match(row[1], /id="lab-slots"/);
  assert.match(html, /\.lab-start-row\s*\{[^}]*flex-wrap: wrap/);
});

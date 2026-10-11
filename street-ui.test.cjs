'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const engineSource = read('engine.js');
const streetSource = read('street-ui.js');
const html = read('index.html');

const IDS = ['street-panel', 'street-map-blips', 'street-hire-btn', 'street-launder-btn',
  'street-float-layer', 'street-status', 'street-dirty-cash', 'street-clean-cash',
  'street-dealer-count', 'street-suspicion-bar', 'street-suspicion-fill',
  'street-suspicion-value', 'street-panic-warning', 'street-unavailable'];

// Minimal DOM: only the surface street-ui.js uses.
class FakeElement {
  constructor(id) {
    this.id = id;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.classes = new Set();
    this.style = {};
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.parent = null;
    const owner = this;
    this.classList = {
      contains: name => owner.classes.has(name),
      toggle(name, force) { if (force) owner.classes.add(name); else owner.classes.delete(name); },
      remove: name => owner.classes.delete(name)
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  removeEventListener(name, fn) {
    this.listeners[name] = (this.listeners[name] || []).filter(entry => entry !== fn);
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  fire(name) { for (const fn of [...(this.listeners[name] || [])]) fn({}); }
  click() { if (!this.disabled) this.fire('click'); }
}

function boot({ withEngine = true, random = () => 0.5, ready = 'complete' } = {}) {
  const elements = {};
  for (const id of IDS) elements[id] = new FakeElement(id);
  const timers = new Map();
  let nextTimer = 1;
  const docListeners = {};
  const context = vm.createContext({
    module: { exports: {} },
    console: { log() {}, warn() {} },
    document: {
      readyState: ready,
      getElementById: id => elements[id] || null,
      createElement: () => new FakeElement(),
      addEventListener: (name, fn) => { docListeners[name] = fn; }
    },
    setInterval: (fn, ms) => { timers.set(nextTimer, { fn, ms, repeat: true }); return nextTimer++; },
    clearInterval: id => timers.delete(id),
    setTimeout: (fn, ms) => { timers.set(nextTimer, { fn, ms, repeat: false }); return nextTimer++; }
  });
  const math = Object.create(Math);
  math.random = random;
  context.Math = math;
  if (withEngine) {
    vm.runInContext(engineSource, context, { filename: 'engine.js' });
    context.stopGameLoop(); // No engine ticks unless a test asks for them.
  }
  const loadStreet = () => vm.runInContext(streetSource, context, { filename: 'street-ui.js' });
  loadStreet();
  const refreshTimers = () => [...timers.values()].filter(t => t.repeat && t.ms === 250);
  return { context, elements, timers, docListeners, loadStreet, refreshTimers,
    $: id => elements[id], state: () => context.playerState };
}

const hireBtn = ui => ui.$('street-hire-btn');
const sayings = ui => ui.$('street-status').textContent;

test('initial render shows balances and an empty, calm meter', () => {
  const ui = boot();
  assert.equal(ui.$('street-dirty-cash').textContent, '$1,000.00');
  assert.equal(ui.$('street-clean-cash').textContent, '$0.00');
  assert.equal(ui.$('street-dealer-count').textContent, '0');
  assert.equal(ui.$('street-suspicion-value').textContent, '0%');
  assert.equal(ui.$('street-suspicion-bar').getAttribute('aria-valuenow'), '0');
  assert.equal(ui.$('street-panel').classList.contains('street-panic'), false);
  assert.equal(ui.$('street-panic-warning').hidden, true);
  assert.equal(ui.$('street-unavailable').hidden, true);
});

test('hire rolls once, hires once with the rolled tier and charges exactly $500', () => {
  const ui = boot({ random: () => 0.8 }); // Rare
  const calls = [];
  const { rollDealerGacha, hireDealer } = ui.context;
  ui.context.rollDealerGacha = () => { calls.push('roll'); return rollDealerGacha(); };
  ui.context.hireDealer = tier => { calls.push('hire:' + tier); return hireDealer(tier); };
  hireBtn(ui).click();
  assert.deepEqual(calls, ['roll', 'hire:Rare']);
  assert.equal(ui.state().dealers.length, 1);
  assert.equal(ui.state().dealers[0].tier, 'Rare');
  assert.equal(ui.state().cash, 500);
  assert.equal(ui.$('street-dirty-cash').textContent, '$500.00');
  assert.equal(ui.$('street-dealer-count').textContent, '1');
  assert.match(sayings(ui), /Rare/);
});

test('each tier appears as one floating result that cleans itself up', () => {
  for (const [roll, tier] of [[0.1, 'Common'], [0.8, 'Rare'], [0.99, 'Legendary']]) {
    const ui = boot({ random: () => roll });
    hireBtn(ui).click();
    const layer = ui.$('street-float-layer');
    assert.equal(layer.children.length, 1);
    const node = layer.children[0];
    assert.equal(node.textContent, tier);
    assert.match(node.className, new RegExp('street-float street-tier-' + tier.toLowerCase()));
    assert.equal(node.getAttribute('aria-hidden'), 'true');
    node.fire('animationend');
    assert.equal(layer.children.length, 0);
  }
});

test('floating results are removed by the fallback timeout without animationend', () => {
  const ui = boot();
  hireBtn(ui).click();
  const fallback = [...ui.timers.values()].find(t => !t.repeat);
  fallback.fn();
  assert.equal(ui.$('street-float-layer').children.length, 0);
});

test('rapid activations each roll, hire, charge and show exactly once', () => {
  const ui = boot();
  ui.state().cash = 1500;
  for (let index = 0; index < 3; index++) hireBtn(ui).click();
  assert.equal(ui.state().dealers.length, 3);
  assert.equal(ui.state().cash, 0);
  assert.equal(ui.$('street-float-layer').children.length, 3);
  hireBtn(ui).click(); // A fourth activation has no funds and adds nothing.
  assert.equal(ui.state().dealers.length, 3);
  assert.equal(ui.$('street-float-layer').children.length, 3);
});

test('insufficient funds: no roll, no hire, no charge, clear feedback', () => {
  const ui = boot();
  ui.state().cash = 499.99;
  let rolls = 0;
  ui.context.rollDealerGacha = () => { rolls++; return 'Common'; };
  hireBtn(ui).click();
  assert.equal(rolls, 0);
  assert.equal(ui.state().dealers.length, 0);
  assert.equal(ui.state().cash, 499.99);
  assert.equal(ui.$('street-float-layer').children.length, 0);
  assert.match(sayings(ui), /Insufficient funds/);
  ui.state().cash = 500;
  hireBtn(ui).click();
  assert.equal(ui.state().dealers.length, 1);
  assert.equal(ui.state().cash, 0);
});

test('rejected or throwing recruitment never charges', () => {
  const ui = boot();
  ui.context.hireDealer = () => null;
  hireBtn(ui).click();
  assert.equal(ui.state().cash, 1000);
  assert.match(sayings(ui), /not charged/);
  ui.context.hireDealer = () => { throw new Error('boom'); };
  hireBtn(ui).click();
  assert.equal(ui.state().cash, 1000);
  ui.context.hireDealer = () => ({ id: 9, tier: 'Mythic' });
  hireBtn(ui).click();
  assert.equal(ui.state().cash, 1000);
  assert.equal(ui.$('street-float-layer').children.length, 0);
});

test('launder calls launderCash once and reports returned clean cash and balances', () => {
  const ui = boot();
  let calls = 0;
  const original = ui.context.launderCash;
  ui.context.launderCash = (...args) => { calls++; return original(...args); };
  ui.state().suspicion = 42;
  $click(ui, 'street-launder-btn');
  assert.equal(calls, 1);
  assert.equal(ui.state().cash, 0);
  assert.equal(ui.state().launderedCash, 900);
  assert.equal(ui.state().suspicion, 42);
  assert.equal(ui.$('street-dirty-cash').textContent, '$0.00');
  assert.equal(ui.$('street-clean-cash').textContent, '$900.00');
  assert.match(sayings(ui), /\$900\.00 clean cash/);
  assert.match(sayings(ui), /Suspicion is unchanged/);
});

test('launder with zero dirty cash reports nothing to launder', () => {
  const ui = boot();
  ui.state().cash = 0;
  $click(ui, 'street-launder-btn');
  assert.match(sayings(ui), /No dirty cash/);
  assert.equal(ui.state().launderedCash, 0);
});

function $click(ui, id) { ui.$(id).click(); }

test('suspicion meter is clamped and exposes accessible values', () => {
  const ui = boot();
  const cases = [[0, '0%', '0'], [37.5, '37.5%', '37.5'], [100, '100%', '100'],
    [250, '100%', '100'], [-20, '0%', '0']];
  for (const [value, text, now] of cases) {
    ui.state().suspicion = value;
    ui.context.StreetUI.refresh();
    assert.equal(ui.$('street-suspicion-value').textContent, text);
    assert.equal(ui.$('street-suspicion-bar').getAttribute('aria-valuenow'), now);
    assert.equal(ui.$('street-suspicion-fill').style.width, now + '%');
  }
});

test('invalid or missing suspicion is safe and never panics', () => {
  const ui = boot();
  for (const bad of [undefined, null, NaN, 'abc', Infinity, {}]) {
    ui.state().suspicion = bad;
    ui.context.StreetUI.refresh();
    assert.equal(ui.$('street-suspicion-value').textContent, '--%');
    assert.equal(ui.$('street-suspicion-bar').getAttribute('aria-valuenow'), null);
    assert.equal(ui.$('street-panel').classList.contains('street-panic'), false);
  }
});

test('panic starts strictly above 80 and clears at 80, raids and presets', () => {
  const ui = boot();
  const panic = () => ui.$('street-panel').classList.contains('street-panic');
  for (const [value, expected] of [[79.5, false], [80, false], [80.5, true], [100, true], [80, false]]) {
    ui.state().suspicion = value;
    ui.context.StreetUI.refresh();
    assert.equal(panic(), expected, 'suspicion ' + value);
    assert.equal(ui.$('street-panic-warning').hidden, !expected);
  }
  ui.state().suspicion = 95;
  ui.context.StreetUI.refresh();
  assert.equal(panic(), true);
  ui.context.triggerRaid();
  ui.context.StreetUI.refresh();
  assert.equal(panic(), false);
  ui.state().suspicion = 95;
  ui.context.StreetUI.refresh();
  ui.context.loadJudgePreset('Mid');
  ui.context.StreetUI.refresh();
  assert.equal(panic(), false);
  assert.equal(ui.$('street-dirty-cash').textContent, '$25,000.00');
});

test('timer refresh follows engine ticks without advancing the engine', () => {
  const ui = boot();
  const [timer] = ui.refreshTimers();
  assert.ok(timer);
  ui.context.loadJudgePreset('Late');
  const ticks = ui.state().timeTicks;
  timer.fn();
  assert.equal(ui.$('street-suspicion-value').textContent, '75%');
  assert.equal(ui.$('street-dealer-count').textContent, '1');
  assert.equal(ui.state().timeTicks, ticks);
  assert.equal(ui.$('street-map-blips').children.length, 1);
});

test('refreshes do not replay floating results or touch engine state', () => {
  const ui = boot();
  hireBtn(ui).click();
  const node = ui.$('street-float-layer').children[0];
  const before = JSON.stringify(ui.state());
  for (let index = 0; index < 5; index++) ui.context.StreetUI.refresh();
  assert.equal(ui.$('street-float-layer').children.length, 1);
  assert.equal(ui.$('street-float-layer').children[0], node);
  assert.equal(JSON.stringify(ui.state()), before);
});

test('reloading the script does not duplicate handlers or refresh timers', () => {
  const ui = boot();
  ui.loadStreet();
  ui.loadStreet();
  assert.equal(ui.refreshTimers().length, 1);
  assert.equal(ui.$('street-hire-btn').listeners.click.length, 1);
  assert.equal(ui.$('street-launder-btn').listeners.click.length, 1);
  hireBtn(ui).click();
  assert.equal(ui.state().dealers.length, 1);
  ui.context.StreetUI.destroy();
  assert.equal(ui.refreshTimers().length, 0);
  assert.equal(ui.$('street-hire-btn').listeners.click.length, 0);
});

test('missing engine shows an unavailable state and disables controls without throwing', () => {
  const ui = boot({ withEngine: false });
  assert.equal(ui.$('street-unavailable').hidden, false);
  assert.equal(ui.$('street-hire-btn').disabled, true);
  assert.equal(ui.$('street-launder-btn').disabled, true);
  assert.equal(ui.$('street-suspicion-value').textContent, '--%');
  ui.$('street-hire-btn').fire('click');
  ui.$('street-launder-btn').fire('click');
  assert.match(sayings(ui), /Engine unavailable/);
});

test('init waits for DOMContentLoaded while the document is loading', () => {
  const ui = boot({ ready: 'loading' });
  assert.equal(ui.refreshTimers().length, 0);
  ui.docListeners.DOMContentLoaded();
  assert.equal(ui.refreshTimers().length, 1);
});

test('index.html wires scripts once, in order, with the required styling', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(scripts.filter(src => src === 'engine.js'), ['engine.js']);
  assert.ok(scripts.indexOf('engine.js') < scripts.indexOf('street-ui.js'));
  assert.match(html, /id="lab-panel"/);
  assert.match(html, /BURNER PHONE CALL \(\$500\)/);
  assert.match(html, />Launder Money</);
  assert.match(html, />Dispatch Map</);
  assert.match(html, /VT323/);
  assert.match(html, /#1a1a1a/);
  assert.match(html, /linear-gradient/);
  assert.match(html, /#street-suspicion-fill|street-meter-fill/);
  assert.match(html, /#ff003c/);
  assert.match(html, /box-shadow:[^;]*#ff003c/);
  assert.match(html, /@keyframes street-float-up[\s\S]*?translate\(-50%, -110px\)/);
  assert.match(html, /@keyframes street-panic-shake/);
  assert.match(html, /@keyframes street-panic-border/);
  assert.match(html, /#street-panel\.street-panic\s*\{[^}]*street-panic-shake[^}]*street-panic-border/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  for (const id of IDS) assert.match(html, new RegExp('id="' + id + '"'), id);
});

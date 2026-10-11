'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const html = read('index.html');
const SOURCES = ['engine.js', 'lab-ui.js', 'street-ui.js', 'main.js'];

const BUTTON_IDS = ['cook-start-btn', 'lab-buy-slot', 'street-hire-btn', 'street-launder-btn', 'street-bribe-btn', 'nav-lab', 'nav-street', 'music-btn', 'vacuum-btn', 'scorecard-dismiss'];
const IDS = ['game-viewport', 'lab-container', 'street-container', 'nav-lab', 'nav-street', 'music-btn', 'hud-inventory', 'hud-suspicion-fill', 'lab-panel', 'lab-scene', 'lab-engine-status', 'lab-compound', 'lab-compound-info',
  'lab-feedback', 'lab-production', 'lab-idle', 'lab-batches', 'lab-slots', 'lab-slots-count', 'lab-slots-state', 'street-panel', 'street-map-blips',
  'street-hire-btn', 'street-launder-btn', 'street-bribe-btn', 'street-float-layer', 'street-status', 'street-dirty-cash',
  'street-clean-cash', 'street-dealer-count', 'street-suspicion-bar', 'street-suspicion-fill',
  'street-suspicion-value', 'street-panic-warning', 'street-unavailable', 'hud', 'hud-cash',
  'hud-laundered', 'hud-suspicion', 'cook-start-btn', 'lab-buy-slot', 'cook-selection', 'cook-progress', 'cook-results',
  'dealer-roster', 'cash-float-layer', 'vacuum-btn', 'scorecard-modal', 'scorecard-title',
  'scorecard-status', 'scorecard-profit', 'scorecard-ticks', 'scorecard-dismiss', 'scorecard-quality', 'scorecard-reputation',
  'scorecard-evasion', 'inventory-tray', 'flawless-alert', 'flawless-reveal', 'flawless-video'];

// DOM double: the surface the four scripts use. Real engine, real UI scripts, fake clock.
class FakeElement {
  constructor(doc, id = '') {
    this.doc = doc;
    this.id = id;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.classes = new Set();
    this.style = {};
    this.textContent = '';
    this.className = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this.offsetWidth = 1;
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
  listenerCount() { return Object.values(this.listeners).reduce((n, list) => n + list.length, 0); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  querySelector() { return null; }
  focus() { if (!this.hidden && !this.disabled) this.doc.activeElement = this; }
  fire(name, event = {}) { for (const fn of [...(this.listeners[name] || [])]) fn(event); }
  click() { if (!this.disabled) this.fire('click'); }
  get text() { return [this.textContent, ...this.children.map(child => child.text)].join(' ').trim(); }
}

function boot({ random = () => 0.5, load = true, storage } = {}) {
  const doc = { activeElement: null, listeners: {} };
  const elements = {};
  for (const id of IDS) elements[id] = new FakeElement(doc, id);
  elements['scorecard-modal'].hidden = true;
  elements['vacuum-btn'].hidden = true;
  const layout = new FakeElement(doc, 'layout');
  const workflowButtons = ['Rapid', 'Standard', 'Precision'].map(name => {
    const button = new FakeElement(doc, `workflow-${name}`);
    button.setAttribute('data-workflow', name);
    return button;
  });
  Object.assign(doc, {
    readyState: 'complete',
    getElementById: id => elements[id] || null,
    createElement: () => new FakeElement(doc),
    querySelectorAll: selector => (selector === 'button' ? [...workflowButtons, ...BUTTON_IDS.map(id => elements[id])] : workflowButtons),
    querySelector: selector => (selector === '.arcade-layout' ? layout : null),
    addEventListener: FakeElement.prototype.addEventListener,
    removeEventListener: FakeElement.prototype.removeEventListener, fire: FakeElement.prototype.fire
  });

  const timers = new Map();
  let nextTimer = 1;
  let now = 0;
  const calls = { startCook: [], roll: 0, hire: [], launder: 0, tick: 0, completions: [], bgm: 0, stopBgm: 0, music: [], sirens: 0, static: 0 };
  const context = vm.createContext({
    module: { exports: {} },
    console: { log() {}, warn() {} },
    document: doc,
    ...(storage ? { localStorage: storage } : {}),
    setInterval: (fn, ms) => { timers.set(nextTimer, { fn, ms, at: now + ms, repeat: true }); return nextTimer++; },
    clearInterval: id => timers.delete(id),
    setTimeout: (fn, ms) => { timers.set(nextTimer, { fn, ms, at: now + ms, repeat: false }); return nextTimer++; },
    clearTimeout: id => timers.delete(id),
    playCookComplete(rare) { calls.completions.push(rare); },
    startBGM() { calls.bgm++; },
    stopBGM() { calls.stopBgm++; },
    setMusicEnabled(on) { calls.music.push(on); },
    playSiren() { calls.sirens++; },
    playStatic() { calls.static++; },
    playClick() { if (ctl.audio) ctl.audio(); clicks.count++; }
  });
  const math = Object.create(Math);
  math.random = () => ctl.random();
  context.Math = math;
  const ctl = { random, audio: null };
  const clicks = { count: 0 };

  const run = name => vm.runInContext(read(name), context, { filename: name });
  vm.runInContext(read('engine.js'), context, { filename: 'engine.js' });
  context.stopGameLoop(); // Engine ticks only when a test calls tick().
  context.setCompoundSetting('amber', 'potency', 1);
  context.setCompoundSetting('amber', 'yield', 8);
  context.setCompoundSetting('amber', 'baseMinutes', 10);
  context.setCompoundSetting('neon', 'potency', 2);
  context.setCompoundSetting('neon', 'yield', 16);
  context.setCompoundSetting('neon', 'baseMinutes', 10);
  for (const id of ['violet', 'ember', 'azure']) {
    context.setCompoundSetting(id, 'potency', 1);
    context.setCompoundSetting(id, 'yield', 8);
    context.setCompoundSetting(id, 'baseMinutes', 10);
  }
  // Spies sit on the globals the UI scripts read at call time.
  for (const [name, key] of [['startCook', 'startCook'], ['rollDealerGacha', 'roll'],
    ['hireDealer', 'hire'], ['launderCash', 'launder'], ['tick', 'tick']]) {
    const original = context[name];
    context[name] = (...args) => {
      if (key === 'roll' || key === 'launder' || key === 'tick') calls[key]++;
      else calls[key].push(args);
      return original(...args);
    };
  }
  if (load) for (const name of SOURCES.slice(1)) run(name);

  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      now = timer.at;
      if (timer.repeat) timer.at += timer.ms; else timers.delete(id);
      timer.fn();
    }
    now = end;
  };
  const ui = {
    context, elements, doc, clicks, timers, calls, run, advance, ctl, workflowButtons, layout,
    $: id => elements[id],
    state: () => context.playerState,
    // The engine api object bypasses the spy that counts UI-originated ticks.
    tick: (count = 1) => { for (let i = 0; i < count; i++) context.BreakingBadEngine.tick(); },
    simmer: seconds => {
      for (let i = 0; i < seconds; i++) {
        context.BreakingBadEngine.tick();
        advance(100);
      }
    },
    loop: () => [...timers.values()].filter(t => t.repeat && t.ms === 100),
    results: () => elements['cook-results'].children,
    roster: () => elements['dealer-roster'].children.map(item => item.text),
    modalOpen: () => !elements['scorecard-modal'].hidden,
    floats: () => elements['cash-float-layer'].children
  };
  return ui;
}

const start = ui => ui.$('cook-start-btn');
const feedback = ui => ui.$('lab-feedback');

test('index.html loads the engine once, main.js last, with every required hook', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(scripts.map(src => src.split('?')[0]), ['engine.js', 'audio.js', 'lab-ui.js', 'street-ui.js', 'main.js']);
  for (const id of IDS) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<button[^>]*id="cook-start-btn"[^>]*>Start Cook</);
  assert.match(html, /<button[^>]*id="lab-buy-slot"[^>]*>Add Lab Slot \(\$50,000\)</);
  assert.match(html, /<button[^>]*id="street-hire-btn"[^>]*>BURNER PHONE CALL \(\$500\)</);
  assert.match(html, /<button[^>]*id="street-launder-btn"[^>]*>Launder Money</);
  assert.match(html, /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="scorecard-title"/);
  assert.match(html, /<button[^>]*id="vacuum-btn"[^>]*hidden[^>]*>Call the Vacuum Repairman</);
  assert.match(html, /<div id="scorecard-modal"[^>]*hidden/);
  assert.match(html, /\.floating-text\s*\{[^}]*animation: floating-text-rise 1s/);
  assert.match(html, /@keyframes floating-text-rise[\s\S]*translate\(-50%, -40px\)/);
  assert.match(html, /repeating-linear-gradient/);
  assert.match(html, /\.neon-cyan-glow\s*\{/);
  assert.match(html, /animation: cook-fill 3s linear/);
  assert.match(html, /@keyframes cook-fill/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*cook-progress/);
});

test('Start Cook calls startCook once with the selected compound and workflow, then animates 3 s', () => {
  const ui = boot();
  assert.equal(start(ui).disabled, false);
  assert.match(ui.$('cook-selection').textContent, /Compound AM-01 · Standard/);
  ui.$('lab-compound').value = 'neon';
  ui.workflowButtons[2].click(); // selecting a workflow must not start a cook
  assert.equal(ui.calls.startCook.length, 0);
  start(ui).click();
  assert.deepEqual(ui.calls.startCook, [['neon', 'Precision']]);
  assert.equal(ui.state().activeBatches.length, 1);
  assert.equal(ui.$('cook-progress').getAttribute('data-state'), 'running');
  assert.match(feedback(ui).textContent, /Compound NE-02 · Precision cook started/);
  assert.equal(ui.state().cash, 1000 - ui.state().activeBatches[0].cost);
});

test('default workflow is Standard and Rapid/Precision buttons reflect the choice', () => {
  const ui = boot();
  start(ui).click();
  assert.deepEqual(ui.calls.startCook, [['amber', 'Standard']]);
  assert.deepEqual(ui.workflowButtons.map(b => b.getAttribute('aria-pressed')), ['false', 'true', 'false']);
});

test('animation end never marks an active batch finished', () => {
  const ui = boot();
  start(ui).click();
  ui.advance(3000);
  assert.equal(ui.$('cook-progress').getAttribute('data-state'), 'idle');
  assert.equal(ui.results().length, 0);
  assert.match(feedback(ui).textContent, /still cooking — 10 min left/);
  assert.equal(ui.state().activeBatches.length, 1);
  assert.equal(ui.$('lab-batches').children.length, 1); // true engine progress remains visible
});

test('rejected cooks show feedback and never animate', () => {
  const ui = boot();
  ui.state().cash = 1; // cannot afford the batch
  start(ui).click();
  assert.equal(ui.calls.startCook.length, 1);
  assert.equal(ui.state().activeBatches.length, 0);
  assert.equal(ui.$('cook-progress').getAttribute('data-state'), 'idle');
  assert.equal(feedback(ui).getAttribute('data-kind'), 'error');
  assert.match(feedback(ui).textContent, /rejected/);
  ui.advance(3500);
  assert.equal(ui.results().length, 0);

  ui.state().cash = 1000;
  ui.state().labEquipment = { basicLab: 1 };
  start(ui).click(); // accepted
  start(ui).click(); // occupied slot: rejected, original animation untouched
  assert.equal(ui.state().activeBatches.length, 1);
  assert.match(feedback(ui).textContent, /rejected/);
});

test('an engine exception is contained', () => {
  const ui = boot();
  ui.context.startCook = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => start(ui).click());
  assert.match(feedback(ui).textContent, /Engine error/);
  assert.equal(ui.$('cook-progress').getAttribute('data-state'), 'idle');
});

test('a real completion reports once, with its engine quality and no glow for Standard', () => {
  const ui = boot({ random: () => 0.5 });
  ui.workflowButtons[0].click(); // Rapid amber: 5 min, 6 units
  start(ui).click();
  ui.advance(3000);
  ui.simmer(299);
  assert.equal(ui.results().length, 0, 'still one tick short');
  ui.simmer(1);
  ui.advance(2000);
  assert.equal(ui.results().length, 1);
  assert.match(feedback(ui).textContent, /Compound AM-01 · Rapid finished\./);
  const [result] = ui.results();
  assert.match(result.textContent, /Compound AM-01 · Rapid complete — 6 units, Standard/);
  assert.equal(result.className.includes('neon-cyan-glow'), false);
  assert.equal(ui.state().inventory.amber, 6);
  assert.equal(ui.calls.tick, 0, 'main.js never ticks the engine');
  assert.deepEqual(ui.calls.completions, [false]);
});

test('Flawless Blue results get .neon-cyan-glow; normal results beside them do not', () => {
  const ui = boot({ random: () => 0.01 }); // below flawlessChance
  ui.state().labEquipment = { basicLab: 2 };
  start(ui).click();
  ui.simmer(600);
  assert.equal(ui.results().length, 1);
  assert.equal(ui.state().completedBatches[0].quality, 'Flawless Blue');
  assert.match(ui.results()[0].className, /\bneon-cyan-glow\b/);

  ui.ctl.random = () => 0.9;
  start(ui).click();
  ui.simmer(600);
  assert.equal(ui.results().length, 2);
  assert.equal(ui.results()[0].className.includes('neon-cyan-glow'), false); // newest first
  assert.match(ui.results()[1].className, /neon-cyan-glow/);
  ui.advance(2000);
  assert.deepEqual(ui.calls.completions, [true, false], 'rare voice is requested exactly once, then a normal chime');
});

test('lab scene pulses on true completion only, then clears; rejected starts and resets do not', () => {
  const ui = boot({ random: () => 0.5 });
  const scene = ui.$('lab-scene');
  ui.state().cash = 1;
  start(ui).click(); // rejected
  assert.equal(scene.getAttribute('data-complete'), null);
  ui.state().cash = 1000;
  ui.workflowButtons[0].click();
  start(ui).click();
  ui.advance(3500);
  assert.equal(scene.getAttribute('data-complete'), null, 'start presentation is not a completion');
  ui.simmer(300);
  ui.advance(500);
  assert.notEqual(scene.getAttribute('data-complete'), null);
  assert.equal(scene.getAttribute('data-flawless'), 'false');
  ui.advance(2000);
  assert.equal(scene.getAttribute('data-complete'), null, 'effect clears');
  start(ui).click();
  ui.state().activeBatches = []; // removed without a lot
  ui.advance(1000);
  assert.equal(scene.getAttribute('data-complete'), null, 'removal is not a completion');
});

test('concurrent batches each report their own result once', () => {
  const ui = boot();
  ui.state().labEquipment = { basicLab: 2 };
  ui.state().cash = 10000;
  start(ui).click();
  ui.$('lab-compound').value = 'neon';
  ui.workflowButtons[0].click();
  start(ui).click();
  assert.equal(ui.state().activeBatches.length, 2);
  ui.simmer(600); // amber Standard (10 min) and neon Rapid (5 min) both finished
  assert.equal(ui.results().length, 2);
  const names = ui.results().map(item => item.textContent);
  assert.ok(names.some(text => /Compound AM-01 · Standard complete/.test(text)));
  assert.ok(names.some(text => /Compound NE-02 · Rapid complete/.test(text)));
});

test('old stock never produces a result for a new cook', () => {
  const ui = boot();
  ui.state().completedBatches.push({ id: 99, compoundId: 'amber', quantity: 5, quality: 'Flawless Blue',
    valueMultiplier: 10, unitPrice: 25, dealerId: null });
  ui.state().inventory.amber = 5;
  start(ui).click();
  ui.advance(3000);
  assert.equal(ui.results().length, 0);
});

test('hiring below $500 neither rolls, hires nor charges', () => {
  const ui = boot();
  ui.state().cash = 499.99;
  ui.$('street-hire-btn').click();
  assert.equal(ui.calls.roll, 0);
  assert.equal(ui.calls.hire.length, 0);
  assert.equal(ui.state().cash, 499.99);
  assert.deepEqual(ui.roster(), ['No dealers hired yet.']);
  assert.match(ui.$('street-status').textContent, /Insufficient funds/);
});

test('a funded hire rolls once, hires once, charges $500 once and names the dealer', () => {
  const cases = [[0.1, 'Street Hustler', 'Common'], [0.8, 'Middle-Man', 'Rare'], [0.99, 'Cartel Distributor', 'Legendary']];
  for (const [roll, name, tier] of cases) {
    const ui = boot({ random: () => roll });
    ui.$('street-hire-btn').click();
    ui.advance(100);
    assert.equal(ui.calls.roll, 1);
    assert.deepEqual(ui.calls.hire, [[tier]]);
    assert.equal(ui.state().cash, 500);
    assert.equal(ui.state().dealers.length, 1);
    assert.equal(ui.roster().length, 1);
    assert.match(ui.roster()[0], new RegExp(`^${name} ${tier} · #1 ${{ Common: 100, Rare: 300, Legendary: 1000 }[tier]}/${{ Common: 100, Rare: 300, Legendary: 1000 }[tier]} units$`));
    assert.equal(ui.$('street-dealer-count').textContent, '1'); // existing street count preserved
    assert.equal(ui.$('street-map-blips').children.length, 1); // and the map blip
  }
});

test('roster follows engine state without duplicating entries (hires and Judge Mode)', () => {
  const ui = boot({ random: () => 0.1 });
  ui.$('street-hire-btn').click();
  ui.$('street-hire-btn').click();
  ui.advance(500);
  ui.advance(500);
  assert.equal(ui.roster().length, 2);
  ui.context.loadJudgePreset('Late');
  ui.advance(100);
  assert.equal(ui.roster().length, 1);
  assert.match(ui.roster()[0], /Cartel Distributor Legendary · #1/);
  ui.context.loadJudgePreset('Early');
  ui.advance(100);
  assert.deepEqual(ui.roster(), ['No dealers hired yet.']);
});

test('Launder Money delegates once to launderCash and the HUD follows', () => {
  const ui = boot();
  ui.$('street-launder-btn').click();
  assert.equal(ui.calls.launder, 1);
  assert.equal(ui.state().cash, 0);
  assert.equal(ui.state().launderedCash, 900);
  ui.advance(100);
  assert.equal(ui.$('hud-cash').textContent, '$0.00');
  assert.equal(ui.$('hud-laundered').textContent, '$900.00');
  assert.equal(ui.modalOpen(), false, 'cash reaching zero is not a raid');
});

test('the render loop mirrors Cash, Laundered and Suspicion, including presets', () => {
  const ui = boot();
  assert.equal(ui.$('hud-cash').textContent, '$1,000.00');
  assert.equal(ui.$('hud-suspicion').textContent, '0%');
  ui.state().suspicion = 42.5;
  ui.advance(100);
  assert.equal(ui.$('hud-suspicion').textContent, '42.5%');
  assert.equal(ui.$('hud').getAttribute('data-panic'), 'false');
  ui.context.loadJudgePreset('Mid');
  ui.advance(100);
  assert.equal(ui.$('hud-cash').textContent, '$25,000.00');
  assert.equal(ui.$('hud-laundered').textContent, '$10,000.00');
  assert.equal(ui.$('hud-suspicion').textContent, '35%');
  ui.state().suspicion = 81;
  ui.advance(100);
  assert.equal(ui.$('hud').getAttribute('data-panic'), 'true');
  assert.equal(ui.calls.tick, 0);
});

test('a rising raidCount ends the run as BUSTED with the post-seizure scorecard', () => {
  const ui = boot();
  const opener = ui.$('lab-compound');
  opener.focus();
  start(ui).click();
  ui.advance(500);
  ui.state().completedBatches.push({ id: 50, compoundId: 'neon', quantity: 12, quality: 'Standard',
    valueMultiplier: 1, unitPrice: 50, dealerId: null });
  ui.state().launderedCash = 700;
  ui.state().timeTicks = 8;
  ui.context.hireDealer('Rare');
  let stops = 0;
  const stop = ui.context.stopGameLoop;
  ui.context.stopGameLoop = () => { stops++; return stop(); };
  ui.context.triggerRaid();
  ui.advance(100);
  assert.equal(ui.modalOpen(), true);
  assert.equal(stops, 1);
  assert.equal(ui.$('scorecard-status').textContent, 'Final Status: BUSTED');
  assert.equal(ui.$('scorecard-profit').textContent, 'Total Net Profit: $700.00'); // cash seized
  assert.equal(ui.$('scorecard-ticks').textContent, 'Total Ticks Survived: 8');
  assert.equal(ui.$('scorecard-quality').textContent, 'Scientific Quality Index: 74% (STREET GRADE)');
  assert.equal(ui.$('scorecard-reputation').textContent, 'Reputation Score: 16');
  assert.equal(ui.$('scorecard-evasion').textContent, 'Legal Evasion Rating: 100%'); // the raid zeroes suspicion
  assert.equal(ui.$('cook-progress').getAttribute('data-state'), 'idle');
  assert.equal(ui.results().length, 0);
  assert.equal(ui.doc.activeElement, ui.$('scorecard-dismiss'));
  assert.equal(ui.layout.inert, true);
  ui.advance(3000); // the canceled cook's animation timer must not announce anything
  assert.equal(feedback(ui).textContent, '');

  // Frozen: later engine changes never reach the scorecard.
  ui.state().cash = 5000;
  ui.state().launderedCash = 9;
  ui.state().timeTicks = 99;
  ui.context.triggerRaid();
  ui.advance(500);
  assert.equal(ui.$('scorecard-profit').textContent, 'Total Net Profit: $700.00');
  assert.equal(ui.$('scorecard-ticks').textContent, 'Total Ticks Survived: 8');
  assert.equal(stops, 1, 'the second raid does not end the run again');

  ui.$('scorecard-dismiss').click();
  assert.equal(ui.modalOpen(), false);
  assert.equal(ui.layout.inert, true, 'dismissal does not resume the ended run');
  assert.equal(ui.doc.activeElement, opener, 'focus returns to the previous control');
  assert.equal(ui.$('vacuum-btn').hidden, true);
});

test('Add Lab Slot prices the second, third, and fourth slots and rejects a short purchase', () => {
  const ui = boot();
  const buy = ui.$('lab-buy-slot');
  assert.equal(buy.disabled, false);
  assert.equal(buy.textContent, 'Add Lab Slot ($50,000)');
  assert.equal(buy.listenerCount(), 2);
  buy.click();
  assert.equal(ui.state().cash, 1000);
  assert.equal(ui.state().labEquipment.basicLab, 3);
  assert.match(feedback(ui).textContent, /Not enough cash for a lab slot \(\$50,000\)/);
  ui.state().cash = 50000;
  buy.click();
  ui.advance(250);
  assert.equal(ui.state().cash, 0);
  assert.equal(ui.state().labEquipment.basicLab, 4);
  assert.deepEqual(
    [ui.$('lab-slots-count').textContent, ui.$('lab-slots-state').textContent],
    ['0/4 occupied · 4 available', 'Slot available']
  );
  assert.match(feedback(ui).textContent, /Lab slot added\. 4 total\./);
  assert.equal(buy.disabled, true);
  assert.equal(buy.textContent, 'Add Lab Slot');
  ui.state().labEquipment = { basicLab: 1 };
  ui.state().cash = 5000;
  ui.advance(250);
  assert.equal(buy.textContent, 'Add Lab Slot ($5,000)');
  buy.click();
  assert.equal(ui.state().labEquipment.basicLab, 2);
  assert.equal(ui.state().cash, 0);
  assert.equal(buy.textContent, 'Add Lab Slot ($30,000)');
});

test('Escape closes the scorecard and Tab stays inside it', () => {
  const ui = boot();
  ui.context.triggerRaid();
  ui.advance(100);
  let prevented = 0;
  ui.$('scorecard-modal').fire('keydown', { key: 'Tab', preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.equal(ui.doc.activeElement, ui.$('scorecard-dismiss'));
  ui.$('scorecard-modal').fire('keydown', { key: 'a', preventDefault: () => prevented++ });
  assert.equal(ui.modalOpen(), true);
  ui.$('scorecard-modal').fire('keydown', { key: 'Escape', preventDefault: () => prevented++ });
  assert.equal(ui.modalOpen(), false);
});

test('Lab Slots follow Start Cook, completion, raids and Judge Mode on the existing refresh loop', () => {
  const ui = boot();
  const text = () => [ui.$('lab-slots-count').textContent, ui.$('lab-slots-state').textContent];
  assert.deepEqual(text(), ['0/3 occupied · 3 available', 'Slot available']);
  ui.workflowButtons[0].click();
  start(ui).click();
  ui.advance(250);
  assert.deepEqual(text(), ['1/3 occupied · 2 available', 'Slot available']);
  ui.workflowButtons[1].click();
  start(ui).click();
  ui.advance(250);
  assert.deepEqual(text(), ['2/3 occupied · 1 available', 'Slot available']);
  start(ui).click();
  ui.advance(250);
  assert.deepEqual(text(), ['3/3 occupied · 0 available', 'Lab full']);
  const fullCash = ui.state().cash;
  start(ui).click();
  ui.advance(250);
  assert.equal(ui.state().activeBatches.length, 3);
  assert.equal(ui.state().cash, fullCash);
  assert.deepEqual(text(), ['3/3 occupied · 0 available', 'Lab full']);
  ui.tick(300);
  ui.advance(250);
  assert.equal(ui.state().activeBatches.length, 2);
  assert.deepEqual(text(), ['2/3 occupied · 1 available', 'Slot available']);
  start(ui).click();
  ui.context.triggerRaid();
  ui.advance(250);
  assert.deepEqual(text(), ['0/0 occupied · 0 available', 'No lab equipment']);
  assert.equal(ui.$('lab-slots').getAttribute('data-state'), 'none');
  ui.$('scorecard-dismiss').click();
  assert.deepEqual(text(), ['0/0 occupied · 0 available', 'No lab equipment']);
  ui.context.loadJudgePreset('Mid');
  ui.advance(250);
  assert.deepEqual(text(), ['0/3 occupied · 3 available', 'Slot available']);
  ui.context.loadJudgePreset('Late');
  ui.advance(250);
  assert.deepEqual(text(), ['0/4 occupied · 4 available', 'Slot available']);
  ui.context.loadJudgePreset('Early');
  ui.advance(250);
  assert.deepEqual(text(), ['0/3 occupied · 3 available', 'Slot available']);
  const timers = ui.timers.size;
  ui.run('lab-ui.js'); // reinitialization replaces, never duplicates, the refresh timer
  assert.equal(ui.timers.size, timers);
});

test('initial load and Judge Mode resets never end the run', () => {
  const ui = boot();
  assert.equal(ui.modalOpen(), false);
  ui.context.loadJudgePreset('Early');
  ui.advance(100);
  ui.context.loadJudgePreset('Late');
  ui.advance(100);
  assert.equal(ui.modalOpen(), false);
  assert.equal(ui.floats().length, 0, 'presets are not earnings');

  // Loading main.js into a state that already carries raids is a baseline, not an alert.
  const late = boot({ load: false });
  late.context.triggerRaid();
  for (const name of SOURCES.slice(1)) late.run(name);
  assert.equal(late.modalOpen(), false);
});

test('a positive cash change on an engine tick floats +$X once, then removes it after 1 s', () => {
  const ui = boot();
  ui.advance(100);
  assert.equal(ui.floats().length, 0, 'initial load');
  ui.state().cash += 250; // earnings on a tick
  ui.state().timeTicks++;
  ui.advance(100);
  ui.advance(300); // the faster render loop sees the same tick again
  assert.equal(ui.floats().length, 1);
  assert.equal(ui.floats()[0].className, 'floating-text');
  assert.equal(ui.floats()[0].textContent, '+$250.00');
  ui.advance(1000);
  assert.equal(ui.floats().length, 0);
  // Zero and negative changes, and cash gained without a tick, show nothing.
  ui.state().timeTicks++;
  ui.advance(100);
  ui.state().cash -= 100;
  ui.state().timeTicks++;
  ui.advance(100);
  ui.state().cash += 100;
  ui.advance(100);
  assert.equal(ui.floats().length, 0);
});

test('a purchase between frames does not hide a tick\'s earnings', () => {
  const ui = boot();
  ui.advance(100);
  ui.$('street-hire-btn').click(); // -$500 right before the tick
  ui.state().cash += 200;
  ui.state().timeTicks++;
  ui.advance(100);
  assert.equal(ui.floats().length, 1);
  assert.equal(ui.floats()[0].textContent, '+$200.00');
});

test('Vacuum button: hidden below $1,000,000 laundered, glowing at exactly $1,000,000', () => {
  const ui = boot();
  const vacuum = ui.$('vacuum-btn');
  assert.equal(vacuum.hidden, true);
  ui.state().launderedCash = 999999.99;
  ui.advance(100);
  assert.equal(vacuum.hidden, true);
  assert.equal(vacuum.click(), undefined);
  assert.equal(ui.modalOpen(), false);
  ui.state().launderedCash = 1000000;
  ui.advance(100);
  assert.equal(vacuum.hidden, false);
  assert.equal(vacuum.classes.has('neon-cyan-glow'), true);
  assert.equal(ui.modalOpen(), false, 'eligibility alone does not end the run');
  ui.state().launderedCash = 1500000;
  ui.advance(100);
  assert.equal(vacuum.hidden, false);
});

test('clicking Vacuum stops the engine loop and shows a frozen ESCAPED scorecard', () => {
  const ui = boot();
  Object.assign(ui.state(), { cash: 1234.5, launderedCash: 1000000, timeTicks: 77 });
  ui.advance(100);
  let stops = 0;
  const stop = ui.context.stopGameLoop;
  ui.context.stopGameLoop = () => { stops++; return stop(); };
  ui.$('vacuum-btn').click();
  assert.equal(stops, 1);
  assert.equal(ui.modalOpen(), true);
  assert.equal(ui.$('scorecard-status').textContent, 'Final Status: ESCAPED');
  assert.equal(ui.$('scorecard-profit').textContent, 'Total Net Profit: $1,001,234.50');
  assert.equal(ui.$('scorecard-ticks').textContent, 'Total Ticks Survived: 77');
  assert.equal(ui.layout.inert, true);
  assert.equal(ui.$('vacuum-btn').disabled, true);
  ui.state().cash = 0;
  ui.state().timeTicks = 500;
  ui.advance(500);
  assert.equal(ui.$('scorecard-profit').textContent, 'Total Net Profit: $1,001,234.50');
  assert.equal(ui.$('scorecard-ticks').textContent, 'Total Ticks Survived: 77');
  assert.equal(ui.calls.tick, 0, 'no extra tick source');
  assert.equal(ui.loop().length, 1, 'no second interval');
});

test('every button plays the click sound once and keeps its single gameplay action', () => {
  const ui = boot();
  start(ui).click();
  assert.equal(ui.clicks.count, 1);
  assert.equal(ui.calls.startCook.length, 1);
  ui.$('street-hire-btn').click();
  ui.$('street-launder-btn').click();
  ui.workflowButtons[0].click();
  assert.equal(ui.clicks.count, 4);
  assert.equal(ui.calls.roll, 1);
  assert.equal(ui.calls.launder, 1);
  ui.state().launderedCash = 1000000;
  ui.advance(100);
  ui.$('vacuum-btn').click();
  assert.equal(ui.clicks.count, 5);
  ui.$('scorecard-dismiss').click();
  assert.equal(ui.clicks.count, 6);
  start(ui).disabled = true;
  start(ui).click();
  assert.equal(ui.clicks.count, 6, 'disabled buttons do not activate');
});

test('missing or throwing audio never breaks a button', () => {
  const ui = boot();
  ui.context.playClick = undefined;
  start(ui).click();
  assert.equal(ui.calls.startCook.length, 1);
  const broken = boot();
  broken.ctl.audio = () => { throw new Error('no audio'); };
  start(broken).click();
  assert.equal(broken.calls.startCook.length, 1);
});

test('a purchase or laundering that empties cash is not a raid', () => {
  const ui = boot();
  ui.$('street-launder-btn').click();
  start(ui).click(); // rejected: no cash
  ui.advance(500);
  assert.equal(ui.state().cash, 0);
  assert.equal(ui.modalOpen(), false);
});

test('Judge Mode resets leave no stale cook animation or result', () => {
  const ui = boot();
  ui.workflowButtons[0].click();
  start(ui).click(); // amber Rapid, batch id 1 (neon lot id 1 exists in the Mid preset)
  ui.context.loadJudgePreset('Mid');
  ui.advance(100);
  assert.equal(ui.results().length, 0, 'a preset lot with the same id is not this batch');
  assert.equal(ui.$('cook-progress').getAttribute('data-state'), 'idle');
  ui.advance(3000);
  assert.equal(feedback(ui).textContent, '');
});

test('reinitialization keeps one handler, one loop and one engine call per click', () => {
  const ui = boot({ random: () => 0.1 });
  ui.run('main.js');
  ui.run('main.js');
  ui.context.ArcadeMain.init();
  assert.equal(ui.loop().length, 1);
  assert.equal(start(ui).listenerCount(), 2); // Start Cook + click sound
  assert.equal(ui.$('vacuum-btn').listenerCount(), 2);
  assert.equal(ui.$('scorecard-dismiss').listenerCount(), 2);
  assert.equal(ui.$('scorecard-modal').listenerCount(), 1);
  assert.equal(ui.$('street-hire-btn').listenerCount(), 2);
  assert.equal(ui.$('street-launder-btn').listenerCount(), 2);
  start(ui).click();
  assert.equal(ui.calls.startCook.length, 1);
  assert.equal(ui.state().activeBatches.length, 1);
  ui.$('street-hire-btn').click();
  assert.equal(ui.state().dealers.length, 1);
  assert.equal(ui.state().cash, 1000 - ui.state().activeBatches[0].cost - 500);
  assert.equal(ui.roster().length, 1);
  ui.context.ArcadeMain.destroy();
  assert.equal(ui.loop().length, 0);
  assert.equal(start(ui).listenerCount(), 0);
  assert.equal([...ui.timers.values()].filter(t => t.ms === 3000).length, 0);
});

test('without the engine the cook control stays locked and does not throw', () => {
  const ui = boot();
  ui.context.startCook = undefined;
  ui.advance(100);
  assert.equal(start(ui).disabled, true);
  ui.$('lab-compound').value = '';
  assert.doesNotThrow(() => ui.context.ArcadeMain.frame());
});


test('audio begins on interaction and the warning follows suspicion', () => {
  const ui = boot();
  assert.equal(ui.calls.bgm, 0);
  ui.state().suspicion = 85;
  ui.advance(100);
  assert.equal(ui.calls.sirens, 0, 'no audio before user interaction');
  ui.$('street-launder-btn').click();
  assert.equal(ui.calls.bgm, 1);
  ui.advance(100);
  assert.equal(ui.calls.sirens, 1);
  ui.state().suspicion = 20;
  ui.advance(100);
  assert.equal(ui.calls.sirens, 1, 'warning no longer requested');
});


test('the HUD music button toggles only the music and starts enabled', () => {
  const ui = boot();
  const music = ui.$('music-btn');
  assert.match(html, /<button[^>]*id="music-btn"[^>]*aria-pressed="true"[^>]*>Music: On</);
  assert.deepEqual(ui.calls.music, [true], 'a fresh page enables music');
  assert.equal(music.textContent, 'Music: On');
  assert.equal(music.getAttribute('aria-pressed'), 'true');
  music.click();
  assert.deepEqual(ui.calls.music, [true, false]);
  assert.equal(music.textContent, 'Music: Off');
  assert.equal(music.getAttribute('aria-pressed'), 'false');
  ui.state().suspicion = 85;
  ui.advance(100);
  ui.$('street-launder-btn').click(); // Gameplay actions never undo the mute.
  ui.advance(200);
  assert.deepEqual(ui.calls.music, [true, false]);
  assert.equal(music.textContent, 'Music: Off');
  assert.ok(ui.calls.sirens > 0, 'effects still play while muted');
  music.click();
  assert.deepEqual(ui.calls.music, [true, false, true]);
  assert.equal(music.textContent, 'Music: On');
});

test('a muted run and teardown never restart music; destroy resets the toggle', () => {
  const ui = boot();
  ui.$('music-btn').click();
  const before = ui.calls.stopBgm;
  ui.context.BreakingBadEngine.triggerRaid();
  ui.advance(100);
  assert.equal(ui.modalOpen(), true);
  assert.equal(ui.calls.stopBgm, before + 1, 'the ended run stops the music');
  const stops = ui.calls.stopBgm;
  const toggles = ui.calls.music.length;
  ui.$('music-btn').click(); // The toggle itself is inert behind the scorecard.
  assert.equal(ui.calls.bgm, 1, 'an ended run never requests music again');
  assert.equal(ui.calls.music.length, toggles + 1);
  ui.context.ArcadeMain.destroy();
  assert.ok(ui.calls.stopBgm > stops);
});

test('a real raid plays static once after interaction', () => {
  const ui = boot();
  ui.workflowButtons[1].click();
  ui.context.BreakingBadEngine.triggerRaid();
  ui.advance(100);
  assert.equal(ui.modalOpen(), true);
  assert.equal(ui.calls.static, 1);
  ui.advance(2000);
  assert.equal(ui.calls.static, 1);
});


test('U instantly grants selected Flawless Blue inventory and requests its voice once', () => {
  const ui = boot();
  const before = ui.state().cash;
  ui.doc.fire('keydown', { key: 'u', preventDefault() {} });
  assert.equal(ui.state().inventory.amber, 8);
  assert.equal(ui.state().completedBatches[0].quality, 'Flawless Blue');
  assert.equal(ui.state().cash, before);
  assert.equal(ui.state().activeBatches.length, 0);
  assert.deepEqual(ui.calls.completions, [true]);
  assert.match(ui.results()[0].textContent, /Flawless Blue/);
  assert.doesNotMatch(ui.results()[0].textContent, /U bonus/);
  ui.advance(1000);
  assert.deepEqual(ui.calls.completions, [true]);
  ui.doc.fire('keydown', { key: 'U' });
  assert.equal(ui.state().inventory.amber, 16);
});

test('U ignores typing, composition, modifiers, repeats and ended games; teardown removes it', () => {
  const ui = boot();
  for (const extra of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    { target: { isContentEditable: true } }, { target: { closest: () => ({}) } }]) {
    ui.doc.fire('keydown', { key: 'u', ...extra });
  }
  assert.equal(ui.state().completedBatches.length, 0);
  ui.state().launderedCash = 1000000;
  ui.advance(100);
  ui.$('vacuum-btn').click();
  ui.doc.fire('keydown', { key: 'u' });
  assert.equal(ui.state().completedBatches.length, 0);
  ui.context.ArcadeMain.destroy();
  assert.equal(ui.doc.listeners.keydown.length, 0);
});


test('8 grants $1,000,000 dirty cash per separate press and respects guards', () => {
  const ui = boot();
  ui.state().cash = 1000;
  const before = JSON.stringify([ui.state().launderedCash, ui.state().inventory, ui.state().suspicion, ui.state().timeTicks]);
  ui.doc.fire('keydown', { key: '8', code: 'Digit8' });
  assert.equal(ui.state().cash, 1001000);
  assert.match(ui.$('hud-cash').textContent, /1,001,000/);
  assert.match(ui.$('street-dirty-cash').textContent, /1,001,000/);
  ui.doc.fire('keydown', { key: '8', repeat: true });
  for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true },
    { target: { isContentEditable: true } }, { target: { closest: () => ({}) } }]) {
    ui.doc.fire('keydown', { key: '8', ...extra });
  }
  assert.equal(ui.state().cash, 1001000);
  ui.doc.fire('keydown', { key: '8' });
  assert.equal(ui.state().cash, 2001000);
  assert.equal(JSON.stringify([ui.state().launderedCash, ui.state().inventory, ui.state().suspicion, ui.state().timeTicks]), before);
  ui.state().launderedCash = 1000000;
  ui.advance(100);
  ui.$('vacuum-btn').click();
  const cash = ui.state().cash;
  ui.doc.fire('keydown', { key: '8' });
  assert.equal(ui.state().cash, cash);
});

test('U works with the compound selector focused and with a non-English key value', () => {
  const ui = boot();
  ui.doc.fire('keydown', { key: 'u', code: 'KeyU', target: {
    closest: selector => selector.includes('select') ? {} : null
  }});
  assert.equal(ui.state().inventory.amber, 8);
  ui.doc.fire('keydown', { key: 'ㄧ', code: 'KeyU' });
  assert.equal(ui.state().inventory.amber, 16);
  assert.deepEqual(ui.calls.completions, [true, true]);
  assert.doesNotMatch(html, /lab-shortcut|Press <kbd>U/);
});

test('a successful escape clears saved money; an ineligible attempt and a raid-free run do not write it', () => {
  const data = new Map();
  const storage = { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
  const ui = boot({ storage });
  data.set('blueSkyLegacyFunds', '90');
  ui.state().cash = 50;
  ui.state().launderedCash = 10;
  ui.advance(100);
  ui.$('vacuum-btn').click();
  assert.equal(data.get('blueSkyLegacyFunds'), '90');
  ui.state().launderedCash = 1000000.25;
  ui.advance(100);
  ui.$('vacuum-btn').click();
  assert.equal(data.has('blueSkyLegacyFunds'), false);
  assert.equal(ui.$('scorecard-status').textContent, 'Final Status: ESCAPED');
  assert.equal(ui.$('scorecard-profit').textContent, 'Total Net Profit: $1,000,050.25');
  assert.equal(ui.state().launderedCash, 1000000.25);
  assert.equal(ui.state().cash, 50);
  const next = boot({ storage, load: false });
  assert.equal(next.state().launderedCash, 0);
  assert.equal(next.state().cash, 1000);
});

test('an escape still completes when storage throws', () => {
  const fail = () => { throw new Error('blocked'); };
  const ui = boot({ storage: { getItem: fail, setItem: fail, removeItem: fail } });
  ui.state().launderedCash = 1000000;
  ui.advance(100);
  ui.$('vacuum-btn').click();
  assert.equal(ui.$('scorecard-status').textContent, 'Final Status: ESCAPED');
});

test('Bribe Informant delegates to bribeDEA with one click sound and refreshes the HUD', () => {
  const ui = boot();
  Object.assign(ui.state(), { cash: 3000, suspicion: 40 });
  const before = ui.clicks.count;
  ui.$('street-bribe-btn').click();
  assert.equal(ui.clicks.count, before + 1);
  assert.equal(ui.state().cash, 2000);
  assert.equal(ui.state().suspicion, 15);
  Object.assign(ui.state(), { cash: 999 });
  ui.$('street-bribe-btn').click();
  assert.equal(ui.state().cash, 999);
  assert.equal(ui.state().suspicion, 15);
});

test('switchView toggles .hidden between the Lab and the Streets without touching game state or timers', () => {
  const ui = boot();
  const lab = ui.$('lab-container');
  const street = ui.$('street-container');
  assert.equal(lab.classList.contains('hidden'), false, 'opens in the Lab');
  assert.equal(ui.$('nav-lab').getAttribute('aria-pressed'), 'true');
  const listeners = BUTTON_IDS.map(id => ui.$(id).listenerCount());
  start(ui).click();
  ui.$('nav-street').click();
  assert.equal(lab.classList.contains('hidden'), true);
  assert.equal(street.classList.contains('hidden'), false);
  assert.equal(ui.$('nav-street').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.$('game-viewport').getAttribute('data-view'), 'street');
  assert.equal(ui.state().activeBatches.length, 1, 'the cook keeps running');
  for (let n = 0; n < 5000 && ui.state().activeBatches.length; n++) { ui.tick(1); ui.advance(100); }
  ui.advance(500);
  assert.match(ui.results()[0].textContent, /complete/, 'results still arrive while hidden');
  ui.$('nav-lab').click();
  assert.equal(lab.classList.contains('hidden'), false);
  assert.equal(street.classList.contains('hidden'), true);
  assert.equal(ui.loop().length, 1, 'still exactly one render loop');
  assert.deepEqual(BUTTON_IDS.map(id => ui.$(id).listenerCount()), listeners, 'no extra handlers');
  assert.equal(ui.context.switchView('nowhere'), false);
  assert.equal(ui.context.switchView('streets'), true);
  assert.equal(street.classList.contains('hidden'), false);
});

test('the HUD inventory sums every compound and keeps updating from either screen', () => {
  const ui = boot();
  assert.equal(ui.$('hud-inventory').textContent, '0');
  ui.context.loadJudgePreset('Late');
  ui.advance(100);
  assert.equal(ui.$('hud-inventory').textContent, '68');
  ui.$('nav-street').click();
  ui.tick(1); // the Legendary dealer sells 4 units while the Streets are visible
  ui.advance(100);
  assert.equal(ui.$('hud-inventory').textContent, '64');
  ui.$('nav-lab').click();
  ui.tick(1);
  ui.advance(100);
  assert.equal(ui.$('hud-inventory').textContent, '60');
});

test('the Bribe button shows the escalating cost and each activation charges once', () => {
  const ui = boot();
  const button = ui.$('street-bribe-btn');
  Object.assign(ui.state(), { cash: 10000, suspicion: 80 });
  ui.advance(100);
  assert.equal(button.textContent, 'Bribe Informant ($1,000)');
  const costs = [];
  for (let i = 0; i < 3; i++) {
    const before = ui.clicks.count;
    button.click();
    assert.equal(ui.clicks.count, before + 1);
    costs.push([ui.state().cash, ui.state().suspicion, button.textContent]);
  }
  assert.deepEqual(costs, [
    [9000, 55, 'Bribe Informant ($2,000)'], [7000, 30, 'Bribe Informant ($4,000)'], [3000, 5, 'Bribe Informant ($8,000)']]);
  assert.equal(button.getAttribute('data-affordable'), 'false');
  button.click();
  assert.deepEqual([ui.state().cash, ui.state().suspicion, ui.state().bribeCost], [3000, 5, 8000]);
});

test('panic-mode follows suspicion strictly above 80 on the shared viewport', () => {
  const ui = boot();
  const viewport = ui.$('game-viewport');
  ui.state().suspicion = 80;
  ui.advance(100);
  assert.equal(viewport.classList.contains('panic-mode'), false);
  assert.equal(ui.$('hud').getAttribute('data-panic'), 'false');
  ui.state().suspicion = 80.5;
  ui.advance(100);
  assert.equal(viewport.classList.contains('panic-mode'), true);
  assert.equal(ui.$('hud').getAttribute('data-panic'), 'true');
  assert.equal(ui.$('hud-suspicion-fill').style.width, '80.5%');
  ui.state().suspicion = 80;
  ui.advance(100);
  assert.equal(viewport.classList.contains('panic-mode'), false);
});

test('street-heat follows suspicion strictly above 80 on #street-container', () => {
  const ui = boot();
  const container = ui.$('street-container');
  ui.state().suspicion = 80;
  ui.advance(100);
  assert.equal(container.classList.contains('street-heat'), false);
  ui.state().suspicion = 80.5;
  ui.advance(100);
  assert.equal(container.classList.contains('street-heat'), true);
  ui.state().suspicion = 80;
  ui.advance(100);
  assert.equal(container.classList.contains('street-heat'), false);
});

test('each hired tier renders its supplied portrait in an img.dealer-mugshot', () => {
  const cases = [[0.1, 'Common', 'assets/dealer_hustler.jpg'], [0.8, 'Rare', 'assets/dealer_mid.jpg'],
    [0.99, 'Legendary', 'assets/dealer_cartel.jpg']];
  for (const [roll, tier, src] of cases) {
    const ui = boot({ random: () => roll });
    ui.$('street-hire-btn').click();
    ui.advance(100);
    const card = ui.$('dealer-roster').children[0];
    assert.match(card.className, /\bdealer-card\b/);
    const img = card.children[0];
    assert.equal(img.className, 'dealer-mugshot');
    assert.equal(img.getAttribute('src'), src);
    assert.ok(img.getAttribute('alt').length > 5, `${tier} portrait has alt text`);
    assert.ok(fs.existsSync(path.join(__dirname, src)), `${src} is packaged`);
  }
});

test('cash pop-ups roll independent left and top percentages inside the map', () => {
  const rolls = [0, 0, 0.999, 0.999, 0.25, 0.75];
  const ui = boot();
  ui.advance(100);
  ui.ctl.random = () => rolls.shift();
  for (let i = 0; i < 3; i++) {
    ui.state().cash += 100;
    ui.state().timeTicks++;
    ui.advance(100);
  }
  const spots = ui.floats().map(node => [parseFloat(node.style.left), parseFloat(node.style.top)]);
  assert.equal(spots.length, 3);
  for (const [left, top] of spots) {
    assert.ok(left >= 18 && left <= 82 && top >= 18 && top <= 74, `${left}/${top} stays inset`);
  }
  assert.match(ui.floats()[0].style.left, /%$/);
  assert.match(ui.floats()[0].style.top, /%$/);
  assert.notEqual(spots[0][0], spots[1][0]);
  assert.notEqual(spots[1][0], spots[2][0]);
  assert.notEqual(spots[2][0], spots[2][1], 'left and top are rolled separately');
});

test('Streets dispatch terminal styling: city map, radar sweep, dossiers, siren heat', () => {
  assert.match(html, /#street-dispatch-map\s*\{[^}]*url\('assets\/city_radar\.jpg'\) center\/cover/);
  assert.match(html, /#street-dispatch-map::before\s*\{[^}]*conic-gradient\(from 0deg, transparent 70%, rgba\(57, 255, 20, 0\.4\) 100%\)[^}]*animation: radar-sweep 4s linear infinite/);
  assert.match(html, /@keyframes radar-sweep[\s\S]*rotate\(360deg\)/);
  assert.match(html, /#street-dispatch-map::before\s*\{[^}]*pointer-events: none/);
  assert.match(html, /<div class="street-map"[^>]*>[\s\S]*id="cash-float-layer"[\s\S]*<\/div>\s*<dl class="street-stats"/);
  assert.match(html, /li\.dealer-card\s*\{[^}]*rgba\(10, 10, 10, 0\.8\)[^}]*inset 0 0/);
  assert.match(html, /dealer-card\.street-tier-common \{ --tier-glow: #9e9e9e/);
  assert.match(html, /dealer-card\.street-tier-rare \{ --tier-glow: #00e5ff/);
  assert.match(html, /dealer-card\.street-tier-legendary \{ --tier-glow: #ffd400/);
  assert.match(html, /\.dealer-mugshot\s*\{[^}]*filter: grayscale\(100%\) sepia\(100%\) hue-rotate\(80deg\)/);
  assert.match(html, /#street-container\.street-heat::before\s*\{(?=[^}]*pointer-events: none)(?=[^}]*radial-gradient)[^}]*inset 0 0 100px rgba\(255, 0, 60, 0\.5\)/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*#street-dispatch-map::before \{ animation: none/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*#street-container\.street-heat::before \{ animation: none/);
});

test('a real raid wipes the roster and resets the bribe price shown on the button', () => {
  const ui = boot({ random: () => 0.009999 });
  ui.context.loadJudgePreset('Mid');
  Object.assign(ui.state(), { suspicion: 85, bribeCost: 4000 });
  ui.advance(100);
  ui.tick(1);
  ui.advance(100);
  assert.equal(ui.modalOpen(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.state().dealers)), []);
  assert.equal(ui.state().bribeCost, 1000);
  assert.equal(ui.roster()[0], 'No dealers hired yet.');
});

// ----- Visual inventory, Flawless reveal and the expanded scorecard (Issue #18) -----

const stacks = ui => ui.$('inventory-tray').children;
const trayItems = ui => stacks(ui).map(stack => stack.children[0]);
const counts = ui => stacks(ui).map(stack => stack.children[1].textContent);
const srcOf = node => node.getAttribute('src');
const flawlessVideo = ui => {
  const video = ui.$('flawless-video');
  video.plays = 0;
  video.pauses = 0;
  video.play = () => { video.plays++; return Promise.resolve(); };
  video.pause = () => { video.pauses++; };
  return video;
};

test('index.html carries the stacked tray, the alert, the video reveal and the CRT terminal hooks', () => {
  assert.match(html, /<div id="inventory-tray"/);
  assert.match(html, /\.inventory-stack \{[^}]*inline-flex[^}]*white-space: nowrap/);
  assert.match(html, /#inventory-tray \{[^}]*flex-wrap: wrap/);
  assert.doesNotMatch(html, /inventory-overflow/);
  assert.match(html, /<div id="flawless-alert"[^>]*hidden[^>]*>\s*<img src="assets\/heisenberg_alert\.png" alt="Flawless Blue">/);
  assert.match(html, /<video id="flawless-video" src="assets\/flawless_reveal\.mp4"[^>]*muted[^>]*playsinline/);
  assert.match(html, /#flawless-alert\.is-playing img \{ animation: flawless-pop 3s ease-out forwards; \}/);
  assert.match(html, /@keyframes flawless-pop \{[\s\S]*scale\(0\)[\s\S]*scale\(1\.5\)[\s\S]*translate\(-7px/);
  assert.match(html, /\.flawless-glow \{[^}]*box-shadow:[^}]*0 0 16px 5px[^}]*filter: drop-shadow\(/);
  assert.match(html, /<p id="scorecard-restart">PRESS F5 TO RESTART RUN<\/p>/);
  assert.match(html, /#scorecard-restart::after \{[^}]*animation: scorecard-blink 1s steps\(1\) infinite/);
  assert.match(html, /\[data-outcome="busted"\] #scorecard-status \{ color: #ff003c/);
  assert.match(html, /\[data-outcome="escaped"\] #scorecard-status \{ color: #00f3ff/);
  for (const file of ['heisenberg_alert.png', 'grade_1.png', 'grade_2.png', 'grade_3.png', 'grade_4.png', 'flawless_batch.png', 'flawless_reveal.mp4']) {
    assert.ok(fs.existsSync(path.join(__dirname, 'assets', file)), file);
  }
});

test('the tray stacks stock into one image and exact count per grade, and updates as stock sells', () => {
  const ui = boot({ random: () => 0.5 });
  assert.equal(ui.$('inventory-tray').getAttribute('aria-label'), 'Inventory: 0 units');
  assert.equal(stacks(ui).length, 0);
  start(ui).click(); // amber, potency 1, yield 8, 10 min -> score 1.25, grade 2
  ui.simmer(600);
  assert.deepEqual(trayItems(ui).map(srcOf), ['assets/grade_2.png']);
  assert.deepEqual(counts(ui), ['\u00d78']);
  assert.equal(trayItems(ui)[0].className, 'inventory-item');
  assert.equal(stacks(ui)[0].getAttribute('aria-label'), 'Grade 2: Poor Lab Grade, 60% purity: 8 units');
  assert.equal(ui.$('hud-inventory').textContent, '8');

  // Another lot of grade 2 on a different compound joins the same stack; grade 3 is separate.
  ui.state().completedBatches.push(
    { id: 89, compoundId: 'neon', quantity: 2, quality: 'Standard', grade: 2, valueMultiplier: 1, unitPrice: 50, dealerId: null },
    { id: 90, compoundId: 'neon', quantity: 3, quality: 'Standard', grade: 3, valueMultiplier: 1, unitPrice: 50, dealerId: null });
  ui.state().inventory.neon = 5;
  ui.advance(100);
  assert.deepEqual(trayItems(ui).map(srcOf), ['assets/grade_2.png', 'assets/grade_3.png']);
  assert.deepEqual(counts(ui), ['\u00d710', '\u00d73']);
  assert.equal(ui.$('inventory-tray').getAttribute('aria-label'), 'Inventory: 13 units');

  // A Common dealer sells one unit per tick from the stock assigned to it; assigning changes no total.
  const dealer = ui.context.hireDealer('Common');
  ui.context.assignDealerInventory(dealer.id, 1, 2);
  ui.advance(100);
  assert.deepEqual(counts(ui), ['\u00d710', '\u00d73']);
  assert.equal(ui.$('hud-inventory').textContent, '13');
  ui.tick(1);
  ui.advance(100);
  assert.deepEqual(counts(ui), ['\u00d79', '\u00d73']);

  ui.context.sellBatch(); // manual sale of the unassigned stock
  ui.advance(100);
  assert.deepEqual(counts(ui), ['\u00d71']);
  assert.deepEqual(trayItems(ui).map(srcOf), ['assets/grade_2.png'], 'a grade at zero disappears; ×1 is shown');
  assert.equal(ui.$('hud-inventory').textContent, '1');
  assert.equal(ui.$('inventory-tray').getAttribute('aria-label'), 'Inventory: 1 unit');
});

test('grades follow the lot grade; Flawless units glow, and unsaved or unearned grades fall back to 1', () => {
  const ui = boot();
  const lots = [[1, 'Standard'], [2, 'Standard'], [3, 'Standard'], [4, 'Standard'], [undefined, 'Standard'], [5, 'Flawless Blue']];
  lots.forEach(([grade, quality], index) => {
    ui.state().completedBatches.push({ id: 200 + index, compoundId: 'azure', quantity: 1, quality, grade,
      valueMultiplier: quality === 'Standard' ? 1 : 10, unitPrice: 125, dealerId: null });
  });
  ui.state().inventory.azure = 6;
  ui.advance(100);
  assert.deepEqual(trayItems(ui).map(srcOf), ['assets/grade_1.png', 'assets/grade_2.png', 'assets/grade_3.png',
    'assets/grade_4.png', 'assets/flawless_batch.png']);
  assert.deepEqual(counts(ui), ['\u00d72', '\u00d71', '\u00d71', '\u00d71', '\u00d71']);
  assert.deepEqual(trayItems(ui).map(item => item.className.includes('flawless-glow')), [false, false, false, false, true]);
  assert.equal(trayItems(ui)[4].className, 'inventory-item flawless-glow');
  assert.equal(stacks(ui)[4].getAttribute('aria-label'), 'Flawless Blue, grade 5: 1 unit');
  assert.match(stacks(ui)[3].getAttribute('aria-label'), /^Grade 4: High Purity, 90% purity: 1 unit$/);
  // The grade is never inferred from the selling price, current potency, or a Standard "grade 5".
  ui.state().completedBatches.push(
    { id: 300, compoundId: 'azure', quantity: 1, quality: 'Standard', grade: 5, valueMultiplier: 1, unitPrice: 999, dealerId: null },
    { id: 301, compoundId: 'azure', quantity: 1, quality: 'Standard', grade: -2, valueMultiplier: 1, unitPrice: 999, dealerId: null });
  ui.state().inventory.azure = 8;
  ui.advance(100);
  assert.equal(stacks(ui).length, 5);
  assert.deepEqual(counts(ui), ['\u00d74', '\u00d71', '\u00d71', '\u00d71', '\u00d71']);
});

test('a cook is graded from its snapshotted score, so changing options later keeps the art', () => {
  const ui = boot({ random: () => 0.5 });
  ui.context.setCompoundSetting('amber', 'potency', 5);
  ui.context.setCompoundSetting('amber', 'yield', 8);
  ui.context.setCompoundSetting('amber', 'baseMinutes', 40); // 5 * 40 min / 8 = 25 -> grade 4
  ui.state().cash = 100000;
  start(ui).click();
  ui.context.setCompoundSetting('amber', 'potency', 1); // would score far lower now
  ui.simmer(2400);
  assert.equal(ui.state().completedBatches[0].grade, 4);
  ui.advance(100);
  assert.ok(trayItems(ui).every(item => srcOf(item) === 'assets/grade_4.png'));
  assert.equal(ui.$('inventory-tray').getAttribute('aria-label'), 'Inventory: 8 units');
});

test('presets rebuild the stacks without a celebration; a large mixed stash stays at five pairs with full counts', () => {
  const ui = boot();
  flawlessVideo(ui);
  ui.context.loadJudgePreset('Late'); // 60 ember (grade 4) + 8 Flawless
  ui.advance(100);
  assert.deepEqual(counts(ui), ['\u00d760', '\u00d78']);
  assert.equal(ui.$('inventory-tray').getAttribute('aria-label'), 'Inventory: 68 units');
  assert.equal(ui.$('flawless-alert').hidden, true);
  assert.equal(ui.$('flawless-reveal').hidden, true);
  ui.tick(1); // the Legendary dealer sells four
  ui.advance(100);
  assert.equal(ui.$('inventory-tray').getAttribute('aria-label'), 'Inventory: 64 units');
  assert.equal(ui.$('hud-inventory').textContent, '64');
  ui.context.loadJudgePreset('Early');
  ui.advance(100);
  assert.equal(stacks(ui).length, 0);
  assert.equal(ui.$('hud-inventory').textContent, '0');
  assert.equal(ui.$('inventory-tray').getAttribute('aria-label'), 'Inventory: 0 units');

  // 1,000+ units across all five grades, compounds and dealer ownership: five pairs, no overflow badge.
  [[1, 400, 'azure', null], [2, 300, 'amber', null], [3, 200, 'neon', 7], [4, 99, 'ember', null], [5, 12, 'azure', 7]].forEach(([grade, quantity, compoundId, dealerId], index) => {
    ui.state().completedBatches.push({ id: 500 + index, compoundId, quantity, quality: grade === 5 ? 'Flawless Blue' : 'Standard',
      grade, valueMultiplier: 1, unitPrice: 10, dealerId });
  });
  ui.state().inventory = { azure: 412, amber: 300, neon: 200, ember: 99 };
  ui.advance(100);
  assert.equal(stacks(ui).length, 5);
  assert.deepEqual(counts(ui), ['\u00d7400', '\u00d7300', '\u00d7200', '\u00d799', '\u00d712']);
  assert.equal(ui.$('hud-inventory').textContent, '1011');
  assert.equal(ui.$('inventory-tray').getAttribute('aria-label'), 'Inventory: 1011 units');
  assert.ok(stacks(ui).every(stack => stack.children.length === 2), 'each image stays with its count');
  assert.equal(stacks(ui).some(stack => /\+\d/.test(stack.text)), false, 'no +N overflow indicator');
});

test('a new Flawless cook pops the alert for 3 s, then plays the muted video once and cleans up', () => {
  const ui = boot({ random: () => 0.01 });
  const video = flawlessVideo(ui);
  start(ui).click();
  ui.simmer(600);
  assert.equal(ui.$('flawless-alert').hidden, false);
  assert.ok(ui.$('flawless-alert').classes.has('is-playing'));
  assert.equal(ui.$('flawless-reveal').hidden, true);
  ui.advance(2900);
  assert.equal(ui.$('flawless-alert').hidden, false, 'the pop-out runs for the full 3 s');
  assert.equal(video.plays, 0);
  ui.advance(200);
  assert.equal(ui.$('flawless-alert').hidden, true);
  assert.equal(ui.$('flawless-reveal').hidden, false);
  assert.equal(video.plays, 1);
  ui.advance(5000); // repeated render frames never replay it
  assert.equal(video.plays, 1);
  assert.deepEqual(ui.calls.completions, [true], 'the cook voice is still requested exactly once');
  video.fire('ended');
  assert.equal(ui.$('flawless-reveal').hidden, true);
  assert.equal(video.pauses > 0, true);
  ui.advance(20000);
  assert.equal(video.plays, 1);
  assert.equal(ui.$('flawless-alert').hidden, true);
});

test('the video safety timer and a playback failure both finish cleanly with the still as fallback', () => {
  const ui = boot();
  const video = flawlessVideo(ui);
  ui.doc.fire('keydown', { key: 'u' });
  ui.advance(3000);
  assert.equal(ui.$('flawless-reveal').hidden, false);
  ui.advance(12000);
  assert.equal(ui.$('flawless-reveal').hidden, true, 'a stalled player cannot keep the overlay up');

  video.play = () => Promise.reject(new Error('blocked'));
  ui.doc.fire('keydown', { key: 'u' });
  ui.advance(3000);
  return Promise.resolve().then(() => {
    assert.ok(ui.$('flawless-reveal').classes.has('is-fallback'));
    assert.equal(ui.$('flawless-reveal').hidden, false, 'the grade-5 still is shown');
    ui.advance(3000);
    assert.equal(ui.$('flawless-reveal').hidden, true);

    const bare = boot(); // no playback API at all
    bare.doc.fire('keydown', { key: 'u' });
    bare.advance(3000);
    assert.ok(bare.$('flawless-reveal').classes.has('is-fallback'));
    bare.advance(3000);
    assert.equal(bare.$('flawless-reveal').hidden, true);
  });
});

test('closely spaced Flawless successes queue one celebration at a time', () => {
  const ui = boot();
  const video = flawlessVideo(ui);
  ui.doc.fire('keydown', { key: 'u' });
  ui.doc.fire('keydown', { key: 'u' });
  ui.advance(100);
  assert.equal(ui.$('flawless-alert').hidden, false);
  assert.equal(ui.$('flawless-reveal').hidden, true, 'alert and video never overlap');
  ui.advance(3000);
  assert.equal(ui.$('flawless-alert').hidden, true);
  assert.equal(ui.$('flawless-reveal').hidden, false);
  video.fire('ended');
  assert.equal(ui.$('flawless-alert').hidden, false, 'the second one starts after the first finished');
  assert.equal(ui.$('flawless-reveal').hidden, true);
  ui.advance(3000);
  video.fire('ended');
  assert.equal(video.plays, 2);
  assert.equal(ui.$('flawless-alert').hidden, true);
  assert.equal(ui.$('flawless-reveal').hidden, true);
  assert.deepEqual(counts(ui), ['\u00d716']);
  assert.equal(trayItems(ui).every(item => item.className.includes('flawless-glow')), true);
});

test('a preset, the end of the run and teardown cancel a pending celebration', () => {
  const ui = boot();
  const video = flawlessVideo(ui);
  ui.doc.fire('keydown', { key: 'u' });
  ui.doc.fire('keydown', { key: 'u' });
  ui.advance(100);
  ui.context.loadJudgePreset('Mid');
  ui.advance(100);
  assert.equal(ui.$('flawless-alert').hidden, true);
  ui.advance(20000);
  assert.equal(video.plays, 0, 'nothing from before the preset plays later');

  ui.doc.fire('keydown', { key: 'u' });
  ui.advance(100);
  ui.state().launderedCash = 1000000;
  ui.advance(100);
  ui.$('vacuum-btn').click();
  assert.equal(ui.$('flawless-alert').hidden, true, 'the ending outranks the celebration');
  ui.advance(20000);
  assert.equal(video.plays, 0);

  const second = boot();
  flawlessVideo(second);
  second.doc.fire('keydown', { key: 'u' });
  second.advance(100);
  second.context.ArcadeMain.destroy();
  assert.equal(second.$('flawless-alert').hidden, true);
  assert.equal([...second.timers.values()].filter(timer => !timer.repeat).length, 0, 'no celebration timer survives teardown');
});

test('the scorecard reports quality, reputation and legal evasion, and remembers a sold-out Flawless', () => {
  const ui = boot({ random: () => 0.01 });
  start(ui).click();
  ui.simmer(600);
  ui.context.sellBatch(); // every Flawless unit is gone
  ui.advance(100);
  assert.equal(stacks(ui).length, 0);
  Object.assign(ui.state(), { cash: 1234.5, launderedCash: 1000000, suspicion: 12.5 });
  ui.advance(100);
  ui.$('vacuum-btn').click();
  assert.equal(ui.$('scorecard-modal').getAttribute('data-outcome'), 'escaped');
  assert.equal(ui.$('scorecard-status').textContent, 'Final Status: ESCAPED');
  assert.equal(ui.$('scorecard-quality').textContent, 'Scientific Quality Index: 99.1% (HEISENBERG GRADE)');
  assert.equal(ui.$('scorecard-reputation').textContent, 'Reputation Score: 1200');
  assert.equal(ui.$('scorecard-evasion').textContent, 'Legal Evasion Rating: 87.5%');
  assert.match(ui.$('scorecard-profit').textContent, /^Total Net Profit: \$1,0\d\d,\d\d\d\.\d\d$/);
  const frozen = ['scorecard-profit', 'scorecard-quality', 'scorecard-reputation', 'scorecard-evasion', 'scorecard-ticks']
    .map(id => ui.$(id).textContent);
  Object.assign(ui.state(), { cash: 0, launderedCash: 0, suspicion: 99, timeTicks: 5 });
  ui.advance(500);
  assert.deepEqual(['scorecard-profit', 'scorecard-quality', 'scorecard-reputation', 'scorecard-evasion', 'scorecard-ticks']
    .map(id => ui.$(id).textContent), frozen);
});

test('historical Flawless stock never counts; the U bonus does; a preset resets the run history', () => {
  const ui = boot();
  ui.context.loadJudgePreset('Late'); // owns Flawless stock it did not cook this run
  ui.advance(100);
  ui.state().launderedCash = 1000000;
  ui.advance(100);
  ui.$('vacuum-btn').click();
  assert.equal(ui.$('scorecard-quality').textContent, 'Scientific Quality Index: 74% (STREET GRADE)');

  const bonus = boot();
  bonus.doc.fire('keydown', { key: 'u' });
  bonus.advance(100);
  bonus.context.loadJudgePreset('Mid'); // a fresh run starts: the earlier success is forgotten
  bonus.advance(100);
  bonus.state().launderedCash = 1000000;
  bonus.advance(100);
  bonus.$('vacuum-btn').click();
  assert.equal(bonus.$('scorecard-quality').textContent, 'Scientific Quality Index: 74% (STREET GRADE)');

  const kept = boot();
  kept.doc.fire('keydown', { key: 'u' });
  kept.state().launderedCash = 1000000;
  kept.advance(100);
  kept.$('vacuum-btn').click();
  assert.equal(kept.$('scorecard-quality').textContent, 'Scientific Quality Index: 99.1% (HEISENBERG GRADE)');
});

test('a Flawless batch finishing on the raid tick still counts for the BUSTED scorecard', () => {
  const ui = boot({ random: () => 0.01 });
  start(ui).click();
  ui.simmer(599);
  ui.state().suspicion = 95;
  ui.context.BreakingBadEngine.tick(); // finishes the cook ...
  ui.context.triggerRaid(); // ... and the same frame sees the raid
  ui.advance(100);
  assert.equal(ui.modalOpen(), true);
  assert.equal(ui.$('scorecard-status').textContent, 'Final Status: BUSTED');
  assert.equal(ui.$('scorecard-quality').textContent, 'Scientific Quality Index: 99.1% (HEISENBERG GRADE)');
  assert.equal(ui.$('scorecard-evasion').textContent, 'Legal Evasion Rating: 100%');
  assert.equal(ui.$('flawless-alert').hidden, true);
});

test('dealer cards show remaining capacity and warn only below 20%', () => {
  const ui = boot({});
  const dealer = ui.context.hireDealer('Common');
  ui.advance(300);
  assert.match(ui.roster()[0], /100\/100 units$/);
  dealer.unitsSold = 80; // exactly 20% left: no warning
  ui.advance(300);
  assert.match(ui.roster()[0], /20\/100 units$/);
  dealer.unitsSold = 81; // below 20%
  ui.advance(300);
  assert.match(ui.roster()[0], /19\/100 units · Wearing out$/);
});

test('a departing dealer is announced in the Streets status line', () => {
  const ui = boot({});
  ui.context.hireDealer('Common');
  ui.advance(300);
  ui.state().dealerDepartures.push({ id: 1, tier: 'Common' });
  ui.advance(300);
  assert.match(ui.$('street-status').textContent, /Street Hustler #1 wore out/);
});

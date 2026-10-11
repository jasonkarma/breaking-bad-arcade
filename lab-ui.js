/* Cyberpunk Arcade Lab UI — the left (lab) half of index.html.
 * Read-only view over engine.js: it reads playerState.activeBatches, compounds and workflows.
 * Option buttons call setCompoundSetting only. It never starts cooks (main.js owns Start Cook) and never
 * decrements timers; it only re-renders on a display refresh interval. Compound cards and the
 * Rapid/Standard/Precision buttons only select; getSelection() reports the choice.
 * Card diagrams are inline fictional artwork, not identified real chemicals.
 * The Lab Slots display beside Start Cook shows occupied/total/available capacity (read-only).
 * Load engine.js first. Loading this script again replaces the previous instance.
 */
(function (root) {
  'use strict';

  const REFRESH_MS = 250;
  const DEFAULT_WORKFLOW = 'Standard';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STRUCTURES = {
    amber: {
      stroke: '#00f3ff',
      bonds: [[36, 14, 54, 24], [54, 24, 54, 44], [54, 44, 36, 54], [36, 54, 18, 44], [18, 44, 18, 24], [18, 24, 36, 14], [54, 24, 74, 12], [52, 28, 72, 16]],
      atoms: [{ x: 36, y: 14, label: 'N' }, { x: 18, y: 44, label: 'O' }, { x: 36, y: 54, label: 'C' }, { x: 80, y: 12, label: 'Cl' }]
    },
    neon: {
      stroke: '#39ff14',
      bonds: [[28, 16, 44, 24], [44, 24, 44, 44], [44, 44, 28, 52], [28, 52, 12, 44], [12, 44, 12, 24], [12, 24, 28, 16], [44, 24, 60, 16], [60, 16, 76, 24], [76, 24, 76, 44], [76, 44, 60, 52], [60, 52, 44, 44], [58, 20, 74, 28]],
      atoms: [{ x: 28, y: 16, label: 'N' }, { x: 12, y: 44, label: 'O' }, { x: 76, y: 24, label: 'F' }, { x: 60, y: 52, label: 'C' }]
    },
    violet: {
      stroke: '#ffcc00',
      bonds: [[30, 14, 46, 22], [46, 22, 46, 42], [46, 42, 30, 50], [30, 50, 14, 42], [14, 42, 14, 22], [14, 22, 30, 14], [46, 22, 62, 16], [62, 16, 74, 30], [74, 30, 60, 44], [60, 44, 46, 42], [60, 18, 72, 32]],
      atoms: [{ x: 30, y: 14, label: 'N' }, { x: 14, y: 22, label: 'Br' }, { x: 74, y: 30, label: 'O' }, { x: 30, y: 50, label: 'C' }]
    },
    ember: {
      stroke: '#00f3ff',
      bonds: [[10, 40, 26, 22], [26, 22, 42, 40], [42, 40, 58, 22], [58, 22, 74, 40], [74, 40, 90, 26], [90, 26, 90, 48], [90, 48, 74, 40], [24, 26, 40, 36], [72, 36, 88, 30]],
      atoms: [{ x: 26, y: 22, label: 'S' }, { x: 58, y: 22, label: 'N' }, { x: 90, y: 26, label: 'O' }, { x: 10, y: 40, label: 'C' }]
    },
    azure: {
      stroke: '#39ff14',
      bonds: [[18, 18, 32, 26], [32, 26, 32, 44], [32, 44, 18, 52], [18, 52, 4, 44], [4, 44, 4, 26], [4, 26, 18, 18], [32, 26, 48, 18], [48, 18, 64, 26], [64, 26, 64, 44], [64, 44, 48, 52], [48, 52, 32, 44], [64, 26, 80, 20], [80, 20, 92, 34], [92, 34, 78, 46], [78, 46, 64, 44], [78, 22, 90, 36]],
      atoms: [{ x: 18, y: 18, label: 'N' }, { x: 4, y: 44, label: 'O' }, { x: 92, y: 34, label: 'F' }, { x: 48, y: 52, label: 'C' }]
    }
  };

  const OPTION_SETS = {
    potency: [1, 2, 3, 4, 5],
    yield: [8, 16, 24],
    baseMinutes: [10, 24, 40]
  };
  const OPTION_LABELS = { potency: 'Potency', yield: 'Yield', baseMinutes: 'Base time' };

  const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

  function formatDuration(seconds) {
    if (!isFiniteNumber(seconds)) return '--';
    const total = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    if (minutes && remainder) return `${minutes} min ${remainder} sec`;
    if (minutes) return `${minutes} min`;
    return `${total} sec`;
  }

  function formatMoney(value) {
    const amount = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    return '$' + (Number.isFinite(amount) ? amount : 0)
      .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Percent complete of one engine batch, 0-100. Invalid durations read as 0.
  function batchProgress(batch) {
    const total = batch && batch.productionTime;
    const remaining = batch && batch.remainingTicks;
    if (!isFiniteNumber(total) || total <= 0) return 0;
    const left = isFiniteNumber(remaining) ? remaining : total;
    return Math.min(100, Math.max(0, (100 * (total - left)) / total));
  }

  // Whole seconds left, or null when the engine data cannot tell.
  function secondsLeft(batch) {
    const remaining = batch && batch.remainingTicks;
    return isFiniteNumber(remaining) ? Math.max(0, Math.ceil(remaining)) : null;
  }

  // Lab capacity from engine state: one slot per positive safe-integer equipment unit (the
  // engine's startCook rule). Returns null when the state cannot tell, so callers can show
  // "unavailable" instead of a misleading zero.
  function slotCapacity(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.activeBatches)) return null;
    const equipment = state.labEquipment;
    if (!equipment || typeof equipment !== 'object') return null;
    const total = Object.values(equipment).reduce((sum, quantity) =>
      sum + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0), 0);
    const occupied = state.activeBatches.length;
    const available = Math.max(0, total - occupied);
    const status = total === 0 ? 'none' : (available === 0 ? 'full' : 'available');
    return { total, occupied, available, status };
  }

  const SLOT_STATUS_TEXT = {
    available: 'Slot available',
    full: 'Lab full',
    none: 'No lab equipment'
  };

  function createLabUI(env) {
    const doc = env.document;
    const engine = env.engine;
    const setTimer = env.setInterval || root.setInterval;
    const clearTimer = env.clearInterval || root.clearInterval;

    let els = null;
    let timerId = null;
    let listeners = [];
    let rows = new Map(); // batch key -> { item, name, left, bar, fill }
    let compoundKey = '';
    let feedbackTimer = 0; // refresh passes remaining before the cook message clears
    let workflow = DEFAULT_WORKFLOW;

    const byId = id => doc.getElementById(id);

    function on(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push(() => target.removeEventListener(type, handler));
    }

    function engineReady() {
      const compounds = engine.compounds;
      return typeof engine.startCook === 'function' && Array.isArray(compounds) && compounds.length > 0;
    }

    function setFeedback(message, kind) {
      if (els.feedback.textContent !== message) els.feedback.textContent = message;
      els.feedback.setAttribute('data-kind', kind || 'info');
      feedbackTimer = message ? 40 : 0; // ~10 s at the refresh rate
    }

    function structureGraphic(id) {
      const model = STRUCTURES[id] || STRUCTURES.amber;
      if (typeof doc.createElementNS !== 'function') {
        const fallback = doc.createElement('span');
        fallback.className = 'lab-compound-structure';
        fallback.textContent = model.atoms.map(atom => atom.label).join(' ');
        return fallback;
      }
      const svg = doc.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 96 68');
      svg.setAttribute('class', 'lab-compound-structure');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      for (const [x1, y1, x2, y2] of model.bonds) {
        const line = doc.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', model.stroke);
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
      }
      for (const atom of model.atoms) {
        const disc = doc.createElementNS(SVG_NS, 'circle');
        disc.setAttribute('cx', String(atom.x));
        disc.setAttribute('cy', String(atom.y));
        disc.setAttribute('r', atom.label.length > 1 ? '8' : '6');
        disc.setAttribute('fill', '#0f0f1a');
        const text = doc.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', String(atom.x));
        text.setAttribute('y', String(atom.y));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', '#ffcc00');
        text.setAttribute('font-size', atom.label.length > 1 ? '9' : '11');
        text.setAttribute('font-family', 'VT323, monospace');
        text.textContent = atom.label;
        svg.appendChild(disc);
        svg.appendChild(text);
      }
      return svg;
    }

    function createCard(compound) {
      const card = doc.createElement('button');
      card.type = 'button';
      card.className = 'lab-compound-card';
      card.value = compound.id;
      card.setAttribute('data-compound', compound.id);
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', 'false');
      const copy = doc.createElement('span');
      copy.className = 'lab-compound-copy';
      const name = doc.createElement('span');
      name.className = 'lab-compound-name';
      name.textContent = compound.name || compound.id;
      const state = doc.createElement('span');
      state.className = 'lab-compound-state';
      state.setAttribute('aria-hidden', 'true');
      copy.append(name, state);
      card.append(structureGraphic(compound.id), copy);
      on(card, 'click', () => selectCompound(compound.id));
      return card;
    }

    function optionSets() {
      const provided = engine.compoundOptions;
      if (!provided) return OPTION_SETS;
      return {
        potency: provided.potency || OPTION_SETS.potency,
        yield: provided.yield || OPTION_SETS.yield,
        baseMinutes: provided.baseMinutes || OPTION_SETS.baseMinutes
      };
    }

    function currentOption(compound, setting) {
      if (setting === 'baseMinutes') return compound.productionTime / 60;
      return compound[setting];
    }

    function optionText(setting, value, selected) {
      const label = setting === 'baseMinutes' ? `${value} min` : String(value);
      return selected ? `■ ${label}` : label;
    }

    function applySetting(compound, setting, value) {
      if (!engineReady() || typeof engine.setCompoundSetting !== 'function') return;
      engine.setCompoundSetting(compound.id, setting, value);
      render();
    }

    function createOptions(compound) {
      const wrap = doc.createElement('div');
      wrap.className = 'lab-option-groups';
      const sets = optionSets();
      for (const setting of ['potency', 'yield', 'baseMinutes']) {
        const group = doc.createElement('div');
        group.className = 'lab-option-group';
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', `${OPTION_LABELS[setting]} for ${compound.name || compound.id}`);
        group.setAttribute('data-setting-group', setting);
        const caption = doc.createElement('span');
        caption.className = 'lab-option-label';
        caption.textContent = OPTION_LABELS[setting];
        group.appendChild(caption);
        for (const value of sets[setting]) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'lab-option';
          button.setAttribute('role', 'radio');
          button.setAttribute('data-setting', setting);
          button.setAttribute('data-value', String(value));
          button.setAttribute('aria-label', `${OPTION_LABELS[setting]} ${setting === 'baseMinutes' ? value + ' minutes' : value}`);
          on(button, 'click', event => {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            applySetting(compound, setting, value);
          });
          on(button, 'keydown', event => moveOption(event, group, compound, setting));
          group.appendChild(button);
        }
        wrap.appendChild(group);
      }
      return wrap;
    }

    function moveOption(event, group, compound, setting) {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
      if (!(event.key in keys) || !engineReady()) return;
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const buttons = Array.from(group.children).filter(node => node.getAttribute && node.getAttribute('data-setting'));
      if (!buttons.length) return;
      const current = buttons.findIndex(node => node.getAttribute('aria-checked') === 'true');
      let next = current < 0 ? 0 : current;
      if (keys[event.key] === 'first') next = 0;
      else if (keys[event.key] === 'last') next = buttons.length - 1;
      else next = (next + keys[event.key] + buttons.length) % buttons.length;
      const value = Number(buttons[next].getAttribute('data-value'));
      applySetting(compound, setting, value);
      if (typeof buttons[next].focus === 'function') buttons[next].focus();
    }

    function selectionCards() {
      const found = [];
      const walk = node => {
        for (const child of node.children || []) {
          if (child.getAttribute && child.getAttribute('role') === 'radio' && child.getAttribute('data-compound')) found.push(child);
          walk(child);
        }
      };
      walk(els.compound);
      return found;
    }

    function selectCompound(id) {
      if (!els || !engineReady()) return;
      els.compound.value = id;
      render();
    }

    function moveCompound(event) {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
      if (event.target && event.target.getAttribute && event.target.getAttribute('data-setting')) return;
      if (!(event.key in keys) || !engineReady()) return;
      const cards = selectionCards().filter(card => !card.disabled);
      if (!cards.length) return;
      const current = cards.findIndex(card => card.value === els.compound.value);
      let next = current < 0 ? 0 : current;
      if (keys[event.key] === 'first') next = 0;
      else if (keys[event.key] === 'last') next = cards.length - 1;
      else next = (next + keys[event.key] + cards.length) % cards.length;
      els.compound.value = cards[next].value;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof cards[next].focus === 'function') cards[next].focus();
      render();
    }

    function syncCards(selected, ready) {
      selectionCards().forEach((card, index) => {
        const on = card.value === selected;
        card.disabled = !ready;
        card.tabIndex = ready && (on || (!selected && index === 0)) ? 0 : -1;
        card.setAttribute('tabindex', String(card.tabIndex));
        card.setAttribute('aria-checked', String(on));
        const state = card.children[1] && card.children[1].children[1];
        if (state) setText(state, on ? '■ SELECTED' : '□');
      });
    }

    function syncOptions(ready) {
      const compounds = Array.isArray(engine.compounds) ? engine.compounds : [];
      for (const row of els.compound.children) {
        const card = row.children && row.children[0];
        const groups = row.children && row.children[1];
        if (!card || !groups) continue;
        const compound = compounds.find(entry => entry.id === card.value);
        if (!compound) continue;
        for (const group of groups.children || []) {
          const setting = group.getAttribute && group.getAttribute('data-setting-group');
          const current = currentOption(compound, setting);
          const buttons = Array.from(group.children).filter(node => node.getAttribute && node.getAttribute('data-setting'));
          buttons.forEach((button, index) => {
            const value = Number(button.getAttribute('data-value'));
            const on = value === current;
            button.disabled = !ready;
            button.tabIndex = ready && (on || (buttons.every(entry => entry.getAttribute('aria-checked') !== 'true') && index === 0)) ? 0 : -1;
            if (on) button.tabIndex = 0;
            if (!ready) button.tabIndex = -1;
            button.setAttribute('tabindex', String(button.tabIndex));
            button.setAttribute('aria-checked', String(on));
            setText(button, optionText(setting, value, on));
          });
        }
      }
    }

    function selectedWorkflow() {
      const workflows = engine.workflows || {};
      return Object.values(workflows).find(entry => entry && entry.name === workflow) ||
        { name: workflow, timeModifier: 1, yieldModifier: 1 };
    }

    function quoteFact(label, value) {
      const item = doc.createElement('div');
      const term = doc.createElement('dt');
      const detail = doc.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      item.append(term, detail);
      return item;
    }

    function renderPerformance(selected) {
      if (!selected) {
        els.compoundInfo.replaceChildren();
        return;
      }
      const quote = typeof engine.cookQuote === 'function' ? engine.cookQuote(selected.id, workflow) : null;
      const modifiers = selectedWorkflow();
      const duration = quote ? quote.duration : Math.max(1, Math.ceil(selected.productionTime * (modifiers.timeModifier || 1)));
      const quantity = quote ? quote.quantity : Math.max(1, Math.floor(selected.yield * (modifiers.yieldModifier || 1)));
      const minutes = duration / 60;
      const performance = quote && isFiniteNumber(quote.performance)
        ? quote.performance
        : (quantity > 0 ? (selected.potency * minutes) / quantity : 0);
      const cost = quote && isFiniteNumber(quote.cost)
        ? quote.cost
        : Math.round((300 * performance + Number.EPSILON) * 100) / 100;
      const unitPrice = quote && isFiniteNumber(quote.unitPrice)
        ? quote.unitPrice
        : Math.round((selected.potency * selected.yield * 2500 + Number.EPSILON) * 100) / 100;
      const shown = (Math.round((performance + Number.EPSILON) * 100) / 100).toFixed(2);
      const facts = doc.createElement('dl');
      facts.className = 'lab-quotes';
      facts.append(
        quoteFact('Overall performance', shown),
        quoteFact('Upfront cost per batch', formatMoney(cost)),
        quoteFact('Selling price per unit', formatMoney(unitPrice))
      );
      const note = doc.createElement('p');
      note.className = 'lab-quote-note';
      note.textContent =
        `potency × cook time (min) ÷ effective yield. Upfront cost is $300 × overall performance. Selling price is $2,500 × potency × yield. Effective yield ${quantity} units. Duration ${formatDuration(duration)}.`;
      els.compoundInfo.replaceChildren(facts, note);
    }

    function renderCompounds(ready) {
      const compounds = Array.isArray(engine.compounds) ? engine.compounds : [];
      const key = compounds.map(compound => [compound.id, compound.name].join(':')).join('|');
      const previous = els.compound.value;
      if (key !== compoundKey) {
        compoundKey = key;
        els.compound.replaceChildren(...compounds.map(compound => {
          const row = doc.createElement('div');
          row.className = 'lab-compound-row';
          row.append(createCard(compound), createOptions(compound));
          return row;
        }));
      }
      const valid = compounds.some(compound => compound.id === previous);
      const selectedId = valid ? previous : (compounds[0] ? compounds[0].id : '');
      els.compound.value = selectedId;
      syncCards(selectedId, ready);
      syncOptions(ready);
      renderPerformance(ready ? compounds.find(compound => compound.id === selectedId) : null);
    }

    function renderWorkflowMeta() {
      const workflows = engine.workflows || {};
      for (const button of els.buttons) {
        const name = button.getAttribute('data-workflow');
        const workflow = Object.values(workflows).find(entry => entry && entry.name === name);
        const meta = button.querySelector('[data-workflow-meta]');
        if (meta) {
          meta.textContent = workflow ? `${workflow.timeModifier}× TIME · ${workflow.yieldModifier}× YIELD` : '';
        }
      }
    }

    function batchKey(batch, index) {
      return batch && batch.id !== undefined ? `id-${batch.id}` : `idx-${index}`;
    }

    function createRow() {
      const item = doc.createElement('li');
      item.className = 'lab-batch';
      const head = doc.createElement('div');
      head.className = 'lab-batch-head';
      const name = doc.createElement('span');
      const left = doc.createElement('span');
      head.append(name, left);
      const bar = doc.createElement('div');
      bar.className = 'lab-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      const fill = doc.createElement('div');
      fill.className = 'lab-progress-fill';
      bar.appendChild(fill);
      item.append(head, bar);
      return { item, name, left, bar, fill };
    }

    function batchLabel(batch) {
      const compounds = Array.isArray(engine.compounds) ? engine.compounds : [];
      const compound = compounds.find(entry => entry.id === batch.compoundId);
      const compoundName = compound ? compound.name : (batch.compoundId || 'Unknown batch');
      return batch.workflowType ? `${compoundName} · ${batch.workflowType}` : compoundName;
    }

    function setText(node, text) {
      if (node.textContent !== text) node.textContent = text;
    }

    function renderBatches() {
      const state = engine.playerState;
      const batches = state && Array.isArray(state.activeBatches) ? state.activeBatches : [];
      const seen = new Set();
      batches.forEach((batch, index) => {
        if (!batch || typeof batch !== 'object') return;
        const key = batchKey(batch, index);
        seen.add(key);
        let row = rows.get(key);
        if (!row) {
          row = createRow();
          rows.set(key, row);
          els.batches.appendChild(row.item);
        }
        const percent = batchProgress(batch);
        const left = secondsLeft(batch);
        const label = batchLabel(batch);
        const leftText = left === null ? '--' : `${formatDuration(left)} left`;
        setText(row.name, label);
        setText(row.left, leftText);
        row.fill.style.width = `${percent}%`;
        row.bar.setAttribute('aria-label', `${label} progress`);
        row.bar.setAttribute('aria-valuenow', String(Math.round(percent)));
        row.bar.setAttribute('aria-valuetext', `${Math.round(percent)}% complete, ${leftText}`);
      });
      for (const [key, row] of rows) {
        if (seen.has(key)) continue;
        row.item.remove();
        rows.delete(key);
      }
      const cooking = rows.size > 0;
      els.idle.hidden = cooking;
      els.production.setAttribute('data-state', cooking ? 'cooking' : 'idle');
      els.scene.setAttribute('data-state', cooking ? 'cooking' : 'idle');
    }

    function renderSlots() {
      const capacity = slotCapacity(engine.playerState);
      els.slots.setAttribute('data-state', capacity ? capacity.status : 'unavailable');
      setText(els.slotsCount, capacity
        ? `${capacity.occupied}/${capacity.total} occupied · ${capacity.available} available`
        : '-- slots · unavailable');
      setText(els.slotsState, capacity ? SLOT_STATUS_TEXT[capacity.status] : 'Slot status unavailable');
    }

    function render() {
      if (!els) return;
      const ready = engineReady();
      els.panel.setAttribute('data-engine', ready ? 'online' : 'offline');
      setText(els.engineStatus, ready ? 'ENGINE ONLINE' : 'ENGINE OFFLINE');
      for (const button of els.buttons) {
        button.disabled = !ready;
        button.setAttribute('aria-pressed', String(button.getAttribute('data-workflow') === workflow));
      }
      els.compound.disabled = !ready;
      els.compound.setAttribute('aria-disabled', String(!ready));
      renderCompounds(ready);
      if (ready) {
        renderWorkflowMeta();
        if (feedbackTimer > 0 && --feedbackTimer === 0) setFeedback('', 'info');
      } else {
        setFeedback('Engine unavailable — controls are locked.', 'error');
      }
      renderBatches();
      renderSlots();
    }

    // The current compound and workflow choice, or null while the engine is unavailable.
    function getSelection() {
      if (!els || !engineReady() || !els.compound.value) return null;
      return { compoundId: els.compound.value, workflowType: workflow };
    }

    function selectWorkflow(workflowType) {
      workflow = workflowType;
      render();
    }

    function init() {
      destroy();
      els = {
        panel: byId('lab-panel'),
        scene: byId('lab-scene'),
        engineStatus: byId('lab-engine-status'),
        compound: byId('lab-compound'),
        compoundInfo: byId('lab-compound-info'),
        feedback: byId('lab-feedback'),
        production: byId('lab-production'),
        idle: byId('lab-idle'),
        batches: byId('lab-batches'),
        slots: byId('lab-slots'),
        slotsCount: byId('lab-slots-count'),
        slotsState: byId('lab-slots-state'),
        buttons: Array.from(doc.querySelectorAll('[data-workflow]'))
      };
      if (Object.entries(els).some(([name, value]) => name !== 'buttons' && !value)) {
        els = null;
        return false;
      }
      for (const button of els.buttons) {
        const workflowType = button.getAttribute('data-workflow');
        on(button, 'click', () => selectWorkflow(workflowType));
      }
      on(els.compound, 'keydown', moveCompound);
      timerId = setTimer(render, REFRESH_MS);
      render();
      return true;
    }

    function destroy() {
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
      for (const remove of listeners) remove();
      listeners = [];
      if (els) els.batches.replaceChildren();
      rows = new Map();
      compoundKey = '';
      feedbackTimer = 0;
      workflow = DEFAULT_WORKFLOW;
      els = null;
    }

    function feedback(message, kind) {
      if (els) setFeedback(message, kind);
    }

    return { init, destroy, render, getSelection, feedback };
  }

  if (root.LabUI) root.LabUI.destroy();

  const api = { createLabUI, batchProgress, secondsLeft, formatDuration, slotCapacity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root.document) {
    // Engine globals are read on every render so a late-loaded or reset engine is picked up.
    const engine = {
      get playerState() { return root.playerState; },
      get compounds() { return root.compounds; },
      get workflows() { return root.workflows; },
      get startCook() { return root.startCook; },
      get setCompoundSetting() { return root.setCompoundSetting; },
      get cookQuote() { return root.cookQuote; },
      get compoundOptions() { return root.compoundOptions; }
    };
    const instance = createLabUI({ document: root.document, engine });
    const destroy = () => {
      root.document.removeEventListener('DOMContentLoaded', instance.init);
      instance.destroy();
    };
    root.LabUI = {
      ...api, init: instance.init, destroy, render: instance.render,
      getSelection: instance.getSelection, feedback: instance.feedback
    };
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', instance.init);
    } else {
      instance.init();
    }
  }
})(globalThis);

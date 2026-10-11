/* Breaking Bad — street (right-hand) UI: Dispatch Map, dealer hiring, laundering, Suspicion meter.
 * Classic browser script. Load after engine.js; it reads the engine's globals
 * (playerState, rollDealerGacha, hireDealer, launderCash) and never ticks or replaces them.
 * Re-loading the script destroys the previous instance first, so handlers and the
 * refresh timer are never duplicated.
 */
(function (root) {
  'use strict';

  if (root.StreetUI && typeof root.StreetUI.destroy === 'function') root.StreetUI.destroy();

  const HIRE_COST = 500;
  const PANIC_ABOVE = 80; // Panic starts strictly above this suspicion value.
  const REFRESH_MS = 250; // Picks up engine ticks, raids and Judge Mode presets.
  const FLOAT_MS = 1600; // Matches the street-float-up animation duration.
  const TIER_CLASSES = Object.freeze({
    Common: 'street-tier-common', Rare: 'street-tier-rare', Legendary: 'street-tier-legendary'
  });

  const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const formatMoney = value => '$' + (Number.isFinite(value) ? value : 0)
    .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isFn = name => typeof root[name] === 'function';
  const byId = id => root.document.getElementById(id);

  let els = null;
  let timerId = null;
  let floatCount = 0;
  let blipSignature = '';
  const floats = new Set();

  function engineReady() {
    return !!root.playerState && typeof root.playerState === 'object' &&
      isFn('rollDealerGacha') && isFn('hireDealer') && isFn('launderCash');
  }

  // Missing or non-numeric suspicion renders as an empty bar; it never raises panic.
  function readSuspicion() {
    const state = root.playerState;
    const raw = state && typeof state === 'object' ? state.suspicion : undefined;
    const value = typeof raw === 'number' ? raw : NaN;
    return Number.isFinite(value)
      ? { valid: true, raw: value, shown: Math.min(100, Math.max(0, value)) }
      : { valid: false, raw: NaN, shown: 0 };
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function setAttr(el, name, value) {
    if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function say(message, kind) {
    setText(els.status, message);
    els.status.setAttribute('data-kind', kind || 'info');
  }

  function renderBlips(dealers) {
    const list = Array.isArray(dealers) ? dealers : [];
    const signature = list.map(dealer => dealer && dealer.id + ':' + dealer.tier).join('|');
    if (signature === blipSignature) return;
    blipSignature = signature;
    els.blips.textContent = '';
    list.forEach((dealer, index) => {
      if (!dealer || !TIER_CLASSES[dealer.tier]) return;
      const id = Number.isSafeInteger(dealer.id) ? dealer.id : index + 1;
      const blip = root.document.createElement('span');
      blip.className = 'street-blip ' + TIER_CLASSES[dealer.tier];
      // Deterministic spread so a dealer keeps its corner of the map between refreshes.
      blip.style.left = (8 + ((id * 37) % 84)) + '%';
      blip.style.top = (10 + ((id * 53) % 76)) + '%';
      blip.setAttribute('title', dealer.tier + ' dealer #' + id);
      els.blips.appendChild(blip);
    });
  }

  function refresh() {
    if (!els) return;
    const ready = engineReady();
    els.unavailable.hidden = ready;
    els.hire.disabled = !ready;
    els.launder.disabled = !ready;

    const state = ready ? root.playerState : null;
    setText(els.dirty, formatMoney(state ? Number(state.cash) : 0));
    setText(els.clean, formatMoney(state ? Number(state.launderedCash) : 0));
    setText(els.dealers, String(state && Array.isArray(state.dealers) ? state.dealers.length : 0));
    renderBlips(state ? state.dealers : []);

    const suspicion = readSuspicion();
    const pct = suspicion.valid ? +suspicion.shown.toFixed(2) : 0;
    els.fill.style.width = pct + '%';
    els.fill.classList.toggle('street-meter-empty', pct === 0);
    setText(els.value, suspicion.valid ? pct + '%' : '--%');
    if (suspicion.valid) setAttr(els.bar, 'aria-valuenow', String(pct));
    else els.bar.removeAttribute('aria-valuenow');
    setAttr(els.bar, 'aria-valuetext', suspicion.valid ? pct + ' percent' : 'unknown');

    const panic = suspicion.valid && suspicion.raw > PANIC_ABOVE;
    if (els.panel.classList.contains('street-panic') !== panic) {
      els.panel.classList.toggle('street-panic', panic);
    }
    els.warning.hidden = !panic;
  }

  function removeFloat(node) {
    if (!floats.delete(node)) return;
    node.remove();
  }

  function floatResult(tier) {
    const node = root.document.createElement('span');
    node.className = 'street-float ' + TIER_CLASSES[tier];
    node.textContent = tier;
    node.setAttribute('aria-hidden', 'true'); // The status region announces the result.
    node.style.left = (50 + ((floatCount++ % 5) - 2) * 6) + '%';
    floats.add(node);
    els.floatLayer.appendChild(node);
    node.addEventListener('animationend', () => removeFloat(node));
    // Fallback for environments where the animation never fires (e.g. animations disabled).
    root.setTimeout(() => removeFloat(node), FLOAT_MS + 400);
  }

  function hire() {
    if (!els) return;
    if (!engineReady()) {
      say('Engine unavailable: cannot hire dealers.', 'error');
      return refresh();
    }
    const state = root.playerState;
    if (!(Number(state.cash) >= HIRE_COST)) {
      say('Insufficient funds: a dealer costs ' + formatMoney(HIRE_COST) + ' dirty cash.', 'error');
      return refresh();
    }
    let dealer = null;
    try {
      dealer = root.hireDealer(root.rollDealerGacha());
    } catch (error) {
      dealer = null;
    }
    if (!dealer || !TIER_CLASSES[dealer.tier]) {
      say('Recruitment failed. You were not charged.', 'error');
      return refresh();
    }
    state.cash = money(state.cash - HIRE_COST);
    floatResult(dealer.tier);
    say('Hired a ' + dealer.tier + ' dealer for ' + formatMoney(HIRE_COST) + '.', 'success');
    refresh();
  }

  function launder() {
    if (!els) return;
    if (!engineReady()) {
      say('Engine unavailable: cannot launder cash.', 'error');
      return refresh();
    }
    const before = Number(root.playerState.cash);
    if (!(before > 0)) {
      say('No dirty cash to launder.', 'error');
      return refresh();
    }
    let clean = 0;
    try {
      clean = Number(root.launderCash());
    } catch (error) {
      clean = 0;
    }
    if (!(clean > 0)) say('Laundering failed. Nothing changed.', 'error');
    else say('Laundered ' + formatMoney(before) + ' into ' + formatMoney(clean) +
      ' clean cash. Suspicion is unchanged.', 'success');
    refresh();
  }

  function destroy() {
    if (timerId !== null) root.clearInterval(timerId);
    timerId = null;
    if (els) {
      els.hire.removeEventListener('click', hire);
      els.launder.removeEventListener('click', launder);
      for (const node of Array.from(floats)) removeFloat(node);
      els.panel.classList.remove('street-panic');
    }
    floats.clear();
    els = null;
    blipSignature = '';
  }

  function init() {
    if (els) destroy(); // Never stack a second set of handlers or timers.
    const ids = {
      panel: 'street-panel', blips: 'street-map-blips', hire: 'street-hire-btn',
      launder: 'street-launder-btn', floatLayer: 'street-float-layer', status: 'street-status',
      dirty: 'street-dirty-cash', clean: 'street-clean-cash', dealers: 'street-dealer-count',
      bar: 'street-suspicion-bar', fill: 'street-suspicion-fill', value: 'street-suspicion-value',
      warning: 'street-panic-warning', unavailable: 'street-unavailable'
    };
    const found = {};
    for (const key of Object.keys(ids)) {
      found[key] = byId(ids[key]);
      if (!found[key]) return; // Markup missing: stay inert rather than throw.
    }
    els = found;
    els.hire.addEventListener('click', hire);
    els.launder.addEventListener('click', launder);
    refresh();
    timerId = root.setInterval(refresh, REFRESH_MS);
  }

  root.StreetUI = { init, refresh, destroy, HIRE_COST };
  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(globalThis);

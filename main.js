/* Breaking Bad — main.js: bridges the DOM and engine.js.
 * Load last (after engine.js, lab-ui.js and street-ui.js). It owns Start Cook, the 3-second
 * cook animation, cook result notifications, the dealer roster, the top HUD, the floating cash
 * text, the Vacuum Repairman escape button, the visual inventory tray, the Flawless Blue alert/video
 * reveal and the end-game scorecard (ESCAPED / BUSTED). It
 * recreates no game math: costs, timers, yields, quality, hiring odds, laundering
 * and raids all stay in the engine, and it never calls tick(). Add Lab Slot charges the engine's
 * next slot price once. Hire Dealer and Launder Money
 * clicks are handled once by street-ui.js (roll -> hire -> $500); this file only renders
 * their outcome. switchView(target) swaps the Lab / Streets screens by toggling .hidden only. Loading this script again replaces the previous instance.
 */
(function (root) {
  'use strict';

  const ANIMATION_MS = 3000; // Presentation only; real cooks use the engine's minute-scale timers.
  const REFRESH_MS = 100;
  const MAX_RESULTS = 5;
  const CASH_SHORTCUT_AMOUNT = 1000000;
  const FLOAT_MS = 1000; // Matches the floating-text animation duration.
  const ESCAPE_THRESHOLD = 1000000; // Laundered cash that offers the Vacuum Repairman.
  const MAX_TICK_JUMP = 10; // A bigger per-frame jump in timeTicks means a preset was loaded.
  const DEALER_NAMES = Object.freeze({
    Common: 'Street Hustler', Rare: 'Middle-Man', Legendary: 'Cartel Distributor'
  });
  const TIER_CLASSES = Object.freeze({
    Common: 'street-tier-common', Rare: 'street-tier-rare', Legendary: 'street-tier-legendary'
  });
  const FLAWLESS_ALERT_MS = 3000; // Matches the flawless-pop animation duration in index.html.
  const FLAWLESS_FALLBACK_MS = 3000; // How long the still stays up when the video cannot play.
  const FLAWLESS_VIDEO_MAX_MS = 12000; // The clip is 10 s; this only guards a stalled player.
  const MAX_PENDING_CELEBRATIONS = 3;
  // Supplied artwork by quality grade (1 = lowest). The score-to-grade rule is the engine's
  // gradeForScore(); gradeOf() below only reads the grade a lot was given.
  const GRADES = Object.freeze({
    1: Object.freeze({ src: 'assets/grade_1.png', label: 'Street Grade, 50% purity' }),
    2: Object.freeze({ src: 'assets/grade_2.png', label: 'Poor Lab Grade, 60% purity' }),
    3: Object.freeze({ src: 'assets/grade_3.png', label: 'Lab Grade, 75% purity' }),
    4: Object.freeze({ src: 'assets/grade_4.png', label: 'High Purity, 90% purity' }),
    5: Object.freeze({ src: 'assets/flawless_batch.png', label: 'top grade' })
  });
  const FLAWLESS = 'Flawless Blue';
  const QUALITY_HEISENBERG = '99.1% (HEISENBERG GRADE)';
  const QUALITY_STREET = '74% (STREET GRADE)';
  const DEALER_PORTRAITS = Object.freeze({
    Common: Object.freeze({ src: 'assets/dealer_hustler.jpg', alt: 'Street Hustler mugshot' }),
    Rare: Object.freeze({ src: 'assets/dealer_mid.jpg', alt: 'Middle-Man mugshot' }),
    Legendary: Object.freeze({ src: 'assets/dealer_cartel.jpg', alt: 'Cartel Distributor mugshot' })
  });
  // Cash pop-ups land inside these map percentages so the text never clips at an edge.
  const FLOAT_LEFT = Object.freeze({ min: 18, span: 64 });
  const FLOAT_TOP = Object.freeze({ min: 18, span: 56 });
  const IDS = {
    hudCash: 'hud-cash', hudInventory: 'hud-inventory', hudFill: 'hud-suspicion-fill', viewport: 'game-viewport',
    navLab: 'nav-lab', navStreet: 'nav-street', labContainer: 'lab-container', streetContainer: 'street-container',
    hudLaundered: 'hud-laundered', hudSuspicion: 'hud-suspicion', hud: 'hud',
    music: 'music-btn', start: 'cook-start-btn', buySlot: 'lab-buy-slot', selection: 'cook-selection', progress: 'cook-progress',
    results: 'cook-results', roster: 'dealer-roster', floatLayer: 'cash-float-layer',
    vacuum: 'vacuum-btn', bribe: 'street-bribe-btn', modal: 'scorecard-modal', scoreTitle: 'scorecard-title',
    scoreStatus: 'scorecard-status', scoreProfit: 'scorecard-profit', scoreTicks: 'scorecard-ticks',
    dismiss: 'scorecard-dismiss', scoreQuality: 'scorecard-quality', scoreReputation: 'scorecard-reputation',
    scoreEvasion: 'scorecard-evasion', tray: 'inventory-tray', flawlessAlert: 'flawless-alert',
    flawlessReveal: 'flawless-reveal', flawlessVideo: 'flawless-video'
  };

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
  const formatMoney = value => '$' + (isFiniteNumber(value) ? value : 0)
    .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatPercent = value => (isFiniteNumber(value)
    ? +Math.min(100, Math.max(0, value)).toFixed(2) : 0) + '%';

  function createMain(env) {
    const doc = env.document;
    const engine = env.engine; // Getters over the engine globals, read on every use.
    const lab = env.lab || {};
    const setTimer = env.setInterval;
    const clearTimer = env.clearInterval;
    const setLater = env.setTimeout;
    const playClick = typeof env.playClick === 'function' ? env.playClick : () => {};
    const clearLater = env.clearTimeout;

    let els = null;
    let timerId = null;
    let sceneTimer = null;
    let scenePulse = 0;
    let listeners = [];
    let tracked = new Map(); // batch id -> { id, compoundId, workflowType, name, animTimer }
    let lastRaidCount = null;
    let lastTicks = null;
    let lastNextBatchId = null;
    let lastCash = null;
    let floats = new Map(); // floating-text node -> removal timer
    let ended = false;
    let rosterKey = null;
    let departuresSeen = 0;
    let restoreFocus = null;
    let audioStarted = false;
    let musicOn = true; // Music-only mute for this page session; effects and dialogue are unaffected.
    let flawlessCooked = false; // Run history: a Flawless Blue was cooked, even if its stock is sold.
    let traySignature = null; // Last rendered stacks, so unchanged frames leave the DOM alone.
    let pendingCelebrations = 0;
    let celebration = null; // { stage: 'alert' | 'reveal', timer, safety }
    function audio(name, ...args) {
      try { if (typeof env[name] === 'function') env[name](...args); } catch (error) { /* Optional audio. */ }
    }

    function renderMusicButton() {
      setText(els.music, musicOn ? 'Music: On' : 'Music: Off');
      els.music.setAttribute('aria-pressed', String(musicOn));
    }

    function toggleMusic() {
      musicOn = !musicOn;
      renderMusicButton();
      audio('setMusicEnabled', musicOn);
    }

    function on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    }

    const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
    const state = () => (engine.playerState && typeof engine.playerState === 'object'
      ? engine.playerState : null);
    const engineReady = () => typeof engine.startCook === 'function' && !!state();

    function compoundName(id) {
      const compounds = Array.isArray(engine.compounds) ? engine.compounds : [];
      const compound = compounds.find(entry => entry.id === id);
      return compound && compound.name ? compound.name : String(id);
    }

    function say(message, kind) {
      if (typeof lab.feedback === 'function') lab.feedback(message, kind);
    }

    // ----- Start Cook and the 3-second animation -----

    function playAnimation() {
      // Restart the CSS animation: drop the state, force a reflow, then set it again.
      els.progress.setAttribute('data-state', 'idle');
      void els.progress.offsetWidth;
      els.progress.setAttribute('data-state', 'running');
    }

    function stopAnimationIfIdle() {
      if (![...tracked.values()].some(entry => entry.animTimer !== null)) {
        els.progress.setAttribute('data-state', 'idle');
      }
    }

    function dropTracked(entry) {
      if (entry.animTimer !== null) clearLater(entry.animTimer);
      entry.animTimer = null;
      tracked.delete(entry.id);
    }

    function isActive(entry) {
      const current = state();
      const active = current && Array.isArray(current.activeBatches) ? current.activeBatches : [];
      return active.some(batch => batch && batch.id === entry.id && batch.compoundId === entry.compoundId);
    }

    // The animation only says "accepted". Completion is announced from engine state.
    function animationDone(entry) {
      entry.animTimer = null;
      if (tracked.get(entry.id) === entry && isActive(entry)) {
        const batch = state().activeBatches.find(item => item.id === entry.id);
        const left = Number.isFinite(batch.remainingTicks) ? Math.max(0, Math.ceil(batch.remainingTicks)) : null;
        say(`${entry.name} is still cooking${left === null ? '' : ` — ${formatDuration(left)} left`}. Results appear when the batch finishes.`, 'ok');
      }
      stopAnimationIfIdle();
    }

    function startCook() {
      if (!els) return null;
      const selection = typeof lab.getSelection === 'function' ? lab.getSelection() : null;
      if (!engineReady() || !selection) {
        say('Engine unavailable — cannot start a cook.', 'error');
        return null;
      }
      let batch = null;
      try {
        batch = engine.startCook(selection.compoundId, selection.workflowType);
      } catch (error) {
        say('Engine error — cook not started.', 'error');
        return null;
      }
      if (!batch) {
        say(`${selection.workflowType} cook rejected — check cash and free lab slots.`, 'error');
        return null;
      }
      const entry = {
        id: batch.id, compoundId: batch.compoundId, workflowType: batch.workflowType,
        name: `${compoundName(batch.compoundId)} · ${batch.workflowType}`, animTimer: null
      };
      tracked.set(entry.id, entry);
      entry.animTimer = setLater(() => animationDone(entry), ANIMATION_MS);
      playAnimation();
      say(`${entry.name} cook started.`, 'ok');
      renderSelection();
      if (typeof env.refreshPanels === 'function') env.refreshPanels();
      return batch;
    }

    function slotPriceText(cost) {
      return '$' + String(cost).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function quotedSlotCost() {
      if (typeof engine.nextSlotCost !== 'function') return null;
      try {
        const cost = engine.nextSlotCost();
        return Number.isFinite(cost) && cost >= 0 ? cost : null;
      } catch (error) {
        return null;
      }
    }

    function buyLabSlot() {
      if (!els) return null;
      if (typeof engine.buyLabSlot !== 'function' || !state()) {
        say('Engine unavailable — cannot add a lab slot.', 'error');
        return null;
      }
      const cost = quotedSlotCost();
      let slots = null;
      try {
        slots = engine.buyLabSlot();
      } catch (error) {
        say('Engine error — lab slot not added.', 'error');
        return null;
      }
      if (!slots) {
        say(cost === null
          ? 'No lab slot is for sale.'
          : `Not enough cash for a lab slot (${slotPriceText(cost)}).`, 'error');
        renderSelection();
        return null;
      }
      say(`Lab slot added. ${slots} total.`, 'ok');
      renderSelection();
      if (typeof env.refreshPanels === 'function') env.refreshPanels();
      return slots;
    }

    function onBonusKey(event) {
      const target = event.target;
      const bonusKey = event.code === 'KeyU' ||
        (typeof event.key === 'string' && event.key.toLowerCase() === 'u');
      if (ended || !els || event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
          event.isComposing || !bonusKey ||
          (target && (target.isContentEditable || (typeof target.closest === 'function' &&
            target.closest('input, textarea, [contenteditable]'))))) return;
      const selection = typeof lab.getSelection === 'function' ? lab.getSelection() : null;
      if (!selection || typeof engine.grantFlawlessBatch !== 'function') return;
      const lot = engine.grantFlawlessBatch(selection.compoundId, selection.workflowType);
      if (!lot) return;
      if (event.preventDefault) event.preventDefault();
      audioStarted = true;
      audio('startBGM');
      audio('playCookComplete', true);
      flawlessCooked = true;
      addResult({ name: `${compoundName(lot.compoundId)} · ${selection.workflowType}` }, lot);
      celebrateFlawless();
      say(`Flawless Blue ready — ${lot.quantity} units.`, 'ok');
      if (typeof env.refreshPanels === 'function') env.refreshPanels();
      frame();
    }

    function onCashKey(event) {
      const target = event.target;
      const cashKey = event.code === 'Digit8' || event.code === 'Numpad8' || event.key === '8';
      if (ended || !els || event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
          event.isComposing || !cashKey || typeof engine.grantCash !== 'function' ||
          (target && (target.isContentEditable || (typeof target.closest === 'function' &&
            target.closest('input, textarea, select, [contenteditable]'))))) return;
      if (!engine.grantCash(CASH_SHORTCUT_AMOUNT)) return;
      if (event.preventDefault) event.preventDefault();
      if (typeof env.refreshPanels === 'function') env.refreshPanels();
      frame();
    }

    function renderSelection() {
      const selection = typeof lab.getSelection === 'function' ? lab.getSelection() : null;
      const cost = quotedSlotCost();
      els.start.disabled = !engineReady() || !selection;
      els.buySlot.disabled = typeof engine.buyLabSlot !== 'function' || !state() || cost === null;
      setText(els.buySlot, cost === null ? 'Add Lab Slot' : `Add Lab Slot (${slotPriceText(cost)})`);
      const quote = selection && typeof engine.cookQuote === 'function'
        ? engine.cookQuote(selection.compoundId, selection.workflowType) : null;
      const timing = quote ? ` · ${formatDuration(quote.duration)} · ${quote.quantity} units` : '';
      setText(els.selection, selection
        ? `Selected: ${compoundName(selection.compoundId)} · ${selection.workflowType}${timing}` : '');
    }

    // ----- Results -----

    function addResult(entry, lot) {
      const flawless = lot.quality === 'Flawless Blue';
      const item = doc.createElement('li');
      item.className = flawless ? 'cook-result neon-cyan-glow' : 'cook-result';
      item.textContent = `${flawless ? '★ ' : ''}${entry.name} complete — ${lot.quantity} units, ${lot.quality}`;
      els.results.prepend(item);
      while (els.results.children.length > MAX_RESULTS) {
        els.results.children[els.results.children.length - 1].remove();
      }
    }

    // Brief lab-scene effect for one confirmed engine completion (presentation only). The
    // attribute alternates 1/2 so a back-to-back completion restarts the CSS animation.
    function pulseScene(flawless) {
      const scene = doc.getElementById('lab-scene');
      if (!scene) return;
      scenePulse = scenePulse === 1 ? 2 : 1;
      scene.setAttribute('data-complete', String(scenePulse));
      scene.setAttribute('data-flawless', String(Boolean(flawless)));
      if (sceneTimer !== null) clearLater(sceneTimer);
      sceneTimer = setLater(clearScenePulse, 1400);
    }

    function clearScenePulse() {
      if (sceneTimer !== null) clearLater(sceneTimer);
      sceneTimer = null;
      const scene = doc.getElementById('lab-scene');
      if (!scene) return;
      scene.removeAttribute('data-complete');
      scene.removeAttribute('data-flawless');
    }

    // quiet: only record run history (used when the run ends); no sound, result or celebration.
    function scanBatches(quiet = false) {
      const current = state();
      const lots = current && Array.isArray(current.completedBatches) ? current.completedBatches : [];
      for (const entry of [...tracked.values()]) {
        if (isActive(entry)) continue;
        // Gone from the lab: a real completion leaves a lot with the same id and compound.
        const lot = lots.find(item => item && item.id === entry.id && item.compoundId === entry.compoundId);
        if (lot) {
          const flawless = lot.quality === FLAWLESS;
          if (flawless) flawlessCooked = true;
          if (!quiet) {
            audio('playCookComplete', flawless);
            pulseScene(flawless);
            addResult(entry, lot);
            say(`${entry.name} finished.`, 'ok'); // Replaces a stale "still cooking" message.
            if (flawless) celebrateFlawless();
          }
        }
        dropTracked(entry);
      }
      stopAnimationIfIdle();
    }

    function clearCookUi() {
      for (const entry of [...tracked.values()]) dropTracked(entry);
      els.progress.setAttribute('data-state', 'idle');
      clearScenePulse();
      els.results.replaceChildren();
      say('', 'info');
    }

    // ----- Visual inventory: one stack (image + exact count) per occupied quality grade -----

    const isGrade = value => Number.isInteger(value) && value >= 1 && value <= 5;

    // Quality grade of a lot (1-5), which picks the artwork. The engine grades each lot once, from
    // its cooking-result score (grade 5 is the Flawless Blue outcome), and dealer splits copy it,
    // so settings and price changes never relabel stock. A lot with no valid saved grade is
    // grade 1: the grade is never inferred from current settings or the selling price.
    function gradeOf(lot) {
      if (lot.quality === FLAWLESS) return 5;
      return isGrade(lot.grade) && lot.grade < 5 ? lot.grade : 1;
    }

    const unitsText = count => `${count} ${count === 1 ? 'unit' : 'units'}`;

    // The group carries the accessible name (grade and exact count); the image is decorative and
    // the visible "×N" is hidden from assistive technology so it is not read twice.
    function makeStackNode(grade, count) {
      const flawless = grade === 5;
      const stack = doc.createElement('span');
      stack.className = flawless ? 'inventory-stack inventory-stack-flawless' : 'inventory-stack';
      stack.setAttribute('role', 'group');
      stack.setAttribute('data-grade', String(grade));
      stack.setAttribute('aria-label', `${flawless ? 'Flawless Blue, grade 5' : `Grade ${grade}: ${GRADES[grade].label}`}: ${unitsText(count)}`);
      const img = doc.createElement('img');
      img.className = flawless ? 'inventory-item flawless-glow' : 'inventory-item';
      img.setAttribute('src', GRADES[grade].src);
      img.setAttribute('alt', '');
      img.setAttribute('data-grade', String(grade));
      const amount = doc.createElement('span');
      amount.className = 'inventory-count';
      amount.setAttribute('aria-hidden', 'true');
      amount.textContent = `\u00d7${count}`;
      stack.append(img, amount);
      return stack;
    }

    // Sum the remaining units of every lot (dealer-held stock included) per grade and draw one
    // stack for each nonempty grade, 1 through 5. Stateless, so sales, splits, presets and
    // simultaneous cooking always show the current stock and never touch the engine.
    function renderTray(current) {
      const lots = current && Array.isArray(current.completedBatches) ? current.completedBatches : [];
      const counts = new Map();
      for (const lot of lots) {
        if (!lot || !isFiniteNumber(lot.quantity) || lot.quantity < 1) continue;
        const grade = gradeOf(lot);
        counts.set(grade, (counts.get(grade) || 0) + Math.floor(lot.quantity));
      }
      const grades = [1, 2, 3, 4, 5].filter(grade => counts.has(grade));
      const signature = grades.map(grade => `${grade}:${counts.get(grade)}`).join('|');
      if (signature === traySignature) return;
      traySignature = signature;
      const total = grades.reduce((sum, grade) => sum + counts.get(grade), 0);
      els.tray.setAttribute('aria-label', `Inventory: ${unitsText(total)}`);
      els.tray.replaceChildren(...grades.map(grade => makeStackNode(grade, counts.get(grade))));
    }

    // ----- Flawless Blue celebration: alert image, then the muted video; queued, never stacked -----

    function hideCelebration() {
      els.flawlessAlert.hidden = true;
      els.flawlessAlert.classList.toggle('is-playing', false);
      els.flawlessReveal.hidden = true;
      els.flawlessReveal.classList.toggle('is-fallback', false);
      try { if (typeof els.flawlessVideo.pause === 'function') els.flawlessVideo.pause(); } catch (error) { /* Optional media. */ }
    }

    function clearCelebrationTimers() {
      if (celebration) {
        if (celebration.timer !== null) clearLater(celebration.timer);
        if (celebration.safety !== null) clearLater(celebration.safety);
      }
    }

    function cancelCelebration() {
      clearCelebrationTimers();
      celebration = null;
      pendingCelebrations = 0;
      if (els) hideCelebration();
    }

    function nextCelebration() {
      clearCelebrationTimers();
      celebration = null;
      hideCelebration();
      if (pendingCelebrations > 0) {
        pendingCelebrations--;
        startAlert();
      }
    }

    function startAlert() {
      celebration = { stage: 'alert', timer: null, safety: null };
      els.flawlessReveal.hidden = true;
      els.flawlessAlert.hidden = false;
      // Restart the keyframes: drop the class, force a reflow, add it back.
      els.flawlessAlert.classList.toggle('is-playing', false);
      void els.flawlessAlert.offsetWidth;
      els.flawlessAlert.classList.toggle('is-playing', true);
      const mine = celebration;
      mine.timer = setLater(() => { if (celebration === mine) startReveal(); }, FLAWLESS_ALERT_MS);
    }

    function startReveal() {
      const mine = celebration;
      mine.stage = 'reveal';
      mine.timer = null;
      els.flawlessAlert.hidden = true;
      els.flawlessAlert.classList.toggle('is-playing', false);
      els.flawlessReveal.hidden = false;
      mine.safety = setLater(() => { if (celebration === mine) nextCelebration(); }, FLAWLESS_VIDEO_MAX_MS);
      const video = els.flawlessVideo;
      try {
        if (typeof video.play !== 'function') throw new Error('no video playback');
        try { video.currentTime = 0; } catch (error) { /* Not seekable yet. */ }
        const started = video.play();
        if (started && typeof started.catch === 'function') {
          started.catch(() => { if (celebration === mine) revealFailed(); });
        }
      } catch (error) {
        revealFailed();
      }
    }

    // The video's poster is the grade-5 still: when the clip cannot play, that still stays up briefly.
    function revealFailed() {
      if (!celebration || celebration.stage !== 'reveal' || celebration.timer !== null) return;
      const mine = celebration;
      els.flawlessReveal.classList.toggle('is-fallback', true);
      mine.timer = setLater(() => { if (celebration === mine) nextCelebration(); }, FLAWLESS_FALLBACK_MS);
    }

    function revealEnded() {
      if (celebration && celebration.stage === 'reveal') nextCelebration();
    }

    // A confirmed new Flawless Blue completion (tracked cook or the U bonus). Presets,
    // historical stock and repeated frames never reach this.
    function celebrateFlawless() {
      if (ended || !els) return;
      if (celebration) {
        if (pendingCelebrations < MAX_PENDING_CELEBRATIONS) pendingCelebrations++;
        return;
      }
      startAlert();
    }

    function resetRunHistory() {
      flawlessCooked = false;
      cancelCelebration();
      traySignature = null;
    }

    // ----- HUD and roster -----

    function renderHud(current) {
      setText(els.hudCash, formatMoney(current ? current.cash : 0));
      setText(els.hudLaundered, formatMoney(current ? current.launderedCash : 0));
      setText(els.hudSuspicion, current && isFiniteNumber(current.suspicion)
        ? formatPercent(current.suspicion) : '--%');
      const panic = !!current && current.suspicion > 80;
      els.hud.setAttribute('data-panic', String(panic));
      els.viewport.classList.toggle('panic-mode', panic);
      els.streetContainer.classList.toggle('street-heat', panic);
      els.hudFill.style.width = current && isFiniteNumber(current.suspicion)
        ? +Math.min(100, Math.max(0, current.suspicion)).toFixed(2) + '%' : '0%';
      setText(els.hudInventory, String(inventoryTotal(current)));
      renderTray(current);
    }

    // Sum of remaining units across every compound (dealer stock is already included once).
    function inventoryTotal(current) {
      const stock = current && current.inventory && typeof current.inventory === 'object' ? current.inventory : {};
      let total = 0;
      for (const units of Object.values(stock)) if (isFiniteNumber(units) && units > 0) total += units;
      return total;
    }

    // Remaining/max units for a dealer card; counter-less dealers are at full capacity.
    function dealerCapacity(dealer) {
      const tiers = engine.dealerTiers || {};
      const max = dealer && tiers[dealer.tier] ? tiers[dealer.tier].capacity : 0;
      const sold = dealer && isFiniteNumber(dealer.unitsSold) && dealer.unitsSold > 0 ? dealer.unitsSold : 0;
      return Math.max(0, max - sold);
    }

    // Brief message for each dealer that wore out since the last render.
    function announceDepartures(current) {
      const log = current && Array.isArray(current.dealerDepartures) ? current.dealerDepartures : [];
      if (log.length < departuresSeen) departuresSeen = 0; // Fresh run replaced the state.
      for (const gone of log.slice(departuresSeen)) {
        // Shown on the Streets screen; the lab feedback line is hidden while the player is there.
        const message = `${DEALER_NAMES[gone.tier] || gone.tier} #${gone.id} wore out and left the network.`;
        const status = doc.getElementById('street-status');
        if (status) {
          status.textContent = message;
          status.setAttribute('data-kind', 'info');
        }
        say(message, 'info');
      }
      departuresSeen = log.length;
    }

    function renderRoster(current) {
      const dealers = current && Array.isArray(current.dealers) ? current.dealers : [];
      const key = dealers.map(dealer => dealer && `${dealer.id}:${dealer.tier}:${dealerCapacity(dealer)}`).join('|');
      announceDepartures(current);
      if (key === rosterKey) return;
      rosterKey = key;
      const items = dealers.filter(dealer => dealer && DEALER_NAMES[dealer.tier]).map(dealer => {
        const item = doc.createElement('li');
        item.className = `dealer-card ${TIER_CLASSES[dealer.tier]}`;
        const portrait = doc.createElement('img');
        portrait.className = 'dealer-mugshot';
        portrait.setAttribute('src', DEALER_PORTRAITS[dealer.tier].src);
        portrait.setAttribute('alt', DEALER_PORTRAITS[dealer.tier].alt);
        const info = doc.createElement('div');
        info.className = 'dealer-info';
        const name = doc.createElement('span');
        name.className = 'roster-name';
        name.textContent = DEALER_NAMES[dealer.tier];
        const tier = doc.createElement('span');
        tier.className = 'roster-tier';
        tier.textContent = `${dealer.tier} · #${dealer.id}`;
        const max = (engine.dealerTiers && engine.dealerTiers[dealer.tier] || {}).capacity || 1;
        const left = Math.min(max, dealerCapacity(dealer));
        const low = left / max < 0.2;
        const capacity = doc.createElement('span');
        capacity.className = 'dealer-capacity-label';
        capacity.textContent = `${left}/${max} units${low ? ' · Wearing out' : ''}`;
        if (low) capacity.setAttribute('data-low', 'true');
        const bar = doc.createElement('span');
        bar.className = 'dealer-capacity-bar';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', 'Dealer capacity');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(max));
        bar.setAttribute('aria-valuenow', String(left));
        const fill = doc.createElement('span');
        fill.className = 'dealer-capacity-fill';
        fill.style.width = `${+(left / max * 100).toFixed(2)}%`;
        bar.append(fill);
        info.append(name, tier, capacity, bar);
        item.append(portrait, info);
        return item;
      });
      if (items.length === 0) {
        const empty = doc.createElement('li');
        empty.className = 'roster-empty';
        empty.textContent = 'No dealers hired yet.';
        items.push(empty);
      }
      els.roster.replaceChildren(...items);
    }

    // ----- Floating cash -----

    function floatCash(amount) {
      const node = doc.createElement('div');
      node.className = 'floating-text';
      node.textContent = '+' + formatMoney(amount);
      // Independent left/top roll: a different city block for each sale.
      node.style.left = (FLOAT_LEFT.min + Math.random() * FLOAT_LEFT.span).toFixed(2) + '%';
      node.style.top = (FLOAT_TOP.min + Math.random() * FLOAT_TOP.span).toFixed(2) + '%';
      els.floatLayer.appendChild(node);
      floats.set(node, setLater(() => {
        floats.delete(node);
        node.remove();
      }, FLOAT_MS));
    }

    function clearFloats() {
      for (const [node, timer] of floats) {
        clearLater(timer);
        node.remove();
      }
      floats = new Map();
    }

    // ----- Vacuum Repairman and the scorecard -----

    function setBackgroundInert(value) {
      if (els.page) els.page.inert = value;
      els.hud.inert = value;
    }

    function endGame(status, current) {
      if (ended) return;
      ended = true;
      audio('stopCookAudio');
      audio('stopSiren');
      audio('stopBGM');
      if (status === 'BUSTED' && audioStarted) audio('playStatic');
      scanBatches(true); // A Flawless finishing on the ending tick still counts for this run.
      cancelCelebration(); // The ending outranks any celebration.
      // The scorecard holds this snapshot; later engine changes never reach it.
      const profit = (isFiniteNumber(current.cash) ? current.cash : 0) +
        (isFiniteNumber(current.launderedCash) ? current.launderedCash : 0);
      const ticks = isFiniteNumber(current.timeTicks) ? current.timeTicks : 0;
      const evasion = isFiniteNumber(current.suspicion) ? formatPercent(100 - current.suspicion) : '--%';
      if (typeof engine.stopGameLoop === 'function') engine.stopGameLoop();
      clearCookUi();
      clearFloats();
      renderHud(current);
      renderRoster(current);
      if (typeof env.refreshPanels === 'function') env.refreshPanels();
      els.modal.setAttribute('data-outcome', status.toLowerCase());
      setText(els.scoreTitle, status === 'ESCAPED' ? 'Vacuum Repairman' : 'DEA Raid');
      setText(els.scoreStatus, `Final Status: ${status}`);
      setText(els.scoreProfit, `Total Net Profit: ${formatMoney(profit)}`);
      setText(els.scoreQuality, `Scientific Quality Index: ${flawlessCooked ? QUALITY_HEISENBERG : QUALITY_STREET}`);
      setText(els.scoreReputation, `Reputation Score: ${ticks * 2}`);
      setText(els.scoreEvasion, `Legal Evasion Rating: ${evasion}`);
      setText(els.scoreTicks, `Total Ticks Survived: ${ticks}`);
      restoreFocus = doc.activeElement || null;
      els.vacuum.disabled = true;
      els.modal.hidden = false;
      setBackgroundInert(true);
      els.dismiss.focus();
    }

    function callVacuum() {
      const current = state();
      if (ended || !current || !(current.launderedCash >= ESCAPE_THRESHOLD)) return;
      // A win drops carried money. A missing or failing clear never blocks the escape.
      try {
        if (typeof engine.clearSave === 'function') engine.clearSave();
      } catch (error) { /* storage trouble must not break the scorecard */ }
      endGame('ESCAPED', current);
    }

    function renderVacuum(current) {
      const eligible = !ended && !!current && current.launderedCash >= ESCAPE_THRESHOLD;
      els.vacuum.hidden = !eligible;
      els.vacuum.classList.toggle('neon-cyan-glow', eligible);
    }

    // Closing the scorecard never resumes the run; the background stays locked.
    function dismissScorecard() {
      if (!els || els.modal.hidden) return;
      els.modal.hidden = true;
      const target = restoreFocus;
      restoreFocus = null;
      if (target && typeof target.focus === 'function') target.focus();
    }

    function onModalKey(event) {
      if (event.key === 'Escape') {
        if (event.preventDefault) event.preventDefault();
        dismissScorecard();
      } else if (event.key === 'Tab') {
        // The close button is the only focusable control: keep focus inside the dialog.
        if (event.preventDefault) event.preventDefault();
        els.dismiss.focus();
      }
    }

    // ----- Render loop -----

    function frame() {
      if (!els || ended) return;
      const current = state();
      if (current) {
        const ticks = isFiniteNumber(current.timeTicks) ? current.timeTicks : null;
        const nextId = isFiniteNumber(current.nextBatchId) ? current.nextBatchId : null;
        const previousTicks = lastTicks;
        const reset = lastTicks !== null && ticks !== null &&
          (ticks < lastTicks || ticks - lastTicks > MAX_TICK_JUMP ||
           (lastNextBatchId !== null && nextId !== null && nextId < lastNextBatchId));
        lastTicks = ticks;
        lastNextBatchId = nextId;

        const raids = isFiniteNumber(current.raidCount) ? current.raidCount : null;
        if (reset) { // Judge Mode preset: nothing tracked is real any more, and the run starts over.
          clearCookUi();
          resetRunHistory();
        }
        if (raids !== null) {
          const raided = lastRaidCount !== null && raids > lastRaidCount && !reset;
          lastRaidCount = raids;
          if (raided) {
            endGame('BUSTED', current); // Post-seizure state: the engine already ran the raid.
            return;
          }
        }
        // Cash that rose across an ordinary one-second tick is earnings; presets are not.
        const ticked = !reset && ticks !== null && previousTicks !== null && ticks > previousTicks;
        if (ticked && isFiniteNumber(current.cash) && lastCash !== null && current.cash > lastCash) {
          floatCash(current.cash - lastCash);
        }
        lastCash = isFiniteNumber(current.cash) ? current.cash : null;
        scanBatches();
        if (audioStarted) audio(current.suspicion > 80 ? 'playSiren' : 'stopSiren');
      }
      renderHud(current);
      renderVacuum(current);
      renderRoster(current);
      renderSelection();
      renderBribe();
    }

    function bribeCost() {
      const cost = state() && state().bribeCost;
      return isFiniteNumber(cost) && cost > 0 ? cost : 1000;
    }

    const bribeLabel = cost => `Bribe Informant (${slotPriceText(cost)})`;

    function renderBribe() {
      const current = state();
      const cost = bribeCost();
      setText(els.bribe, bribeLabel(cost));
      els.bribe.setAttribute('data-affordable', String(!!current && current.cash >= cost));
    }

    function bribe() {
      if (!els || typeof engine.bribeDEA !== 'function' || !state()) return;
      const cost = bribeCost();
      let paid = false;
      try { paid = engine.bribeDEA(); } catch (error) { paid = false; }
      say(paid ? `Informant bribed for ${slotPriceText(cost)}. Suspicion down.`
        : `Not enough cash to bribe (${slotPriceText(cost)}).`, paid ? 'ok' : 'error');
      renderBribe();
      if (typeof env.refreshPanels === 'function') env.refreshPanels();
    }

    // ----- Screen navigation: only visibility changes; timers, state and selections are untouched -----

    function switchView(target) {
      if (!els) return false;
      const name = String(target).toLowerCase();
      const view = name === 'lab' ? 'lab' : (name === 'street' || name === 'streets' ? 'street' : null);
      if (!view) return false;
      els.labContainer.classList.toggle('hidden', view !== 'lab');
      els.streetContainer.classList.toggle('hidden', view !== 'street');
      els.navLab.setAttribute('aria-pressed', String(view === 'lab'));
      els.navStreet.setAttribute('aria-pressed', String(view === 'street'));
      els.viewport.setAttribute('data-view', view);
      return true;
    }

    function init() {
      destroy();
      const found = {};
      for (const [key, id] of Object.entries(IDS)) {
        found[key] = doc.getElementById(id);
        if (!found[key]) return false;
      }
      found.page = doc.querySelector('.arcade-layout'); // Made inert behind the scorecard.
      els = found;
      const current = state();
      lastRaidCount = current && isFiniteNumber(current.raidCount) ? current.raidCount : null;
      lastTicks = current && isFiniteNumber(current.timeTicks) ? current.timeTicks : null;
      lastNextBatchId = current && isFiniteNumber(current.nextBatchId) ? current.nextBatchId : null;
      lastCash = current && isFiniteNumber(current.cash) ? current.cash : null;
      ended = false;
      musicOn = true; // A fresh page always starts with music enabled.
      audio('setMusicEnabled', true);
      renderMusicButton();
      on(els.music, 'click', toggleMusic);
      on(els.start, 'click', startCook);
      on(els.buySlot, 'click', buyLabSlot);
      on(els.bribe, 'click', bribe);
      on(els.navLab, 'click', () => switchView('lab'));
      on(els.navStreet, 'click', () => switchView('street'));
      switchView('lab');
      on(els.vacuum, 'click', callVacuum);
      on(els.dismiss, 'click', dismissScorecard);
      on(els.flawlessVideo, 'ended', revealEnded);
      on(els.flawlessVideo, 'error', revealFailed);
      on(els.modal, 'keydown', onModalKey);
      on(doc, 'keydown', onBonusKey, true);
      on(doc, 'keydown', onCashKey, true);
      // After every button's own handler (registered earlier or above): click sound, and a cash
      // baseline so a purchase between two frames cannot hide a tick's earnings.
      for (const button of doc.querySelectorAll('button')) {
        on(button, 'click', () => {
          if (!ended) { audioStarted = true; audio('startBGM'); }
          try { playClick(); } catch (error) { /* Audio is optional. */ }
          const now = state();
          if (!ended && now && isFiniteNumber(now.cash)) lastCash = now.cash;
        });
      }
      timerId = setTimer(frame, REFRESH_MS);
      frame();
      return true;
    }

    function destroy() {
      audio('stopCookAudio');
      audio('stopSiren');
      audio('stopBGM');
      audioStarted = false;
      musicOn = true;
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
      for (const remove of listeners) remove();
      listeners = [];
      for (const entry of tracked.values()) if (entry.animTimer !== null) clearLater(entry.animTimer);
      tracked = new Map();
      clearFloats();
      cancelCelebration();
      clearScenePulse();
      traySignature = null;
      flawlessCooked = false;
      if (els) {
        els.tray.replaceChildren();
        els.modal.hidden = true;
        els.vacuum.hidden = true;
        els.vacuum.classList.toggle('neon-cyan-glow', false);
        els.vacuum.disabled = false;
        els.viewport.classList.toggle('panic-mode', false);
        els.streetContainer.classList.toggle('street-heat', false);
        setBackgroundInert(false);
        els.progress.setAttribute('data-state', 'idle');
        els.results.replaceChildren();
        els.roster.replaceChildren();
      }
      els = null;
      lastRaidCount = lastTicks = lastNextBatchId = lastCash = null;
      ended = false;
      rosterKey = null;
      departuresSeen = 0;
      restoreFocus = null;
    }

    return { init, destroy, frame, startCook, callVacuum, dismissScorecard, switchView };
  }

  if (root.ArcadeMain) root.ArcadeMain.destroy();

  const api = { createMain, DEALER_NAMES, ANIMATION_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root.document) {
    const engine = {
      get playerState() { return root.playerState; },
      get compounds() { return root.compounds; },
      get gameConfig() { return root.gameConfig; },
      get dealerTiers() { return root.dealerTiers; },
      get startCook() { return root.startCook; },
      get bribeDEA() { return root.bribeDEA; },
      get buyLabSlot() { return root.buyLabSlot; },
      get nextSlotCost() { return root.nextSlotCost; },
      get grantCash() { return root.grantCash; },
      get grantFlawlessBatch() { return root.grantFlawlessBatch; },
      get cookQuote() { return root.cookQuote; },
      get clearSave() { return root.clearSave; },
      stopGameLoop: () => (typeof root.stopGameLoop === 'function' ? root.stopGameLoop() : undefined)
    };
    const lab = {
      getSelection: () => (root.LabUI ? root.LabUI.getSelection() : null),
      feedback: (message, kind) => { if (root.LabUI) root.LabUI.feedback(message, kind); }
    };
    const refreshPanels = () => {
      if (root.LabUI) root.LabUI.render();
      if (root.StreetUI) root.StreetUI.refresh();
    };
    const instance = createMain({
      document: root.document, engine, lab, refreshPanels,
      ...Object.fromEntries(['playClick', 'playCookComplete', 'stopCookAudio', 'startBGM', 'stopBGM',
        'setMusicEnabled', 'playSiren', 'stopSiren', 'playStatic'].map(name => [name, (...args) =>
          (typeof root[name] === 'function' ? root[name](...args) : undefined)])),
      setInterval: root.setInterval.bind(root), clearInterval: root.clearInterval.bind(root),
      setTimeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root)
    });
    const destroy = () => {
      root.document.removeEventListener('DOMContentLoaded', instance.init);
      instance.destroy();
    };
    root.ArcadeMain = { ...api, init: instance.init, destroy, frame: instance.frame, switchView: instance.switchView };
    root.switchView = instance.switchView;
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', instance.init);
    } else {
      instance.init();
    }
  }
})(globalThis);

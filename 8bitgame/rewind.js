(function () {
  const MAX_VISUAL_STEPS = 5;
  const STEP_PX = 36;

  let audioCtx = null;

  function tickSound(stepsBack) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 520 + stepsBack * 50;
      const now = audioCtx.currentTime;
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {
      // Web Audio unavailable; sound is a non-essential enhancement.
    }
  }

  function buzz() {
    if (navigator.vibrate) navigator.vibrate(10);
  }

  function buildDial() {
    const zone = document.createElement('div');
    zone.id = 'rewind-zone';

    const dial = document.createElement('div');
    dial.id = 'rewind-dial';

    const label = document.createElement('div');
    label.id = 'rewind-label';
    label.textContent = 'REWIND';

    const ticksWrap = document.createElement('div');
    ticksWrap.id = 'rewind-ticks';
    for (let i = 0; i < MAX_VISUAL_STEPS; i++) {
      const tick = document.createElement('div');
      tick.className = 'rewind-tick';
      ticksWrap.appendChild(tick);
    }

    const hint = document.createElement('div');
    hint.id = 'rewind-hint';
    hint.textContent = 'SLIDE LEFT · RELEASE TO REWIND';

    dial.appendChild(label);
    dial.appendChild(ticksWrap);
    dial.appendChild(hint);

    document.body.appendChild(zone);
    document.body.appendChild(dial);

    return { zone, dial, ticksWrap, hint };
  }

  window.RewindDial = {
    attach({ getHistoryLength, onCommit }) {
      const { zone, dial, ticksWrap, hint } = buildDial();
      const ticks = Array.from(ticksWrap.children);
      let active = false;
      let dragging = false;
      let startX = 0;
      let index = 0;

      function setIndex(next) {
        const max = Math.min(MAX_VISUAL_STEPS, getHistoryLength());
        next = Math.max(0, Math.min(max, next));
        if (next === index) return;
        index = next;
        ticks.forEach((tick, i) => tick.classList.toggle('active', i < index));
        hint.textContent = index > 0
          ? `RELEASE TO REWIND ${index} STEP${index > 1 ? 'S' : ''}`
          : 'SLIDE LEFT · RELEASE TO REWIND';
        if (index > 0) {
          buzz();
          tickSound(index);
        }
      }

      function show() {
        dial.classList.add('visible');
        setIndex(0);
      }

      function hide() {
        dial.classList.remove('visible');
        index = 0;
        ticks.forEach((tick) => tick.classList.remove('active'));
      }

      function onStart(x) {
        if (!active || getHistoryLength() === 0) return;
        dragging = true;
        startX = x;
        show();
      }

      function onMove(x) {
        if (!dragging) return;
        const dx = x - startX;
        if (dx >= 0) {
          setIndex(0);
          return;
        }
        setIndex(Math.floor(-dx / STEP_PX));
      }

      function onEnd() {
        if (!dragging) return;
        dragging = false;
        const stepsBack = index;
        hide();
        if (stepsBack > 0) onCommit(stepsBack);
      }

      zone.addEventListener('touchstart', (e) => onStart(e.changedTouches[0].clientX), { passive: true });
      zone.addEventListener('touchmove', (e) => onMove(e.changedTouches[0].clientX), { passive: true });
      zone.addEventListener('touchend', onEnd);
      zone.addEventListener('touchcancel', onEnd);

      zone.addEventListener('mousedown', (e) => onStart(e.clientX));
      window.addEventListener('mousemove', (e) => onMove(e.clientX));
      window.addEventListener('mouseup', onEnd);

      return {
        setActive(value) {
          active = value;
          zone.classList.toggle('active', value);
          if (!value) hide();
        },
      };
    },
  };
})();

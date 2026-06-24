(function () {
  const MAX_VISUAL_STEPS = 5;
  const STEP_PX = 36;
  const HOLD_MS = 420;
  const JITTER_PX = 14;

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
    hint.textContent = 'SWIPE UP TO REWIND';

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
      let tracking = false;
      let armed = false;
      let downX = 0;
      let downY = 0;
      let holdTimer = null;
      let index = 0;

      function setIndex(next) {
        const max = Math.min(MAX_VISUAL_STEPS, getHistoryLength());
        next = Math.max(0, Math.min(max, next));
        if (next === index) return;
        index = next;
        ticks.forEach((tick, i) => tick.classList.toggle('active', i < index));
        hint.textContent = index > 0
          ? `RELEASE TO REWIND ${index} STEP${index > 1 ? 'S' : ''}`
          : 'SWIPE UP TO REWIND';
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

      function clearHoldTimer() {
        clearTimeout(holdTimer);
        holdTimer = null;
      }

      function reset() {
        clearHoldTimer();
        tracking = false;
        armed = false;
        hide();
      }

      function arm() {
        holdTimer = null;
        armed = true;
        buzz();
        show();
      }

      function onDown(x, y) {
        if (!active || getHistoryLength() === 0) return;
        tracking = true;
        armed = false;
        downX = x;
        downY = y;
        clearHoldTimer();
        holdTimer = setTimeout(arm, HOLD_MS);
      }

      function onMove(x, y) {
        if (!tracking) return;
        if (!armed) {
          if (Math.hypot(x - downX, y - downY) > JITTER_PX) reset();
          return;
        }
        const dy = Math.max(0, downY - y);
        setIndex(Math.floor(dy / STEP_PX));
      }

      function onUp() {
        if (!tracking) return;
        const stepsBack = armed ? index : 0;
        reset();
        if (stepsBack > 0) onCommit(stepsBack);
      }

      zone.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        onDown(t.clientX, t.clientY);
      }, { passive: true });
      zone.addEventListener('touchmove', (e) => {
        const t = e.changedTouches[0];
        onMove(t.clientX, t.clientY);
      }, { passive: true });
      zone.addEventListener('touchend', onUp);
      zone.addEventListener('touchcancel', onUp);

      zone.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY));
      window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
      window.addEventListener('mouseup', onUp);

      return {
        setActive(value) {
          active = value;
          zone.classList.toggle('active', value);
          if (!value) reset();
        },
      };
    },
  };
})();

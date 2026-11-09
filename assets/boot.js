/* =========================================================================
   国家电网 × 终末地（ZMD）启动序列 — 行为层
   纯原生 JS：状态机 access → order → close → boot → done
   交互：按住接入 / 指令复诵 / 拖动合闸 / 完成后进入
   自动演示：?auto=1（DSH 启动覆盖层用），任何真实输入即接管
   调试：?jump=access|order|close|boot|done
   ========================================================================= */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const dock = $('dock');
  const Q = new URLSearchParams(location.search);
  const AUTO = Q.get('auto') === '1' || Q.get('demo') === '1';
  const MODE_COOKIE = 'dsh_boot_grid_zmd_mode';
  function writeMode(mode) {
    try { document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=31536000; SameSite=Lax`; } catch (e) { /* file:// 或无 cookie 环境 */ }
  }
  const JUMP = (Q.get('jump') || '').toLowerCase();
  const IN_FRAME = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
  const pad4 = (n) => String(Math.max(0, Math.floor(n))).padStart(4, '0');

  const S = {
    phase: 'access',
    progress: 0,
    state: 'idle',
    auto: AUTO,
    timers: new Set(),
    autoTimers: new Set(),
    hold: 0, holding: false, holdStart: 0, holdRAF: 0,
    orderTyped: false, echoTyping: false, repeated: false,
    brk: 0, brkDrag: false, brkClosed: false, brkRAF: 0, brkSpring: 0,
    bootStart: 0, booting: false, bootDone: false,
    reveal: 0, energize: 0,
    freq: 0, volt: 0, act: 0,
    hoverNode: -1,
    sound: true, audio: null, hum: null, userGesture: false,
    logN: 0, gen: 0, left: false,
  };

  const later = (fn, ms) => {
    const id = setTimeout(() => { S.timers.delete(id); fn(); }, ms);
    S.timers.add(id);
    return id;
  };
  const autoAt = (fn, ms) => {
    const id = setTimeout(() => { S.autoTimers.delete(id); fn(); }, ms);
    S.autoTimers.add(id);
    return id;
  };
  const clearTimers = () => { S.timers.forEach(clearTimeout); S.timers.clear(); };
  const clearAuto = () => { S.autoTimers.forEach(clearTimeout); S.autoTimers.clear(); };

  const el = {
    clock: $('clock'), mode: $('modeChip'),
    freq: $('freq'), volt: $('volt'), act: $('act'), state: $('state'),
    log: $('log'), fill: $('fill'), pct: $('pct'), phaseText: $('phaseText'),
    stepNo: $('stepNo'), stepName: $('stepName'), stepEn: $('stepEn'),
    holdBtn: $('holdBtn'), holdArc: $('holdArc'), holdFill: $('holdFill'), holdT: $('holdT'),
    orderText: $('orderText'), orderEcho: $('orderEcho'), orderMeta: $('orderMeta'),
    repeatBtn: $('repeatBtn'), execBtn: $('execBtn'),
    brkTrack: $('brkTrack'), brkFill: $('brkFill'), brkKnob: $('brkKnob'), kv: $('kv'),
    bootFill: $('bootFill'), bootPct: $('bootPct'), dockHint: $('dockHint'),
    toast: $('toast'), skip: $('skipBtn'), sweep: $('sweep'), hush: $('hush'),
    done: $('done'), doneCta: $('doneCta'), doneAuto: $('doneAuto'), sound: $('soundChip'), modeBtn: $('modeBtn'),
    mapCoord: $('mapCoord'), nodeTip: $('nodeTip'), wave: $('wave'),
  };

  /* ============================== 声音 ============================== */
  function ac() {
    if (!S.sound || !S.userGesture) return null;
    if (S.audio === false) return null;
    if (!S.audio) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { S.audio = false; return null; }
      try { S.audio = new C(); } catch (e) { S.audio = false; return null; }
    }
    if (S.audio.state === 'suspended') S.audio.resume().catch(() => {});
    return S.audio;
  }
  function humStart() {
    const c = ac(); if (!c) return;
    if (!S.hum) {
      const g = c.createGain(); g.gain.value = 0; g.connect(c.destination);
      const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = 50;
      const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 100;
      const g2 = c.createGain(); g2.gain.value = 0.4;
      o1.connect(g); o2.connect(g2); g2.connect(g);
      o1.start(); o2.start();
      S.hum = { g, o1, o2 };
    }
    const t = c.currentTime;
    S.hum.g.gain.cancelScheduledValues(t);
    S.hum.g.gain.setTargetAtTime(S.sound ? 0.035 : 0, t, 0.08);
  }
  function humLevel(v) {
    const c = ac(); if (!c || !S.hum) return;
    S.hum.g.gain.setTargetAtTime(S.sound ? 0.012 + 0.05 * clamp(v, 0, 1) : 0, c.currentTime, 0.06);
  }
  function humStop() {
    const c = ac(); if (!c || !S.hum) return;
    S.hum.g.gain.setTargetAtTime(0, c.currentTime, 0.12);
  }
  function blip(freq, dur, type, vol) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square'; o.frequency.value = freq || 880;
    g.gain.value = 0;
    o.connect(g); g.connect(c.destination);
    const t = c.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.02, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.06));
    o.start(t); o.stop(t + (dur || 0.06) + 0.02);
  }
  function thunk() {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(44, c.currentTime + 0.22);
    g.gain.setValueAtTime(0.09, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.28);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.3);
    blip(240, 0.05, 'square', 0.012);
  }
  function chime() {
    blip(523.25, 0.5, 'sine', 0.03);
    blip(783.99, 0.6, 'sine', 0.02);
    blip(1046.5, 0.7, 'sine', 0.012);
  }

  /* ============================== 日志 / 提示 ============================== */
  function log(text, kind) {
    S.logN += 1;
    const d = document.createElement('div');
    d.innerHTML = `<b>${pad4(S.logN)}</b> ${text}${kind ? ` <span class="${kind}">·</span>` : ''}`;
    el.log.appendChild(d);
    while (el.log.children.length > 6) el.log.removeChild(el.log.firstChild);
  }
  let toastTimer = 0;
  function toast(text, kind) {
    el.toast.textContent = text;
    el.toast.className = 'toast show' + (kind === 'ok' ? ' ok' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.className = 'toast'; }, 1900);
  }
  function setState(state) {
    S.state = state;
    stage.dataset.state = state;
  }
  function hint(text, kind) {
    el.dockHint.className = 'dock-hint' + (kind ? ' ' + kind : '');
    el.dockHint.textContent = text;
  }

  /* ============================== 进度 ============================== */
  function setProgress(p) {
    S.progress = clamp(p, 0, 100);
    el.fill.style.height = S.progress.toFixed(2) + '%';
    el.pct.textContent = pad2(S.progress);
  }
  function tweenProgress(target, ms) {
    const from = S.progress, t0 = performance.now(), my = ++S.gen;
    const step = (now) => {
      if (my !== S.gen) return;
      const k = clamp((now - t0) / ms, 0, 1);
      setProgress(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ============================== 阶段 ============================== */
  const PHASES = {
    access: { n: '01', name: '接入核验', en: 'ACCESS VERIFICATION', hint: '按住按钮 1.2 秒后松开', base: 0, state: '待接入 STANDBY' },
    order: { n: '02', name: '调度指令', en: 'DISPATCH ORDER', hint: '复诵无误后执行 · GB 26860—2011 §7.3.1.2', base: 12, state: '已授权 AUTHORIZED' },
    close: { n: '03', name: '合闸并网', en: 'BREAKER CLOSE', hint: '送电合闸按相反顺序 · GB 26860—2011 §7.3.6.1', base: 52, state: '指令已复诵 READBACK' },
    boot: { n: '04', name: '全网启动', en: 'GRID ENERGIZATION', hint: '能量流自西向东 · 全网扫描', base: 72, state: '断路器合位 CLOSED' },
    done: { n: '04', name: '启动完成', en: 'SYSTEM ONLINE', hint: '', base: 100, state: '系统在线 ONLINE' },
  };

  function setPhase(name) {
    if (S.done) return;
    if (name === 'done') { showDone(); return; }
    S.phase = name;
    const p = PHASES[name];
    stage.dataset.phase = name;
    dock.dataset.phase = name;
    el.stepNo.textContent = 'STEP ' + p.n;
    el.stepName.textContent = p.name;
    el.stepEn.textContent = p.en;
    el.phaseText.textContent = p.state;
    hint(p.hint);
    tweenProgress(p.base, REDUCED ? 120 : 620);
    setState(name === 'close' ? 'ok' : 'idle');
    el.mode.textContent = S.auto ? 'AUTO DEMO' : 'MANUAL';

    if (name === 'order') startOrder();
    if (name === 'close') {
      log('并网前置核验 · 并网协议已签 / 调度许可已下达');
      log('调度条例 §25 / §26 · 统一调度', 'ok');
      if (S.auto) autoAt(autoCloseRun, 900);
    }
    if (name === 'boot') startBoot();
  }

  /* ============================== 01 按住接入 ============================== */
  function paintHold(p) {
    S.hold = p;
    el.holdFill.style.width = (p * 100).toFixed(1) + '%';
    el.holdArc.style.strokeDashoffset = String(119.4 * (1 - p));
    el.holdT.textContent = (p * 1.2).toFixed(2);
  }
  function beginHold() {
    if (S.phase !== 'access' || S.holding) return;
    S.holding = true;
    S.holdStart = performance.now();
    el.holdBtn.classList.remove('ok', 'err');
    el.holdBtn.classList.add('active');
    if (S.sound && S.userGesture) { humStart(); humLevel(0.2); }
    const step = (now) => {
      if (!S.holding) return;
      const p = clamp((now - S.holdStart) / 1200, 0, 1);
      paintHold(p);
      humLevel(p);
      if (p >= 1) { finishHold(); return; }
      S.holdRAF = requestAnimationFrame(step);
    };
    S.holdRAF = requestAnimationFrame(step);
  }
  function endHold(aborted) {
    if (!S.holding) return;
    S.holding = false;
    cancelAnimationFrame(S.holdRAF);
    el.holdBtn.classList.remove('active');
    if (aborted && S.hold < 0.999) {
      el.holdBtn.classList.add('err');
      setTimeout(() => el.holdBtn.classList.remove('err'), 340);
      paintHold(0);
      toast('已中断 · 需持续按住 1.2 秒');
      hint('按住按钮 1.2 秒后松开 · 中断', 'warn');
      humStop();
      log('接入中断 · 时长不足', 'err');
      setState('err');
      setTimeout(() => setState(S.phase === 'access' ? 'idle' : 'ok'), 700);
    }
  }
  function finishHold() {
    S.holding = false;
    cancelAnimationFrame(S.holdRAF);
    paintHold(1);
    el.holdBtn.classList.remove('active');
    el.holdBtn.classList.add('ok');
    el.holdBtn.disabled = true;
    humStop(); chime();
    setState('ok');
    log('身份核验通过 · SG-DISPATCH-07', 'ok');
    hint('已授权 · AUTHORIZED', 'ok');
    toast('接入成功 · 权限等级 3', 'ok');
    tweenProgress(12, 700);
    setTimeout(() => setPhase('order'), REDUCED ? 200 : 720);
  }

  /* ============================== 02 调度指令 ============================== */
  const ORDER = '1000kV 淮南—上海 特高压线路 由检修转运行';
  const ECHO = '复诵：1000kV 淮南—上海 特高压线路 由检修转运行，复诵完毕。';

  function typeInto(node, text, ms, done) {
    node.textContent = '';
    let i = 0;
    const cur = document.createElement('span');
    cur.className = 'cur';
    cur.textContent = '▍';
    node.appendChild(cur);
    const tick = () => {
      if (i >= text.length) { cur.remove(); if (done) done(); return; }
      const span = document.createElement('span');
      span.textContent = text[i];
      i += 1;
      node.insertBefore(span, cur);
      setTimeout(tick, ms + (text[i - 1] === ' ' ? 40 : 0));
    };
    tick();
  }

  function startOrder() {
    if (S.done) return;
    el.orderMeta.textContent = 'GB 26860—2011 §7.3.1.2 · 复诵无误后执行';
    if (JUMP === 'order') {
      el.orderText.textContent = ORDER;
      el.orderEcho.textContent = ECHO;
      S.orderTyped = true;
      S.repeated = true;
      el.repeatBtn.disabled = false;
      el.repeatBtn.classList.add('settled');
      el.execBtn.disabled = false;
      hint('复诵一致 · 点击「执行」下达指令', 'ok');
      return;
    }
    typeInto(el.orderText, ORDER, REDUCED ? 2 : 26, () => {
      S.orderTyped = true;
      el.repeatBtn.disabled = false;
      el.repeatBtn.focus({ preventScroll: true });
      hint('核对指令内容，点击「复诵」');
      log('接收调度指令 · 待复诵');
      blip(660, 0.06, 'square', 0.015);
      if (S.auto) autoAt(doRepeat, 700);
    });
  }

  function doRepeat() {
    if (S.done || S.phase !== 'order' || !S.orderTyped || S.repeated || S.echoTyping) return;
    S.echoTyping = true;
    el.repeatBtn.disabled = true;
    el.repeatBtn.classList.add('press');
    setTimeout(() => el.repeatBtn.classList.remove('press'), 140);
    blip(880, 0.05, 'square', 0.015);
    log('复诵指令 · READBACK');
    typeInto(el.orderEcho, ECHO, REDUCED ? 2 : 18, () => {
      S.echoTyping = false;
      S.repeated = true;
      el.repeatBtn.classList.add('settled');
      el.execBtn.disabled = false;
      el.execBtn.focus({ preventScroll: true });
      hint('复诵一致 · 点击「执行」下达指令', 'ok');
      toast('复诵一致 · 校验通过', 'ok');
      log('复诵一致 · 校验通过', 'ok');
      blip(1046, 0.09, 'sine', 0.02);
      if (S.auto) autoAt(doExec, 700);
    });
  }

  function doExec() {
    if (S.done || S.phase !== 'order' || !S.repeated) return;
    el.execBtn.disabled = true;
    el.execBtn.classList.add('press');
    setTimeout(() => el.execBtn.classList.remove('press'), 160);
    el.execBtn.classList.add('settled');
    thunk();
    log('调度指令执行 · CMD 0x2A71', 'ok');
    hint('指令已执行', 'ok');
    toast('指令已执行 · 转合闸并网', 'ok');
    setState('ok');
    tweenProgress(52, 700);
    setTimeout(() => setPhase('close'), REDUCED ? 200 : 800);
  }

  /* ============================== 03 合闸 ============================== */
  function paintBreaker(p, live) {
    S.brk = clamp(p, 0, 1);
    el.brkFill.style.width = (S.brk * 100).toFixed(2) + '%';
    el.brkKnob.style.left = (S.brk * 100).toFixed(2) + '%';
    el.brkKnob.setAttribute('aria-valuenow', String(Math.round(S.brk * 100)));
    el.brkKnob.setAttribute('aria-valuetext', (S.brk * 525).toFixed(1) + ' kV');
    el.kv.textContent = (S.brk * 525).toFixed(1);
    if (live) humLevel(S.brk);
    if (S.brk >= 0.995) {
      el.brkFill.style.background = 'linear-gradient(90deg, var(--volt-deep), var(--volt))';
      el.brkFill.style.boxShadow = '0 0 16px rgba(55,214,174,.5)';
    } else {
      el.brkFill.style.background = '';
      el.brkFill.style.boxShadow = '';
    }
  }

  function brkFromEvent(ev) {
    const r = el.brkTrack.getBoundingClientRect();
    return clamp((ev.clientX - r.left) / r.width, 0, 1);
  }

  function bindBreaker() {
    el.brkKnob.addEventListener('pointerdown', (ev) => {
      if (S.phase !== 'close' || S.brkClosed) return;
      ev.preventDefault();
      cancelAnimationFrame(S.brkSpring);
      S.brkDrag = true;
      el.brkKnob.classList.add('dragging');
      el.brkKnob.setPointerCapture(ev.pointerId);
      el.brkKnob.focus({ preventScroll: true });
      if (S.sound && S.userGesture) humStart();
      humLevel(S.brk);
      paintBreaker(brkFromEvent(ev), true);
    });
    el.brkKnob.addEventListener('pointermove', (ev) => {
      if (!S.brkDrag) return;
      paintBreaker(brkFromEvent(ev), true);
    });
    const release = (ev) => {
      if (!S.brkDrag) return;
      S.brkDrag = false;
      el.brkKnob.classList.remove('dragging');
      try { el.brkKnob.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (S.brk >= 0.9) { closeBreaker(); return; }
      humStop();
      springBreaker();
    };
    el.brkKnob.addEventListener('pointerup', release);
    el.brkKnob.addEventListener('pointercancel', release);
    el.brkKnob.addEventListener('keydown', (ev) => {
      if (S.phase !== 'close' || S.brkClosed) return;
      const map = { ArrowRight: 0.06, ArrowUp: 0.06, ArrowLeft: -0.06, ArrowDown: -0.06, Home: -1, End: 1 };
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (S.brk >= 0.9) closeBreaker(); else toast('把手未到位 · 请拖至「合」');
        return;
      }
      if (!(ev.key in map)) return;
      ev.preventDefault();
      const to = map[ev.key] === -1 ? 0 : map[ev.key] === 1 ? 1 : S.brk + map[ev.key];
      paintBreaker(clamp(to, 0, 1), false);
      if (to >= 0.9) hint('到位 · 松开或按空格合闸', 'ok');
    });
  }

  function springBreaker() {
    const from = S.brk, t0 = performance.now();
    cancelAnimationFrame(S.brkSpring);
    const step = (now) => {
      const k = REDUCED ? 1 : clamp((now - t0) / 280, 0, 1);
      paintBreaker(from * Math.pow(1 - k, 2), false);
      if (k < 1) S.brkSpring = requestAnimationFrame(step);
    };
    S.brkSpring = requestAnimationFrame(step);
    toast('把手未到位 · 已复归');
    hint('拖动把手至「合」到位', 'warn');
    log('合闸未到位 · 把手复归', 'err');
  }

  function closeBreaker() {
    if (S.done || S.brkClosed) return;
    S.brkClosed = true;
    S.brkDrag = false;
    cancelAnimationFrame(S.brkSpring);
    el.brkKnob.classList.remove('dragging');
    paintBreaker(1, false);
    el.brkKnob.classList.add('closed');
    el.brkKnob.setAttribute('aria-disabled', 'true');
    thunk();
    setTimeout(chime, 180);
    setState('ok');
    log('断路器合位 · 线路电压建立', 'ok');
    hint('合闸成功 · 电压建立', 'ok');
    toast('合闸成功 · 525.0 kV', 'ok');
    tweenProgress(72, 700);
    setTimeout(() => setPhase('boot'), REDUCED ? 250 : 900);
  }

  function autoCloseRun() {
    if (!S.auto || S.phase !== 'close' || S.brkClosed) return;
    const t0 = performance.now();
    const step = (now) => {
      if (!S.auto) return;
      const k = clamp((now - t0) / 1200, 0, 1);
      paintBreaker(0.18 + 0.82 * (1 - Math.pow(1 - k, 3)), false);
      if (k < 1) requestAnimationFrame(step);
      else closeBreaker();
    };
    requestAnimationFrame(step);
  }

  /* ============================== 04 全网启动 ============================== */
  const BOOT_KEYS = [
    [0, 0], [1400, 30], [1750, 32], [3200, 62], [3500, 64],
    [5000, 90], [5300, 92], [6400, 100],
  ];
  const BOOT_LOGS = [
    [0.04, '启动序列 07 · 全网扫描'],
    [0.18, '潮流计算 · 收敛于 6 次迭代'],
    [0.36, '稳定校核 · N-1 通过'],
    [0.55, '频率调整 · 49.62 → 50.00 Hz'],
    [0.74, '省间联络线 · 功率转移'],
    [0.92, '全网电压 · 500 kV 级建立'],
    [1.00, '全网启动完成 · 系统在线'],
  ];
  const BOOT_DONE = [];

  function bootEase(elapsed) {
    for (let i = 1; i < BOOT_KEYS.length; i++) {
      const [t1, v1] = BOOT_KEYS[i];
      if (elapsed <= t1) {
        const [t0, v0] = BOOT_KEYS[i - 1];
        const k = clamp((elapsed - t0) / (t1 - t0), 0, 1);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        return v0 + (v1 - v0) * e;
      }
    }
    return 100;
  }

  function startBoot() {
    if (S.done) return;
    S.bootStart = performance.now();
    S.booting = true;
    setState('ok');
    log('合闸指令确认 · 启动序列 07');
    hint('能量流自西向东 · 全网扫描');
    if (S.sound && S.userGesture) humStart();
    const live = () => {
      if (!S.booting) return;
      const elapsed = performance.now() - S.bootStart;
      const p = bootEase(elapsed) / 100;
      S.reveal = p;
      S.energize = p;
      setProgress(72 + 28 * p);
      el.bootFill.style.width = (72 + 28 * p).toFixed(1) + '%';
      el.bootPct.textContent = String(Math.floor(72 + 28 * p));
      humLevel(0.35 + 0.3 * p);
      BOOT_LOG_THRESH.forEach(([th, text, kind]) => {
        if (p >= th && !BOOT_LOG_THRESH_DONE.has(th)) {
          BOOT_LOG_THRESH_DONE.add(th);
          log(text, kind);
        }
      });
      if (p >= 0.999) { finishBoot(); return; }
      requestAnimationFrame(live);
    };
    requestAnimationFrame(live);
  }

  const BOOT_LOG_THRESH = BOOT_LOGS.map(([p, text]) => [p, text, p >= 1 ? 'ok' : '']);
  const BOOT_LOG_THRESH_DONE = new Set();

  function finishBoot() {
    if (S.bootDone) return;
    S.bootDone = true;
    S.booting = false;
    S.reveal = 1; S.energize = 1;
    setProgress(100);
    el.bootFill.style.width = '100%';
    el.bootPct.textContent = '100';
    humStop();
    setState('ok');
    hint('全网启动完成 · SYSTEM ONLINE', 'ok');
    if (!REDUCED) {
      el.sweep.classList.add('go');
      thunk();
      setTimeout(() => { el.hush.classList.add('go'); }, 420);
      setTimeout(chime, 540);
    }
    setTimeout(() => showDone(), REDUCED ? 420 : 1150);
  }

  /* ============================== 完成页 ============================== */
  function showDone() {
    if (S.done) return;
    S.done = true;
    S.phase = 'done';
    clearTimers(); clearAuto();
    el.done.classList.add('show');
    el.skip.style.display = 'none';
    el.hush.classList.remove('go');
    stage.dataset.phase = 'done';
    stage.dataset.state = 'done';
    log('终端交付 · DEEPSEEK HARNESS', 'ok');
    el.phaseText.textContent = PHASES.done.state;
    setProgress(100);
    // 背景层退出可访问性树与 Tab 顺序，焦点只留在完成页
    document.querySelectorAll('.leftcol, .mapwrap, .dock, .meta.bottom, .rail').forEach((n) => { n.inert = true });
    el.doneCta.focus({ preventScroll: true });
    // DSH 覆盖层：3 秒后自动交还，不让用户被完成页扣住
    if (IN_FRAME) {
      let n = 3;
      el.doneAuto.textContent = `${n} 秒后自动进入 DSH`;
      const tick = () => {
        if (S.left || n <= 0) return;
        n -= 1;
        el.doneAuto.textContent = n > 0 ? `${n} 秒后自动进入 DSH` : '正在进入 DSH…';
        if (n <= 0) { leave(); return; }
        setTimeout(tick, 1000);
      };
      setTimeout(tick, 1000);
    }
  }
  function leave() {
    if (S.left) return;
    S.left = true;
    if (IN_FRAME) { try { window.parent.postMessage('boot-grid-zmd:done', '*'); } catch (e) {} }
    else location.reload();
  }
  function skipAll() {
    if (S.done) { leave(); return; }
    if (IN_FRAME) { try { window.parent.postMessage('boot-grid-zmd:skip', '*'); } catch (e) {} }
    else showDone();
  }

  /* ============================== 自动演示 ============================== */
  function autoHoldRun() {
    if (!S.auto || S.phase !== 'access' || S.holding) return;
    S.holding = true;
    const t0 = performance.now();
    const step = (now) => {
      if (!S.auto) return;
      const p = clamp((now - t0) / 1200, 0, 1);
      paintHold(p);
      if (p >= 1) { S.holding = false; paintHold(1); el.holdBtn.disabled = true; el.holdBtn.classList.add('ok'); finishHold(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function syncMode() {
    el.mode.textContent = S.auto ? 'AUTO DEMO' : 'MANUAL';
    el.modeBtn.textContent = S.auto ? '模式 自动' : '模式 手动';
    el.modeBtn.setAttribute('aria-label', S.auto ? '播放模式：自动。点击切换为手动操作' : '播放模式：手动。点击切换为自动演示');
    el.modeBtn.title = S.auto ? '当前为自动演示；点击切换为手动操作（下次启动也保持）' : '当前为手动操作；点击切换为自动演示（下次启动也保持）';
  }
  function stopAuto() {
    clearAuto();
    // 自动演示正在进行中的按住动作要让位给真实输入
    if (S.phase === 'access' && S.holding) {
      S.holding = false;
      cancelAnimationFrame(S.holdRAF);
      el.holdBtn.classList.remove('active', 'ok');
      paintHold(0);
    }
  }
  function resumeAuto() {
    if (!S.auto || S.done) return;
    if (S.phase === 'access') {
      if (!S.holding) autoAt(autoHoldRun, 350);
    } else if (S.phase === 'order') {
      if (S.orderTyped && !S.repeated) autoAt(doRepeat, 500);
      else if (S.orderTyped && S.repeated) autoAt(doExec, 500);
    } else if (S.phase === 'close' && !S.brkClosed) {
      autoAt(autoCloseRun, 500);
    }
  }
  function setMode(mode, persist = true) {
    if (S.done) return;
    const auto = mode === 'auto';
    if (persist) writeMode(mode);
    if (auto === S.auto) { syncMode(); return; }
    if (auto) {
      S.auto = true;
      syncMode();
      resumeAuto();
    } else {
      stopAuto();
      S.auto = false;
      syncMode();
    }
  }
  function manualTakeover() {
    if (!S.auto) return;
    setMode('manual');
  }

  /* ============================== 地图 ============================== */
  const CHINA = window.__CHINA__ || null;
  const mapWrap = $('mapwrap');
  const mapCv = $('map');
  const mapCtx = mapCv.getContext('2d');
  const groundCv = $('mapGround');
  const groundCtx = groundCv.getContext('2d');
  const bgCv = $('bg');
  const bgCtx = bgCv.getContext('2d');
  const waveCv = el.wave;
  const waveCtx = waveCv.getContext('2d');

  let mapW = 0, mapH = 0, mapFit = null, mapStatic = null, dotsCanvas = null, hotDotsCanvas = null, nodes = [], linePaths = [];
  let mapLift = 12, mapBounds = null;
  let bgW = 0, bgH = 0;

  const UHV = [
    { name: '昌吉—古泉', kv: '±1100 kV', pts: [[87.3, 44.0], [93.5, 42.8], [98.5, 39.7], [100.4, 38.9], [103.8, 36.1], [108.9, 34.3], [113.6, 34.7], [118.7, 30.9]] },
    { name: '复龙—奉贤', kv: '±800 kV', pts: [[104.6, 28.8], [106.5, 29.6], [111.3, 30.7], [114.3, 30.6], [117.2, 31.8], [118.8, 32.1], [121.5, 31.2]] },
    { name: '淮南—上海', kv: '1000 kV', pts: [[117.0, 32.6], [118.4, 31.3], [120.1, 30.9], [121.5, 31.2]] },
    { name: '张北—雄安', kv: '±500 kV', pts: [[114.7, 41.2], [115.2, 40.1], [115.9, 39.0]] },
    { name: '酒泉—湘潭', kv: '±800 kV', pts: [[98.5, 39.7], [103.8, 36.1], [108.9, 34.3], [112.1, 32.0], [112.9, 27.8]] },
    { name: '宁东—绍兴', kv: '±800 kV', pts: [[106.3, 38.0], [108.9, 34.3], [112.1, 32.0], [114.3, 30.6], [118.4, 31.3], [120.6, 30.0]] },
    { name: '昆北—龙门', kv: '±800 kV', pts: [[102.8, 24.9], [106.6, 26.6], [110.3, 25.3], [113.3, 23.1], [114.0, 23.7]] },
  ];
  const NODES = [
    { name: '昌吉', kv: '±1100 kV', at: [87.3, 44.0], major: true },
    { name: '古泉', kv: '±1100 kV', at: [118.7, 30.9], major: true },
    { name: '复龙', kv: '±800 kV', at: [104.6, 28.8], major: true },
    { name: '奉贤', kv: '±800 kV', at: [121.5, 31.2], major: true },
    { name: '张北', kv: '±500 kV', at: [114.7, 41.2], major: true },
    { name: '雄安', kv: '1000 kV', at: [115.9, 39.0] },
    { name: '淮南', kv: '1000 kV', at: [117.0, 32.6] },
    { name: '酒泉', kv: '±800 kV', at: [98.5, 39.7] },
    { name: '湘潭', kv: '±800 kV', at: [112.9, 27.8] },
    { name: '宁东', kv: '±800 kV', at: [106.3, 38.0] },
    { name: '绍兴', kv: '±800 kV', at: [120.6, 30.0] },
    { name: '昆北', kv: '±800 kV', at: [102.8, 24.9] },
    { name: '龙门', kv: '±800 kV', at: [114.0, 23.7] },
  ];

  function fitCanvas(cv, ctx) {
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    cv.width = Math.floor(w * DPR);
    cv.height = Math.floor(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return { w, h };
  }

  function project(lon, lat) {
    const f = mapFit;
    return [f.cx + (lon - f.lon0) * f.s * f.cosLat, f.cy - (lat - f.lat0) * f.s];
  }

  function buildMap() {
    const size = fitCanvas(mapCv, mapCtx);
    mapW = size.w; mapH = size.h;
    fitCanvas(groundCv, groundCtx);
    mapLift = clamp(mapH * .024, 9, 15);
    if (!CHINA) return false;
    const [LON0, LAT0, LON1, LAT1] = CHINA.bounds;
    const cosLat = Math.cos(35 * Math.PI / 180);
    const spanX = (LON1 - LON0) * cosLat;
    const spanY = LAT1 - LAT0;
    const padX = 26, padY = 26;
    const s = Math.min((mapW - padX * 2) / spanX, (mapH - padY * 2) / spanY);
    mapFit = { lon0: (LON0 + LON1) / 2, lat0: (LAT0 + LAT1) / 2, s, cosLat, cx: mapW / 2, cy: mapH / 2, LON0, LAT0, LON1, LAT1 };

    const toXY = (nx, ny) => {
      const lon = LON0 + (nx / 1000) * (LON1 - LON0);
      const lat = LAT1 - (ny / 1000) * (LAT1 - LAT0);
      return project(lon, lat);
    };

    mapStatic = document.createElement('canvas');
    mapStatic.width = mapCv.width;
    mapStatic.height = mapCv.height;
    const c = mapStatic.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, 0, 0);

    // 地面 → 石墨侧壁 → 地表；复用现有边界，不伪造地形或倾转国土。
    const land = new Path2D();
    const rings = CHINA.provinces.map(ring => {
      const path = new Path2D();
      for (let i = 0; i < ring.length; i += 2) {
        const p = toXY(ring[i], ring[i + 1]);
        if (i) path.lineTo(...p); else path.moveTo(...p);
      }
      path.closePath(); land.addPath(path);
      return path;
    });
    const g = groundCtx;
    g.clearRect(0, 0, mapW, mapH);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(236,237,237,.055)';
    const horizon = mapH * .22;
    for (let i = 0; i <= 10; i++) {
      const x = 24 + (mapW - 48) * i / 10;
      g.beginPath(); g.moveTo(lerp(mapW / 2, x, .7), horizon);
      g.lineTo(x, mapH - 24); g.stroke();
    }
    for (const v of [.08, .2, .38, .64, 1]) {
      const y = lerp(horizon, mapH - 24, v);
      g.beginPath(); g.moveTo(24, y); g.lineTo(mapW - 24, y); g.stroke();
    }
    g.save(); g.translate(3, mapLift + 5);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fill(land);
    g.restore();
    g.save(); g.translate(0, mapLift);
    g.fillStyle = '#090f14'; g.fill(land);
    g.restore();
    for (let y = mapLift - 1; y >= 1; y -= 3) {
      g.save(); g.translate(0, y);
      g.fillStyle = y > mapLift / 2 ? '#0c161e' : '#14222c';
      g.fill(land); g.restore();
    }

    const face = c.createLinearGradient(0, 40, mapW * .75, mapH);
    face.addColorStop(0, '#273945');
    face.addColorStop(.55, '#1a2933');
    face.addColorStop(1, '#131f28');
    c.fillStyle = face; c.fill(land);
    c.save(); c.clip(land);
    c.strokeStyle = 'rgba(236,237,237,.045)'; c.lineWidth = 1;
    for (let lon = 80; lon <= 130; lon += 10) {
      const a = project(lon, LAT0 + 1), b = project(lon, LAT1 - 1);
      c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke();
    }
    for (let lat = 20; lat <= 50; lat += 10) {
      const a = project(LON0 + 1, lat), b = project(LON1 - 1, lat);
      c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke();
    }
    c.restore();
    c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = 1;
    c.strokeStyle = 'rgba(236,237,237,.2)';
    for (const path of rings) c.stroke(path);

    mapBounds = { minX: 26, maxX: mapW - 26 };

    // 地图与城市点各烘焙一次；逐帧只做一次 clip + drawImage，避免 5000 次状态切换。
    g.drawImage(mapStatic, 0, 0, mapW, mapH);
    dotsCanvas = document.createElement('canvas');
    dotsCanvas.width = mapCv.width; dotsCanvas.height = mapCv.height;
    const d = dotsCanvas.getContext('2d');
    d.setTransform(DPR, 0, 0, DPR, 0, 0);
    hotDotsCanvas = document.createElement('canvas');
    hotDotsCanvas.width = mapCv.width; hotDotsCanvas.height = mapCv.height;
    const hd = hotDotsCanvas.getContext('2d');
    hd.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (let i = 0; i < CHINA.dots.length; i += 3) {
      const p = toXY(CHINA.dots[i], CHINA.dots[i + 1]);
      if (p[0] < 0 || p[0] > mapW || p[1] < 0 || p[1] > mapH) continue;
      const w = CHINA.dots[i + 2];
      d.fillStyle = `rgba(236,237,237,${(.24 + w * .24).toFixed(3)})`;
      d.fillRect(p[0], p[1], .5 + w * .55, .5 + w * .55);
      if (w > .55) {
        hd.fillStyle = `rgba(55,214,174,${(.3 + w * .3).toFixed(3)})`;
        hd.fillRect(p[0], p[1], .6 + w * .7, .6 + w * .7);
      }
    }

    nodes = NODES.map((n, index) => {
      const [x, y] = project(...n.at);
      return { ...n, index, x, y, lift: n.major ? 11 : 6 };
    });
    linePaths = UHV.map((line, idx) => {
      const raw = line.pts.map(q => project(...q));
      const pts = [raw[0]];
      let start = raw[0];
      for (let i = 1; i < raw.length - 1; i++) {
        const end = [lerp(raw[i][0], raw[i + 1][0], .5), lerp(raw[i][1], raw[i + 1][1], .5)];
        // 与原来的二次曲线相同；采样一次，线芯与脉冲共享同一弧长。
        for (let j = 1; j <= 16; j++) {
          const u = j / 16, v = 1 - u;
          pts.push([v*v*start[0] + 2*v*u*raw[i][0] + u*u*end[0], v*v*start[1] + 2*v*u*raw[i][1] + u*u*end[1]]);
        }
        start = end;
      }
      pts.push(raw[raw.length - 1]);
      const lengths = [0];
      for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { ...line, pts, lengths, len: lengths[lengths.length - 1], idx };
    });
    return true;
  }

  function drawCorridor(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(...pts[i]);
  }

  function pathPointAt(line, u) {
    const distance = clamp(u, 0, 1) * line.len;
    let i = 1;
    while (i < line.lengths.length - 1 && line.lengths[i] < distance) i++;
    const span = line.lengths[i] - line.lengths[i - 1];
    const k = span ? (distance - line.lengths[i - 1]) / span : 0;
    return [lerp(line.pts[i - 1][0], line.pts[i][0], k), lerp(line.pts[i - 1][1], line.pts[i][1], k)];
  }

  function drawMap(now) {
    if (!mapFit || !dotsCanvas) return;
    const ctx = mapCtx;
    ctx.clearRect(0, 0, mapW, mapH);
    const t = REDUCED ? 0 : now / 1000;
    const reveal = REDUCED ? Math.floor(S.reveal * 4) / 4 : S.reveal;
    const energy = S.energize;
    const booting = S.booting || S.phase === 'done';
    const sx = mapBounds.minX + reveal * (mapBounds.maxX - mapBounds.minX);
    ctx.globalAlpha = 1;

    // 底稿贴地，通电数据抬起；地表不再跟着数据一起增亮。
    for (const line of linePaths) {
      drawCorridor(ctx, line.pts);
      ctx.strokeStyle = 'rgba(210,224,230,.16)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // 扫描线只落在地图；地面投影和地表扫描相差一个底座高度。
    if (!REDUCED && reveal > 0.001 && reveal < 0.999) {
      const g = ctx.createLinearGradient(sx - 46, 0, sx, 0);
      g.addColorStop(0, 'rgba(251,251,70,0)');
      g.addColorStop(0.75, 'rgba(251,251,70,.06)');
      g.addColorStop(1, 'rgba(251,251,70,.16)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 46, 0, 46, mapH);
      ctx.strokeStyle = 'rgba(251,251,70,.75)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx + 0.5, 0); ctx.lineTo(sx + 0.5, mapH); ctx.stroke();
      ctx.fillStyle = 'rgba(251,251,70,.9)';
      for (let y = 12; y < mapH; y += 34) ctx.fillRect(sx - 4, y, 9, 1);
    }

    // 城市点烘焙在地表层，按扫描前沿一次裁剪揭示；带电城市叠绿色热点。
    if (reveal > 0.001) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, sx, mapH); ctx.clip();
      ctx.drawImage(dotsCanvas, 0, 0, mapW, mapH);
      if (energy > .5) {
        ctx.globalAlpha = clamp((energy - .5) / .3, 0, 1);
        ctx.drawImage(hotDotsCanvas, 0, 0, mapW, mapH);
      }
      ctx.restore();
    }

    // 高度由通电阶段一次建立：地表灰底稿保持不动，绿线路抬至节点顶面附近。
    const networkLift = 6 * (REDUCED ? 1 : clamp(energy / .22, 0, 1));
    ctx.save(); ctx.translate(0, -networkLift);
    // 线路按共享弧长依序出现，带电后只使用绿色。
    for (const line of linePaths) {
      const startAt = .035 + line.idx * .027;
      const local = clamp((reveal - startAt) / .42, 0, 1);
      if (local <= 0) continue;
      drawCorridor(ctx, line.pts);
      ctx.setLineDash([line.len * local, line.len]); ctx.lineDashOffset = 0;
      ctx.strokeStyle = energy > .15 ? 'rgba(8,42,34,.75)' : 'rgba(8,13,17,.5)';
      ctx.lineWidth = energy > .15 ? 3 : 2; ctx.stroke();
      ctx.strokeStyle = energy > .15 ? 'rgba(55,214,174,.88)' : 'rgba(220,228,221,.52)';
      ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      if (local >= .995 && energy > .04) {
        for (let k = 0; k < 2; k++) {
          const u = (t * .13 + k / 2 + line.idx * .11) % 1;
          const head = pathPointAt(line, u), tail = pathPointAt(line, Math.max(0, u - .035));
          ctx.strokeStyle = `rgba(179,255,221,${(.48 * energy).toFixed(3)})`;
          ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(...tail); ctx.lineTo(...head); ctx.stroke();
        }
      }
    }

    ctx.restore();
    // 节点细柱：暗投影 → 窄边侧面 → 方形顶面。
    const hover = S.hoverNode;
    const labelBoxes = [];
    for (const n of nodes) {
      const on = energy > .5, lift = n.lift, r = n.major ? 4.5 : 3;
      const topY = n.y - lift;
      ctx.fillStyle = 'rgba(0,0,0,.36)'; ctx.fillRect(n.x - 5 + 2, n.y - 1, 10, 3);
      ctx.fillStyle = on ? '#12644f' : '#53605d';
      ctx.beginPath(); ctx.moveTo(n.x-r, topY+r); ctx.lineTo(n.x-r, n.y+r); ctx.lineTo(n.x, n.y+r+2); ctx.lineTo(n.x, topY+r+2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(n.x, topY+r+2); ctx.lineTo(n.x, n.y+r+2); ctx.lineTo(n.x+r, n.y+r); ctx.lineTo(n.x+r, topY+r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = on ? '#1d785f' : '#263943';
      ctx.fillRect(n.x-r, topY-r, r*2, r*2);
      ctx.strokeStyle = on ? 'rgba(55,214,174,.9)' : 'rgba(251,251,70,.72)';
      ctx.lineWidth = 1; ctx.strokeRect(n.x-r+.5, topY-r+.5, r*2-1, r*2-1);
      ctx.fillStyle = on ? '#9af1d2' : '#fbfb46'; ctx.fillRect(n.x-1, topY-1, 2, 2);
      if (n.major) {
        ctx.font = '9px "Bahnschrift", "Consolas", monospace'; ctx.letterSpacing = '1px';
        const tw = ctx.measureText(n.name).width, right = n.x < mapW * .7;
        const tx = clamp(right ? n.x + 10 : n.x - tw - 10, 12, mapW - tw - 12);
        let ty = topY - 5;
        for (let i = 0; i < 4; i++) {
          if (!labelBoxes.some(b => tx - 3 < b.x + b.w && tx + tw + 3 > b.x && ty - 10 < b.y + 14 && ty + 3 > b.y)) break;
          ty -= 15;
        }
        labelBoxes.push({x:tx - 3,y:ty - 10,w:tw + 6});
        ctx.strokeStyle = 'rgba(236,237,237,.25)'; ctx.beginPath(); ctx.moveTo(n.x,topY-r); ctx.lineTo(tx + tw/2,ty+2); ctx.stroke();
        ctx.fillStyle = 'rgba(8,14,19,.88)'; ctx.fillRect(tx - 3, ty - 10, tw + 6, 14);
        ctx.fillStyle = 'rgba(236,238,233,.88)'; ctx.fillText(n.name, tx, ty);
      }
      if (hover === n.index) {
        const q = 13;
        ctx.strokeStyle = 'rgba(251,251,70,.9)'; ctx.lineWidth = 1;
        for (const [dx,dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
          ctx.beginPath(); ctx.moveTo(n.x+dx*q,n.y-lift+dy*(q-5)); ctx.lineTo(n.x+dx*q,n.y-lift+dy*q); ctx.lineTo(n.x+dx*(q-5),n.y-lift+dy*q); ctx.stroke();
        }
      }
    }

    if (!booting) {
      // 细节：图上角标尺
      ctx.strokeStyle = 'rgba(236,238,233,.18)';
      ctx.fillStyle = 'rgba(236,238,233,.28)';
      ctx.font = '7px "Bahnschrift", monospace';
      for (let i = 0; i <= 10; i++) {
        const x = 26 + (i / 10) * (mapW - 52);
        ctx.beginPath(); ctx.moveTo(x, mapH - 6); ctx.lineTo(x, mapH - (i % 5 === 0 ? 12 : 9)); ctx.stroke();
      }
    }
  }

  function nodesNeedIndex() { nodes.forEach((n, i) => { n.index = i; }); }

  /* ============================== 背景等高线 ============================== */
  const CLUSTERS = [
    { x: 0.16, y: 0.30, rings: 12, scale: 1.05 },
    { x: 0.82, y: 0.20, rings: 14, scale: 1.2 },
    { x: 0.66, y: 0.96, rings: 10, scale: 0.9 },
  ];
  function drawBg(now) {
    if (!bgW) return;
    const t = now / 1000;
    bgCtx.clearRect(0, 0, bgW, bgH);
    bgCtx.lineWidth = 1;
    for (const c of CLUSTERS) {
      const cx = c.x * bgW, cy = c.y * bgH;
      for (let r = 0; r < c.rings; r++) {
        const base = (30 + r * 34) * c.scale;
        bgCtx.beginPath();
        for (let a = 0; a <= 60; a++) {
          const ang = (a / 60) * Math.PI * 2;
          const wob = Math.sin(ang * 3 + t * .07 + r * .4) * 14 + Math.sin(ang * 5 - t * .05 + r * .7) * 7;
          const rr = base + wob;
          const x = cx + Math.cos(ang) * rr * 1.3;
          const y = cy + Math.sin(ang) * rr * .8;
          if (a) bgCtx.lineTo(x, y); else bgCtx.moveTo(x, y);
        }
        bgCtx.closePath();
        const alpha = 0.02 + 0.016 * (0.5 + 0.5 * Math.sin(r * .5 + t * .25));
        bgCtx.strokeStyle = `rgba(236,238,233,${alpha.toFixed(3)})`;
        bgCtx.stroke();
      }
    }
  }

  /* ============================== 波形 ============================== */
  function drawWave(now) {
    const w = 240, h = 50;
    const c = waveCtx;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(236,238,233,.06)';
    c.lineWidth = 1;
    for (let x = 0; x <= w; x += 16) { c.beginPath(); c.moveTo(x + .5, 0); c.lineTo(x + .5, h); c.stroke(); }
    for (let y = 0; y <= h; y += 12) { c.beginPath(); c.moveTo(0, y + .5); c.lineTo(w, y + .5); c.stroke(); }
    c.strokeStyle = 'rgba(251,251,70,.14)';
    c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();

    const amp = 2 + S.hold * 14 + S.energize * 8;
    const t = now / 1000;
    const volty = S.energize > 0.5;
    c.beginPath();
    for (let x = 0; x <= w; x++) {
      const u = x / w;
      const y = h / 2 + Math.sin(u * 22 + t * (4 + S.hold * 8)) * amp * Math.sin(u * Math.PI);
      if (x) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.strokeStyle = volty ? 'rgba(55,214,174,.85)' : 'rgba(251,251,70,.8)';
    c.lineWidth = 1.2;
    c.stroke();
  }

  /* ============================== 遥测 ============================== */
  const tele = { freq: '', volt: '', act: '', state: '' };
  function setText(node, key, text) {
    if (tele[key] !== text) { tele[key] = text; node.textContent = text; }
  }
  function updateTelemetry() {
    if (S.phase === 'boot' || S.phase === 'done') {
      const p = S.reveal;
      const live = p >= 0.999;
      const freq = live ? 50.0 : 49.62 + 0.38 * clamp((p - 0.5) / 0.5, 0, 1) + (live ? 0 : Math.sin(performance.now() / 90) * 0.02);
      const volt = 525 * clamp((p - 0.18) / 0.82, 0, 1);
      const act = 2.41 * Math.pow(clamp((p - 0.3) / 0.7, 0, 1), 1.5);
      setText(el.freq, 'freq', freq.toFixed(2));
      setText(el.volt, 'volt', volt.toFixed(1));
      setText(el.act, 'act', act.toFixed(2));
      setText(el.state, 'state', live ? 'ONLINE' : 'ENERGIZING');
      el.state.parentElement.classList.toggle('hot', live);
      if (live) { el.freq.parentElement.classList.add('hot'); el.volt.parentElement.classList.add('hot'); el.act.parentElement.classList.add('hot'); }
    } else if (S.phase === 'close') {
      setText(el.volt, 'volt', (S.brk * 525).toFixed(1));
      setText(el.freq, 'freq', '----');
      setText(el.act, 'act', '0.00');
      setText(el.state, 'state', S.brk >= 0.9 ? 'CLOSING' : 'READY');
    } else {
      setText(el.freq, 'freq', '----');
      setText(el.volt, 'volt', '0.0');
      setText(el.act, 'act', '0.00');
      setText(el.state, 'state', S.phase === 'access' ? 'STANDBY' : 'ARMED');
    }
  }

  /* ============================== 指针 / 悬停 ============================== */
  function onMapMove(ev) {
    if (!mapFit) return;
    const r = mapCv.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    // 经纬读数
    const lon = mapFit.LON0 + ((x - (mapFit.cx - (mapFit.LON1 - mapFit.LON0) / 2 * mapFit.s * mapFit.cosLat)) / (mapFit.s * mapFit.cosLat));
    const lat = mapFit.LAT1 - ((y - (mapFit.cy - (mapFit.LAT1 - mapFit.LAT0) / 2 * mapFit.s)) / mapFit.s);
    el.mapCoord.textContent = `N ${clamp(lat, 0, 60).toFixed(1)}°  E ${clamp(lon, 60, 150).toFixed(1)}°`;
    let best = -1, bd = 15;
    nodes.forEach((n, i) => {
      const d = Math.min(Math.hypot(n.x - x, n.y - y), Math.hypot(n.x - x, n.y - n.lift - y));
      if (d < bd) { bd = d; best = i; }
    });
    if (best !== S.hoverNode) {
      S.hoverNode = best;
      mapWrap.classList.toggle('focus-node', best >= 0);
      if (best >= 0) {
        const n = nodes[best];
        el.nodeTip.querySelector('b').textContent = n.name + ' · ' + n.kv;
        el.nodeTip.querySelector('span').textContent = 'HOVER · SCHEMATIC NODE';
        el.nodeTip.classList.add('show');
        const width = el.nodeTip.offsetWidth, height = el.nodeTip.offsetHeight;
        el.nodeTip.style.left = clamp(n.x + 14, 8, mapW - width - 8) + 'px';
        el.nodeTip.style.top = clamp(n.y - n.lift - height - 12, 24, mapH - height - 8) + 'px';
      } else el.nodeTip.classList.remove('show');
    }
  }
  function onMapLeave() {
    S.hoverNode = -1;
    mapWrap.classList.remove('focus-node');
    el.nodeTip.classList.remove('show');
  }

  /* ============================== 时钟 ============================== */
  function utcStamp() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
  }
  function tickClock() {
    const d = new Date();
    el.clock.textContent = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(pad2).join(':');
  }

  /* ============================== 主循环 ============================== */
  let teleFrame = 0;
  let reducedFrame = '';
  function loop(now) {
    if (S.phase === 'done') return;
    const key = `${S.phase}:${S.hold.toFixed(2)}:${S.brk.toFixed(2)}:${Math.floor(S.reveal * 4)}:${S.hoverNode}:${mapW}:${mapH}`;
    if (!REDUCED || key !== reducedFrame) {
      drawBg(REDUCED ? 0 : now);
      drawMap(REDUCED ? 0 : now);
      drawWave(REDUCED ? 0 : now);
      reducedFrame = key;
    }
    if (++teleFrame % 6 === 0) updateTelemetry();
    requestAnimationFrame(loop);
  }

  /* ============================== 初始化 ============================== */
  function resizeAll() {
    const b = fitCanvas(bgCv, bgCtx); bgW = b.w; bgH = b.h;
    buildMap();
    nodesNeedIndex();
    const wr = el.wave.getBoundingClientRect();
    el.wave.width = Math.floor(wr.width * DPR);
    el.wave.height = Math.floor(wr.height * DPR);
    waveCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (JUMP === 'boot') { S.reveal = 0.55; S.energize = 0.55; }
  }

  function bindEvents() {
    // 按住接入
    el.holdBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      beginHold();
    });
    el.holdBtn.addEventListener('pointerup', () => endHold(true));
    el.holdBtn.addEventListener('pointerleave', () => endHold(true));
    el.holdBtn.addEventListener('pointercancel', () => endHold(true));
    el.holdBtn.addEventListener('keydown', (ev) => {
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      ev.preventDefault();
      beginHold();
    });
    el.holdBtn.addEventListener('keyup', (ev) => {
      if (ev.key === ' ' || ev.key === 'Enter') endHold(true);
    });

    el.repeatBtn.addEventListener('click', (ev) => { ev.stopPropagation(); doRepeat(); });
    el.execBtn.addEventListener('click', (ev) => { ev.stopPropagation(); doExec(); });

    bindBreaker();

    mapCv.addEventListener('pointermove', onMapMove);
    mapCv.addEventListener('pointerleave', onMapLeave);
    mapCv.addEventListener('click', () => {
      if (S.hoverNode >= 0) {
        const n = nodes[S.hoverNode];
        toast(`${n.name} · ${n.kv} · 示意节点`, 'ok');
        blip(1000, 0.04, 'square', 0.01);
      }
    });

    el.skip.addEventListener('click', () => skipAll());

    el.done.addEventListener('click', () => leave());
    el.doneCta.addEventListener('click', (ev) => { ev.stopPropagation(); leave(); });

    el.sound.addEventListener('click', () => {
      S.sound = !S.sound;
      el.sound.textContent = S.sound ? '音效 开' : '音效 关';
      el.sound.classList.toggle('on', S.sound);
      if (!S.sound) humStop(); else if (S.userGesture) blip(880, 0.05, 'square', 0.015);
    });

    el.modeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setMode(S.auto ? 'manual' : 'auto');
      blip(760, 0.05, 'square', 0.012);
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); skipAll(); return; }
      if (S.done && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); leave(); }
    }, true);

    const wake = (ev) => {
      const t = ev.target;
      if (t && t.closest && (t.closest('#modeBtn') || t.closest('#soundChip'))) return;
      S.userGesture = true;
      if (S.auto) manualTakeover();
    };
    document.addEventListener('pointerdown', wake, true);
    document.addEventListener('keydown', wake, true);

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeAll, 120);
    });
  }

  function jumpTo(name) {
    if (!name) return;
    if (name === 'order') {
      paintHold(1);
      el.holdBtn.classList.add('ok'); el.holdBtn.disabled = true;
      setProgress(12);
      setPhase('order');
      // 调试跳转：直接完成打字
      el.orderText.textContent = ORDER;
      S.orderTyped = true; el.repeatBtn.disabled = false;
      S.echoTyping = false; S.repeated = true;
      el.repeatBtn.classList.add('settled');
      el.orderEcho.textContent = ECHO;
      el.execBtn.disabled = false;
      hint('复诵一致 · 点击「执行」下达指令', 'ok');
      log('复诵一致 · 校验通过', 'ok');
      return;
    }
    if (name === 'close') {
      setProgress(52); setPhase('close');
      return;
    }
    if (name === 'boot') {
      setProgress(72); setPhase('boot');
      S.bootStart = performance.now() - 2800;
      return;
    }
    if (name === 'done') {
      setProgress(100); showDone();
    }
  }

  function boot() {
    tickClock();
    setInterval(tickClock, 1000);
    resizeAll();
    bindEvents();
    paintHold(0);
    setProgress(0);
    updateTelemetry();
    syncMode();
    log('DSH TERMINAL SC-01 · 电源接通');
    log('等待调度员接入 · STANDBY');
    requestAnimationFrame(loop);

    if (JUMP) { jumpTo(JUMP); return; }
    if (S.auto) autoAt(autoHoldRun, 1100);
    // 通知宿主：动画已起来，可以撤掉载入看门狗（页面崩了就不会发这条）
    if (IN_FRAME) { try { window.parent.postMessage('boot-grid-zmd:ready', '*'); } catch (e) {} }
  }

  // 供调试 / 自动化测试
  window.__BOOT__ = {
    S, setPhase, paintHold, paintBreaker, finishHold, doRepeat, doExec, closeBreaker,
    showDone, state: S,
    get nodes() { return nodes },
    get mapFit() { return mapFit },
  };

  boot();
})();

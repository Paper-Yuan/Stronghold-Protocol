(() => {
  const $ = (id) => document.getElementById(id);
  const field = $('field'), warn = $('warn'), warnTimer = $('warnTimer');
  const bossStage = $('bossStage'), bossCore = $('bossCore');
  const hpFill = $('hpFill'), bossName = $('bossName'), bossPhase = $('bossPhase');
  const hudRound = $('hudRound'), stateEl = $('state');

  const WARN_MS = 2600;                // 预警持续 2.6 秒
  let phaseNo = 1;                      // 1 = 第一个 Boss，2 = 隐秘核心
  let hp = 100;                         // 百分比
  let hpTimer = null;
  let busy = false;                     // 预警/转场中，不接受点击

  const BOSS = [
    { name: '假想敌 · 其一', core: '◈', hpRate: 1.0 },
    { name: '隐秘核心 · 其二', core: '✵', hpRate: 1.0 },
  ];

  function setState(txt, phase2) {
    stateEl.innerHTML = '阶段：<b>' + phaseNo + ' / 2</b> · ' + txt;
    stateEl.classList.toggle('is-phase2', !!phase2);
  }

  function setHp(pct) {
    hp = Math.max(0, Math.min(100, pct));
    hpFill.style.width = hp + '%';
  }

  function startDrain() {
    clearInterval(hpTimer);
    // 自动掉血，模拟战斗推进（每秒 ~4%），让画面有生命感
    hpTimer = setInterval(() => {
      if (busy) return;
      setHp(hp - 4);
      if (hp <= 0) killBoss();
    }, 1000);
  }

  function hitBurst() {
    const fx = document.createElement('div');
    fx.className = 'hitfx';
    bossStage.appendChild(fx);
    setTimeout(() => fx.remove(), 500);
  }

  /** 击败当前 Boss */
  function killBoss() {
    if (busy) return;
    if (phaseNo >= 2) {
      // 第二个也死了 → 正常结束
      busy = true;
      clearInterval(hpTimer);
      setHp(0);
      hitBurst();
      setTimeout(() => {
        bossStage.classList.add('is-hidden');
        setState('双 Boss 已全部击败 —— 进入下一回合', true);
        stateEl.innerHTML = '阶段：<b>2 / 2 完成</b> · 双 Boss 已击败，正常进入下一轮次';
        hudRound.textContent = 'ROUND 45 // CLEARED';
        busy = false;
        $('btnKill').textContent = '已通关 · 点「重新开始」';
        $('btnKill').disabled = true;
      }, 700);
      return;
    }
    // 第一个死了 → 全屏红色预警 → 切第二个
    busy = true;
    clearInterval(hpTimer);
    setHp(0);
    hitBurst();
    setTimeout(() => showWarn(), 620);
  }

  function showWarn() {
    bossStage.classList.add('is-hidden');
    field.classList.add('is-dim');
    // 重置动画：先摘掉 is-on 强制回流，再挂上，这样重播也会重新播一遍
    warn.classList.remove('is-on', 'is-out');
    void warn.offsetWidth;
    warn.classList.add('is-on');
    warnTimer.style.transition = 'none';
    warnTimer.style.transform = 'scaleX(0)';
    void warnTimer.offsetWidth;
    warnTimer.style.transition = 'transform ' + WARN_MS + 'ms linear';
    warnTimer.style.transform = 'scaleX(1)';
    setState('敌方领袖已倒下 · 隐秘核心正在苏醒…', true);

    setTimeout(() => {
      warn.classList.add('is-out');
      warn.classList.remove('is-on');
      field.classList.remove('is-dim');
      setTimeout(() => { warn.classList.remove('is-out'); spawnSecond(); }, 340);
    }, WARN_MS);
  }

  function spawnSecond() {
    phaseNo = 2;
    const b = BOSS[1];
    bossName.textContent = b.name;
    bossCore.textContent = b.core;
    bossPhase.textContent = 'PHASE 2 / 2';
    hudRound.textContent = 'ROUND 45 // CORE';
    hudRound.classList.add('is-phase2');
    setHp(100);
    bossStage.classList.remove('is-hidden');
    bossStage.classList.add('is-enter');
    setTimeout(() => bossStage.classList.remove('is-enter'), 900);
    setState('战斗中（点击 Boss 削血）', true);
    busy = false;
    startDrain();
  }

  function reset() {
    clearInterval(hpTimer);
    busy = false;
    phaseNo = 1;
    const b = BOSS[0];
    bossName.textContent = b.name;
    bossCore.textContent = b.core;
    bossPhase.textContent = 'PHASE 1 / 2';
    hudRound.textContent = 'ROUND 45 // BOSS';
    hudRound.classList.remove('is-phase2');
    setHp(100);
    bossStage.classList.remove('is-hidden', 'is-enter');
    warn.classList.remove('is-on');
    field.classList.remove('is-dim');
    $('btnKill').textContent = '一击击败当前 Boss';
    $('btnKill').disabled = false;
    setState('战斗中（点击 Boss 削血）', false);
    startDrain();
  }

  // ── 交互 ──
  bossStage.addEventListener('click', () => {
    if (busy) return;
    hitBurst();
    setHp(hp - 18);
    if (hp <= 0) killBoss();
  });
  $('btnKill').addEventListener('click', killBoss);
  $('btnReplay').addEventListener('click', () => {
    if (busy) return;
    busy = true;
    clearInterval(hpTimer);
    showWarn();
  });
  $('btnReset').addEventListener('click', reset);

  // 键盘：空格 = 一击
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); killBoss(); }
    if (e.code === 'KeyR') reset();
  });

  reset();
})();
(function(){
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const num = (n) => String(n);

  /* ── tabs ───────────────────────────────────────────── */
  $$('.olo-tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.olo-tab').forEach((t) => { t.classList.toggle('is-on', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
    $$('.olo-view').forEach((v) => v.classList.toggle('is-on', v.dataset.view === tab.dataset.tab));
  }));

  /* ── 档案 ───────────────────────────────────────────── */
  const FILES = {
    30: { round: 30, boss: 3, traits: 5, layers: 412, kills: [['R20','猩红血钻'],['R25','昆图斯'],['R30','“巨大的丑东西”']],
      chips: [['强攻','pos'],['灵巧','pos'],['再生','pos'],['虚弱','neg'],['虚空','neg']] },
    45: { round: 45, boss: 6, traits: 8, layers: 986, kills: [['R20','猩红血钻'],['R25','昆图斯'],['R30','“巨大的丑东西”'],['R40','凋零骑士 · 腐败骑士'],['R45','杰斯顿 · “狼之主”']],
      chips: [['强攻','pos'],['灵巧','pos'],['再生','pos'],['共栖','pos'],['破局','pos'],['虚弱','neg'],['迟滞','neg'],['不和','neg']] },
    60: { round: 60, boss: 9, traits: 11, layers: 2140, kills: [['R20','猩红血钻'],['R25','昆图斯'],['R30','“巨大的丑东西”'],['R40','凋零骑士 · 腐败骑士'],['R45','杰斯顿 · “狼之主”'],['R55','双 Boss'],['R60','双 Boss']],
      chips: [['强攻','pos'],['灵巧','pos'],['再生','pos'],['共栖','pos'],['破局','pos'],['富足','pos'],['虚弱','neg'],['迟滞','neg'],['不和','neg'],['暴露','neg'],['萎靡','neg']] },
  };
  function renderFile(set){
    const d = FILES[set];
    $('#file-round').textContent = num(d.round);
    $('#file-boss').textContent = num(d.boss);
    $('#file-traits').textContent = num(d.traits);
    $('#file-layers').innerHTML = num(d.layers) + '<em>层</em>';
    $('#hud-round').textContent = 'R ' + d.round;
    $('#hud-traits').textContent = num(d.traits);
    $('#file-new').style.display = set === '60' ? 'inline-flex' : 'none';
    $('#file-kills').innerHTML = d.kills.map(([r, n]) => `<li><span class="r">${r}</span><span class="n">${n}</span><span class="tag">LEADER</span></li>`).join('');
    $('#file-chips').innerHTML = d.chips.map(([n, p]) => `<span class="olo-chip ${p === 'neg' ? 'is-neg' : ''}">${n}</span>`).join('');
  }
  $$('#file-switch button').forEach((b) => b.addEventListener('click', () => {
    $$('#file-switch button').forEach((x) => x.classList.toggle('is-on', x === b));
    renderFile(b.dataset.set);
  }));
  renderFile('30');

  /* ── 词条 ───────────────────────────────────────────── */
  const TRAIT_SETS = [
    [ { name: '强攻', text: '全体干员攻击力 +25%', mob: '法术大师A1', neg: false },
      { name: '灵巧', text: '所有我方单位获得 15% 物理与法术闪避', mob: '帝国炮火中枢先兆者', neg: false },
      { name: '虚弱', text: '全体干员攻击力 -20%', mob: '“越长尘”', neg: true } ],
    [ { name: '再生', text: '全体干员每 2 秒额外回复 3% 的生命值', mob: '极寒源石虫', neg: false },
      { name: '破局', text: '敌方全体单位防御力 -15%，法抗 -6', mob: '家族灭迹人', neg: false },
      { name: '蜂拥', text: '下回合额外出现 1 只随机精英敌人', mob: '狂暴宿主组长', neg: true } ],
    [ { name: '壁垒', text: '敌方全体单位防御力 +15%，法抗 +6', mob: '萨卡兹枯朽战车', neg: true },
      { name: '共栖', text: '本局所有方式提升的盟约层数额外 +1', mob: '泥岩巨像', neg: false },
      { name: '萎靡', text: '所有我方单位受到的治疗和生命回复效果 -20%', mob: '深池伙友卫队精英', neg: true } ],
  ];
  let traitSet = 0, locked = null, picked = null, rerolls = 1, skipped = false;
  const toast = (txt) => { const el = $('#trait-toast'); el.textContent = txt; el.classList.add('is-on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('is-on'), 1600); };
  function renderTraits(){
    const cards = TRAIT_SETS[traitSet];
    $('#trait-cards').innerHTML = cards.map((c, i) => `
      <article class="olo-tcard ${c.neg ? 'is-neg' : ''} ${locked === i ? 'is-locked' : ''} ${picked === i ? 'is-selected' : ''}" data-trait="${i}">
        <div class="olo-tcard__top"><span class="olo-tcard__kind">${c.neg ? 'NEGATIVE' : 'POSITIVE'} · TRAIT</span>
          <button class="olo-tcard__lock" data-lock="${i}" title="锁定到下一次抉择">${locked === i ? '●' : '○'}</button></div>
        <div class="olo-tcard__name">${c.name}</div>
        <div class="olo-tcard__desc">${c.text}</div>
        <div class="olo-tcard__mob">敌人 · <b>${c.mob}</b><span class="badge">${c.neg ? '危机' : '悬赏'}</span></div>
      </article>`).join('');
    $('#trait-reroll').disabled = rerolls <= 0;
    $('#trait-reroll').innerHTML = `重抽 <span class="num">(${rerolls})</span>`;
    $('#trait-lock-hint').textContent = locked == null ? '未锁定' : `已锁定：${TRAIT_SETS[traitSet][locked].name}`;
    $('#trait-picked').innerHTML = skipped
      ? '本次已跳过 · <b>下一轮资金 +1</b>'
      : (picked == null ? '本局已选：<b>—</b>' : `本局已选：<b>${TRAIT_SETS[traitSet][picked].name}</b>（确认后生效）`);
    $$('#trait-cards [data-lock]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = Number(b.dataset.lock);
      locked = locked === i ? null : i;
      renderTraits();
      toast(locked == null ? '已取消锁定' : '已锁定，下次抉择必出');
    }));
    $$('#trait-cards .olo-tcard').forEach((el) => el.addEventListener('click', () => {
      if (locked === Number(el.dataset.trait)) return;
      picked = Number(el.dataset.trait); renderTraits();
    }));
  }
  $('#trait-reroll').addEventListener('click', () => {
    if (rerolls <= 0) return;
    rerolls--; traitSet = (traitSet + 1) % TRAIT_SETS.length; picked = null;
    renderTraits(); toast('已重抽 · 本次抉择刷新');
  });
  $('#trait-skip').addEventListener('click', () => {
    skipped = true; picked = null; $('#trait-confirm').disabled = true;
    renderTraits(); toast('已跳过 · 下一轮资金 +1');
  });
  $('#trait-confirm').addEventListener('click', () => {
    if (skipped) { toast('本次已跳过'); return; }
    if (picked == null) { toast('先选一张词条'); return; }
    $('#hud-traits').textContent = String(Number($('#hud-traits').textContent) + 1);
    toast(`已选择 · ${TRAIT_SETS[traitSet][picked].name}`);
  });
  renderTraits();

  /* ── 词缀 ───────────────────────────────────────────── */
  const AFFIXES = [
    { id:'berserk', name:'狂暴', text:'生命低于 50% 时攻击速度 +50%、攻击力 +20%。', stage:'第一阶段', warn:'核心生命 +50%' },
    { id:'summon', name:'召唤', text:'每 20 秒召唤 1 只随从；随从不计入漏怪。', stage:'第一阶段', warn:'随从每 20 秒 +1' },
    { id:'shield', name:'护盾', text:'开场获得等于 40% 最大生命的护盾，破盾前受到伤害 -60%。', stage:'二阶段', warn:'护盾 · 伤害 -60%' },
    { id:'reflect', name:'反伤', text:'近战干员每次攻击受到其攻击力 15% 的真实伤害。', stage:'二阶段', warn:'近战反伤 15%' },
  ];
  let affix = 0;
  function renderAffixes(){
    const a = AFFIXES[affix];
    $('#affix-title').textContent = a.name;
    $('#affix-desc').textContent = a.text;
    $('#affix-stage').textContent = a.stage;
    $('#affix-warn').textContent = a.name;
    $('#hud-affix').innerHTML = 'BOSS 词缀 · <b>' + a.name + '</b>';
    $('#affix-list').innerHTML = AFFIXES.map((x, i) => `
      <div class="olo-affix ${i === affix ? 'is-on' : ''}" data-affix="${i}">
        <span class="ico">${x.name.slice(0,1)}</span>
        <span class="txt"><b>${x.name}</b><span>${x.text}</span></span>
        <span class="st">${x.stage === '二阶段' ? '二阶段' : (i === affix ? '生效中' : '可选')}</span>
      </div>`).join('');
    $$('#affix-list .olo-affix').forEach((el) => el.addEventListener('click', () => { affix = Number(el.dataset.affix); renderAffixes(); toast('预览词缀：' + AFFIXES[affix].name); }));
  }
  renderAffixes();

  /* ── 契约 ───────────────────────────────────────────── */
  const CONTRACTS = [
    { id:'none', name:'不签契约', desc:'按常规 Boss 轮开战，不承受额外风险，也不拿额外奖励。', reward:'奖励：无', hp:'常规', tone:'' },
    { id:'elite', name:'加一只精英', desc:'Boss 轮额外出现 1 只随机精英敌人，与 Boss 同时出场。', reward:'奖励：<b>词条 +1</b>', hp:'常规', tone:'' },
    { id:'time', name:'限时 90 秒', desc:'Boss 轮时限缩短到 90 秒；超时按漏怪处理。', reward:'奖励：<b>资金 +2</b>', hp:'常规', tone:'is-warn' },
    { id:'aspd', name:'敌方攻速 +20%', desc:'Boss 与随从的攻击速度提升 20%，持续整轮。', reward:'奖励：<b>重抽 +1</b>', hp:'常规', tone:'is-warn' },
  ];
  let contract = 0;
  function renderContracts(){
    const c = CONTRACTS[contract];
    $('#contract-cards').innerHTML = CONTRACTS.slice(1).map((x, i) => `
      <article class="olo-ccard ${contract === i + 1 ? 'is-on' : ''}" data-contract="${i + 1}">
        <span class="olo-ccard__kind">CONTRACT · ${x.id.toUpperCase()}</span>
        <span class="olo-ccard__name">${x.name}</span>
        <span class="olo-ccard__desc">${x.desc}</span>
        <span class="olo-ccard__reward">${x.reward}</span>
      </article>`).join('');
    $('#contract-name').textContent = c.name;
    $('#contract-hp').textContent = c.hp;
    $('#contract-reward').textContent = c.id === 'none' ? '无' : c.reward.replace(/<[^>]+>/g, '');
    $('#hud-contract').innerHTML = '契约 · <b>' + (c.id === 'none' ? '未选择' : c.name) + '</b>';
    $$('#contract-cards .olo-ccard').forEach((el) => el.addEventListener('click', () => {
      contract = Number(el.dataset.contract); renderContracts(); toast('已选择契约：' + CONTRACTS[contract].name);
    }));
  }
  $('#contract-reset').addEventListener('click', () => { contract = 0; renderContracts(); toast('已重置契约'); });
  renderContracts();
})();

// 超限 · 词条抉择 动效预览（临时文件，接进游戏后删）
// 词条池：十二组，正负一一对应；每张卡附一只真实悬赏怪（coin ≥ 3，名字取自 data/enemies.json）

// 特化配置：以后任何一只怪都能特化，加一条 special 键 + 在这里登记一张徽记图即可
const SPECIAL = {
  reid: {
    img: '/dev/enemy-reid.png', hue: '231,49,24', hi: '#ff5454',
    title: '复仇-火与钢',
    desc: '<“复仇者”>的生命值提升 <b>150%</b>，获得<b>抵抗</b>，攻击速度提升 <b>100</b>，'
        + '生命值低于一半时攻击力额外提升 <b>100%</b> 且受到的伤害减少 <b>60%</b>',
    chance: 0.2,
  },
  mdrock: {
    img: '/dev/enemy-mdrock.png', hue: '231,49,24', hi: '#ff5454',
    title: '坚甲随身Ⅲ',
    desc: '<泥岩>的攻击力提升 <b>90%</b>，生命值提升 <b>100%</b>，法术抗性提升 <b>45</b>，'
        + '<泥岩>的护盾值额外提升 <b>100%</b> 且护盾刷新冷却时间减少至 <b>70%</b>',
    chance: 0.2,
  },
  xi: {
    img: '/dev/enemy-xi.png', hue: '231,49,24', hi: '#ff5454',
    title: '气定神闲Ⅲ',
    desc: '<“自在”>的生命值提升 <b>50%</b>，防御力提升 <b>250%</b>，法术抗性提升 <b>30</b>，'
        + '【破桎而出】的释放间隔缩短 <b>50%</b>，爆炸范围扩大 <b>100%</b>',
    chance: 0.2,
  },
};

// ── 怪物池：悬赏 coin ≥ 3 的全部 46 只（按等级分组，抽卡时按权重取） ──
// 等级权重：普通 5% / 精英 25% / BOSS 70%（业主 2026-10-18 第二次调整：普通降到 5%，让给精英）
const RANK_WEIGHT = { NORMAL: 5, ELITE: 25, BOSS: 70 };

// 特化怪「复仇者」不进普通随机池：它只以特化卡出现，避免同一次抽卡里重复
// 特化怪都不进普通随机池（只在特化卡出现，避免同次抽卡重复）
const SPECIAL_MOBS = new Set(['enemy_1539_reid', 'enemy_1511_mdrock', 'enemy_1517_xi']);

const MONSTERS = {
  NORMAL: [
    { mob: '法术大师A1', icon: 'enemy_1041_lazerd' },
  ],
  ELITE: [
    { mob: '“越长尘”', icon: 'enemy_1302_ymtro_2' },
    { mob: '帝国炮火中枢先兆者', icon: 'enemy_1112_emppnt_2' },
    { mob: '鼎沸', icon: 'enemy_10054_cjhot' },
    { mob: '反派阵营角色', icon: 'enemy_10099_crvln' },
    { mob: '高普尼克', icon: 'enemy_2002_bearmi' },
    { mob: '高准度伦蒂尼姆城防自行炮', icon: 'enemy_1273_stmgun_2' },
    { mob: '家族灭迹人', icon: 'enemy_1283_sgkill' },
    { mob: '尖端萨卡兹枯朽战车', icon: 'enemy_1272_nhtank_2' },
    { mob: '狂暴宿主组长', icon: 'enemy_1062_rager_2' },
    { mob: '澪', icon: 'enemy_10118_ymgprc' },
    { mob: '流泪小子', icon: 'enemy_2034_sythef' },
    { mob: '泥岩巨像', icon: 'enemy_1092_mdgint' },
    { mob: '清明', icon: 'enemy_1209_sfden' },
    { mob: '萨卡兹骸骨拷打者', icon: 'enemy_1364_spnaxe_2' },
    { mob: '萨卡兹枯朽战车', icon: 'enemy_1272_nhtank' },
    { mob: '山海众头目', icon: 'enemy_1299_ymkilr' },
    { mob: '深池伙友卫队', icon: 'enemy_1174_duholy' },
    { mob: '深池伙友卫队精英', icon: 'enemy_1174_duholy_2' },
    { mob: '术师快艇', icon: 'enemy_1162_magmot' },
    { mob: '温顺的武装大驮兽', icon: 'enemy_1415_mmkabi_2' },
    { mob: '乌顶巨角卢鲁', icon: 'enemy_10144_xdelk_2' },
    { mob: '新硎', icon: 'enemy_1207_sfji_2' },
    { mob: '鸭爵', icon: 'enemy_2001_duckmi' },
    { mob: '伊利昂的木驮兽', icon: 'enemy_10159_mntrjn' },
    { mob: '元核孽生者', icon: 'enemy_1439_dslntf' },
    { mob: '圆仔', icon: 'enemy_2085_skzjxd' },
    { mob: '主角阵营角色', icon: 'enemy_10098_crhro' },
    { mob: '灼藤', icon: 'enemy_10067_ftsjc' },
    { mob: '自制投石机', icon: 'enemy_10162_mnctpt' },
  ],
  BOSS: [
    { mob: '“巨大的丑东西”', icon: 'enemy_1512_mcmstr' },
    { mob: '锏', icon: 'enemy_1525_blkswb' },
    { mob: '迷路的巨像', icon: 'enemy_2003_rockman' },
    { mob: '扎罗，“狼之主”', icon: 'enemy_1535_wlfmster' },
    { mob: '“墓碑”', icon: 'enemy_2008_flking' },
    { mob: '“遗弃者”', icon: 'enemy_2005_axetro' },
    { mob: '“自在”', icon: 'enemy_1517_xi', special: 'xi' },
    { mob: '杰斯顿·威廉姆斯', icon: 'enemy_1516_jakill' },
    { mob: '泥岩', icon: 'enemy_1511_mdrock', special: 'mdrock' },
    { mob: '“邪魔的利刃”', icon: 'enemy_2048_smgrd' },
    { mob: '凋零骑士', icon: 'enemy_1513_dekght_2' },
    { mob: '腐败骑士', icon: 'enemy_1513_dekght' },
    { mob: '纠缠藤蔓', icon: 'enemy_2052_smgia' },
    { mob: '喷气人', icon: 'enemy_2004_balloon' },
    { mob: '陷落雪祀', icon: 'enemy_2050_smsha' },
  ],
};

// ── 词条池：每条都带名字（业主 2026-10-18）。正面 13 条，负面 14 条逐条对位 ──
const TRAITS = {
  pos: [
    { n: '再生', t: '全体干员每 <b>2 秒</b>额外回复 <b>3%</b> 的生命值' },
    { n: '浴血', t: '干员生命值越低攻击力越高，<b>30%</b> 生命值时达到最大 <b>+50%</b>' },
    { n: '坚守', t: '全体干员<b>防御力 +20%</b>，<b>法抗 +8</b>' },
    { n: '强攻', t: '全体干员<b>攻击力 +25%</b>' },
    { n: '意志', t: '所有我方<b>近战单位</b>部署时获得最大生命 <b>50%</b> 的屏障' },
    { n: '熟稔', t: '所有自然回复技能的<b>技力恢复 +0.2/秒</b>' },
    { n: '灵巧', t: '所有我方单位获得 <b>15%</b> 物理与法术<b>闪避</b>' },
    { n: '盛发', t: '所有我方单位受到的<b>治疗与生命回复 +20%</b>' },
    { n: '富足', t: '每回合开始时，额外获得 <b>1 资金</b>' },
    { n: '破局', t: '敌方全体单位<b>防御力 -15%</b>，<b>法抗 -6</b>' },
    { n: '再起', t: '本局每回合完成<b>完美作战</b>后回复 <b>1</b> 点生命' },
    { n: '共栖', t: '本局所有方式提升的<b>盟约层数额外 +1</b>' },
    { n: '集群', t: '下回合获得一个<b>【变形同构体】</b>' },
  ],
  neg: [
    { n: '腐蚀', t: '全体干员每 <b>2 秒</b>额外损失 <b>1%</b> 的生命值' },
    { n: '颓势', t: '干员生命值越低攻击力越低，<b>30%</b> 生命值时最多 <b>-30%</b>' },
    { n: '破防', t: '全体干员<b>防御力 -20%</b>，<b>法抗 -8</b>' },
    { n: '虚弱', t: '全体干员<b>攻击力 -20%</b>' },
    { n: '脆壳', t: '所有我方<b>近战单位</b>部署时受到最大生命 <b>20%</b> 的伤害' },
    { n: '迟滞', t: '所有自然回复技能的<b>技力恢复 -0.2/秒</b>' },
    { n: '暴露', t: '所有我方单位受到<b>物理与法术伤害 +15%</b>' },
    { n: '萎靡', t: '所有我方单位受到的<b>治疗与生命回复 -20%</b>' },
    { n: '贫乏', t: '每回合开始时，<b>资金 -1</b>（最低 0）' },
    { n: '壁垒', t: '敌方全体单位<b>防御力 +15%</b>，<b>法抗 +6</b>' },
    { n: '苛责', t: '每回合<b>未达成完美作战</b>时，目标<b>生命值 -1</b>' },
    { n: '离散', t: '本局所有方式提升的<b>盟约层数额外 -1</b>' },
    { n: '蜂拥', t: '下回合额外出现 <b>1</b> 只随机<b>精英敌人</b>' },
    { n: '不和', t: '每回合开始时，随机减少 <b>3</b> 个盟约的 <b>10 层</b>层数' },
  ],
};

const SUB = {
  pos: '本次为<b>正面</b>词条 · 效果立即生效并贯穿本局剩余战斗',
  neg: '本次为<b>负面</b>词条 · 效果立即生效并贯穿本局剩余战斗',
};

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function replay(el) {
  if (!el) return;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

function sample(list, n) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function play(polarity) {
  const neg = polarity === 'neg';
  const stage = $('stage');
  stage.style.setProperty('--acc', neg ? 'var(--neg)' : 'var(--pos)');
  stage.style.setProperty('--acc-hi', neg ? 'var(--neg-hi)' : 'var(--pos-hi)');
  stage.style.setProperty('--acc-a12', neg ? 'var(--neg-a12)' : 'var(--pos-a12)');
  stage.style.setProperty('--acc-a30', neg ? 'var(--neg-a30)' : 'var(--pos-a30)');
  stage.style.setProperty('--acc-a55', neg ? 'var(--neg-a55)' : 'var(--pos-a55)');
  $('sub').innerHTML = SUB[polarity];
  replay($('micro')); replay($('title')); replay($('sub'));
  document.querySelectorAll('.dia').forEach(replay);
  replay(document.querySelector('.rule'));
  replay(document.querySelector('.foot'));
  replay(document.querySelector('.veil'));

  // ── 抽卡 ──
  // 1) 特化：负面按概率强制占第一张，且「复仇者」不进普通随机（不会重复）
  let special = null;
  if (neg) {
    for (const [key, sp] of Object.entries(SPECIAL)) {
      if (Math.random() < (sp.chance ?? 0.2)) {
        const host = [...MONSTERS.BOSS, ...MONSTERS.ELITE].find((m) => m.special === key);
        special = { key, sp, icon: host ? host.icon : (key === 'reid' ? 'enemy_1539_reid' : null) };
        break;
      }
    }
  }
  // 2) 三张卡的怪物：按等级权重（普通 10 / 精英 20 / BOSS 70）抽，且三张互不重复
  const usedIcons = new Set(special ? [...SPECIAL_MOBS] : []);
  const drawMob = () => {
    // 先按等级权重定等级，再在该等级里等概率取一只（否则池子大小会淹没权重）
    const ranks = Object.entries(RANK_WEIGHT).filter(([rank]) => (MONSTERS[rank] || []).some((m) => !usedIcons.has(m.icon)));
    if (!ranks.length) return null;
    let r = Math.random() * ranks.reduce((a, [, w]) => a + w, 0);
    let rank = ranks[ranks.length - 1][0];
    for (const [rk, w] of ranks) { r -= w; if (r <= 0) { rank = rk; break; } }
    const pool = (MONSTERS[rank] || []).filter((m) => !usedIcons.has(m.icon));
    const m = pool[Math.floor(Math.random() * pool.length)];
    if (!m) return null;
    usedIcons.add(m.icon);
    return { ...m, boss: rank === 'BOSS' };
  };
  // 3) 三张卡的词条：从对应极性池里抽，互不重复
  const traits = sample(TRAITS[polarity], 3);
  const picks = [];
  if (special) {
    const host = MONSTERS.BOSS.find((m) => m.icon === special.icon) || { mob: '“复仇者”', icon: 'enemy_1539_reid' };
    picks.push({ mob: host.mob, icon: host.icon, special: special.key, boss: true, trait: traits[0].t, traitName: traits[0].n });
  }
  for (let i = picks.length; i < 3; i++) {
    const m = drawMob();
    if (!m) break;
    picks.push({ mob: m.mob, icon: m.icon, boss: m.boss === true, trait: traits[i].t, traitName: traits[i].n });
  }

  const cards = $('cards');
  cards.className = 'cards';
  cards.innerHTML = '';
  picks.forEach((c, i) => {
    const sp = c.special ? SPECIAL[c.special] : null;
    const el = document.createElement('div');
    el.className = 'card' + (neg ? ' card--neg' : '') + (c.special ? ' card--special' : '');
    if (sp) {
      el.dataset.special = c.special;
      el.style.setProperty('--sigil', 'url("' + sp.img + '")');
      el.style.setProperty('--sp-rgb', sp.hue);
      el.style.setProperty('--sp-hi', sp.hi);
    }
    el.innerHTML = [
      '<span class="ring ring--glow"></span><span class="ring"></span>',
      '<span class="lock"></span><span class="flash"></span><span class="shock"></span>',
      '<span class="frame"><i class="t"></i><i class="r"></i><i class="b"></i><i class="l"></i>',
      '<i class="ch ch-a"></i><i class="ch ch-b"></i></span>',
      '<b class="brk tl"></b><b class="brk tr"></b><b class="brk bl"></b><b class="brk br"></b>',
      '<span class="scan"></span>',
      '<span class="tag' + (sp ? ' tag--special' : '') + '">' + (sp && sp.title ? sp.title : (neg ? '负面词条' : '正面词条')) + '</span>',
      (c.boss ? '<span class="bossflag">BOSS</span>' : ''),
      '<div class="art"><span class="diamond"></span><img class="mobicon" src="/assets/enemy/icon/' + c.icon + '.png" alt="" draggable="false"></div>',
      (c.special ? '<span class="wm" aria-hidden="true"></span>' : ''),
      '<div class="body">',
      '  <div class="mob">' + c.mob + '</div>',
      (sp && sp.desc ? '  <div class="sep sep--tight"></div>' : ''),
      (sp && sp.desc ? '  <div class="specdesc">' + sp.desc + '</div>' : ''),
      '  <div class="sep"></div>',
      '  <div class="traitname">' + c.traitName + '</div>',
      '  <div class="trait">' + c.trait + '</div>',
      '</div>',
      '<div class="folder" aria-hidden="true"></div>',
      '<div class="pick"><span>已选择</span></div>',
    ].join('');
    el.addEventListener('click', () => pick(cards, el, neg));
    cards.appendChild(el);
    setTimeout(() => el.classList.add('is-ready'), 880 + i * 120);
  });
}

const DEL_STAGGER = 120, DEL_FLICKER = 580, DEL_WIPE = 400, DEL_PAD = 100;
const MOVE_MS = 620, MORPH_MS = 820;

function pick(cards, el, neg) {
  if (cards.classList.contains('is-choosing')) return;
  cards.classList.add('is-choosing');

  const row = cards.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  el.style.setProperty('--to-center', ((row.left + row.width / 2) - (box.left + box.width / 2)) + 'px');

  el.classList.add('is-selected');
  const dels = [...cards.children].filter((c) => c !== el);
  dels.forEach((c, i) => {
    c.style.setProperty('--del-delay', (i * DEL_STAGGER) + 'ms');
    c.classList.add('is-deleting');
  });
  setTimeout(() => { for (const c of dels) c.classList.add('is-wiped'); }, DEL_FLICKER);

  const lastGone = DEL_FLICKER + Math.max(0, dels.length - 1) * DEL_STAGGER + DEL_WIPE + DEL_PAD;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    el.classList.add('is-moving');
    setTimeout(() => morphToFolder(el), MOVE_MS + 60);
  };
  let remaining = dels.length;
  for (const c of dels) {
    c.addEventListener('animationend', (e) => {
      if (e.animationName === 'cyberWipe' && --remaining <= 0) start();
    }, { once: true });
  }
  setTimeout(start, lastGone + 60);

  const total = lastGone + MOVE_MS + MORPH_MS + 1600;
  setTimeout(() => {
    reset();
    cards.style.transition = 'opacity .4s ease';
    cards.style.opacity = '0';
    setTimeout(() => {
      cards.style.opacity = '';
      cards.style.transition = '';
      play(neg ? 'neg' : 'pos');
    }, 420);
  }, total);
}

function reset() {
  for (const n of document.querySelectorAll('.card.is-folder')) n.remove();
}

function morphToFolder(el) {
  const cr = el.getBoundingClientRect();
  const nw = Math.min(600, Math.round(window.innerWidth * 0.8));
  const folder = el.querySelector('.folder');
  buildFolder(folder, el);

  const probe = document.createElement('div');
  probe.className = el.className + ' is-folder';
  probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:' + nw + 'px;height:auto;';
  probe.innerHTML = '<div class="folder">' + folder.innerHTML + '</div>';
  document.getElementById('stage').appendChild(probe);
  const nh = Math.round(probe.getBoundingClientRect().height) || 210;
  probe.remove();

  document.body.appendChild(el);
  el.style.position = 'fixed';
  el.style.margin = '0';
  el.style.transform = 'none';
  el.style.transition = 'none';
  el.style.left = cr.left + 'px';
  el.style.top = cr.top + 'px';
  el.style.width = cr.width + 'px';
  el.style.height = cr.height + 'px';
  el.classList.add('is-folder');

  requestAnimationFrame(() => {
    el.style.transition = '';
    requestAnimationFrame(() => {
      el.style.left = Math.round((window.innerWidth - nw) / 2) + 'px';
      el.style.top = Math.round((window.innerHeight - nh) / 2) + 'px';
      el.style.width = nw + 'px';
      el.style.height = nh + 'px';
    });
  });
}

function buildFolder(doc, el) {
  const sp = el.dataset.special ? SPECIAL[el.dataset.special] : null;
  const mob = (el.querySelector('.mob') || {}).textContent || '';
  const trait = (el.querySelector('.trait') || {}).innerHTML || '';
  const neg = el.classList.contains('card--neg');
  doc.innerHTML = [
    '<div class="fade-in folder__top">',
    '  <span class="folder__kind">TRAIT ACQUIRED · ' + (neg ? '负面' : '正面') + '</span>',
    '  <span class="folder__scope">INFINITE PROTOCOL</span>',
    '</div>',
    (sp && sp.title ? '<div class="fade-in"><p class="folder__title">' + sp.title + '</p></div>' : ''),
    (sp && sp.desc ? '<div class="fade-in"><p class="folder__desc">' + sp.desc + '</p></div>' : ''),
    '<div class="fade-in"><p class="folder__trait">' + trait + '</p></div>',
    '<div class="fade-in folder__rows">',
    '  <span class="folder__k">选择敌人</span><span class="folder__v folder__v--mob">' + mob + '</span>',
    '  <span class="folder__k">生效范围</span><span class="folder__v">本局剩余的全部战斗（永久）</span>',
    '</div>',
    '<div class="fade-in folder__foot"><span class="folder__seal">已生效</span></div>',
  ].join('');
}

document.querySelectorAll('.replay button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.replay button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    reset();
    play(b.dataset.p);
  });
});

play('pos');

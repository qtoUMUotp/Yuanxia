/* 界面：建卡向导 / 地图 / 战斗 / 事件 / 商店 / 休整 / 升级 / 人物卡 */
(function (global) {
  const NK = (global.NK = global.NK || {});
  const R = NK.Rules;
  const U = NK.Util;

  const GAME_NAME = '渊下';

  const App = {
    screen: 'title', run: null, modal: null, toast: null, _toastTimer: null,
    targetUid: null, asiDraft: null, overSummary: null, spellPick: [], create: null, logTail: 0,
  };

  const el = () => document.getElementById('app');
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attrName = (k) => NK.Data.get('rules').attrLabels[k];
  const fmt = (v) => (v >= 0 ? '+' : '') + v;

  function toast(msg) {
    App.toast = msg;
    clearTimeout(App._toastTimer);
    App._toastTimer = setTimeout(() => { App.toast = null; render(); }, 3400);
    render();
  }

  function newCreate() {
    return {
      step: 0, raceId: null, classId: null, subclassId: null, bgId: null,
      attrs: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
      skills: [], cantrips: [], spells: [], pack: 0, difficulty: 1, name: '',
      bonusChoice: {}, rolled: null, mc: [],   // mc = 兼职（副职）条目 [{id, level}]
    };
  }

  /* ================= 角色配置存档 ================= */
  const BUILDS_KEY = 'yuanxia_builds_v1';
  const LAST_KEY = 'yuanxia_lastbuild_v1';

  function readJSON(key, fallback) {
    try {
      const raw = global.localStorage && global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { global.localStorage && global.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn(e); }
  }
  function loadBuilds() { return readJSON(BUILDS_KEY, []); }
  function saveBuilds(list) { writeJSON(BUILDS_KEY, list); }
  function lastBuild() { return readJSON(LAST_KEY, null); }

  /* ---- 自动记忆：建卡过程中每一步都存草稿，下次进来直接沿用 ---- */
  let draftSig = '';
  /** 把当前建卡状态存为「上一套」。只在至少选了种族 + 职业后才存，避免用空配置覆盖掉有效记录 */
  function rememberDraft(c) {
    if (!c || !c.raceId || !c.classId) return;
    try {
      const b = captureBuild(c);
      const sig = JSON.stringify([b.raceId, b.classId, b.subclassId, b.bgId, b.attrs, b.bonusChoice, b.skills, b.cantrips, b.spells, b.mc, b.pack, b.difficulty, b.name]);
      if (sig === draftSig) return;   // 没变就不写
      draftSig = sig;
      writeJSON(LAST_KEY, b);
    } catch (e) { /* 存档失败不影响游戏 */ }
  }

  /** 从建卡状态里抽出可保存的字段 */
  function captureBuild(c) {
    return {
      id: 'b' + Date.now().toString(36),
      name: c.name || (c.classId ? R.classDef(c.classId).name + '配置' : '未命名'),
      raceId: c.raceId, classId: c.classId, subclassId: c.subclassId, bgId: c.bgId,
      attrs: Object.assign({}, c.attrs), bonusChoice: Object.assign({}, c.bonusChoice),
      skills: c.skills.slice(), cantrips: c.cantrips.slice(), spells: c.spells.slice(),
      mc: (c.mc || []).map((e) => ({ id: e.id, level: e.level })),
      pack: c.pack, difficulty: c.difficulty, at: Date.now(),
    };
  }
  /** 把保存的配置灌回建卡状态 */
  function applyBuild(c, b) {
    c.raceId = b.raceId; c.classId = b.classId; c.subclassId = b.subclassId || null; c.bgId = b.bgId;
    c.attrs = Object.assign({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, b.attrs || {});
    c.bonusChoice = Object.assign({}, b.bonusChoice || {});
    c.skills = (b.skills || []).slice();
    c.cantrips = (b.cantrips || []).slice();
    c.spells = (b.spells || []).slice();
    c.mc = (b.mc || []).map((e) => ({ id: e.id, level: e.level }));
    c.pack = b.pack || 0; c.difficulty = b.difficulty || 1; c.name = b.name || '';
    c.step = stepsFor(c).length - 1;
    return c;
  }
  /** 把建卡状态（含兼职）渲染成职业标签，例如「战士 1 / 游侠 3」 */
  function buildClassLabel(c) {
    const parts = [];
    const pc = c.classId ? R.classDef(c.classId) : null;
    if (pc) {
      const s = c.subclassId ? R.subclassDef(c.classId, c.subclassId) : null;
      parts.push(pc.name + ' 1' + (s ? '·' + s.name : ''));
    }
    for (const e of (c.mc || [])) {
      const k = R.classDef(e.id);
      if (k) parts.push(k.name + ' ' + e.level);
    }
    return parts.join(' / ');
  }
  /** 把载入的配置对齐到当前职业（换职业/改数据后旧配置可能失效，直接开局会出问题） */
  function sanitizeBuild(c) {
    const cls = c.classId ? R.classDef(c.classId) : null;
    if (!cls) return c;
    if (c.subclassId && !(cls.subclasses || []).some((s) => s.id === c.subclassId)) c.subclassId = null;
    if (cls.subclassLevel !== 1) c.subclassId = null;
    const pool = (cls.skillChoices && cls.skillChoices.from) || [];
    const need = cls.skillChoices ? cls.skillChoices.count : 0;
    c.skills = (c.skills || []).filter((s) => pool.includes(s));
    for (const s of pool) { if (c.skills.length >= need) break; if (!c.skills.includes(s)) c.skills.push(s); }
    c.skills = c.skills.slice(0, need);
    if (cls.spellcasting) {
      const eff = NK.Rules.spellListOf(cls.id);
      const okIds = new Set(NK.Data.get('spells').spells.filter((s) => s.classes.some((x) => eff.includes(x))).map((s) => s.id));
      // 只剔除「不属于这个职业 / 已不存在」的法术；不按需求量截断
      // （半施法职业 1 级需求为 0，但配置里带的法术是有效的，不能清掉）
      const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
      c.cantrips = uniq((c.cantrips || []).filter((id) => okIds.has(id)));
      c.spells = uniq((c.spells || []).filter((id) => okIds.has(id)));
    } else { c.cantrips = []; c.spells = []; }
    const packs = NK.Items.startingPacks(c.classId);
    if (!(c.pack >= 0 && c.pack < packs.length)) c.pack = 0;
    if (!NK.Data.get('maps').difficulties.some((d) => d.id === c.difficulty)) c.difficulty = 1;
    return c;
  }

  /** 进入建卡：传 b 就沿用那套配置（并标记为「已沿用」），不传就是全新一张白纸 */
  function startCreate(b) {
    App.create = sanitizeBuild(b ? applyBuild(newCreate(), b) : newCreate());
    App.createRestored = !!b;
    App.screen = 'create';
    if (b) toast('已自动填入上一套配置，可以直接开局，也可以改任意一项。');
  }

  function buildSummary(b) {
    const race = b.raceId ? R.raceDef(b.raceId) : null;
    const cls = b.classId ? R.classDef(b.classId) : null;
    const bg = b.bgId ? R.bgDef(b.bgId) : null;
    const sub = (cls && b.subclassId) ? R.subclassDef(cls.id, b.subclassId) : null;
    const mc = (b.mc || []).map((e) => { const k = R.classDef(e.id); return k ? k.name + ' ' + e.level : null; }).filter(Boolean).join(' / ');
    const classPart = (cls ? cls.name : '?') + (sub ? '·' + sub.name : '') + (mc ? ' / ' + mc : '');
    return `${race ? race.name : '?'} ${classPart}　${bg ? bg.name : ''}　${NK.Run.difficulty(b.difficulty || 1).name}`;
  }

  /* ================= 建卡向导 ================= */
  function stepsFor(c) {
    const s = ['race', 'bg', 'class'];
    const cls = c.classId ? R.classDef(c.classId) : null;
    if (cls && cls.subclassLevel === 1) s.push('subclass');
    s.push('attrs', 'skills');
    if (cls && cls.spellcasting) s.push('spells');
    s.push('pack', 'difficulty');
    return s;
  }

  /** 把购点 + 种族加值算成最终属性 */
  function previewAttrs(c) {
    const race = c.raceId ? R.raceDef(c.raceId) : null;
    const out = {};
    for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      out[k] = c.attrs[k] + ((race && race.bonus && race.bonus[k]) || 0) + (c.bonusChoice[k] || 0);
    }
    return out;
  }

  /** 创建角色时，主职「需要选几个戏法 / 几个法术」——按实际可学池钳制，避免池子太小导致永远选不齐、卡死下一步 */
  function spellNeeds(c) {
    const cls = c.classId ? R.classDef(c.classId) : null;
    const sc = cls && cls.spellcasting;
    if (!sc) return { cantrips: 0, spells: 0 };
    const mod = R.mod(previewAttrs(c)[sc.ability]);
    const eff = NK.Rules.spellListOf(cls.id);
    const poolLen = (lvl) => NK.Data.get('spells').spells.filter((s) => s.classes.some((x) => eff.includes(x)) && s.level === lvl).length;
    const pool0 = poolLen(0), pool1 = poolLen(1);
    const cantrips = Math.min(sc.cantrips || 0, pool0);
    let spells = 0;
    if (sc.spellbook) spells = Math.min(sc.spellsAtLevel1 || 6, pool1);
    else if (sc.prepared) {
      // 标准半施法职业（游侠/圣武士）1 级还没有法术位，无需准备；
      // 奥术工匠这类「向上取整的半施法」从 1 级起就有，按「属性调整 + 1」准备，但不超过实际可学池
      const noSlots = sc.type === 'half' && !sc.halfUp;
      if (!noSlots) spells = Math.min(Math.max(1, mod + 1), pool1);
    } else {
      spells = Math.min((sc.knownByLevel ? sc.knownByLevel[0] : 0), pool1);
    }
    return { cantrips, spells };
  }

  /** 动作的稳定标识——跨回合认人用（法术位会变，用 id+环阶而不是下标） */
  function actionKey(o) {
    if (!o) return '';
    return `${o.kind}:${o.id !== undefined ? o.id : 'i' + o.index}:${o.slot || 0}`;
  }

  function createScreen() {
    if (!App.create) App.create = newCreate();
    const c = App.create;
    rememberDraft(c);   // 每改一步就存草稿：中途退出、下次进来还能接着用
    const steps = stepsFor(c);
    if (c.step >= steps.length) c.step = steps.length - 1;
    const step = steps[c.step];
    const cls = c.classId ? R.classDef(c.classId) : null;
    const race = c.raceId ? R.raceDef(c.raceId) : null;

    const bar = `<div class="steps">${steps.map((s, i) => `<span class="${i === c.step ? 'on' : i < c.step ? 'done' : ''}">${i + 1}</span>`).join('')}</div>`;
    let body = '';

    if (step === 'race') {
      body = `<h2>你降生于……</h2><div class="small dim">比背景更早，比选择也更早——血统是先于一切的东西。它决定属性加值与一两个生理上的优势。</div>
        <div class="cards" style="margin-top:10px">${NK.Data.get('races').races.map((r) => `
          <div class="card ${c.raceId === r.id ? 'sel' : ''}" data-act="c:race" data-id="${r.id}">
            <h3>${esc(r.name)}</h3>
            <div class="small mono">${Object.keys(r.bonus).map((k) => `${attrName(k).slice(0, 1)}${fmt(r.bonus[k])}`).join(' ')} ${r.bonusChoice ? '＋自选 2 项 +1' : ''}</div>
            <div class="small">${esc(r.desc)}</div>
            <hr><div class="small dim">${r.traits.map((t) => `<b>${esc(t.name)}</b>：${esc(t.desc)}`).join('<br>')}</div>
          </div>`).join('')}</div>`;
    } else if (step === 'class') {
      body = `<h2>在踏入冒险之后，你决定成为……</h2><div class="small dim">生命骰决定血量，豁免熟练决定你抗什么，护甲与武器熟练决定你能穿什么、拿什么——起始装备也会照着这些给。子职在 3 级选（牧师/邪术师/术士 1 级、法师 2 级）。</div>
        <div class="cards" style="margin-top:10px">${NK.Data.get('classes').classes.map((k) => `
          <div class="card ${c.classId === k.id ? 'sel' : ''}" data-act="c:class" data-id="${k.id}">
            <h3>${esc(k.name)} <span class="tag">d${k.hitDie}</span></h3>
            <div class="small">${esc(k.blurb)}</div>
            <div class="small dim" style="margin-top:4px">主属性 ${attrName(k.primary)}${k.spellcasting && k.spellcasting.ability !== k.primary ? ` / ${attrName(k.spellcasting.ability)}（施法）` : ''}　豁免熟练 ${k.saveProfs.map(attrName).join('、')}</div>
            <div class="small dim">护甲：${k.armorProfs.length ? k.armorProfs.map((a) => ({ light: '轻甲', medium: '中甲', heavy: '重甲', shield: '盾牌' })[a]).join('、') : '无'}　武器：${k.weaponProfs.map((w) => ({ simple: '简易', martial: '军用', rogue: '游荡者武器' })[w] || w).join('、')}</div>
            <div class="hint">子职：${k.subclasses.map((s) => esc(s.name)).join(' / ')}（${k.subclassLevel} 级选）</div>
          </div>`).join('')}</div>`;
    } else if (step === 'subclass') {
      body = `<h2>选择${cls.name}的子职</h2><div class="small dim">${esc(cls.name)}在 1 级就要选定道路。</div>
        <div class="cards" style="margin-top:10px">${cls.subclasses.map((s) => `
          <div class="card ${c.subclassId === s.id ? 'sel' : ''}" data-act="c:subclass" data-id="${s.id}">
            <h3>${esc(s.name)}</h3><div class="small">${esc(s.desc)}</div><hr>
            <table>${s.features.map((f) => `<tr><td class="hint" style="width:44px">Lv.${f.level}</td><td><b>${esc(f.name)}</b></td><td class="small">${esc(f.desc)}</td></tr>`).join('')}</table>
          </div>`).join('')}</div>`;
    } else if (step === 'bg') {
      body = `<h2>在踏入冒险之前，你曾经是……</h2><div class="small dim">那是你前半辈子留下的东西：两项技能熟练，和一个怎么也改不掉的习惯。</div>
        <div class="cards" style="margin-top:10px">${NK.Data.get('backgrounds').backgrounds.map((b) => `
          <div class="card ${c.bgId === b.id ? 'sel' : ''}" data-act="c:bg" data-id="${b.id}">
            <h3>${esc(b.name)}</h3>
            <div class="small">${esc(b.desc)}</div>
            <div class="small gold" style="margin-top:4px">${esc(b.perk)}</div>
            <div class="small dim">技能：${b.skills.map((s) => R.skillDef(s).name).join('、')}</div>
          </div>`).join('')}</div>`;
    } else if (step === 'attrs') {
      const pb = NK.Data.get('rules').pointBuy;
      const spent = R.pointBuyCost(c.attrs);
      const left = pb.total - spent;
      const pc = R.classDef(c.classId).primary;
      const scA = (cls.spellcasting && cls.spellcasting.ability) || null;
      body = `<h2>分配属性</h2>
        <div class="small dim">购点法：${pb.total} 点，范围 ${pb.min}~${pb.max}（越高越贵）。种族加值显示在括号里。</div>
        ${race && race.bonusChoice ? `<div class="panel tight" style="margin-top:8px"><b>${esc(race.name)}：自选两项属性各 +1</b>
          <div>${race.bonusChoice.from.map((k) => `<button class="sm ${c.bonusChoice[k] ? 'primary' : ''}" data-act="c:bonus" data-k="${k}">${attrName(k)} ${c.bonusChoice[k] ? '+1' : ''}</button>`).join('')}</div>
          <div class="hint">已选 ${Object.keys(c.bonusChoice).length} / ${race.bonusChoice.count}</div></div>` : ''}
        <div class="panel tight" style="margin-top:8px">
          <div class="spread"><b>剩余点数</b><span class="tag ${left === 0 ? 'green' : 'gold'}">${left}</span></div>
          <table style="margin-top:6px">${['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => {
            const v = c.attrs[k];
            const bonus = ((race && race.bonus && race.bonus[k]) || 0) + (c.bonusChoice[k] || 0);
            return `<tr>
              <td style="width:70px"><b>${attrName(k)}</b>${k === pc ? ' <span class="tag gold">主</span>' : ''}</td>
              <td class="mono">${v}${bonus ? ` <span class="green">+${bonus} → ${v + bonus}</span>` : ''} <span class="dim">(${fmt(R.mod(v + bonus))})</span></td>
              <td style="width:130px" class="center">
                <button class="sm ghost" data-act="c:attr:sub" data-k="${k}" ${v <= pb.min ? 'disabled' : ''}>−</button>
                <span class="mono" style="display:inline-block;width:22px">${v}</span>
                <button class="sm ghost" data-act="c:attr:add" data-k="${k}" ${(left <= 0 || v >= pb.max) ? 'disabled' : ''}>+</button>
              </td></tr>`;
          }).join('')}</table>
        </div>
        <div class="small dim">推荐：${attrName(pc)} 放 15${scA && scA !== pc ? `，${attrName(scA)}（施法属性）放 15` : ''}，体质不低于 12。剩下的点数随便花。</div>`;
    } else if (step === 'skills') {
      const need = cls.skillChoices.count;
      const granted = new Set((c.bgId ? R.bgDef(c.bgId).skills : []).concat(
        ((race && race.traits) || []).flatMap((t) => (t.effects && t.effects.skillProfs) || [])
      ));
      const pool = cls.skillChoices.from;
      body = `<h2>选择技能熟练</h2>
        <div class="small dim">从职业列表里选 ${need} 项。背景与种族已经给你的技能不占用名额，也不重复出现在这里。</div>
        <div class="spread" style="margin-top:8px"><span class="tag ${c.skills.length === need ? 'green' : 'gold'}">已选 ${c.skills.length}/${need}</span></div>
        <div class="cards" style="margin-top:10px">${pool.map((sid) => {
          const sk = R.skillDef(sid);
          const has = granted.has(sid);
          const on = c.skills.includes(sid);
          return `<div class="card ${on ? 'sel' : ''} ${has ? 'locked' : ''}" ${has ? '' : `data-act="c:skill" data-id="${sid}"`}>
            <h3>${esc(sk.name)} <span class="tag">${attrName(sk.attr)}</span></h3>
            <div class="small dim">${has ? '已由背景/种族提供' : `检定加值 ${fmt(R.mod(c.attrs[sk.attr] + ((race && race.bonus && race.bonus[sk.attr]) || 0)) + 2)}`}</div>
          </div>`;
        }).join('')}</div>`;
    } else if (step === 'spells') {
      const sc = cls.spellcasting;
      const attr = sc.ability;
      const mod = R.mod(previewAttrs(c)[attr]);
      const need = spellNeeds(c);
      const needCantrips = need.cantrips;
      const needSpells = need.spells;
      const eff = NK.Rules.spellListOf(cls.id);
      const list = (lvl) => NK.Data.get('spells').spells.filter((s) => s.classes.some((c) => eff.includes(c)) && s.level === lvl);
      body = `<h2>选择法术</h2>
        <div class="small dim">施法属性：${attrName(attr)}（调整值 ${fmt(mod)}）。${sc.spellbook ? '法师把法术抄进法术书，抄进去就能准备。' : sc.prepared ? '牧师/圣武士每天可以更换准备的法术（长休时）。' : '游侠的法术是固定学会的。'}</div>
        ${needCantrips ? `<h3 style="margin-top:12px">戏法（选 ${needCantrips} 个，不消耗法术位）<span class="tag ${c.cantrips.length === needCantrips ? 'green' : 'gold'}">${c.cantrips.length}/${needCantrips}</span></h3>
        <div class="cards">${list(0).map((sp) => `<div class="card ${c.cantrips.includes(sp.id) ? 'sel' : ''}" data-act="c:cantrip" data-id="${sp.id}">
          <h3>${esc(sp.name)}</h3><div class="small">${esc(sp.desc)}</div></div>`).join('')}</div>` : ''}
        ${needSpells ? `<h3 style="margin-top:12px">一环法术（选 ${needSpells} 个）<span class="tag ${c.spells.length === needSpells ? 'green' : 'gold'}">${c.spells.length}/${needSpells}</span></h3>
        <div class="cards">${list(1).map((sp) => `<div class="card ${c.spells.includes(sp.id) ? 'sel' : ''}" data-act="c:spell" data-id="${sp.id}">
          <h3>${esc(sp.name)} <span class="tag blue">${esc(sp.action)}</span></h3><div class="small">${esc(sp.desc)}</div>
          ${sp.concentration ? '<div class="hint">需要专注</div>' : ''}</div>`).join('')}</div>` : '<div class="small dim" style="margin-top:8px">这个职业在 1 级还没有法术位。</div>'}`;
    } else if (step === 'pack') {
      const packs = NK.Items.startingPacks(c.classId);
      body = `<h2>选择起始装备</h2><div class="small dim">两套都合法，区别只是你想怎么打。</div>
        <div class="cards" style="margin-top:10px">${packs.map((p, i) => `
          <div class="card ${c.pack === i ? 'sel' : ''}" data-act="c:pack" data-idx="${i}">
            <h3>${esc(p.name)}</h3><div class="small">${esc(p.desc)}</div>
            <div class="small dim" style="margin-top:6px">${[p.weapons.length ? p.weapons.map((w) => NK.Items.baseById(w).name).join('、') : '空手（徒手打击）', p.armor ? NK.Items.baseById(p.armor).name : '不穿护甲', p.shield ? NK.Items.baseById(p.shield).name : null].filter(Boolean).join('　·　')}　＋　治疗药水 ×2${p.consumables && p.consumables.length ? '、' + p.consumables.map((cid) => (NK.Items.consumableById(cid) || {}).name).filter(Boolean).join('、') : ''}</div>
          </div>`).join('')}</div>`;
    } else if (step === 'difficulty') {
      body = `<h2>选择难度</h2><div class="small dim">这一局死了就是死了——没有跨局成长，所以难度只是你自己的选择。</div>
        <div class="cards" style="margin-top:10px">${NK.Data.get('maps').difficulties.map((d) => `
          <div class="card ${c.difficulty === d.id ? 'sel' : ''}" data-act="c:diff" data-id="${d.id}">
            <h3>${esc(d.name)}</h3><div class="small">${esc(d.desc)}</div>
            <div class="small dim">经验 ×${d.xpMul}　金币 ×${d.goldMul}</div>
          </div>`).join('')}</div>
        <div class="panel tight" style="margin-top:12px">
          <div class="spread"><b>${esc(c.name || '无名者')}</b>
            <div><button class="sm" data-act="c:name">改名</button>
            <button class="sm ghost" data-act="b:save">保存这套配置</button></div>
          </div>
          <div class="small dim">${esc(race ? race.name : '')} ${esc(buildClassLabel(c))} · ${esc(c.bgId ? R.bgDef(c.bgId).name : '')}</div>
          <div class="hint">保存后可以在标题界面直接用它开局，不用每次重新捏人。</div>
        </div>`;
    }

    const canNext = (() => {
      if (step === 'race') return !!c.raceId;
      if (step === 'class') return !!c.classId;
      if (step === 'subclass') return !!c.subclassId;
      if (step === 'bg') return !!c.bgId;
      if (step === 'attrs') {
        if (R.pointBuyCost(c.attrs) < 0 || R.pointBuyCost(c.attrs) > NK.Data.get('rules').pointBuy.total) return false;
        if (race && race.bonusChoice && Object.keys(c.bonusChoice).length !== race.bonusChoice.count) return false;
        return true;
      }
      if (step === 'skills') return c.skills.length === cls.skillChoices.count;
      if (step === 'spells') {
        const need = spellNeeds(c);
        return c.cantrips.length === need.cantrips && c.spells.length === need.spells;
      }
      if (step === 'pack') return true;
      return true;
    })();

    return `
      <div class="center" style="margin:18px 0 10px"><h1>${GAME_NAME}</h1>
        <div class="dim small">5e 规则的单人地牢肉鸽。死了就重来，什么都不会留下。</div></div>
      ${bar}
      ${(() => {
        if (App.createRestored) {
          return `<div class="panel tight" style="margin-top:8px"><div class="spread">
            <div class="small">已自动沿用<b>上一套</b>：${esc(buildSummary(c))}${c.name ? '　（' + esc(c.name) + '）' : ''}
              <div class="hint">下面每一页都已经填好了，想改哪一项就翻到那一页；也可以直接开局或清空重来。</div></div>
            <div style="white-space:nowrap">
              <button class="sm primary" data-act="c:start" ${canNext && c.step === steps.length - 1 ? '' : 'disabled'}>直接开局</button>
              <button class="sm ghost" data-act="c:reset">清空重来</button>
            </div></div></div>`;
        }
        // 白纸开局：第 1 页提示有记忆可用，一键就能把上一套搬回来
        const lb = lastBuild();
        if (!lb || c.step !== 0) return '';
        return `<div class="panel tight" style="margin-top:8px"><div class="spread">
          <div class="small">上一套：${esc(buildSummary(lb))}${lb.name ? '　（' + esc(lb.name) + '）' : ''}
            <div class="hint">捏人的每一步都会自动记住，换一局不用从头点一遍。</div></div>
          <div style="white-space:nowrap"><button class="sm primary" data-act="c:autofill">一键沿用</button></div></div></div>`;
      })()}
      <div class="panel">${body}</div>
      <div class="spread" style="margin-top:6px">
        <div>${c.step > 0 ? '<button data-act="c:back">上一步</button>' : '<button data-act="c:title">返回标题</button>'}</div>
        <div>
          ${c.step === steps.length - 1
            ? `<button class="primary" data-act="c:start" ${canNext ? '' : 'disabled'} style="padding:9px 26px">进 入 地 牢</button>`
            : `<button class="primary" data-act="c:next" ${canNext ? '' : 'disabled'}>下一步 →</button>`}
        </div>
      </div>`;
  }

  /* ================= 通用组件 ================= */
  function slotText(p) {
    if (!p.slotsMax || !p.slotsMax.some((x) => x > 0)) return '';
    return p.slots.map((n, i) => n > 0 ? `<span class="tag blue">${NK.Data.get('rules').slotLevelNames[i]} ${n}/${p.slotsMax[i]}</span>` : '').join('');
  }

  function playerSummary(p) {
    const hpPct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
    return `
      <div class="spread">
        <div><b>${esc(p.name)}</b><span class="dim small">　${esc(R.raceDef(p.raceId).name)} · ${esc(R.classLabel(p))}</span></div>
        <div class="small"><span class="tag gold">⚔ ${fmt(R.attackBonus(p))}</span><span class="tag blue">AC ${p.ac}</span><span class="tag">先攻 ${fmt(R.initiative(p))}</span><span class="tag">熟练 ${fmt(p.prof)}</span></div>
      </div>
      <div class="bar" style="margin-top:6px"><i style="width:${hpPct}%"></i></div>
      <div class="small dim">HP ${p.hp}/${p.maxHp}${p.tempHp ? `<span class="blue">（临时 ${p.tempHp}）</span>` : ''}${p.wardHp ? `<span class="blue">（结界 ${p.wardHp}）</span>` : ''}　生命骰 ${p.hitDice.left}/${p.hitDice.total}（d${p.hitDice.die}）　经验 ${p.xp}${R.xpNeeded(p.level) !== null ? '/' + R.xpNeeded(p.level) : '（满级）'}</div>
      <div style="margin-top:4px">${slotText(p)}${p.layPool !== undefined ? `<span class="tag gold">圣疗池 ${p.layPool}</span>` : ''}${p.superiorityLeft !== undefined ? `<span class="tag gold">卓越骰 ${p.superiorityLeft}</span>` : ''}${p.kiMax > 0 ? `<span class="tag gold">气 ${p.kiLeft}/${p.kiMax}</span>` : ''}${p.flags && p.flags.rage ? `<span class="tag gold">狂暴 ${p.rageLeft}/${p.rageMax}</span>` : ''}${p.pactLevel ? `<span class="tag gold">邪术环 ${p.pactSlots}/${p.pactSlotsMax}</span>` : ''}</div>`;
  }

  function condTags(t) {
    const cs = (t.conditions || []).map((c) => `<span class="tag red" title="${esc((NK.Data.get('rules').conditions[c.id] || {}).desc || '')}">${esc(c.name)}${c.turns ? ' ' + c.turns : ''}</span>`).join('');
    const bs = (t.buffs || []).map((b) => `<span class="tag ${b.kind === 'curse' ? 'red' : 'green'}" title="${esc((b.mods ? Object.keys(b.mods).map((k) => k + ' ' + b.mods[k]).join('，') : ''))}">${esc(b.name)}${b.turns && b.turns < 90 ? ' ' + b.turns : ''}</span>`).join('');
    return cs + bs;
  }

  function itemLine(it, actions) {
    if (!it) return '<span class="dim">（空）</span>';
    const color = NK.Items.RARITY_COLOR[it.rarity] || '#ccc';
    return `<span style="color:${color}">${esc(it.name)}</span> <span class="hint">${esc(NK.Items.describe(it))}</span> ${actions || ''}`;
  }

  /* ================= 地图 ================= */
  function mapScreen() {
    const run = App.run;
    const act = run.map.acts[run.actIndex];
    const avail = NK.MapGen.available(run).map((n) => n.id);
    const meta = NK.Data.get('maps').nodeMeta;
    const layers = act.layers.map((layer) => `<div class="layer">${layer.map((n) => {
      const visible = NK.MapGen.isVisible(run, n);
      const m = meta[n.type] || { name: '?', icon: '?', color: '#888' };
      const cls = ['node'];
      if (n.done) cls.push('done');
      if (n.visited) cls.push('visited');
      if (avail.includes(n.id)) cls.push('avail');
      if (!visible) cls.push('hidden');
      return `<div class="${cls.join(' ')}" ${avail.includes(n.id) ? `data-act="node" data-id="${n.id}"` : ''} style="${avail.includes(n.id) ? `border-color:${m.color}` : ''}">
        <span class="icon" style="color:${visible ? m.color : '#4a443c'}">${visible ? m.icon : '·'}</span>
        <span class="node-label" style="${visible ? '' : 'color:#4a443c'}">${esc(visible ? m.name : '未知')}</span></div>`;
    }).join('')}</div>`).join('');

    return `
      <div class="panel tight"><div class="spread">
        <div><b class="gold">${esc(act.name)}</b><span class="tag">${esc(act.theme)}</span><span class="tag blue">${esc(NK.Run.difficulty(run.difficulty).name)}</span></div>
        <div><span class="tag gold">金币 ${run.gold}</span><span class="tag orange">食物 ${run.food}</span><span class="tag green">生命骰 ${run.player.hitDice.left}/${run.player.hitDice.total}</span>${slotText(run.player)}</div>
      </div></div>
      <div class="panel">${playerSummary(run.player)}${condTags(run.player) ? `<div style="margin-top:4px">${condTags(run.player)}</div>` : ''}
        <div style="margin-top:8px">
          <button class="sm" data-act="open:sheet">人物卡</button>
          <button class="sm" data-act="open:bag">背包</button>
          <button class="sm" data-act="open:help">规则</button>
          <button class="sm ghost" data-act="save:quit">保存并回到标题</button>
        </div></div>
      <div class="panel">
        <div class="spread"><h3 style="margin:0">路线</h3><span class="hint">点击亮起的节点前进</span></div>
        <div style="margin-top:12px">${layers}</div>
      </div>
      <div class="panel"><h3>旅途记录</h3>${run.log.slice(-6).map((l) => `<div class="small dim">${esc(l.t)}</div>`).join('') || '<div class="dim small">还没有记录。</div>'}</div>`;
  }

  /* ================= 战斗 ================= */
  function battleScreen() {
    const run = App.run;
    const c = run._combat;
    if (!c) return '<div class="panel">战斗已结束。</div>';
    const p = run.player;
    const acts = NK.Combat.availableActions(c);
    const alive = c.enemies.filter((e) => e.hp > 0);
    // 目标选择：当前目标死了、或者够不到而旁边有够得到的，就自动切过去
    const curTarget = alive.find((e) => e.uid === App.targetUid);
    const reachable = alive.filter((e) => NK.Combat.canReach(p, e));
    if (!curTarget || (reachable.length && !NK.Combat.canReach(p, curTarget))) {
      const pick = (reachable.length ? reachable : alive).slice().sort((a, b) => (a.band || 0) - (b.band || 0) || a.hp - b.hp)[0];
      App.targetUid = pick ? pick.uid : null;
    }
    const isMyTurn = c.order[c.turnIndex] && c.order[c.turnIndex].ref === p && !c.over;

    const enemies = c.enemies.map((e) => {
      const pct = Math.max(0, Math.round((e.hp / e.maxHp) * 100));
      const traits = (e.traits || []).map((t) => { const d = NK.Data.get('monsters').traits[t.effect]; return `<span class="tag" title="${esc(d ? d.desc : '')}">${esc(d ? d.name : t.name)}</span>`; }).join('');
      const defenses = [
        (e.resist || []).length ? `<span class="tag blue">抗性 ${e.resist.join('/')}</span>` : '',
        (e.immune || []).length ? `<span class="tag gold">免疫 ${e.immune.join('/')}</span>` : '',
        (e.vuln || []).length ? `<span class="tag red">易伤 ${e.vuln.join('/')}</span>` : '',
      ].join('');
      const it = e.hp > 0 ? (e.intent || NK.Combat.planIntent(c, e)) : null;
      const intentHtml = it ? `<div class="intent ${it.tone}"><b>意图</b>　${esc(it.name)}<span class="dim"> · ${esc(it.detail || '')}</span></div>` : '';
      return `<div class="enemy ${App.targetUid === e.uid ? 'sel' : ''} ${e.hp <= 0 ? 'dead' : ''}" ${e.hp > 0 ? `data-act="target" data-uid="${e.uid}"` : ''}>
        <div class="spread"><b>${esc(e.name)}</b><span class="small dim">${e.rank === 'boss' ? '关底' : e.rank === 'elite' ? '精英' : '普通'}　命中 ${fmt(e.atk.bonus)}　AC ${NK.Combat.acOf(c, e)}　${esc(e.atk.dice)}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="small dim">HP ${Math.max(0, e.hp)}/${e.maxHp}${e.tempHp ? `（临时 ${e.tempHp}）` : ''}${e.mirrorLeft ? `　<span class="blue">镜像 ${e.mirrorLeft}</span>` : ''}</div>
        <div class="small">${traits}${defenses}${condTags(e)}</div>${intentHtml}</div>`;
    }).join('');

    const opts = [];
    for (const s of acts.spells) if (s.ok) opts.push({ group: '法术', kind: 'spell', id: s.spell.id, slot: s.slot, label: s.label, hint: s.spell.desc, need: s.spell.action === '附赠动作' ? 'bonus' : 'action' });
    for (const s of acts.upcast) opts.push({ group: '升环施法', kind: 'spell', id: s.spell.id, slot: s.slot, label: s.label, hint: s.spell.desc, need: 'action' });
    for (const b of acts.bonus) opts.push({ group: '附赠动作', kind: 'bonus', id: b.id, label: b.label, need: 'bonus' });
    for (const x of acts.items) opts.push({ group: '物品', kind: 'item', index: x.index, label: x.item.name, hint: x.item.desc, need: 'action' });
    const usable = opts.filter((o) => (o.need === 'bonus' ? c.turn.bonus : c.turn.action));
    if (App.selAction === undefined || App.selAction >= usable.length) App.selAction = 0;
    // 记住上一回合用的那一手：还在列表里就自动选中，不用每回合重新挑
    let remembered = null;
    if (App.lastActionKey) {
      const hit = usable.findIndex((o) => actionKey(o) === App.lastActionKey);
      if (hit >= 0) { App.selAction = hit; remembered = usable[hit].label; }
    }
    const groups = {};
    usable.forEach((o, i) => { (groups[o.group] = groups[o.group] || []).push({ o, i }); });
    const selHtml = usable.length ? `<select data-act="sel:action" class="selbox">
      ${Object.keys(groups).map((g) => `<optgroup label="${esc(g)}">${groups[g].map(({ o, i }) => `<option value="${i}" ${i === App.selAction ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</optgroup>`).join('')}
    </select><button class="primary" data-act="b:do" title="${esc((usable[App.selAction] || {}).hint || '')}">执行</button>` : '<span class="dim small">本回合已无可用的动作</span>';

    const actionBtns = isMyTurn && !p.dying && !c.over ? `
      <div class="distance">
        <span class="tag ${acts.move.text === '近身' ? 'red' : acts.move.text === '远距' ? 'blue' : 'gold'}">距离 ${acts.move.text}</span>
        <button class="sm" data-act="b:move" data-dir="in" ${acts.move.canIn ? '' : 'disabled'} title="拉近一档（每回合一次，不消耗动作）">接近</button>
        <button class="sm" data-act="b:move" data-dir="out" ${acts.move.canOut ? '' : 'disabled'} title="后撤一档（每回合一次，不消耗动作）">拉开</button>
        <button class="sm ghost" data-act="b:delay" ${c.delayedThisRound ? 'disabled' : ''} title="把自己移到本回合最后，看清敌人动作再出手">延后行动</button>
        ${acts.move.moved ? '<span class="hint">本回合已移动</span>' : ''}
      </div>
      <div class="actions">
        <button class="primary" data-act="b:attack" ${c.turn.action && acts.canReachFront ? '' : 'disabled'} title="${esc(acts.canReachFront ? '' : (acts.front ? NK.Combat.reachHint(p, acts.front) : ''))}">攻击${p.mods.extraAttack ? '（×' + (1 + p.mods.extraAttack) + '）' : ''}</button>
        ${selHtml}
        <button data-act="b:dodge" ${c.turn.action ? '' : 'disabled'} title="攻击你的检定具有劣势">闪避</button>
        <button data-act="b:end">结束回合</button>
      </div>
      ${!acts.canReachFront && acts.front ? `<div class="small red" style="margin-top:4px">${esc(NK.Combat.reachHint(p, acts.front))}</div>` : ''}
      <div class="small dim" style="margin-top:6px">动作：${c.turn.action ? '<span class="green">可用</span>' : '<span class="red">已用</span>'}　附赠动作：${c.turn.bonus ? '<span class="green">可用</span>' : '<span class="red">已用</span>'}
        　${remembered ? `<span class="tag green">记住了上一手：${esc(remembered)}</span>` : App.lastActionKey === 'attack' ? '<span class="tag green">记住了上一手：攻击（按 1）</span>' : ''}
        　<span class="hint">快捷键：1 攻击　2-9 法术　Enter 执行　Q 闪避　空格 结束回合</span></div>` : `<div class="actions">${c.over ? '<button class="primary" data-act="b:continue">继续</button>' : p.dying ? '<button data-act="b:pass">等待死亡豁免</button>' : '<span class="dim small">敌人的回合……</span>'}</div>`;

    const LOG_TAIL = 9;
    const folded = !App.logFull && c.log.length > LOG_TAIL + 3;
    const shown = folded ? c.log.slice(-LOG_TAIL) : c.log;
    const logHtml = shown.map((l) => `<div class="${l.k}">${esc(l.t)}</div>`).join('');
    const logBar = c.log.length > LOG_TAIL
      ? `<div class="logbar"><span class="dim">${folded ? `只显示最后 ${LOG_TAIL} 条（共 ${c.log.length}）` : `全部 ${c.log.length} 条`}</span>
          <button class="sm ghost" data-act="log:toggle">${folded ? '展开全部' : '收起'}</button></div>`
      : '';
    const resultBox = c.over ? `<div class="panel" style="border-color:${c.result === 'victory' ? 'var(--gold)' : 'var(--red)'}">
      <h3>${c.result === 'victory' ? '战斗胜利' : '你死了'}</h3>
      <div class="small dim">${c.result === 'victory' ? '战场安静下来。' : '这一次没有人会把你叫醒。'}</div>
      <div style="margin-top:8px"><button class="primary" data-act="b:continue">继续</button></div></div>` : '';

    const orderBar = `<div class="orderbar">${c.order.map((o, i) => {
      const ref = o.ref;
      const dead = NK.Combat.dead(ref);
      const active = i === c.turnIndex && !c.over;
      const isP = !!ref.isPlayer;
      const pct = isP ? Math.round((ref.hp / ref.maxHp) * 100) : Math.round((Math.max(0, ref.hp) / ref.maxHp) * 100);
      return `<div class="orderchip ${active ? 'on' : ''} ${dead ? 'dead' : ''} ${isP ? 'me' : ''}">
        <div class="nm">${esc(o.name)}${isP ? '' : ` <span class="dim">${NK.Combat.bandName(ref.band)}</span>`}</div>
        <div class="bar mini"><i style="width:${pct}%"></i></div></div>`;
    }).join('')}</div>`;

    return `
      <div class="panel tight"><div class="spread">
        <div><span class="tag red">${c.source === 'boss' ? '关底战' : c.source === 'elite' ? '精英战' : '战斗'}</span> 第 ${c.round} 回合</div>
        <div class="small dim">先攻：${c.order.map((o) => o.name).join(' > ')}</div>
      </div>${orderBar}</div>
      <div class="row">
        <div class="col">
          <div class="panel tight"><h3 style="margin-bottom:6px">敌人</h3>${enemies}</div>
          <div class="panel tight"><h3 style="margin-bottom:6px">你</h3>${playerSummary(p)}${condTags(p) ? `<div style="margin-top:4px">${condTags(p)}</div>` : ''}
            ${(c.allies && c.allies.length) ? `<div style="margin-top:6px"><div class="hint">你的召唤物（每回合自动出击，不占你的动作）</div>${c.allies.map((a) => {
              const pct = Math.max(0, Math.round((a.hp / a.maxHp) * 100));
              return `<div class="enemy" style="margin-top:4px">
                <div class="spread"><b>${esc(a.name)}</b><span class="small dim">命中 ${fmt(a.atk.bonus)}　AC ${a.ac}　${esc(a.atk.dice)} ${esc(a.atk.type)}</span></div>
                <div class="bar"><i style="width:${pct}%"></i></div>
                <div class="small dim">HP ${Math.max(0, a.hp)}/${a.maxHp}　剩余 ${a.turnsLeft} 回合${p.concentration === a.spellId ? '　<span class="tag blue">专注维持中</span>' : ''}</div>
                ${condTags(a)}</div>`;
            }).join('')}</div>` : ''}
            <div class="small dim" style="margin-top:4px">右手：${itemLine(p.items.mainHand)}　左手：${itemLine(p.items.offHand)}　上身：${itemLine(p.items.body)}　戒指 ${R.ringCount(p)}/${R.ringCap(p)}${R.interference(p) > 0 ? '（干涉 -' + R.interference(p) + '）' : ''}</div></div>
        </div>
        <div class="col" style="flex:1.7 1 380px">
          <div class="log">${folded ? '<div class="dim small">……</div>' : ''}${logHtml}</div>
          ${logBar}
          ${resultBox || actionBtns}
        </div>
      </div>`;
  }

  /* ================= 事件 ================= */
  function eventScreen() {
    const run = App.run;
    const ev = run.event;
    if (!ev) return '<div class="panel">什么都没有发生。</div>';
    const res = run.eventResult;
    const options = ev.options.map((o, i) => {
      const req = NK.Events.checkRequire(run, o);
      return `<div class="choice">
        <button data-act="ev:opt" data-index="${i}" ${req.ok && !res ? '' : 'disabled'}>${esc(o.label)}</button>
        ${o.hint ? `<span class="hint">（${esc(o.hint)}）</span>` : ''}
        ${req.ok ? '' : `<span class="red small">　${esc(req.msg)}</span>`}
      </div>`;
    }).join('');
    const resultBox = res ? `<hr>
      ${res.roll ? `<div class="small mono ${res.roll.ok ? 'green' : 'red'}">${esc(res.roll.label)}检定：d20(${res.roll.nat})${res.roll.bonus >= 0 ? '+' + res.roll.bonus : res.roll.bonus} = ${res.roll.total} VS DC ${res.roll.dc} —— ${res.roll.ok ? '成功' : '失败'}${res.roll.mode === 'dis' ? '（劣势）' : res.roll.mode === 'adv' ? '（优势）' : ''}</div>` : ''}
      <p>${esc(res.text)}</p>
      <ul>${res.lines.map((l) => `<li class="small gold">${esc(l)}</li>`).join('')}</ul>
      <div style="margin-top:10px"><button class="primary" data-act="ev:next">继续前进</button></div>` : '';
    return `
      <div class="panel tight"><div class="spread"><div><span class="tag purple">事件</span> ${esc(ev.name)}</div>
        <div class="small dim">${esc(run.map.acts[run.actIndex].name)}</div></div></div>
      <div class="panel">${playerSummary(run.player)}</div>
      <div class="panel"><p style="font-size:16px">${esc(ev.text)}</p><hr>${options}${resultBox}</div>`;
  }

  /* ================= 商店 ================= */
  function shopScreen() {
    const run = App.run;
    const s = run.shop;
    if (!s) return '<div class="panel">这里没有商店。</div>';
    const sec = (title, list, kind) => `<h3>${title}</h3>${list.map((e) => `
      <div class="spread choice">
        <div>${kind === 'gear' ? itemLine(e.item) : `<b>${esc(e.item.name)}</b> <span class="hint">${esc(e.item.desc || '')}</span>`}</div>
        <div><span class="tag gold">${e.price} 金</span><button class="sm" data-act="buy" data-id="${e.id}" ${e.sold || run.gold < e.price ? 'disabled' : ''}>${e.sold ? '已售出' : '购买'}</button></div>
      </div>`).join('')}`;
    return `
      <div class="panel tight"><div class="spread"><div><span class="tag gold">商店</span> 地下交易点</div><div><span class="tag gold">金币 ${run.gold}</span><span class="tag orange">食物 ${run.food}</span></div></div></div>
      <div class="panel">${sec('装备', s.items, 'gear')}<hr>${sec('药剂与卷轴', s.consumables, 'consumable')}<hr>${sec('服务', s.services, 'service')}
        <div class="center" style="margin-top:14px"><button class="primary" data-act="shop:leave">离开</button></div></div>`;
  }

  /* ================= 休整 ================= */
  function restScreen() {
    const run = App.run;
    const p = run.player;
    const o = NK.Run.restOptions(run);
    const hpPct = Math.round((p.hp / p.maxHp) * 100);
    const slotLeft = p.slots.reduce((a, b) => a + b, 0);
    const slotAll = p.slotsMax.reduce((a, b) => a + b, 0);
    const rows = [
      ['生命', `${p.hp}/${p.maxHp}（${hpPct}%）`, p.hp >= p.maxHp ? '不用补' : hpPct < 40 ? '<b class="red">偏低</b>' : '略缺'],
      ['法术位', slotAll ? `${slotLeft}/${slotAll}` : '—', slotAll && slotLeft === 0 ? '<b class="red">空了</b>' : '—'],
      ['生命骰', `${p.hitDice.left}/${p.hitDice.total}（d${p.hitDice.die}）`, p.hitDice.left === 0 ? '<b class="red">用完了</b>' : `${o.short.perDie} 点/颗`],
      ['食物', `${run.food} 份`, run.food === 0 ? '<b class="red">没有</b>' : '够长休'],
    ];
    if (p.pactLevel) rows.push(['邪术环', `${p.pactSlots}/${p.pactSlotsMax}`, p.pactSlots === 0 ? '<b class="red">空了</b>' : '可用']);
    if (p.flags.rage) rows.push(['狂暴', `${p.rageLeft || 0}/${p.rageMax}`, (p.rageLeft || 0) === 0 ? '需长休' : '可用']);
    if (p.flags.ki) rows.push(['气', `${p.kiLeft}/${p.kiMax}`, p.kiLeft === 0 ? '需休息' : '可用']);
    if (p.flags.superiority) rows.push(['卓越骰', `${p.superiorityLeft || 0}/${p.flags.superiority}`, (p.superiorityLeft || 0) === 0 ? '需休息' : '可用']);
    if (p.flags.layOnHands) rows.push(['圣疗池', `${p.layPool}/${p.level * p.flags.layOnHands}`, p.layPool === 0 ? '需长休' : '可用']);
    const list = (arr) => `<ul style="margin:4px 0 0 16px">${arr.map((x) => `<li class="small">${x}</li>`).join('')}</ul>`;
    return `
      <div class="panel tight"><div class="spread"><div><span class="tag green">营地</span> ${esc(run.map.acts[run.actIndex].name)}</div>
        <div class="small dim"><b>每个营地只能休息一次</b>，选完就不能改</div></div></div>
      <div class="panel"><p>你找到一处背风的石缝。火升起来之后，才发现自己的手一直在抖。</p>
        <h3 style="margin-top:10px">现在的你</h3>
        <table>${rows.map((r) => `<tr><td style="width:76px" class="hint">${r[0]}</td><td class="mono">${r[1]}</td><td class="small">${r[2]}</td></tr>`).join('')}</table>
        ${condTags(p) ? `<div style="margin-top:6px">${condTags(p)}</div>` : ''}</div>
      <div class="panel">
        <h3>你要做什么？</h3>
        <div class="cards">
          <div class="card ${o.short.ok ? '' : 'locked'}">
            <h3>短休　<span class="tag green">${esc(o.short.cost)}</span></h3>
            <div class="small dim">${esc(o.short.detail)}</div>
            <div style="margin-top:6px"><b class="small">能拿回来：</b>${list(o.short.restores)}</div>
            <div class="hint" style="margin-top:6px">${esc(o.short.note)}</div>
            <div class="small dim" style="margin-top:6px">每颗生命骰约回 ${o.short.perDie} 点（d${p.hitDice.die}/2 + 体质 ${fmt(R.mod(p.attrs.con))} + 1）</div>
            <div style="margin-top:8px">${o.short.ok
              ? (() => {
                const want = App.lastRestDice ? Math.min(App.lastRestDice, p.hitDice.left) : Math.min(3, p.hitDice.left);
                return [1, 2, 3, 4, 5, 6].filter((n) => n <= p.hitDice.left).map((n) =>
                  `<button class="${n === want ? 'primary' : ''}" data-act="rest:short" data-n="${n}">用 ${n} 颗${App.lastRestDice === n ? '（上次）' : ''}</button>`).join(' ');
              })()
              : '<div class="small red">生命骰用完了——只有长休能回复它。</div>'}</div>
          </div>
          <div class="card ${o.long.ok ? '' : 'locked'}">
            <h3>长休　<span class="tag ${o.long.costKind}">${esc(o.long.cost)}</span></h3>
            <div class="small dim">${esc(o.long.detail)}</div>
            <div style="margin-top:6px"><b class="small">能拿回来：</b>${list(o.long.restores)}</div>
            <div class="hint" style="margin-top:6px">${esc(o.long.note)}</div>
            ${run.food < 1 ? '<div class="small red" style="margin-top:6px">你没有食物。长休需要 1 份——怪物会掉落，商店也能买。</div>' : ''}
            <div style="margin-top:8px"><button class="primary" data-act="rest:long" ${o.long.ok ? '' : 'disabled'}>长休</button></div>
          </div>
          <div class="card">
            <h3>不休息，继续前进</h3>
            <div class="small">把这次机会留给后面。每个营地只能休息一次，下一处营地不知道在多远。</div>
            <div class="hint" style="margin-top:6px">适合：血量还够、法术位还剩、想把长休留到关底前。</div>
            <div style="margin-top:8px"><button data-act="rest:none">继续前进</button></div>
          </div>
        </div>
      </div>`;
  }

  /* ================= 长休后重新准备法术 ================= */
  /** 可供准备的法术池：法师只能从法术书里挑，牧师/德鲁伊等可以从整个职业列表里挑 */
  function preparePool(p) {
    const cs = R.classEntries(p).filter((e) => { const sc = (R.classDef(e.id) || {}).spellcasting; return sc && sc.prepared; });
    const hasBook = cs.some((e) => (R.classDef(e.id).spellcasting || {}).spellbook);
    const maxLv = R.maxSpellLevel(p) || 1;
    const ids = new Set();
    for (const e of cs) {
      const eff = R.spellListOf(e.id);
      NK.Data.get('spells').spells.forEach((s) => {
        if (!s.classes.some((c) => eff.includes(c))) return;
        if (s.level === 0 || s.level > maxLv) return;
        if (hasBook && !(p.knownSpells || []).includes(s.id)) return;
        ids.add(s.id);
      });
    }
    return NK.Data.get('spells').spells.filter((s) => ids.has(s.id));
  }

  function prepareScreen() {
    const run = App.run;
    if (!run) { App.screen = 'map'; return mapScreen(); }
    const p = run.player;
    App.prepSel = App.prepSel || (p.prepared || []).slice();
    const cap = R.spellCapacity(p).prepared;
    const pool = preparePool(p);
    const LN = NK.Data.get('rules').slotLevelNames;
    const over = App.prepSel.length > cap;
    const card = (s) => `<div class="card ${App.prepSel.includes(s.id) ? 'sel' : ''}" data-act="p:toggle" data-id="${s.id}">
        <h3>${esc(s.name)} <span class="tag blue">${LN[s.level - 1]}</span></h3>
        <div class="small dim">${esc((s.desc || '').slice(0, 40))}</div></div>`;
    return `
      <div class="panel tight"><div class="spread"><div><span class="tag green">长休</span> 重新准备法术</div>
        <div class="small dim">已选 <b class="${over ? 'red' : ''}">${App.prepSel.length}/${cap}</b></div></div></div>
      <div class="panel"><p>你坐在火堆边翻着法术。今天要带哪些出门，是现在决定的事。</p>
        <div class="small dim">${pool.some((s) => !(p.knownSpells || []).includes(s.id)) || !pool.length ? '' : '法师只能从法术书里挑（书里的法术才是你会的）。'}</div></div>
      <div class="panel">
        <h3>环阶法术</h3>
        ${pool.length ? `<div class="cards">${pool.map(card).join('')}</div>` : '<div class="small dim">你现在还不会任何环阶法术。</div>'}
      </div>
      <div class="panel">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="primary" data-act="p:done" ${over ? 'disabled' : ''}>就这些（${App.prepSel.length}/${cap}）</button>
          <button data-act="p:keep">保持上一次的选择</button>
        </div>
      </div>`;
  }

  /* ================= 宝库 ================= */
  function treasureScreen() {
    const lines = App.run.treasureResult || [];
    return `<div class="panel tight"><span class="tag blue">宝库</span> 上锁的铁箱</div>
      <div class="panel"><ul>${lines.map((l) => `<li class="gold">${esc(l)}</li>`).join('')}</ul>
      <div class="center" style="margin-top:12px"><button class="primary" data-act="tr:continue">继续</button></div></div>`;
  }

  /* ================= 升级 ================= */
  function levelUpScreen() {
    const run = App.run;
    const p = run.player;
    const cls = R.classDef(p.classId);
    const sub = R.subclassOf(p);
    const pend = R.pendingChoices(p)[0];
    const header = `<div class="panel tight"><div class="spread">
      <div><span class="tag gold">升级</span> <b>${esc(R.classLabel(p))}</b></div>
      <div class="small dim">HP ${p.hp}/${p.maxHp}　熟练 ${fmt(p.prof)}</div></div></div>`;
    if (!pend) return header + `<div class="panel"><p>升级结算完成。</p><div class="center"><button class="primary" data-act="l:done">继续</button></div></div>`;

    let body = '';
    if (pend.kind === 'classlevel') {
      const entries = R.classEntries(p);
      const rows = entries.map((e) => {
        const cd = R.classDef(e.id);
        const s = (cd.subclasses || []).find((x) => x.id === e.subclassId);
        return `<div class="card ${e.id === pend.classId ? 'sel' : ''}" data-act="l:classlevel" data-id="${e.id}">
          <h3>${esc(cd.name)} ${e.level} 级</h3>
          <div class="small">${e.subclassId ? esc(s ? s.name : '未定子职') : '<span class="dim">尚未选择子职</span>'}</div>
          <div class="hint">${e.id === pend.classId ? '这一级默认加在这里 —— 点它确认' : `改投这里 → ${esc(cd.name)} ${e.level + 1} 级`}</div></div>`;
      }).join('');
      const news = NK.Data.get('classes').classes.filter((c) => !entries.some((e) => e.id === c.id)).map((c) => {
        const need = c.primary;
        const ok = (p.attrs[need] || 0) >= 13;
        return `<div class="card ${ok ? '' : 'locked'}" ${ok ? `data-act="l:classlevel" data-id="${c.id}"` : ''}>
          <h3>${esc(c.name)} <span class="tag gold">新兼职</span></h3>
          <div class="small">${esc((c.features[0] || {}).desc || '')}</div>
          <div class="hint">需要 ${attrName(need)} ≥ 13　（你 ${p.attrs[need]}）${ok ? '' : '　<span class="red">不满足</span>'}</div></div>`;
      }).join('');
      body = `<h2>职业进阶：第 ${pend.level} 级加在哪里？</h2>
        <div class="small dim">当前：${entries.map((e) => esc(R.classDef(e.id).name) + ' ' + e.level).join('　／　')}　（总等级 ${R.totalLevel(p)}）</div>
        <div class="small dim" style="margin-top:4px">兼职能拿到新职业的低阶特性与法术，但会稀释本职的高等级能力和高阶法术位。新开职业需要该职业主属性 ≥ 13。</div>
        <div class="cards" style="margin-top:10px">${rows}</div>
        ${news ? `<h3 style="margin-top:14px">新开一个兼职职业</h3><div class="cards">${news}</div>` : ''}`;
    } else if (pend.kind === 'invocation' || pend.kind === 'metamagic' || pend.kind === 'pactBoon') {
      const CFG = {
        invocation: { list: 'invocations', title: '魔能祈愿', act: 'l:invocation', owned: p.invocations || [], lead: '你的主人允许你从它的力量里取走一小块。选了就是永久的。' },
        metamagic: { list: 'metamagics', title: '超魔', act: 'l:metamagic', owned: p.metamagics || [], lead: `每个超魔消耗 1 点术法点，在施法前用附赠动作挂上。术法点上限 ${R.sorceryMax(p)}，长休恢复。` },
        pactBoon: { list: 'pactBoons', title: '魔契恩泽', act: 'l:pactboon', owned: [], lead: '契约结成实物。这决定你之后怎么打——三选一，不能改。' },
      }[pend.kind];
      body = `<h2>${CFG.title}${pend.count > 1 ? `（选 ${pend.count} 项）` : ''}</h2>
        <div class="small dim">${CFG.lead}</div>
        <div class="cards" style="margin-top:10px">${NK.Data.get('rules')[CFG.list].filter((o) => !CFG.owned.includes(o.id)).map((o) => `
          <div class="card" data-act="${CFG.act}" data-id="${o.id}">
            <h3>${esc(o.name)}</h3><div class="small">${esc(o.desc)}</div></div>`).join('')}</div>`;
    } else if (pend.kind === 'subclass') {
      const scl = R.classDef(pend.classId || p.classId);
      body = `<h2>选择${scl.name}的子职（${pend.level} 级）</h2><div class="small dim">这是本局最重要的一次选择。</div>
        <div class="cards" style="margin-top:10px">${scl.subclasses.map((s) => `
          <div class="card" data-act="l:subclass" data-id="${s.id}">
            <h3>${esc(s.name)}</h3><div class="small">${esc(s.desc)}</div><hr>
            <table>${s.features.map((f) => `<tr><td class="hint" style="width:44px">Lv.${f.level}</td><td><b>${esc(f.name)}</b></td><td class="small">${esc(f.desc)}</td></tr>`).join('')}</table>
          </div>`).join('')}</div>`;
    } else if (pend.kind === 'asi') {
      const draft = App.asiDraft || { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
      const used = Object.keys(draft).reduce((a, k) => a + draft[k], 0);
      body = `<h2>属性提升 或 专长（${pend.level} 级）</h2>
        <div class="small dim">二者只能选一个。属性提升共 2 点：可以全给一项（+2），也可以分给两项（+1/+1）。</div>
        <div class="panel tight" style="margin-top:10px"><div class="spread"><b>属性提升</b><span class="tag ${used === 2 ? 'green' : 'gold'}">${used}/2</span></div>
          <table style="margin-top:6px">${['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => {
            const cur = p.attrs[k] + draft[k];
            return `<tr><td style="width:74px"><b>${attrName(k)}</b></td>
              <td class="mono">${p.attrs[k]} → ${cur} <span class="dim">(${fmt(R.mod(cur))})</span></td>
              <td style="width:130px" class="center">
                <button class="sm ghost" data-act="l:attr:sub" data-k="${k}" ${draft[k] <= 0 ? 'disabled' : ''}>−</button>
                <span class="mono" style="display:inline-block;width:22px">${draft[k]}</span>
                <button class="sm ghost" data-act="l:attr:add" data-k="${k}" ${used >= 2 ? 'disabled' : ''}>+</button></td></tr>`;
          }).join('')}</table>
          <div class="center" style="margin-top:10px"><button class="primary" data-act="l:asi" ${used === 2 ? '' : 'disabled'}>确认属性提升</button></div></div>
        <div class="panel tight"><b>或者，选一个专长</b>
          <table style="margin-top:6px">${NK.Data.get('rules').feats.filter((f) => !(p.feats || []).includes(f.id)).map((f) => `
            <tr><td style="width:130px"><b>${esc(f.name)}</b></td><td class="small">${esc(f.desc)}</td>
            <td style="width:60px"><button class="sm" data-act="l:feat" data-id="${f.id}">选取</button></td></tr>`).join('')}</table></div>`;
    } else if (pend.kind === 'style') {
      body = `<h2>选择战斗风格</h2><div class="cards" style="margin-top:10px">${NK.Data.get('rules').fightingStyles.map((s) => `
        <div class="card" data-act="l:style" data-id="${s.id}"><h3>${esc(s.name)}</h3><div class="small">${esc(s.desc)}</div></div>`).join('')}</div>`;
    } else if (pend.kind === 'expertise') {
      const prog = p.proficiencies.skills || [];
      body = `<h2>选择专精技能（${pend.count} 项）</h2><div class="small dim">只能专精你已经熟练的技能，检定加值再 +3。</div>
        <div class="cards" style="margin-top:10px">${prog.filter((s) => !(p.expertise || []).includes(s)).map((sid) => `
          <div class="card" data-act="l:expertise" data-id="${sid}"><h3>${esc(R.skillDef(sid).name)}</h3>
          <div class="small dim">当前 ${fmt(R.skillBonus(p, sid))} → ${fmt(R.skillBonus(p, sid) + 3)}</div></div>`).join('')}</div>`;
    } else if (pend.kind === 'cantrips' || pend.kind === 'spells') {
      const isCantrip = pend.kind === 'cantrips';
      const scCls = R.classDef(pend.classId || p.classId);
      const pool = R.spellPool(p, isCantrip);
      body = `<h2>${isCantrip ? '学习新戏法' : '学习新法术'}（还需选 ${Math.min(pend.count, pool.length)} 个）</h2>
        <div class="small dim">${scCls.spellcasting && scCls.spellcasting.prepared ? '长休时可以更换准备的法术。' : '学会之后就固定了。'}可学环阶：${isCantrip ? '戏法' : '一~' + NK.Data.get('rules').slotLevelNames[(R.maxSpellLevel(p) || 1) - 1]}</div>
        <div class="cards" style="margin-top:10px">${pool.map((s) => `
          <div class="card" data-act="l:spell" data-id="${s.id}">
            <h3>${esc(s.name)} <span class="tag ${s.level === 0 ? 'gold' : 'blue'}">${s.level === 0 ? '戏法' : NK.Data.get('rules').slotLevelNames[s.level - 1]}</span></h3>
            <div class="small">${esc(s.desc)}</div>
            <div class="hint">${esc(s.action)}${s.concentration ? '　需要专注' : ''}　${esc(s.range || '')}</div></div>`).join('')}</div>`;
    }
    const q = R.pendingChoices(p);
    return header + `<div class="panel">${body}</div>
      <div class="small dim center">待处理：${q.map((x) => ({ subclass: '子职', asi: '属性/专长', style: '战斗风格', expertise: '专精', spells: '法术', cantrips: '戏法', classlevel: '职业进阶', invocation: '魔能祈愿', metamagic: '超魔', pactBoon: '魔契恩泽' }[x.kind] + `(${x.level})`)).join('　')}</div>`;
  }

  /* ================= 结算 ================= */
  function overScreen() {
    const s = App.overSummary || {};
    const run = App.run;
    return `
      <div class="center" style="margin:22px 0"><h1>${s.victory ? '通 关' : '你 死 了'}</h1>
        <div class="dim">${s.victory ? '三幕都走完了。你活着走出了黑曜圣所。' : `你在${esc(s.actName || '地牢')}倒下，死因是${esc(s.deathCause || '未知')}。没有下次了——这一局的你就到这里。`}</div></div>
      <div class="panel"><h3>这一局</h3><div class="kv">
        <b>角色</b><span>${esc(s.race || '')} ${esc(s.className || '')}${s.subclass ? '·' + esc(s.subclass) : ''} Lv.${s.level}（${esc(s.bg || '')}）</span>
        <b>抵达</b><span>第 ${s.act} 幕 · ${esc(s.actName || '')}</span>
        <b>击杀</b><span>${s.kills} 个（精英 ${s.elites} · 关底 ${s.bosses}）</span>
        <b>终局数值</b><span>HP ${s.maxHp}　AC ${s.ac}　命中 ${fmt(s.hit)}</span>
        <b>金币</b><span>${s.gold}</span>
        <b>用时</b><span>约 ${s.minutes} 分钟</span>
      </div></div>
      <div class="panel"><h3>接下来</h3>
        <div class="small dim">《渊下》没有跨局成长：不会有新的天赋、图鉴或传承。下一局你从 1 级重新开始，唯一变化的是你自己知道该怎么玩了。</div>
        <div class="center" style="margin-top:12px">
          ${lastBuild() ? '<button class="primary" data-act="t:last" style="padding:10px 24px">用同一套角色再来一局</button>' : ''}
          <button data-act="o:again" style="margin-left:8px">重新捏一个角色</button>
        </div></div>`;
  }

  /* ================= 人物卡 ================= */
  function sheetHtml() {
    const run = App.run;
    if (!run) return '<h2>人物卡</h2><div class="dim">当前不在局内。</div>';
    const p = run.player;
    const cls = R.classDef(p.classId);
    const sub = R.subclassOf(p);
    const mains = new Set(R.classEntries(p).map((e) => (R.classDef(e.id) || {}).primary).filter(Boolean));
    const attrs = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const attrGrid = attrs.map((k) => {
      const isMain = mains.has(k);
      return `<div class="card" style="padding:8px 4px;text-align:center;${isMain ? 'border-color:var(--gold)' : ''}">
        <div class="small dim">${attrName(k)}${isMain ? ' ★' : ''}</div>
        <div style="font-size:21px;line-height:1.2" class="mono">${p.attrs[k]}</div>
        <div class="tag ${isMain ? 'gold' : ''}">${fmt(R.mod(p.attrs[k]))}</div></div>`;
    }).join('');
    const saves = attrs.map((k) => `<tr><td>${attrName(k)}</td><td class="mono">${fmt(R.saveBonus(p, k))}</td><td class="hint">${p.proficiencies.saves.includes(k) ? '熟练' : ''}</td></tr>`).join('');
    const skillRows = NK.Data.get('rules').skills.map((s) => {
      const info = R.skillInfo(p, s.id);
      const mark = info.expertise ? '◆专精' : info.proficient ? '●熟练' : '';
      return `<tr><td>${mark}</td><td>${esc(s.name)}</td><td class="hint">${attrName(s.attr)}</td><td class="mono">${fmt(info.total)}</td></tr>`;
    }).join('');
    const features = [];
    for (const e of R.classEntries(p)) {
      const c = R.classDef(e.id); if (!c) continue;
      for (const f of c.features) if (f.level <= e.level) features.push({ lv: f.level, name: f.name, desc: f.desc, tag: c.name });
      const s = (c.subclasses || []).find((x) => x.id === e.subclassId);
      if (s) for (const f of s.features) if (f.level <= e.level) features.push({ lv: f.level, name: f.name, desc: f.desc, tag: s.name });
    }
    for (const fid of p.feats || []) { const ft = R.featDef(fid); if (ft) features.push({ lv: '-', name: ft.name, desc: ft.desc, tag: '专长' }); }
    for (const sid of p.styles || []) { const st = R.styleDef(sid); if (st) features.push({ lv: '-', name: st.name, desc: st.desc, tag: '战斗风格' }); }
    features.sort((a, b) => (a.lv === '-' ? 99 : a.lv) - (b.lv === '-' ? 99 : b.lv));
    const spells = R.castableSpells(p).map((s) => `<tr><td><b>${esc(s.name)}</b></td><td class="hint">${s.level === 0 ? '戏法' : NK.Data.get('rules').slotLevelNames[s.level - 1]}</td><td class="small">${esc(s.desc)}</td></tr>`).join('');
    const slotLine = p.slotsMax.some((x) => x > 0) ? p.slots.map((n, i) => `<span class="tag ${n > 0 ? 'blue' : ''}">${NK.Data.get('rules').slotLevelNames[i]} ${n}/${p.slotsMax[i]}</span>`).join('') : '';
    const equipRows = NK.Items.SLOTS.filter((s) => s.id !== 'rings').map((sl) => [sl, p.items[sl]])
      .concat((p.items.rings || []).map((it, i) => ['rings', it, i]));
    const equip = equipRows.map(([sl, it, idx]) => `<tr><td class="hint" style="width:52px">${esc(NK.Items.slotName(sl))}</td>
      <td>${itemLine(it, it ? `<button class="sm ghost" data-act="unequip" data-slot="${sl}" data-index="${idx === undefined ? '' : idx}">卸下</button>` : '')}</td></tr>`).join('');
    const pen = R.armorPenalty(p);
    const inter = R.interference(p);
    const tab = App.sheetTab || 'core';
    const TABS = [['core', '属性'], ['combat', '战斗'], ['features', '特性'], ['skills', '技能']];
    if (spells) TABS.push(['spells', '法术']);
    TABS.push(['equip', '装备']);

    const tabsHtml = `<div class="tabs">${TABS.map(([id, name]) => `<button class="${id === tab ? 'on' : ''}" data-act="sheet:tab" data-tab="${id}">${name}</button>`).join('')}</div>`;

    let body = '';
    if (tab === 'core') {
      body = `<div class="cards" style="grid-template-columns:repeat(6,1fr)">${attrGrid}</div>
        <div class="row" style="margin-top:12px">
          <div class="col"><h3>豁免</h3><table>${saves}</table></div>
          <div class="col"><h3>技能</h3><table>${skillRows}</table></div>
        </div>`;
    } else if (tab === 'combat') {
      body = `<div class="row"><div class="col"><h3>攻击</h3><table>
          <tr><td>右手</td><td class="mono">${itemLine(p.items.mainHand)}</td></tr>
          <tr><td>左手</td><td class="mono">${itemLine(p.items.offHand)}${p.items.offHand && p.items.offHand.dice ? '　<span class="hint">可用附赠动作攻击</span>' : ''}</td></tr>
          <tr><td>伤害</td><td class="mono">${R.weaponDice(p)} ${fmt(R.damageBonus(p))} ${p.items.mainHand ? esc(p.items.mainHand.dmgType) : ''}</td></tr>
          <tr><td>命中</td><td class="mono">d20 ${fmt(R.attackBonus(p))}</td></tr>
          ${R.weaponDice(p) !== (p.items.mainHand ? p.items.mainHand.dice : '') ? '<tr><td></td><td class="hint">左手空着，正在双手持用</td></tr>' : ''}
          ${p.mods.sneakAttack ? `<tr><td>偷袭</td><td class="mono">${p.mods.sneakAttack}d6（需要优势）</td></tr>` : ''}
          ${R.spellAbility(p) ? `<tr><td>施法</td><td class="mono">${attrName(R.spellAbility(p))}　DC ${R.spellDc(p)}　攻击 ${fmt(R.spellAttack(p))}</td></tr>` : ''}
          <tr><td>减伤</td><td class="mono">${fmt(-(p.mods.dr || 0))}</td></tr>
        </table>
        <h3 style="margin-top:10px">防御</h3><table>
          <tr><td>AC</td><td class="mono">${p.ac}</td></tr>
          <tr><td>先攻</td><td class="mono">${fmt(R.initiative(p))}</td></tr>
          <tr><td>抗性</td><td class="small">${(p.resist || []).join('、') || '无'}</td></tr>
          <tr><td>免疫</td><td class="small">${(p.immune || []).join('、') || '无'}</td></tr>
        </table>
        ${pen.strDexDisadvantage || pen.heavyStrPenalty || inter > 0 ? `<h3 style="margin-top:10px">惩罚</h3><table>
          ${pen.strDexDisadvantage ? '<tr><td class="red">未熟练护甲</td><td class="small">力量与敏捷的豁免/检定劣势，无法施法</td></tr>' : ''}
          ${pen.heavyStrPenalty ? '<tr><td class="red">力量不足</td><td class="small">AC 额外 -2</td></tr>' : ''}
          ${inter > 0 ? `<tr><td class="red">能量干涉</td><td class="small">${R.ringCount(p)} 枚戒指，所有 d20 检定 -${inter}</td></tr>` : ''}
        </table>` : ''}
        </div></div>`;
    } else if (tab === 'features') {
      body = `<table>${features.map((f) => `<tr><td class="hint" style="width:56px">${f.lv === '-' ? f.tag : 'Lv.' + f.lv}</td><td style="width:110px"><b>${esc(f.name)}</b></td><td class="small">${esc(f.desc)}</td></tr>`).join('')}</table>
        ${(p.buffs || []).length ? `<h3 style="margin-top:12px">当前状态</h3><table>${p.buffs.map((b) => `<tr><td class="${b.kind === 'curse' ? 'red' : 'green'}">${esc(b.name)}</td><td class="small">${esc(b.desc || '')}</td></tr>`).join('')}</table>` : ''}`;
    } else if (tab === 'skills') {
      body = `<table>${skillRows}</table>`;
    } else if (tab === 'spells') {
      body = `<div class="small dim" style="margin-bottom:6px">${slotLine || '没有法术位'}</div><table>${spells}</table>`;
    } else {
      body = `<table>${equip}</table>`;
    }

    return `
      <div class="spread"><div><h2 style="margin:0">${esc(p.name)}</h2>
        <div class="small dim">${esc(R.raceDef(p.raceId).name)} · ${esc(R.classLabel(p))}　背景：${esc(R.bgDef(p.bgId).name)}　熟练 ${fmt(p.prof)}</div></div>
        <div class="small"><span class="tag gold">⚔ ${fmt(R.attackBonus(p))}</span><span class="tag blue">AC ${p.ac}</span><span class="tag">先攻 ${fmt(R.initiative(p))}</span><span class="tag red">重击 ${p.critRange}-20</span></div></div>
      <div class="bar" style="margin-top:8px"><i style="width:${Math.round(p.hp / p.maxHp * 100)}%"></i></div>
      <div class="small dim">HP ${p.hp}/${p.maxHp}　生命骰 ${p.hitDice.left}/${p.hitDice.total}d${p.hitDice.die}　经验 ${p.xp}${R.xpNeeded(p.level) !== null ? '/' + R.xpNeeded(p.level) : ''}</div>
      ${tabsHtml}
      ${body}`;
  }

  function bagHtml() {
    const run = App.run;
    if (!run) return '<h2>背包</h2><div class="dim">当前不在局内。</div>';
    const p = run.player;
    const effList = (it) => NK.Items.effects(it).map((e) => `<div class="small ${e.kind === 'skill' ? 'gold' : e.kind === 'resist' ? 'blue' : 'dim'}">· ${esc(e.text)}</div>`).join('');
    const pen = R.armorPenalty(p);
    const inter = R.interference(p);

    const slotCard = (slot, it, idx) => {
      const unprof = it && !R.isProficient(p, it);
      return `<div class="card" style="cursor:default${unprof ? ';border-color:var(--red)' : ''}">
        <div class="spread"><b>${esc(NK.Items.slotName(slot))}</b>${it ? `<button class="sm ghost" data-act="unequip" data-slot="${slot}" data-index="${idx === undefined ? '' : idx}">卸下</button>` : ''}</div>
        ${it ? `<div style="margin-top:2px">${itemLine(it)} ${unprof ? '<span class="tag red">未熟练</span>' : ''}</div>${effList(it)}` : '<div class="dim small">（空）</div>'}
      </div>`;
    };
    const equipped = NK.Items.SLOTS.filter((s) => s.id !== 'rings').map((s) => slotCard(s.id, p.items[s.id])).join('')
      + `<div class="card" style="cursor:default">
          <div class="spread"><b>戒指</b><span class="small ${inter > 0 ? 'red' : 'dim'}">${R.ringCount(p)}/${R.ringCap(p)}${inter > 0 ? '　能量干涉 -' + inter : ''}</span></div>
          ${(p.items.rings || []).length ? p.items.rings.map((it, i) => `<div style="margin-top:2px">${itemLine(it, `<button class="sm ghost" data-act="unequip" data-slot="rings" data-index="${i}">卸下</button>`)}</div>${effList(it)}`).join('') : '<div class="dim small">（空）</div>'}
          ${inter > 0 ? `<div class="small red">从第 2 枚戒指开始，每多一枚，你的所有攻击检定、豁免与属性检定 -1（当前 -${inter}）。</div>` : ''}
        </div>`;

    const bagRows = (p.bag || []).map((it, i) => {
      const cur = it.slot === 'rings' ? (p.items.rings[p.items.rings.length - 1] || null) : p.items[it.slot];
      const curScore = cur ? (cur.price || 0) : -1;
      const better = (it.price || 0) > curScore;
      const unprof = !R.isProficient(p, it);
      let btns = '';
      if (it.dice) {
        btns += `<button class="sm" data-act="equip" data-index="${i}" data-slot="mainHand">装右手</button>`;
        if (!it.twoHanded) btns += `<button class="sm" data-act="equip" data-index="${i}" data-slot="offHand">装左手</button>`;
      } else if (it.slot === 'rings') btns += `<button class="sm" data-act="equip" data-index="${i}" data-slot="rings">戴上</button>`;
      else btns += `<button class="sm" data-act="equip" data-index="${i}" data-slot="${it.slot}">装备</button>`;
      return `<div class="choice">
        <div class="spread">
          <div>${itemLine(it)} ${better ? '<span class="tag green">比身上的好</span>' : ''}${unprof ? '<span class="tag red">未熟练</span>' : ''}${it.hands === 2 ? '<span class="tag">双手</span>' : ''}</div>
          <div>${btns}<button class="sm ghost" data-act="sell" data-index="${i}">卖 ${NK.Items.sellValue(it)}</button></div>
        </div>
        ${effList(it)}
        ${cur ? `<div class="small dim">当前 ${NK.Items.slotName(it.slot)}：${esc(cur.name)}（${esc(NK.Items.describe(cur))}）</div>` : ''}
      </div>`;
    }).join('');

    const cons = (p.inventory || []).map((it, i) => {
      const sp = NK.Items.scrollSpell(it);
      const copy = sp ? R.canCopyScroll(p, it) : null;
      return `<tr>
        <td><b>${esc(it.name)}</b>${sp ? `<span class="tag blue">${sp.level === 0 ? '戏法' : sp.level + ' 环'}</span>` : ''}<div class="hint">${esc(it.desc || (sp ? sp.desc : ''))}</div></td>
        <td style="width:150px;text-align:right">
          <button class="sm" data-act="use" data-index="${i}">使用</button>
          ${copy ? (copy.ok
            ? `<button class="sm ${run.gold >= copy.cost ? 'primary' : ''}" data-act="copy" data-index="${i}" title="${esc(copy.msg)}">抄写 ${copy.cost}金</button>`
            : (['只有把法术记在法术书里的职业才能抄写卷轴（法师）。'].includes(copy.msg) ? '' : `<button class="sm ghost" disabled title="${esc(copy.msg)}">抄写</button>`)) : ''}
        </td></tr>`;
    }).join('');

    const skills = (p.itemAbilities || []).concat(
      Object.keys(p.itemPassives || {}).map((k) => ({ name: { second_breath: '回息', read_the_room: '读局' }[k], source: '装备', desc: { second_breath: '每场战斗一次，被击倒时以 1 HP 站起并清除负面状态。', read_the_room: '每场战斗开始时读局：每回合的第一次攻击检定具有优势。' }[k] }))
    );

    return `<h2>背包与装备</h2>
      <div class="small dim">金币 ${run.gold}　食物 ${run.food} 份（长休消耗 1 份）　消耗品 ${(p.inventory || []).length}/10</div>
      ${pen.strDexDisadvantage ? `<div class="panel tight" style="border-color:var(--red);margin-top:8px"><b class="red">护甲惩罚</b><div class="small">你穿着不熟练的护甲或盾牌：力量与敏捷的豁免/检定具有劣势，并且无法施法。</div></div>` : ""}
      ${pen.heavyStrPenalty ? `<div class="small red" style="margin-top:6px">力量不足，AC 额外 -2。</div>` : ""}
      <h3>已装备</h3>
      <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr))">${equipped}</div>
      ${skills.length ? `<h3 style="margin-top:12px">装备技能</h3>
        <table>${skills.map((s) => `<tr><td style="width:110px"><b class="gold">${esc(s.name)}</b></td><td class="small">${esc(s.desc || '')}</td><td class="hint" style="width:90px">${esc(s.source)}</td></tr>`).join('')}</table>` : ''}
      <h3 style="margin-top:12px">背包（${(p.bag || []).length} 件）</h3>
      ${bagRows || '<div class="dim small">空。</div>'}
      <h3 style="margin-top:12px">消耗品</h3>
      <table>${cons || '<tr><td class="dim">空</td></tr>'}</table>
      <div class="small dim" style="margin-top:8px">抗性：${(p.resist || []).length ? esc(p.resist.join('、')) : '无'}　免疫：${(p.immune || []).length ? esc(p.immune.join('、')) : '无'}</div>`;
  }

  /* ================= 通关记录与图鉴 ================= */
  const CODEX_TABS = [
    { id: 'monsters', name: '怪物' }, { id: 'spells', name: '法术' },
    { id: 'items', name: '物品' }, { id: 'events', name: '事件' },
  ];

  function recordsHtml() {
    const list = NK.Codex.records();
    const s = NK.Codex.recordStats();
    if (!list.length) return '<h2>通关记录</h2><div class="dim">还没有打完过一局。记录只是记录，不会给你任何加成。</div>';
    const byClass = Object.keys(s.byClass).map((k) => `${esc(k)} ${s.byClass[k].wins}/${s.byClass[k].runs}`).join('　');
    return `<h2>通关记录</h2>
      <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));margin-bottom:10px">
        <div class="card" style="cursor:default"><div class="hint">总局数</div><b style="font-size:20px">${s.total}</b></div>
        <div class="card" style="cursor:default"><div class="hint">通关</div><b style="font-size:20px" class="gold">${s.wins}</b><span class="small dim">（${s.rate}%）</span></div>
        <div class="card" style="cursor:default"><div class="hint">最高等级</div><b style="font-size:20px">${s.bestLevel}</b></div>
        <div class="card" style="cursor:default"><div class="hint">最多击杀</div><b style="font-size:20px">${s.bestKills}</b></div>
      </div>
      <div class="small dim" style="margin-bottom:8px">按职业：${byClass || '—'}</div>
      <table>
        <tr><th>结果</th><th>角色</th><th>等级</th><th>难度</th><th>进度</th><th>击杀</th><th>用时</th></tr>
        ${list.map((r) => `<tr>
          <td>${r.result === 'victory' ? '<span class="tag gold">通关</span>' : `<span class="tag red">阵亡</span>`}</td>
          <td>${esc(r.race || '')} ${esc(r.className || '')}${r.subclass ? '·' + esc(r.subclass) : ''}<div class="hint">${esc(r.name || '')}</div></td>
          <td>${r.level}</td>
          <td class="small">${esc(r.difficultyName || '')}</td>
          <td class="small">第 ${r.act} 幕${r.result === 'defeat' && r.deathCause ? `<div class="hint">死于 ${esc(r.deathCause)}</div>` : ''}</td>
          <td>${r.kills}</td>
          <td class="small">${r.minutes} 分</td>
        </tr>`).join('')}
      </table>
      <div class="center" style="margin-top:10px"><button class="sm ghost" data-act="rec:clear">清空记录</button></div>`;
  }

  function codexHtml() {
    const tab = App.codexTab || 'monsters';
    const prog = NK.Codex.progress();
    const seen = NK.Codex.seen(tab);
    const D = NK.Data;
    let entries = [];
    if (tab === 'monsters') entries = (D.get('monsters').monsters || []).map((m) => ({ id: m.id, name: m.name, act: m.act, rank: m.rank }));
    else if (tab === 'spells') entries = (D.get('spells').spells || []).map((s) => ({ id: s.id, name: s.name, act: 0, rank: s.level === 0 ? '戏法' : s.level + ' 环' }));
    else if (tab === 'items') entries = (D.get('items').magicItems || []).map((i) => ({ id: i.id, name: i.name, rank: NK.Items.RARITY_NAME[i.rarity] }))
      .concat((D.get('items').consumables || []).map((i) => ({ id: i.id, name: i.name, rank: '消耗品' })));
    else entries = (D.get('events').events || []).map((e) => ({ id: e.id, name: e.title, act: (e.act || [])[0] || 0, rank: `${(e.options || []).length} 选项` }));

    const rows = entries.map((en) => {
      const got = seen.includes(en.id);
      const detail = got ? NK.Codex.entry(tab, en.id) : null;
      return `<div class="choice" style="padding:8px 12px">
        <div class="spread"><div><b class="${got ? '' : 'dim'}">${got ? esc(en.name) : '？？？'}</b>
          <span class="hint">${en.act ? '第 ' + en.act + ' 幕 · ' : ''}${esc(String(en.rank || ''))}</span></div></div>
        ${detail ? `<div class="small dim">${esc(detail.tag)}</div>${detail.lines.map((l) => `<div class="small">${esc(l)}</div>`).join('')}${detail.flavor ? `<div class="hint" style="margin-top:2px">${esc(detail.flavor)}</div>` : ''}` : '<div class="small dim">还没见过。</div>'}
      </div>`;
    }).join('');

    const allSeen = prog.monsters.seen + prog.spells.seen + prog.items.seen + prog.events.seen;
    const allTotal = prog.monsters.total + prog.spells.total + prog.items.total + prog.events.total;
    const pct = allTotal ? Math.round(allSeen / allTotal * 100) : 0;
    const done = (k) => prog[k].total > 0 && prog[k].seen >= prog[k].total;
    return `<h2>图鉴 · 收集目标</h2>
      <div class="small dim">只记录你见过的东西，不提供任何数值加成——集齐只是属于你自己的成就。</div>
      <div class="panel tight" style="margin:10px 0">
        <div class="spread"><b>总收集度</b><span class="tag ${pct >= 100 ? 'green' : 'gold'}">${allSeen}/${allTotal}（${pct}%）</span></div>
        <div style="height:8px;background:rgba(255,255,255,.12);border-radius:4px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${pct}%;background:#caa45a"></div></div>
      </div>
      <div class="actions" style="margin:10px 0">
        ${CODEX_TABS.map((t) => `<button class="sm ${t.id === tab ? 'primary' : ''}" data-act="codex:tab" data-tab="${t.id}">${t.name} ${prog[t.id].seen}/${prog[t.id].total}${done(t.id) ? ' ✅' : ''}</button>`).join('')}
        <button class="sm ghost" data-act="codex:clear" style="margin-left:auto">清空图鉴</button>
      </div>
      ${pct >= 100 ? '<div class="panel tight" style="margin-bottom:10px"><b class="green">图鉴集齐！</b><div class="small dim">你已见过这里的每一个存在、每一道法术、每一件物品与每一段遭遇。没有奖励，只有这份记录。</div></div>' : ''}
      ${rows}`;
  }

  function helpHtml() {
    return `<h2>规则（5e 精简版）</h2>
      <h3>检定</h3><ul class="small">
        <li>攻击 = d20 + 属性调整值 + 熟练加值 + 装备，对上 AC。自然 20 必中且重击，自然 1 必失。</li>
        <li>豁免 = d20 + 属性调整值（本职豁免加熟练）。法术 DC = 8 + 熟练 + 施法属性。</li>
        <li>优势/劣势：投两次 d20 取高/取低。潜行、包夹、状态都会带来优势或劣势。</li>
        <li>技能检定用于事件与部分战斗行动（隐匿、运动、察觉……），加值 = 属性 + 熟练(+专精 3)。</li>
      </ul>
      <h3>回合与资源</h3><ul class="small">
        <li>每回合有 1 个<b>动作</b>和 1 个<b>附赠动作</b>。攻击、施法、使用物品、闪避占动作；回气、灵巧动作、圣疗、至圣斩占附赠动作。</li>
        <li><b>法术位</b>按环阶消耗，短休不回，长休（或奥术恢复）才回。戏法不消耗法术位。</li>
        <li><b>短休</b>：消耗生命骰回血（用几颗由你决定），法师还能恢复法术位。<b>长休</b>：全回复 + 生命骰回一半。</li>
        <li><b>休息次数不限</b>——限制你的是地图上营地节点的数量，以及生命骰的总量（只有长休能回复生命骰）。</li>
        <li>生命降到 0 会进入<b>濒死</b>：每回合投死亡豁免，成功 3 次稳定（1 HP），失败 3 次死亡。敌人会补刀。</li>
      </ul>
      <h3>成长</h3><ul class="small">
        <li>升级获得职业特性；3 级（牧师 1 级、法师 2 级）选子职；4/8 级选属性提升或专长；2/5/9 级学新法术。</li>
        <li>本作没有跨局成长。每一局都是新的 1 级角色。</li>
      </ul>
      <h3>操作</h3><ul class="small">
        <li><span class="mono">1</span> 攻击　<span class="mono">2-9</span> 法术/技能　<span class="mono">Q</span> 闪避　<span class="mono">E</span> 背包　<span class="mono">C</span> 人物卡　<span class="mono">空格</span> 结束回合　<span class="mono">Esc</span> 关闭</li>
      </ul>`;
  }

  /* ================= 弹窗与渲染 ================= */
  function modalHtml() {
    if (!App.modal) return '';
    let inner = '';
    let wide = '';
    if (App.modal === 'sheet') { inner = sheetHtml(); wide = 'max-width:1000px'; }
    else if (App.modal === 'bag') inner = bagHtml();
    else if (App.modal === 'help') inner = helpHtml();
    else if (App.modal === 'records') { inner = recordsHtml(); wide = 'max-width:900px'; }
    else if (App.modal === 'codex') { inner = codexHtml(); wide = 'max-width:1000px'; }
    return `<div class="modal-bg" data-act="close"><div class="modal" data-stop="1" style="${wide}">${inner}
      <div class="center" style="margin-top:14px"><button data-act="close">关闭</button></div></div></div>`;
  }

  function render() {
    if (globalThis.__NO_RENDER__) return;   // TEST HOOK（验证脚本用，可删）
    const root = el();
    if (!root) return;
    let html = '';
    const s = App.screen;
    if (s === 'title') html = titleScreen();
    else if (s === 'create') html = createScreen();
    else if (s === 'map') html = mapScreen();
    else if (s === 'battle') html = battleScreen();
    else if (s === 'event') html = eventScreen();
    else if (s === 'shop') html = shopScreen();
    else if (s === 'rest') html = restScreen();
    else if (s === 'prepare') html = prepareScreen();
    else if (s === 'treasure') html = treasureScreen();
    else if (s === 'levelup') html = levelUpScreen();
    else if (s === 'over') html = overScreen();
    html += modalHtml();
    if (App.toast) html += `<div class="toast">${esc(App.toast)}</div>`;
    root.innerHTML = html;
    const log = root.querySelector('.log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function titleScreen() {
    const saved = NK.RunStore.load();
    const builds = loadBuilds();
    const last = lastBuild();
    const diffs = NK.Data.get('maps').difficulties;
    const rec = NK.Codex.recordStats();
    const prog = NK.Codex.progress();
    const codexDone = prog.monsters.seen + prog.spells.seen + prog.items.seen + prog.events.seen;
    const codexTotal = prog.monsters.total + prog.spells.total + prog.items.total + prog.events.total;
    return `
      <div class="center" style="margin:34px 0 20px"><h1 style="font-size:38px">${GAME_NAME}</h1>
        <div class="dim">5e 规则的单人地牢肉鸽 · 文字版</div>
        <div class="small dim" style="margin-top:6px">没有跨局成长。死了就重来。</div></div>

      <div class="panel">
        <div class="spread"><h3 style="margin:0">开始</h3>
          <div>
            ${last ? `<button class="primary" data-act="t:last">用上次的角色再来一局</button>` : ''}
            <button data-act="t:new">重新捏一个角色</button>
            ${saved ? '<button data-act="t:continue">继续未完成的一局</button>' : ''}
          </div>
        </div>
        ${last ? `<div class="small dim" style="margin-top:8px">上次：${esc(buildSummary(last))}${last.name ? '　（' + esc(last.name) + '）' : ''}</div>` : '<div class="small dim" style="margin-top:8px">还没有用过任何角色。捏完一个人可以在最后一页保存下来。</div>'}
      </div>

      <div class="panel">
        <h3>保存的角色配置（${builds.length}）</h3>
        ${builds.length ? builds.map((b) => `
          <div class="buildrow">
            <div><b>${esc(b.name)}</b><div class="small dim">${esc(buildSummary(b))}</div></div>
            <div><button class="sm primary" data-act="t:quickstart" data-id="${b.id}">用这套开局</button>
                 <button class="sm" data-act="t:editbuild" data-id="${b.id}">编辑</button>
                 <button class="sm ghost" data-act="t:renamebuild" data-id="${b.id}">改名</button>
                 <button class="sm ghost" data-act="t:delbuild" data-id="${b.id}">删除</button></div>
          </div>`).join('') : '<div class="small dim">还没有保存过配置。捏完角色后在最后一步点「保存这套配置」。</div>'}
      </div>

      <div class="panel"><h3>难度</h3><table>${diffs.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td class="small">${esc(d.desc)}</td><td class="hint">经验 ×${d.xpMul}</td></tr>`).join('')}</table>
      <div class="small dim" style="margin-top:6px">难度在创建角色时选择，没有解锁条件。</div></div>

      <div class="center"><button class="sm ghost" data-act="open:help">规则说明</button>
        <button class="sm ghost" data-act="open:records" style="margin-left:6px">通关记录 ${rec.total ? `（${rec.wins}/${rec.total}）` : ''}</button>
        <button class="sm ghost" data-act="open:codex" style="margin-left:6px">图鉴 ${codexDone}/${codexTotal}</button></div>`;
  }

  /* ================= 动作 ================= */
  function busyScreen() {
    const run = App.run;
    if (!run) { App.screen = 'title'; return; }
    if (run.ended) { App.screen = 'over'; return; }
    if (NK.Char && false) {}
    if (R.pendingChoices(run.player).length) { App.asiDraft = App.asiDraft || { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }; App.screen = 'levelup'; return; }
    if (run.state === 'battle' && run._combat) { App.screen = 'battle'; return; }
    if (run.state === 'event') { App.screen = 'event'; return; }
    if (run.state === 'shop') { App.screen = 'shop'; return; }
    if (run.state === 'rest') { App.screen = 'rest'; return; }
    if (run.state === 'treasure') { App.screen = 'treasure'; return; }
    if (run.state === 'levelup') { App.screen = 'levelup'; return; }
    App.screen = 'map';
  }

  /** 用建卡状态开始一局（建卡完成、载入配置、重开一局都走这里） */
  function beginRun(c) {
    const cls = R.classDef(c.classId);
    const packs = NK.Items.startingPacks(c.classId);
    const pack = packs[c.pack] || packs[0];
    const equipment = NK.Items.packToItems(pack);
    const inventory = [NK.Items.consumableById('potion_healing_lesser'), NK.Items.consumableById('potion_healing_lesser')].filter(Boolean);
    // 职业专属的起始消耗品（卷轴 / 药剂）
    for (const cid of (pack.consumables || [])) {
      const c = NK.Items.consumableById(cid);
      if (c) inventory.push(c);
    }
    // 兼职：把主职 + 副职拼成 classes 数组交给规则层
    const classes = [{ id: c.classId, level: 1, subclassId: c.subclassId || null }].concat((c.mc || []).map((e) => ({ id: e.id, level: e.level, subclassId: null })));
    const run = NK.Run.start({
      rng: NK.RNG.make(), raceId: c.raceId, classId: c.classId, subclassId: c.subclassId, bgId: c.bgId,
      attrs: c.attrs, bonusChoice: c.bonusChoice, skills: c.skills, cantrips: c.cantrips, spells: c.spells,
      pack: c.pack, difficulty: c.difficulty, name: c.name || '无名者', equipment,
      classes,
      knownSpells: cls.spellcasting && !cls.spellcasting.prepared ? c.spells.slice() : (cls.spellcasting && cls.spellcasting.spellbook ? c.spells.slice() : []),
      prepared: cls.spellcasting && cls.spellcasting.prepared && !cls.spellcasting.spellbook ? c.spells.slice() : [],
    });
    // 法师：法术书里的法术按「已准备」上限先占好位（长休可重选）
    if (cls.spellcasting && cls.spellcasting.spellbook && cls.spellcasting.prepared) {
      const cap = R.spellCapacity(run.player).prepared;
      run.player.prepared = run.player.knownSpells.slice(0, cap);
    }
    run.player.inventory = inventory;
    App.run = run;
    App.asiDraft = null;
    App.selAction = 0;
    App.lastActionKey = null;
    writeJSON(LAST_KEY, captureBuild(c));   // 记住这次用的配置，重开时不用再捏
    busyScreen();
    render();
  }

  function finishRun() {
    App.overSummary = NK.Run.settle(App.run);
    NK.RunStore.clear();
    App.screen = 'over';
    render();
  }

  const actions = {
    't:new': () => { startCreate(null); render(); },
    /** 一键把上一套配置灌回来（建卡第 1 页的横幅按钮） */
    'c:autofill': () => { startCreate(lastBuild()); render(); },
    'c:reset': () => { App.create = newCreate(); App.createRestored = false; toast('已清空，从头捏一个。'); render(); },
    't:continue': () => {
      const saved = NK.RunStore.load();
      if (!saved) { toast('没有找到未完成的一局。'); return; }
      saved.rng = NK.RNG.make(saved.seed);
      const p = saved.player;
      p.bag = p.bag || []; p.inventory = p.inventory || []; p.buffs = p.buffs || []; p.conditions = [];
      p.feats = p.feats || []; p.styles = p.styles || []; p.expertise = p.expertise || [];
      p.asiTaken = p.asiTaken || []; p.knownSpells = p.knownSpells || []; p.prepared = p.prepared || [];
      p.cantrips = p.cantrips || []; p.hitDice = p.hitDice || { die: 8, total: 1, left: 1 };
      R.recalc(p);
      App.run = saved;
      App.asiDraft = null;
      if (saved.state === 'battle' && saved.current) {
        const id = saved.current;
        saved.state = 'map';
        NK.Run.enterNode(saved, id);
      }
      delete saved._combat;
      busyScreen();
      App.toast = null;
      render();
      toast('你回到了未完成的一局。');
    },
    'c:title': () => { App.screen = 'title'; render(); },
    'c:back': () => { App.create.step = Math.max(0, App.create.step - 1); render(); },
    'c:next': () => { App.create.step += 1; render(); },
    'c:race': (d) => { const c = App.create; c.raceId = d.id; c.bonusChoice = {}; c.step += 1; render(); },
    'c:class': (d) => {
      const c = App.create;
      c.classId = d.id; c.subclassId = null; c.skills = []; c.cantrips = []; c.spells = []; c.mc = [];
      const cls = R.classDef(d.id);
      c.step = stepsFor(c).indexOf(cls.subclassLevel === 1 ? 'subclass' : 'attrs');
      if (c.step < 0) c.step = 2;
      render();
    },
    'c:subclass': (d) => { App.create.subclassId = d.id; App.create.step += 1; render(); },
    'c:bg': (d) => { App.create.bgId = d.id; App.create.step += 1; render(); },
    'c:attr:add': (d) => {
      const c = App.create;
      const pb = NK.Data.get('rules').pointBuy;
      const spent = R.pointBuyCost(c.attrs);
      const cur = c.attrs[d.k];
      const next = R.pointBuyCost(Object.assign({}, c.attrs, { [d.k]: cur + 1 }));
      if (cur >= pb.max || next < 0 || next > pb.total) return;
      c.attrs[d.k] = cur + 1;
      render();
    },
    'c:attr:sub': (d) => { const c = App.create; const pb = NK.Data.get('rules').pointBuy; if (c.attrs[d.k] > pb.min) c.attrs[d.k] -= 1; render(); },
    'c:bonus': (d) => {
      const c = App.create;
      const race = R.raceDef(c.raceId);
      const cur = c.bonusChoice[d.k] ? 1 : 0;
      if (cur) delete c.bonusChoice[d.k];
      else {
        if (Object.keys(c.bonusChoice).length >= race.bonusChoice.count) { toast(`只能选 ${race.bonusChoice.count} 项。`); return; }
        c.bonusChoice[d.k] = 1;
      }
      render();
    },
    'c:skill': (d) => {
      const c = App.create;
      const cls = R.classDef(c.classId);
      const i = c.skills.indexOf(d.id);
      if (i >= 0) c.skills.splice(i, 1);
      else if (c.skills.length < cls.skillChoices.count) c.skills.push(d.id);
      render();
    },
    'c:cantrip': (d) => {
      const c = App.create;
      const max = spellNeeds(c).cantrips;
      const i = c.cantrips.indexOf(d.id);
      if (i >= 0) c.cantrips.splice(i, 1);
      else if (c.cantrips.length < max) c.cantrips.push(d.id);
      render();
    },
    'c:spell': (d) => {
      const c = App.create;
      const max = spellNeeds(c).spells;
      const i = c.spells.indexOf(d.id);
      if (i >= 0) c.spells.splice(i, 1);
      else if (c.spells.length < max) c.spells.push(d.id);
      render();
    },
    'c:pack': (d) => { App.create.pack = parseInt(d.idx, 10); render(); },
    'c:diff': (d) => { App.create.difficulty = parseInt(d.id, 10); render(); },
    'c:name': () => {
      const v = global.prompt ? global.prompt('给你的角色取个名字', App.create.name || '无名者') : null;
      if (v) App.create.name = v.slice(0, 12);
      render();
    },
    'c:start': () => { beginRun(App.create); },

    /* ---- 角色配置存档 ---- */
    'b:save': () => {
      const b = captureBuild(App.create);
      const name = global.prompt ? global.prompt('给这套配置取个名字', b.name) : b.name;
      if (name === null) return;
      b.name = (name || b.name).slice(0, 16);
      const list = loadBuilds();
      const same = list.findIndex((x) => x.raceId === b.raceId && x.classId === b.classId && x.bgId === b.bgId && JSON.stringify(x.attrs) === JSON.stringify(b.attrs));
      if (same >= 0) { b.id = list[same].id; list[same] = b; toast(`已更新「${b.name}」。`); }
      else { list.unshift(b); toast(`已保存「${b.name}」，下次可以在标题界面直接开局。`); }
      saveBuilds(list.slice(0, 30));
      render();
    },
    't:quickstart': (d) => {
      const b = loadBuilds().find((x) => x.id === d.id);
      if (!b) { toast('找不到这套配置。'); return; }
      beginRun(sanitizeBuild(applyBuild(newCreate(), b)));
    },
    't:editbuild': (d) => {
      const b = loadBuilds().find((x) => x.id === d.id);
      if (!b) { toast('找不到这套配置。'); return; }
      startCreate(b);
      render();
      toast('已载入配置，可以直接开始或继续调整。');
    },
    't:delbuild': (d) => {
      const list = loadBuilds().filter((x) => x.id !== d.id);
      saveBuilds(list);
      toast('已删除。');
      render();
    },
    't:renamebuild': (d) => {
      const list = loadBuilds();
      const b = list.find((x) => x.id === d.id);
      if (!b) { toast('找不到这套配置。'); return; }
      const v = global.prompt ? global.prompt('给这套配置改名', b.name) : null;
      if (v === null || !v.trim()) return;
      b.name = v.trim().slice(0, 16);
      saveBuilds(list);
      toast('已改名。');
      render();
    },
    't:last': () => {
      const b = lastBuild();
      if (!b) { toast('没有记录。'); return; }
      beginRun(sanitizeBuild(applyBuild(newCreate(), b)));
    },
    'open:records': () => { App.modal = 'records'; render(); },
    'open:codex': () => { App.modal = 'codex'; App.codexTab = App.codexTab || 'monsters'; render(); },
    'sheet:tab': (d) => { App.sheetTab = d.tab; render(); },
    'log:toggle': () => { App.logFull = !App.logFull; render(); },
    'codex:tab': (d) => { App.codexTab = d.tab; render(); },
    'codex:clear': () => { NK.Codex.clear(); toast('图鉴已清空。'); render(); },
    'rec:clear': () => { NK.Codex.clearRecords(); toast('记录已清空。'); render(); },
    'node': (d) => {
      const r = NK.Run.enterNode(App.run, d.id);
      if (!r.ok) { toast(r.msg); return; }
      if (App.run.restMsg) { toast(App.run.restMsg); App.run.restMsg = null; }
      busyScreen();
      render();
    },

    /* 战斗 */
    'b:attack': () => { App.lastActionKey = 'attack'; NK.Combat.playerAction(App.run._combat, { type: 'attack', target: App.targetUid }); render(); },
    'b:do': () => {
      const run = App.run;
      const c = run._combat;
      const acts = NK.Combat.availableActions(c);
      const opts = [];
      for (const s of acts.spells) if (s.ok) opts.push({ kind: 'spell', id: s.spell.id, slot: s.slot, need: s.spell.action === '附赠动作' ? 'bonus' : 'action' });
      for (const s of acts.upcast) opts.push({ kind: 'spell', id: s.spell.id, slot: s.slot, need: 'action' });
      for (const b of acts.bonus) opts.push({ kind: 'bonus', id: b.id, need: 'bonus' });
      for (const x of acts.items) opts.push({ kind: 'item', index: x.index, need: 'action' });
      const usable = opts.filter((o) => (o.need === 'bonus' ? c.turn.bonus : c.turn.action));
      const o = usable[App.selAction || 0];
      if (!o) { toast('本回合没有可执行的动作。'); return; }
      if (o.kind === 'spell') NK.Combat.playerAction(c, { type: 'cast', spellId: o.id, slot: o.slot, target: App.targetUid });
      else if (o.kind === 'bonus') NK.Combat.playerAction(c, { type: 'bonus', id: o.id, target: App.targetUid });
      else NK.Combat.playerAction(c, { type: 'item', index: o.index, target: App.targetUid });
      App.lastActionKey = actionKey(o);   // 记住这一手，下一回合自动选中同一个
      App.selAction = 0;
      render();
    },
    'b:move': (d) => { NK.Combat.playerAction(App.run._combat, { type: 'move', dir: d.dir }); render(); },
    'b:delay': () => { NK.Combat.playerAction(App.run._combat, { type: 'delay' }); render(); },
    'b:dodge': () => { NK.Combat.playerAction(App.run._combat, { type: 'dodge' }); render(); },
    'b:end': () => { NK.Combat.playerAction(App.run._combat, { type: 'endTurn' }); render(); },
    'b:pass': () => { NK.Combat.playerAction(App.run._combat, { type: 'endTurn' }); render(); },
    'b:bonus': (d) => { NK.Combat.playerAction(App.run._combat, { type: 'bonus', id: d.id, target: App.targetUid }); render(); },
    'b:cast': (d) => { App.lastActionKey = `spell:${d.id}:${parseInt(d.slot, 10)}`; NK.Combat.playerAction(App.run._combat, { type: 'cast', spellId: d.id, slot: parseInt(d.slot, 10), target: App.targetUid }); render(); },
    'b:item': (d) => { NK.Combat.playerAction(App.run._combat, { type: 'item', index: parseInt(d.index, 10), target: App.targetUid }); render(); },
    'target': (d) => { App.targetUid = d.uid; render(); },
    'b:continue': () => {
      const run = App.run;
      const c = run._combat;
      App.logFull = false;   // 新战斗默认折叠日志
      const res = NK.Run.finishBattle(run, c);
      if (res.defeat || run.ended) { finishRun(); return; }
      if (res.lines && res.lines.length) toast(res.lines[res.lines.length - 1]);
      busyScreen();
      render();
    },

    /* 事件 */
    'ev:opt': (d) => {
      const run = App.run;
      const opt = run.event.options[parseInt(d.index, 10)];
      const req = NK.Events.checkRequire(run, opt);
      if (!req.ok) { toast(req.msg); return; }
      const out = NK.Events.resolve(run, opt, run.rng);
      const lines = NK.Events.applyEffect(run, out.effect, run.rng);
      run.eventResult = { opt, out, lines };
      if (out.effect.fight) run.pendingFight = out.effect.fight;
      NK.Run.save(run);
      render();
    },
    'ev:next': () => {
      const run = App.run;
      const node = NK.Run.node(run);
      if (run.pendingFight) {
        const kind = run.pendingFight; run.pendingFight = null;
        NK.Run.startBattle(run, kind);
        App.targetUid = null;
        App.screen = 'battle'; render(); return;
      }
      run.event = null; run.eventResult = null;
      if (node) node.done = true;
      run.state = 'map';
      if (run.forceDown) { run.ended = true; run.victory = false; run.deathCause = '事件中的伤势'; finishRun(); return; }
      NK.Run.save(run);
      busyScreen();
      render();
    },

    /* 商店 */
    buy: (d) => {
      const run = App.run;
      const all = run.shop.items.concat(run.shop.consumables, run.shop.services);
      const entry = all.find((x) => x.id === d.id);
      if (!entry) return;
      const r = NK.Shop.buy(run, entry);
      toast(r.msg); render();
    },
    'shop:leave': () => {
      const run = App.run;
      const node = NK.Run.node(run);
      if (node) node.done = true;
      run.state = 'map'; run.shop = null;
      NK.Run.save(run);
      busyScreen(); render();
    },

    /* 休整 */
    'rest:short': (d) => {
      const n = parseInt(d.n || '1', 10);
      App.lastRestDice = n;   // 记住上次投了几颗，下次营地默认还是这个数
      const r = NK.Run.restShort(App.run, n);
      toast(r.msg); render();
    },
    'rest:long': () => {
      const r = NK.Run.restLong(App.run);
      toast(r.msg);
      if (r.ok && App.run.needReprepare) { App.prepSel = (App.run.player.prepared || []).slice(); App.screen = 'prepare'; }
      render();
    },
    'p:toggle': (d) => {
      const sel = App.prepSel || (App.prepSel = []);
      const i = sel.indexOf(d.id);
      if (i >= 0) sel.splice(i, 1); else sel.push(d.id);
      render();
    },
    'p:done': () => {
      const run = App.run;
      if (!run) return;
      const res = R.resetPrepared(run.player, App.prepSel || []);
      toast(res.msg);
      App.prepSel = null;
      run.needReprepare = false;
      const node = NK.Run.node(run);
      if (node) node.done = true;
      run.state = 'map';
      NK.Run.save(run);
      App.screen = 'map';
      busyScreen(); render();
    },
    'p:keep': () => {
      const run = App.run;
      if (!run) return;
      App.prepSel = null;
      run.needReprepare = false;
      const node = NK.Run.node(run);
      if (node) node.done = true;
      run.state = 'map';
      NK.Run.save(run);
      App.screen = 'map';
      busyScreen(); render();
    },
    'rest:none': () => {
      const run = App.run;
      const node = NK.Run.node(run);
      if (node) node.done = true;
      run.state = 'map';
      NK.Run.save(run);
      busyScreen(); render();
    },

    /* 宝库 */
    'tr:continue': () => {
      const run = App.run;
      if (!run) { App.screen = 'title'; render(); return; }
      run.treasureResult = null;
      if (run.ended) { finishRun(); return; }
      busyScreen(); render();
    },

    /* 升级 */
    'l:classlevel': (d) => { const r = NK.Run.resolveChoice(App.run, { classId: d.id }); toast(r.msg); render(); },
    'l:subclass': (d) => { const r = NK.Run.resolveChoice(App.run, { subclass: d.id }); toast(r.msg); App.asiDraft = null; render(); },
    'l:invocation': (d) => { const r = NK.Run.resolveChoice(App.run, { id: d.id }); toast(r.msg); App.asiDraft = null; render(); },
    'l:metamagic': (d) => { const r = NK.Run.resolveChoice(App.run, { id: d.id }); toast(r.msg); App.asiDraft = null; render(); },
    'l:pactboon': (d) => { const r = NK.Run.resolveChoice(App.run, { id: d.id }); toast(r.msg); App.asiDraft = null; render(); },
    'l:feat': (d) => { const r = NK.Run.resolveChoice(App.run, { feat: d.id }); toast(r.msg); App.asiDraft = null; render(); },
    'l:style': (d) => { const r = NK.Run.resolveChoice(App.run, { style: d.id }); toast(r.msg); render(); },
    'l:expertise': (d) => { const r = NK.Run.resolveChoice(App.run, { skill: d.id }); toast(r.msg); render(); },
    'l:spell': (d) => { const r = NK.Run.resolveChoice(App.run, { spell: d.id }); toast(r.msg); render(); },
    'l:attr:add': (d) => {
      App.asiDraft = App.asiDraft || { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
      const used = Object.keys(App.asiDraft).reduce((a, k) => a + App.asiDraft[k], 0);
      if (used >= 2) return;
      App.asiDraft[d.k] += 1;
      render();
    },
    'l:attr:sub': (d) => {
      App.asiDraft = App.asiDraft || { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
      if (App.asiDraft[d.k] > 0) App.asiDraft[d.k] -= 1;
      render();
    },
    'l:asi': () => {
      const alloc = {};
      for (const k of Object.keys(App.asiDraft)) if (App.asiDraft[k] > 0) alloc[k] = App.asiDraft[k];
      const r = NK.Run.resolveChoice(App.run, { alloc });
      toast(r.msg); App.asiDraft = null; render();
    },
    'l:done': () => {
      const run = App.run;
      if (R.pendingChoices(run.player).length) { render(); return; }
      run.state = 'map';
      NK.Run.save(run);
      busyScreen(); render();
    },

    /* 通用 */
    'open:sheet': () => { App.modal = 'sheet'; render(); },
    'open:bag': () => { App.modal = 'bag'; render(); },
    'open:help': () => { App.modal = 'help'; render(); },
    close: () => { App.modal = null; render(); },
    equip: (d) => {
      const it = App.run.player.bag[parseInt(d.index, 10)];
      if (!it) { render(); return; }
      const res = NK.Run.equip(App.run, it, d.slot);
      toast(res.ok ? res.msg : res.msg);
      render();
    },
    unequip: (d) => {
      const idx = d.index === '' || d.index === undefined ? undefined : parseInt(d.index, 10);
      const it = NK.Run.unequip(App.run, d.slot, idx);
      if (it) toast(`卸下了 ${it.name}。${R.interference(App.run.player) ? ` 能量干涉 -${R.interference(App.run.player)}。` : ''}`);
      render();
    },
    sell: (d) => { const it = App.run.player.bag[parseInt(d.index, 10)]; if (it) { const r = NK.Run.sell(App.run, it); toast(r.msg); } render(); },
    use: (d) => { const r = NK.Run.useConsumable(App.run, parseInt(d.index, 10)); toast(r.msg); render(); },
    copy: (d) => { const r = NK.Run.copyScroll(App.run, parseInt(d.index, 10)); toast(r.msg); render(); },
    'save:quit': () => { NK.RunStore.save(App.run); App.run = null; App.screen = 'title'; toast('已保存。'); render(); },
    'o:again': () => { App.run = null; App.overSummary = null; startCreate(lastBuild()); render(); },
  };

  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (e.target.closest('.modal') && t.dataset.act === 'close' && t.classList.contains('modal-bg')) return;
    const fn = actions[t.dataset.act];
    if (!fn) return;
    e.preventDefault();
    fn(t.dataset, t);
  }

  function onChange(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'sel:action') { App.selAction = parseInt(t.value, 10) || 0; render(); }
  }

  function onKey(e) {
    if (e.key === 'Escape') { if (App.modal) { App.modal = null; render(); } return; }
    if (App.screen !== 'battle' || App.modal) return;
    const c = App.run && App.run._combat;
    if (!c || c.over || c.player.dying) return;
    if (e.key === '1') actions['b:attack']();
    else if (e.key === 'Enter') { e.preventDefault(); actions['b:do'](); }
    else if (e.key.toLowerCase() === 'q') actions['b:dodge']();
    else if (e.key.toLowerCase() === 'e') { App.modal = 'bag'; render(); }
    else if (e.key.toLowerCase() === 'c') { App.modal = 'sheet'; render(); }
    else if (e.key === ' ') { e.preventDefault(); actions['b:end'](); }
    else if (/^[2-9]$/.test(e.key)) {
      const acts = NK.Combat.availableActions(c);
      const list = acts.spells.filter((s) => s.ok);
      const s = list[parseInt(e.key, 10) - 2];
      if (s) actions['b:cast']({ id: s.spell.id, slot: String(s.slot) });
    }
  }

  NK.UI = {
    App, render, toast, onClick, onKey,
    act(name, data) { const fn = actions[name]; if (!fn) throw new Error('未知动作: ' + name); return fn(data || {}); },
    init() {
      App.screen = 'title';
      App.create = newCreate();
      App.selAction = 0;
      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);
      document.addEventListener('keydown', onKey);
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);

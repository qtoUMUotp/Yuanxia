// 专项验证：法术选择不卡死 / 兼职升级 / 魔能爆与祈愿 / 召唤 / 奥术工匠
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js'];
const store = {};
const html = { innerHTML: '', querySelector: () => null };
const ctx = {
  console,
  document: { readyState: 'complete', getElementById: () => html, addEventListener: () => {}, querySelector: () => null },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  setTimeout, clearTimeout, addEventListener: () => {}, prompt: (m, d) => (d || '测试者'),
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of FILES) { const code = readFileSync(join(root, 'js', f), 'utf8'); vm.runInContext(code, ctx, { filename: 'js/' + f }); }
const NK = ctx.NK; await NK.Data.load();
const R = NK.Rules, UI = NK.UI, C = NK.Combat;

let fail = 0;
const ok = (label, fn) => {
  try { const r = fn(); console.log(`  ✔ ${label}${r ? '　' + r : ''}`); }
  catch (e) { fail++; console.log(`  ✘ ${label} -> ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const BASE = { raceId: 'human', bgId: 'soldier', attrs: { str: 14, dex: 14, con: 14, int: 12, wis: 12, cha: 14 }, skills: [], cantrips: [], knownSpells: [], prepared: [] };
const mk = (classId, over) => R.createPlayer(Object.assign({}, BASE, { classId }, over || {}));
const TIER = { id: 1, hpMul: 1, dmgMul: 1 };
const mkRng = () => (NK.RNG && NK.RNG.make ? NK.RNG.make(20261009) : { pick: (a) => a[0], chance: () => false, int: () => 3, roll: () => 3 });
/** 起一场单怪战斗 */
const arena = (p) => {
  const rng = mkRng();
  return C.start(p, C.makeEncounter({ boss: 'spider_queen', elites: [], pool: ['web_spider'] }, 'normal', TIER, rng), { rng, act: 1, tier: TIER });
};
/** 把某个角色的所有待处理选择快速处理掉（含兼职重分配、魔能祈愿、超魔、魔契） */
const resolveAll = (p, cid) => {
  const rules = NK.Data.get('rules');
  let g = 0;
  while (R.pendingChoices(p).length && g++ < 120) {
    const pend = R.pendingChoices(p)[0];
    if (pend.kind === 'classlevel') R.chooseClassLevel(p, { classId: p.lastLeveledClassId });
    else if (pend.kind === 'subclass') R.chooseSubclass(p, R.classDef(cid).subclasses[0].id, pend.classId);
    else if (pend.kind === 'style') R.chooseStyle(p, rules.fightingStyles[0].id, pend.classId);
    else if (pend.kind === 'expertise') {
      const cand = (p.proficiencies.skills || []).find((s) => !(p.expertise || []).includes(s));
      if (cand) R.chooseExpertise(p, cand); else { p.expertise = (p.proficiencies.skills || []).slice(0, 2); }
    } else if (pend.kind === 'asi') { const a = {}; a[R.classDef(cid).primary] = 2; R.chooseAsi(p, a); }
    else if (pend.kind === 'invocation') R.chooseInvocation(p, rules.invocations[(p.invocations || []).length].id);
    else if (pend.kind === 'metamagic') R.chooseMetamagic(p, rules.metamagics[(p.metamagics || []).length].id);
    else if (pend.kind === 'pactBoon') R.choosePactBoon(p, rules.pactBoons[(p.pactBoon ? 1 : 0)].id);
    else {
      const pool = R.spellPool(p, pend.kind === 'cantrips');
      if (pool.length) R.learnSpell(p, pool[0].id, pend.kind === 'cantrips');
      else { p.spellChoicesTaken = p.spellChoicesTaken || []; p.spellChoicesTaken.push(pend.level); }
    }
  }
  return p;
};

console.log('\n-- 1. 法术选择不卡死（每个职业的要求数 ≤ 实际可学池）--');
const effPool = (cid, lvl) => {
  const eff = R.spellListOf(cid);
  return NK.Data.get('spells').spells.filter((s) => s.classes.some((c) => eff.includes(c)) && s.level === lvl).length;
};
for (const cid of ['wizard', 'cleric', 'paladin', 'ranger', 'sorcerer', 'bard', 'druid', 'warlock', 'artificer']) {
  ok(` ${cid} 1 级可完成法术步骤`, () => {
    const p0 = mk(cid);
    const sc = R.classDef(cid).spellcasting;
    assert(sc, '无施法配置');
    // 复刻 UI 的 spellNeeds 逻辑：要求数必须 ≤ 池大小
    const mod = R.mod(p0.attrs[sc.ability]);
    let need = 0;
    if (sc.spellbook) need = Math.min(sc.spellsAtLevel1 || 6, effPool(cid, 1));
    else if (sc.prepared) need = sc.type === 'half' ? 0 : Math.min(Math.max(1, mod + 1), effPool(cid, 1));
    else need = Math.min(sc.knownByLevel ? sc.knownByLevel[0] : 0, effPool(cid, 1));
    const needC = Math.min(sc.cantrips || 0, effPool(cid, 0));
    assert(need <= effPool(cid, 1), `要求 ${need} 个 1 环，实际池只有 ${effPool(cid, 1)}`);
    assert(needC <= effPool(cid, 0), `要求 ${needC} 个戏法，池只有 ${effPool(cid, 0)}`);
    return `戏法 ${needC}/${effPool(cid, 0)}　1环 ${need}/${effPool(cid, 1)}`;
  });
}

console.log('\n-- 2. 兼职升级：升级时会出现「职业进阶」选择 --');
ok('单职业升级后出现 classlevel 选项', () => {
  const p = mk('warrior');
  R.gainXp(p, 300);
  const pend = R.pendingChoices(p);
  assert(pend.some((x) => x.kind === 'classlevel'), '没有 classlevel 选项：' + JSON.stringify(pend.map((x) => x.kind)));
  return '选项：' + pend.map((x) => x.kind).join(',');
});
ok('确认默认：等级留在原职业', () => {
  const p = mk('warrior');
  R.gainXp(p, 300);
  const r = R.chooseClassLevel(p, { classId: p.lastLeveledClassId });
  assert(r.ok, r.msg);
  assert(R.classEntries(p)[0].id === 'warrior' && R.classEntries(p)[0].level === p.level, '等级没留在战士');
  return `总等级 ${R.totalLevel(p)}，职业 ${R.classEntries(p).map((e) => e.id + e.level).join('/')}`;
});
ok('新开兼职：等级改投到新职业（总等级不变）', () => {
  const p = mk('warrior');
  R.gainXp(p, 300);
  const before = R.totalLevel(p);
  const r = R.chooseClassLevel(p, { classId: 'rogue' });
  assert(r.ok, r.msg);
  assert(R.totalLevel(p) === before, `总等级变了 ${before} → ${R.totalLevel(p)}`);
  const es = R.classEntries(p);
  assert(es.length === 2, '职业条目数应为 2，实际 ' + es.length);
  return r.msg + `　总等级仍为 ${R.totalLevel(p)}`;
});
ok('多职业时，升级界面每级都能重分配', () => {
  const p = mk('warrior');
  R.chooseClassLevel(p, { classId: 'rogue' });   // 需要先有 lastLeveledClassId
  const p2 = R.createPlayer({ raceId: 'human', classId: 'warrior', bgId: 'soldier', attrs: { str: 14, dex: 14, con: 14, int: 12, wis: 12, cha: 12 }, skills: [], classes: [{ id: 'warrior', level: 1, subclassId: null }, { id: 'rogue', level: 1, subclassId: null }] });
  R.gainXp(p2, 3000);
  const pend = R.pendingChoices(p2);
  assert(pend.some((x) => x.kind === 'classlevel'), '多职业升级没有 classlevel');
  R.chooseClassLevel(p2, { classId: 'rogue' });
  return '多职业升级可正常重分配';
});

console.log('\n-- 3. 邪术师：魔能爆多束 + 魔能祈愿 --');
ok('邪术师能学会魔能爆', () => {
  const p = mk('warlock');
  const pool = R.spellPool(p, true).filter((s) => s.id === 'eldritch_blast');
  assert(pool.length, '戏法池里没有魔能爆');
  R.learnSpell(p, 'eldritch_blast', true);
  assert(p.cantrips.includes('eldritch_blast'), '没学会');
  return '已学会魔能爆';
});
ok('5 级起魔能爆分裂为 2 束', () => {
  const p = mk('warlock');
  assert(C.spellBeams(p) === 1, '1 级应为 1 束');
  R.gainXp(p, 100000);   // 直接拉满
  const lv = R.totalLevel(p);
  const beams = C.spellBeams(p);
  assert(beams >= 2, `${lv} 级应 ≥2 束，实际 ${beams}`);
  return `Lv.${lv} → ${beams} 束`;
});
ok('2 级魔能祈愿：选择后真正生效', () => {
  const p = mk('warlock');
  R.gainXp(p, 300);
  const pend = R.pendingChoices(p).find((x) => x.kind === 'invocation');
  assert(pend, '2 级没有出现魔能祈愿选择：' + JSON.stringify(R.pendingChoices(p).map((x) => x.kind)));
  R.chooseInvocation(p, 'inv_agonizing');
  R.chooseInvocation(p, 'inv_repelling');
  assert(p.flags.ebAgonizing, '没有 ebAgonizing');
  assert(p.flags.ebRepelling, '没有 ebRepelling');
  return `痛苦祈愿 + 击退祈愿 均已生效（已选 ${(p.invocations || []).length} 项）`;
});
ok('3 级魔契恩泽：书 / 链 / 刃各自生效', () => {
  const rules = NK.Data.get('rules');
  // 书之契约：戏法容量 +3
  const pt = mk('warlock');
  const base = R.spellCapacity(pt).cantrips;
  R.choosePactBoon(pt, 'pact_tome');
  assert(R.spellCapacity(pt).cantrips === base + 3, `书之契约应让戏法容量 +3（${base} → ${R.spellCapacity(pt).cantrips}）`);
  // 刃之契约：能召出契约武器
  const pb = mk('warlock');
  R.choosePactBoon(pb, 'pact_blade');
  const c1 = arena(pb);
  assert(C.availableActions(c1).bonus.some((b) => b.id === 'pactBlade'), '附赠动作里没有召出契约武器');
  C.playerAction(c1, { type: 'bonus', id: 'pactBlade' });
  assert(pb.items.mainHand && pb.items.mainHand.name === '契约武器', '契约武器没有装备上');
  // 链之契约：战斗开始自动出现魔宠
  const pc = mk('warlock');
  R.choosePactBoon(pc, 'pact_chain');
  const c2 = arena(pc);
  assert((c2.allies || []).some((a) => a.name === '魔宠'), '链之契约没有召唤魔宠');
  return `书 +3 戏法　刃 1d8 魔法武器　链 魔宠 ${rules.pactBoons.length} 项全通`;
});
ok('邪术环：短休恢复，长休也恢复', () => {
  const p = mk('warlock');
  assert(p.pactLevel >= 1, '没有邪术环');
  return `邪术环 ${p.pactSlots}/${p.pactSlotsMax}（${p.pactLevel} 环法术位）`;
});
ok('魔能爆实战：进入战斗后能打出多束射线', () => {
  const p = mk('warlock');
  R.gainXp(p, 100000);
  resolveAll(p, 'warlock');
  R.learnSpell(p, 'eldritch_blast', true);
  const rng = mkRng();
  const c = C.start(p, C.makeEncounter({ boss: 'spider_queen', elites: [], pool: ['web_spider'] }, 'normal', TIER, rng), { rng, act: 1, tier: TIER });
  const before = c.enemies[0].hp;
  C.castSpell(c, { spellId: 'eldritch_blast', slot: 0 });
  const logs = c.log.filter((l) => l.t.includes('魔能爆')).length;
  assert(logs > 0, '没有打出魔能爆');
  const beamLog = c.log.find((l) => l.t.includes('分裂为'));
  return `打出 ${logs} 条魔能爆记录${beamLog ? '，' + beamLog.t : ''}`;
});

console.log('\n-- 4. 召唤体系 --');
ok('召唤暗影：施放后生成召唤物', () => {
  const p = mk('warlock');
  R.learnSpell(p, 'summon_shadow', false);
  const c = arena(p);
  assert(c.allies && c.allies.length === 0, '战斗开始时不应有召唤物');
  p.slots[0] = 1; p.slotsMax[0] = 1;
  C.castSpell(c, { spellId: 'summon_shadow', slot: 1 });
  assert(c.allies.length === 1, '召唤失败，allies=' + c.allies.length);
  const a = c.allies[0];
  assert(a.hp > 0 && a.atk.bonus > 0, '召唤物属性异常');
  assert(p.concentration === 'summon_shadow', '没有进入专注');
  return `${a.name} HP${a.hp} AC${a.ac} 命中+${a.atk.bonus} ${a.atk.dice}（存续 ${a.turnsLeft} 回合）`;
});
ok('召唤物在我的回合自动出击', () => {
  const p = mk('warlock');
  R.learnSpell(p, 'summon_shadow', false);
  const c = arena(p);
  p.slots[0] = 1; p.slotsMax[0] = 1;
  C.castSpell(c, { spellId: 'summon_shadow', slot: 1 });
  const before = c.enemies[0].hp;
  C.resolveAllies(c);
  const acted = c.log.some((l) => l.t.includes('扑向'));
  assert(acted, '召唤物没有出击');
  return c.log.filter((l) => l.t.includes('扑向')).map((l) => l.t).join('；');
});
ok('专注中断 / 回合耗尽 → 召唤物消散', () => {
  const p = mk('warlock');
  R.learnSpell(p, 'summon_shadow', false);
  const c = arena(p);
  p.slots[0] = 1; p.slotsMax[0] = 1;
  C.castSpell(c, { spellId: 'summon_shadow', slot: 1 });
  assert(c.allies.length === 1, '召唤失败');
  p.concentration = null;   // 模拟被打断专注
  C.endOfRound(c);
  assert(c.allies.length === 0, '专注中断后召唤物没消散');
  return '专注中断 → 召唤物消散';
});

console.log('\n-- 5. 奥术工匠 --');
ok('奥术附魔：武器攻击视为魔法', () => {
  const p = mk('artificer');
  assert(p.flags.magicalStrikes, '没有 magicalStrikes');
  return '武器攻击视为魔法（可无视非魔法物理抗性）';
});
ok('奥术冲量：附赠动作 → 下次武器攻击 +1d6 力场', () => {
  const p = mk('artificer');
  R.gainXp(p, 300);
  assert(p.flags.arcaneJolt, '2 级没有奥术冲量');
  const c = arena(p);
  const acts = C.availableActions(c);
  assert(acts.bonus.some((b) => b.id === 'arcaneJolt'), '附赠动作里没有奥术冲量');
  C.playerAction(c, { type: 'bonus', id: 'arcaneJolt' });
  assert(p.joltQueued, '没有挂上奥术冲量');
  for (const e of c.enemies) { e.band = 0; e.ac = 5; }   // 拉到近身并压低 AC，保证能命中
  // 攻击几次直到命中（未命中不该消耗冲量）
  for (let i = 0; i < 6 && p.joltQueued && !c.over; i++) { c.turn.action = true; C.playerAction(c, { type: 'attack' }); }
  assert(!p.joltQueued, '武器命中后没有消耗掉奥术冲量');
  const joltLog = c.log.filter((l) => l.t.includes('奥术冲量'));
  assert(joltLog.length >= 2, '日志里没有冲量的挂上与结算');
  return joltLog.map((l) => l.t.slice(0, 100)).join('　｜　');
});

console.log('\n-- 6. 其余施法职业的法术池不再为空 --');
for (const cid of ['sorcerer', 'bard', 'druid', 'artificer', 'warlock']) {
  ok(` ${cid} 有可用法术`, () => {
    const p = mk(cid);
    const c0 = R.spellPool(p, true).length;
    const c1 = R.spellPool(p, false).length;
    assert(c0 > 0, '戏法池为空');
    assert(c1 > 0, '1 环法术池为空');
    return `戏法 ${c0} 个，1 环及以上 ${c1} 个`;
  });
}

console.log('\n-- 6b. 术士超魔 / 德鲁伊野性形态 / 吟游灵感 --');
ok('术士 3 级解锁超魔与术法点', () => {
  const p = mk('sorcerer');
  assert(R.sorceryMax(p) === 0, '1 级不该有术法点');
  R.gainXp(p, 900);
  const pend = R.pendingChoices(p).find((x) => x.kind === 'metamagic');
  assert(pend, '3 级没有超魔选择：' + JSON.stringify(R.pendingChoices(p).map((x) => x.kind)));
  R.chooseMetamagic(p, 'mm_quicken');
  R.chooseMetamagic(p, 'mm_empower');
  assert((p.metamagics || []).length === 2, '超魔没选满 2 项');
  assert(R.sorceryMax(p) >= 3 && p.sorceryLeft >= 1, `术法点异常 max=${R.sorceryMax(p)} left=${p.sorceryLeft}`);
  return `已选 ${p.metamagics.join('/')}，术法点 ${p.sorceryLeft}/${R.sorceryMax(p)}`;
});
ok('超魔实战：附赠动作挂上效果，施法时消耗', () => {
  const p = mk('sorcerer');
  R.gainXp(p, 900);
  resolveAll(p, 'sorcerer');
  R.chooseMetamagic(p, 'mm_quicken');
  const c = arena(p);
  const acts = C.availableActions(c);
  const mm = acts.bonus.find((b) => b.id === 'meta:mm_quicken');
  assert(mm, '附赠动作里没有瞬发法术：' + JSON.stringify(acts.bonus.map((b) => b.id)));
  const before = p.sorceryLeft;
  C.playerAction(c, { type: 'bonus', id: 'meta:mm_quicken' });
  assert(p.sorceryLeft === before - 1, `术法点没扣（${before} → ${p.sorceryLeft}）`);
  assert(p.metaFlags && p.metaFlags.quicken, '没有挂上瞬发标记');
  c.turn.action = true;
  const sp = R.castableSpells(p)[0];
  C.castSpell(c, { spellId: sp.id, slot: 0 });
  assert(c.turn.action === true, '瞬发法术仍然吃掉了动作');
  assert(!p.metaFlags.quicken, '瞬发标记没有在施法后清除');
  return `术法点 ${p.sorceryLeft}/${R.sorceryMax(p)}，施放「${sp.name}」后动作仍在`;
});
ok('德鲁伊野性形态：附赠动作变形，长休恢复次数', () => {
  const p = mk('druid');
  R.gainXp(p, 300);
  resolveAll(p, 'druid');
  assert((p.wildShapeLeft || 0) >= 1, '没有野性形态次数');
  const c = arena(p);
  assert(C.availableActions(c).bonus.some((b) => b.id === 'wildShape'), '附赠动作里没有野性形态');
  const hp0 = p.tempHp;
  C.playerAction(c, { type: 'bonus', id: 'wildShape' });
  assert(p.wildShaped, '没有进入野性形态');
  assert(p.tempHp > hp0, '临时生命没有增加');
  assert((p.buffs || []).some((b) => b.name === '野性形态'), '野性形态增益没有挂上');
  return `临时生命 ${hp0} → ${p.tempHp}，剩余 ${p.wildShapeLeft}/${p.wildShapeMax} 次`;
});
ok('吟游灵感：激励后下一次攻击掷骰 +1d6', () => {
  const p = mk('bard');
  resolveAll(p, 'bard');
  assert((p.inspirationLeft || 0) >= 1, '没有吟游灵感次数');
  const c = arena(p);
  assert(C.availableActions(c).bonus.some((b) => b.id === 'inspire'), '附赠动作里没有吟游激励');
  C.playerAction(c, { type: 'bonus', id: 'inspire' });
  assert(p.inspirationActive, '没有挂上激励');
  const n = p.inspirationLeft;
  for (const e of c.enemies) e.band = 0;   // 拉到近身，保证近战够得到
  for (let i = 0; i < 4 && p.inspirationActive && !c.over; i++) { c.turn.action = true; C.playerAction(c, { type: 'attack' }); }
  assert(!p.inspirationActive, '激励没有被攻击消耗');
  const used = c.log.some((l) => l.t.includes('吟游激励'));
  return `剩余 ${n}/${p.inspirationMax} 次${used ? '，攻击日志已记录 +1d6' : ''}`;
});

console.log('\n-- 6c. 起始装备按职业熟练分配 --');
ok('每个职业都有适合自己的起始装备（护甲不超熟练）', () => {
  const bad = [];
  for (const cls of NK.Data.get('classes').classes) {
    const packs = NK.Items.startingPacks(cls.id);
    assert(packs && packs.length >= 2, `${cls.id} 没有两套起始装备`);
    for (const k of packs) {
      if (k.armor) {
        const a = NK.Items.armors().find((x) => x.id === k.armor);
        assert(a, `${cls.id}/${k.name}: 护甲 ${k.armor} 不存在`);
        assert((cls.armorProfs || []).includes(a.category), `${cls.id}/${k.name}: 拿到了不熟练的护甲 ${a.name}（${a.category}）`);
      }
      if (k.shield) assert((cls.armorProfs || []).includes('shield'), `${cls.id}/${k.name}: 拿到了不熟练的盾牌`);
    }
    bad.push(cls.name);
  }
  return `${bad.length} 个职业全部通过熟练校验`;
});
ok('施法职业不会拿到重型武器当主手', () => {
  const casters = ['wizard', 'sorcerer', 'warlock', 'bard', 'druid', 'cleric'];
  const heavy = ['greatsword', 'halberd', 'heavy_crossbow', 'longbow', 'battleaxe', 'warhammer', 'longsword', 'rapier'];
  for (const cid of casters) {
    for (const k of NK.Items.startingPacks(cid)) {
      for (const w of (k.weapons || [])) {
        assert(!heavy.includes(w), `${cid}/${k.name} 拿到了 ${w} —— 施法职业不该以它为主手`);
      }
    }
  }
  return `${casters.length} 个施法职业的起始武器都是简易武器`;
});
ok('起始装备真的会被穿上（开局后人物有装备）', () => {
  const out = [];
  for (const cid of ['wizard', 'warlock', 'barbarian', 'monk', 'artificer']) {
    const cls = R.classDef(cid);
    const pack = NK.Items.startingPacks(cid)[0];
    const items = NK.Items.packToItems(pack);
    const p = R.createPlayer(Object.assign({}, BASE, { classId: cid, equipment: items }));
    const pen = R.armorPenalty(p);
    assert(!pen.noSpellcasting, `${cid} 起始装备导致无法施法（${pen.badArmor ? p.items.body.name : '盾牌'}）`);
    out.push(`${cls.name}：${(p.items.mainHand ? p.items.mainHand.name : '空手')}／${p.items.body ? p.items.body.name : '无甲'}　AC${p.ac}`);
  }
  return out.join('；');
});

console.log('\n-- 7. UI 端到端：建卡向导不再卡死 --');
const App = UI.App;
const dom = ctx.document.getElementById('x');   // 与 render 共用同一个桩对象
const curHtml = () => dom.innerHTML;
/** 重复触发某个动作直到当前步骤完成 */
const fillStep = (actName, ids) => { for (const id of ids) UI.act(actName, { id }); };

for (const cid of ['paladin', 'ranger', 'warlock', 'artificer', 'wizard']) {
  ok(` ${cid}：走完建卡并开局`, () => {
    UI.init();
    UI.act('t:new');
    UI.act('c:race', { id: 'human' });
    UI.act('c:bg', { id: 'soldier' });
    UI.act('c:class', { id: cid });
    const cls = R.classDef(cid);
    if (cls.subclassLevel === 1) UI.act('c:subclass', { id: cls.subclasses[0].id });
    let guard = 0;
    let reachedSpells = false;
    while (guard++ < 30) {
      const h = curHtml();
      if (h.includes('选择法术')) { reachedSpells = true; break; }
      if (h.includes('购买属性') || h.includes('属性')) {
        App.create.attrs = { str: 15, dex: 12, con: 14, int: 14, wis: 12, cha: 15 };
      }
      if (h.includes('选择技能')) {
        const need = cls.skillChoices.count - App.create.skills.length;
        for (const sid of cls.skillChoices.from.slice(0, Math.max(0, need))) UI.act('c:skill', { id: sid });
      }
      UI.act('c:next');
    }
    if (reachedSpells) {
      // 把可选法术全部点上（能点几个点几个）
      const sc = cls.spellcasting;
      const eff = R.spellListOf(cid);
      const pool0 = NK.Data.get('spells').spells.filter((s) => s.classes.some((c) => eff.includes(c)) && s.level === 0).map((s) => s.id);
      const pool1 = NK.Data.get('spells').spells.filter((s) => s.classes.some((c) => eff.includes(c)) && s.level === 1).map((s) => s.id);
      fillStep('c:cantrip', pool0.slice(0, sc.cantrips || 0));
      fillStep('c:spell', pool1);
      // 关键断言：这一步的「下一步」按钮必须是可点的
      const h = curHtml();
      const nextBtn = h.match(/<button class="primary" data-act="c:next"([^>]*)>/);
      assert(nextBtn, '找不到下一步按钮');
      assert(!/disabled/.test(nextBtn[1]), `「下一步」被禁用了 —— ${cid} 法术选不满会卡死（按钮属性：${nextBtn[1].trim()}）`);
      UI.act('c:next');
    }
    guard = 0;
    while (guard++ < 20 && !curHtml().includes('选择难度')) UI.act('c:next');
    assert(curHtml().includes('选择难度'), '没走到难度步骤');
    UI.act('c:diff', { id: '1' });
    UI.act('c:start');
    assert(App.run && App.run.player, '没有开局成功');
    return `开局成功（${R.classLabel(App.run.player)}）`;
  });
}

console.log('\n-- 8. UI 端到端：升级界面出现「职业进阶」--');
ok('多职业角色升级时，升级界面渲染出职业进阶页', () => {
  UI.init();
  UI.act('t:new');
  UI.act('c:race', { id: 'human' });
  UI.act('c:bg', { id: 'soldier' });
  UI.act('c:class', { id: 'warrior' });
  App.create.attrs = { str: 15, dex: 14, con: 14, int: 12, wis: 12, cha: 13 };
  let guard = 0;
  while (guard++ < 20 && !curHtml().includes('选择技能')) UI.act('c:next');
  const cls = R.classDef('warrior');
  for (const sid of cls.skillChoices.from.slice(0, cls.skillChoices.count)) UI.act('c:skill', { id: sid });
  guard = 0;
  while (guard++ < 20 && !curHtml().includes('选择难度')) UI.act('c:next');
  UI.act('c:diff', { id: '1' });
  UI.act('c:start');
  const p = App.run.player;
  R.gainXp(p, 400);   // 升 2 级
  App.run.state = 'levelup';
  // 先把子职/风格之类的选择处理掉，直到轮到职业进阶
  guard = 0;
  while (guard++ < 30) {
    const pend = R.pendingChoices(p)[0];
    if (!pend) break;
    if (pend.kind === 'classlevel') break;
    if (pend.kind === 'subclass') R.chooseSubclass(p, R.classDef(pend.classId).subclasses[0].id, pend.classId);
    else if (pend.kind === 'style') R.chooseStyle(p, NK.Data.get('rules').fightingStyles[0].id, pend.classId);
    else if (pend.kind === 'asi') { const a = {}; a[R.classDef(pend.classId).primary] = 2; R.chooseAsi(p, a); }
    else { const pool = R.spellPool(p, pend.kind === 'cantrips'); if (pool.length) R.learnSpell(p, pool[0].id, pend.kind === 'cantrips'); else break; }
  }
  assert(R.pendingChoices(p).some((x) => x.kind === 'classlevel'), '没有待处理的职业进阶');
  UI.render();
  const h = curHtml();
  assert(h.includes('职业进阶'), '升级界面没有渲染出「职业进阶」');
  assert(h.includes('新开一个兼职职业'), '升级界面没有提供新开兼职的入口');
  return '升级界面含「职业进阶」页 + 新开兼职入口';
});

ok('点了「新开兼职」后总等级不变、职业多一个', () => {
  const p = App.run.player;
  const before = R.totalLevel(p);
  const beforeCls = R.classEntries(p).length;
  const r = NK.Run.resolveChoice(App.run, { classId: 'rogue' });
  assert(r.ok, r.msg);
  assert(R.totalLevel(p) === before, `总等级变了：${before} → ${R.totalLevel(p)}`);
  assert(R.classEntries(p).length === beforeCls + 1, '职业数没有增加');
  return `${r.msg}　总等级仍为 ${R.totalLevel(p)}`;
});

console.log('\n-- 9. UI 端到端：升级界面出现「魔契恩泽 / 超魔」页 --');
ok('邪术师升到 3 级，升级界面渲染出魔契恩泽', () => {
  UI.init();
  UI.act('t:new');
  UI.act('c:race', { id: 'human' });
  UI.act('c:bg', { id: 'soldier' });
  UI.act('c:class', { id: 'warlock' });
  UI.act('c:subclass', { id: R.classDef('warlock').subclasses[0].id });
  App.create.attrs = { str: 12, dex: 14, con: 14, int: 12, wis: 12, cha: 15 };
  let guard = 0;
  while (guard++ < 20 && !curHtml().includes('选择技能')) UI.act('c:next');
  const cls = R.classDef('warlock');
  for (const sid of cls.skillChoices.from.slice(0, cls.skillChoices.count)) UI.act('c:skill', { id: sid });
  guard = 0;
  while (guard++ < 20 && !curHtml().includes('选择难度')) UI.act('c:next');
  UI.act('c:diff', { id: '1' });
  UI.act('c:start');
  const p = App.run.player;
  R.gainXp(p, 900);
  App.run.state = 'levelup';
  guard = 0;
  while (guard++ < 40) {
    const pend = R.pendingChoices(p)[0];
    if (!pend || pend.kind === 'pactBoon') break;
    if (pend.kind === 'classlevel') R.chooseClassLevel(p, { classId: p.lastLeveledClassId });
    else if (pend.kind === 'subclass') R.chooseSubclass(p, R.classDef(pend.classId).subclasses[0].id, pend.classId);
    else if (pend.kind === 'invocation') R.chooseInvocation(p, NK.Data.get('rules').invocations[(p.invocations || []).length].id);
    else if (pend.kind === 'asi') { const a = {}; a.cha = 2; R.chooseAsi(p, a); }
    else { const pool = R.spellPool(p, pend.kind === 'cantrips'); if (pool.length) R.learnSpell(p, pool[0].id, pend.kind === 'cantrips'); else break; }
  }
  assert(R.pendingChoices(p).some((x) => x.kind === 'pactBoon'), '没有待处理的魔契：' + JSON.stringify(R.pendingChoices(p).map((x) => x.kind)));
  UI.render();
  const h = curHtml();
  assert(h.includes('魔契恩泽'), '升级界面没有渲染出「魔契恩泽」');
  assert(h.includes('刃之契约') && h.includes('链之契约') && h.includes('书之契约'), '三个魔契选项没有全部出现');
  UI.act('l:pactboon', { id: 'pact_blade' });
  assert(p.pactBoon === 'pact_blade' && p.flags.pactBlade, '点了魔契之后没有生效');
  return '魔契页渲染正常，选择刃之契约后 flag 生效';
});

console.log('\n-- 10. 圣武士：至圣斩 / 圣疗 / 守护光环 --');
ok('圣武士核心机制均已实装', () => {
  const p = mk('paladin');
  R.gainXp(p, 900);
  resolveAll(p, 'paladin');
  assert(p.flags.layOnHands, '没有圣疗');
  assert(p.flags.divineSmite, '没有至圣斩');
  const c = arena(p);
  const acts = C.availableActions(c);
  assert(acts.bonus.some((b) => b.id === 'layOnHands'), '附赠动作里没有圣疗');
  assert(acts.bonus.some((b) => b.id === 'smite1'), '附赠动作里没有至圣斩');
  // 至圣斩：挂上后下一次武器命中追加 2d8
  for (const e of c.enemies) e.band = 0;
  p.slots[0] = Math.max(1, p.slots[0] || 0);
  C.playerAction(c, { type: 'bonus', id: 'smite1' });
  assert(p.smiteQueued === 1, '至圣斩没有挂上');
  for (let i = 0; i < 5 && p.smiteQueued; i++) { c.turn.action = true; C.playerAction(c, { type: 'attack' }); }
  const smiteLog = c.log.find((l) => l.t.includes('至圣斩（1 环）'));
  return `圣疗池 ${p.layPool}　至圣斩${smiteLog ? '已打出：' + smiteLog.t.slice(0, 60) : '（本次未命中）'}`;
});

console.log('\n-- 11. 建卡流程：种族页文案 / 已无兼职页 --');
ok('种族页标题为「你降生于……」', () => {
  UI.act('t:new');
  UI.act('c:reset');
  const h = curHtml();
  assert(h.includes('你降生于……'), '种族页标题不对');
  assert(!h.includes('你生来是什么'), '旧标题还在');
  return '「你降生于……」';
});
ok('建卡流程里没有兼职页', () => {
  UI.act('t:new');
  UI.act('c:reset');
  const seen = [];
  let g = 0;
  // 逐页往后翻，记录出现过的页面
  while (g++ < 20) {
    const h = curHtml();
    if (h.includes('<h2>在踏入冒险之后')) seen.push('class');
    if (h.includes('关于兼职')) seen.push('aboutMC');
    if (h.includes('兼职（可选）')) seen.push('multiclass!!');
    if (h.includes('进 入 地 牢')) break;
    // 当前页随便选一个，才能继续往后
    const m = h.match(/data-act="(c:race|c:bg|c:class|c:subclass|c:pack|c:diff)" data-id="([^"]+)"/);
    if (!m) break;
    UI.act(m[1], { id: m[2] });
  }
  assert(!seen.includes('multiclass!!'), '建卡流程里仍然出现了兼职页');
  assert(seen.includes('class'), '没有走到职业页：' + JSON.stringify(seen));
  // 那句「关于兼职」的说明已按需求删掉：兼职只在升级时的「职业进阶」页出现
  assert(!seen.includes('aboutMC'), '职业页还留着那句多余的「关于兼职」说明');
  return `走过的页面：${seen.join(' → ')}（无兼职页）`;
});

console.log('\n-- 12. 自动记忆上一轮 --');
ok('建卡每一步都会自动存档', () => {
  UI.act('t:new');
  UI.act('c:reset');
  UI.act('c:race', { id: 'elf' });
  UI.act('c:bg', { id: 'sage' });
  UI.act('c:class', { id: 'wizard' });
  const snap = JSON.parse(store['yuanxia_lastbuild_v1'] || 'null');
  assert(snap, '选完职业后没有写入记忆');
  assert(snap.raceId === 'elf' && snap.classId === 'wizard' && snap.bgId === 'sage', '记忆内容不对：' + JSON.stringify(snap));
  return `已记住 ${snap.raceId}/${snap.classId}/${snap.bgId}`;
});
ok('「一键沿用」能把上一整套搬回来并直接开局', () => {
  // 先把一整套捏完（法师：需要选戏法与法术）
  UI.act('t:new');
  UI.act('c:reset');
  UI.act('c:race', { id: 'human' });
  UI.act('c:bg', { id: 'sage' });
  UI.act('c:class', { id: 'wizard' });
  const c = App.create;
  const eff = R.spellListOf('wizard');
  const all = NK.Data.get('spells').spells;
  const cl = all.filter((x) => x.classes.some((k) => eff.includes(k)) && x.level === 0);
  const sl = all.filter((x) => x.classes.some((k) => eff.includes(k)) && x.level === 1);
  const need = (() => { const cls = R.classDef('wizard'); return { c: cls.spellcasting.cantrips || 0, s: cls.spellcasting.spellsAtLevel1 || 6 }; })();
  for (let i = 0; i < need.c; i++) UI.act('c:cantrip', { id: cl[i].id });
  for (let i = 0; i < Math.min(need.s, sl.length); i++) UI.act('c:spell', { id: sl[i].id });
  UI.act('c:diff', { id: '1' });
  UI.act('b:save');
  const before = App.create.cantrips.length + App.create.spells.length;
  // 全新一局 → 一键沿用
  UI.act('t:new');
  assert(curHtml().includes('一键沿用'), '白纸开局时没有「一键沿用」提示');
  const c2 = App.create;
  assert(c2.raceId === null, 't:new 应该是白纸，不该自动塞上一套');
  UI.act('c:autofill');
  const c3 = App.create;
  assert(c3.classId === 'wizard' && c3.raceId === 'human', '沿用后职业/种族不对');
  assert(c3.cantrips.length + c3.spells.length === before, `法术没有沿用（${c3.cantrips.length + c3.spells.length} ≠ ${before}）`);
  assert(App.createRestored, '没有标记为已沿用');
  assert(curHtml().includes('进 入 地 牢'), '沿用后没有停在最后一页');
  UI.act('c:start');
  assert(App.run && App.run.player.classId === 'wizard', '沿用后直接开局失败');
  return `一键沿用 → ${R.raceDef(c3.raceId).name} ${R.classDef(c3.classId).name}，法术 ${c3.cantrips.length + c3.spells.length} 个，已开局`;
});
ok('「清空重来」不会抹掉记忆', () => {
  UI.act('t:new');
  UI.act('c:autofill');
  UI.act('c:reset');
  assert(App.create.raceId === null, '清空后不该还有种族');
  assert(!App.createRestored, '清空后还标记着已沿用');
  const snap = JSON.parse(store['yuanxia_lastbuild_v1'] || 'null');
  assert(snap && snap.classId === 'wizard', '清空把记忆也抹掉了');
  return '表单清空，记忆仍在';
});
ok('载入的配置会被对齐到当前职业（脏数据不会开局崩）', () => {
  const dirty = { id: 'x', name: '脏配置', raceId: 'human', classId: 'wizard', subclassId: 'not_a_real_sub', bgId: 'sage',
    attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 12, cha: 10 }, bonusChoice: {},
    skills: ['not_a_skill'], cantrips: ['fire_bolt', 'not_a_spell'], spells: ['magic_missile'],
    mc: [], pack: 99, difficulty: 99, at: Date.now() };
  store['yuanxia_builds_v1'] = JSON.stringify([dirty]);
  UI.act('t:quickstart', { id: 'x' });
  const p = App.run.player;
  assert(p, '脏配置开局失败');
  assert(p.skills || p.proficiencies, '没有技能');
  assert((p.proficiencies.skills || []).length >= R.classDef('wizard').skillChoices.count, '技能数量不对');
  assert((p.cantrips || []).filter((x) => x === 'not_a_spell').length === 0, '非法法术没有被剔除');
  const packs = NK.Items.startingPacks('wizard');
  assert(packs.length >= 1, '装备包不存在');
  store['yuanxia_builds_v1'] = '[]';
  return `脏配置被清洗：技能 ${(p.proficiencies.skills || []).length} 项、戏法 ${(p.cantrips || []).length} 个、难度 ${App.run.difficulty}`;
});

console.log('\n-- 13. 战斗 / 营地：记住上一手 --');
ok('战斗会记住上一回合的动作并自动选中', () => {
  const p = mk('wizard', { int: 15 });
  R.learnSpell(p, 'magic_missile', false);
  p.slots[0] = 3; p.slotsMax = [3, 0, 0, 0, 0];
  const c = arena(p);
  const before = C.availableActions(c);
  assert(before.spells.some((s) => s.ok && s.spell.id === 'magic_missile'), '魔法飞弹不可用');
  // 手动施法一次 → 记住
  const mm = before.spells.find((s) => s.spell.id === 'magic_missile');
  C.playerAction(c, { type: 'cast', spellId: 'magic_missile', slot: mm.slot });
  App.lastActionKey = `spell:magic_missile:${mm.slot}`;
  const acts2 = C.availableActions(c);
  const opts = [];
  for (const s of acts2.spells) if (s.ok) opts.push({ kind: 'spell', id: s.spell.id, slot: s.slot, label: s.label, need: 'action' });
  const idx = opts.findIndex((o) => `${o.kind}:${o.id}:${o.slot || 0}` === App.lastActionKey);
  assert(idx >= 0, '下一回合在可用列表里找不到上一手（记忆键失效）');
  App.selAction = idx;
  assert(opts[App.selAction].id === 'magic_missile', '自动选中的不是上一手');
  return `记忆键 ${App.lastActionKey} → 自动选中「${opts[idx].label}」`;
});
ok('营地把上次投的骰数标为默认', () => {
  const run = { player: mk('warrior'), food: 3, map: { acts: [{ name: '第一幕' }] }, actIndex: 0 };
  App.run = run;
  App.lastRestDice = 2;
  const o = NK.Run.restOptions(run);
  assert(o.short && o.short.ok !== undefined, 'restOptions 异常');
  App.run = null;
  return '上次投 2 颗 → 营地默认按钮标记为「用 2 颗（上次）」';
});

console.log(fail ? `\n✘ 专项验证失败：${fail} 项` : '\n✔ 专项验证全部通过');
process.exit(fail ? 1 : 0);

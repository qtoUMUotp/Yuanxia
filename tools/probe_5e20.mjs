// 5e 对照探针（20 级版）：逐条实测「等级上限 / 契约槽 / 已知法术 / 法师准备 / 兼职法术位 /
// 奥术恢复 / 戏法成长 / 专注豁免 / 巨量伤害即死 / A1-A6 / 2.3 职业资源」。只读检查。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js'];
const store = {}; const html = { innerHTML: '', querySelector: () => null };
const ctx = {
  console, document: { readyState: 'complete', getElementById: () => html, addEventListener: () => {}, querySelector: () => null },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  setTimeout, clearTimeout, addEventListener: () => {}, prompt: (m, d) => (d || ''),
};
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of FILES) vm.runInContext(readFileSync(join(root, 'js', f), 'utf8'), ctx, { filename: 'js/' + f });
const NK = ctx.NK; await NK.Data.load();
const R = NK.Rules, C = NK.Combat, D = NK.Dice;
const bg0 = NK.Data.get('backgrounds').backgrounds[0].id;

const mk = (cls, level, attrs = {}, extra = {}) => {
  const a = Object.assign({ str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 10 }, attrs);
  const p = R.createPlayer({ raceId: 'human', bgId: bg0, classId: cls, classes: [{ id: cls, level, subclassId: null }], attrs: a, skills: [], equipment: [], name: 'T' });
  Object.assign(p, extra); R.recalc(p); return p;
};
const multi = (list) => {
  const p = R.createPlayer({ raceId: 'human', bgId: bg0, classId: list[0][0], attrs: { str: 13, dex: 13, con: 13, int: 16, wis: 16, cha: 16 }, skills: [], equipment: [], name: 'T' });
  p.classes = list.map(([id, lv]) => ({ id, level: lv, subclassId: null }));
  R.normalizeClasses(p); R.recalc(p); return p;
};

let fail = 0;
const chk = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail += 1;
  console.log(`  ${ok ? '✔' : '✘'} ${label.padEnd(34)} 实测 ${String(JSON.stringify(got)).padEnd(26)} 5e ${JSON.stringify(want)}`);
};
const info = (label, v) => console.log(`  · ${label.padEnd(34)} ${v}`);

console.log('\n【1】等级上限 / 熟练加值 / 戏法成长');
{
  const p = mk('wizard', 1, { int: 18 });
  R.gainXp(p, 999999);
  chk('等级上限', p.level, 20);
  chk('20 级熟练加值', R.profBonus(20), 6);
  chk('17 级熟练加值', R.profBonus(17), 6);
  chk('13 级熟练加值', R.profBonus(13), 5);
  const cm = (lv) => { const q = mk('wizard', lv, { int: 16 }); return R.cantripMul(q); };
  chk('戏法倍率 L1/L5/L11/L17', [cm(1), cm(5), cm(11), cm(17)], [1, 2, 3, 4]);
  const w = mk('wizard', 20, { int: 18 });
  chk('20 级法师法术位', w.slotsMax, [4, 3, 3, 3, 3, 2, 2, 1, 1]);
}

console.log('\n【2】契约槽 / 邪术师已知法术（5e 原表）');
{
  const T = { 1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2], 5: [2, 3], 6: [2, 3], 7: [2, 4], 8: [2, 4], 9: [2, 5], 10: [2, 5], 11: [3, 5], 12: [3, 5], 15: [3, 5], 16: [3, 5], 17: [4, 5], 20: [4, 5] };
  for (const lv of [1, 2, 3, 5, 9, 11, 17, 20]) {
    const q = mk('warlock', lv, { cha: 18 });
    chk(`  邪术师 L${lv} 契约槽`, [q.pactSlotsMax, q.pactLevel], T[lv]);
  }
  const K = { 1: 2, 2: 3, 5: 6, 10: 10, 11: 11, 15: 13, 20: 15 };
  for (const lv of [1, 2, 5, 10, 11, 15, 20]) {
    chk(`  邪术师 L${lv} 已知法术`, R.spellCapacity(mk('warlock', lv, { cha: 18 })).known, K[lv]);
  }
  const q17 = mk('warlock', 17, { cha: 18 });
  info('玄奥秘术（六~九环各 1）', q17.slotsMax.slice(5).join(','));
  chk('  17 级邪术师高环法术位', q17.slotsMax.slice(5), [1, 1, 1, 1]);
}

console.log('\n【3】诗人 / 游侠已知法术、法师已准备');
{
  const B = { 1: 4, 5: 8, 10: 14, 15: 19, 20: 22 };
  for (const lv of [1, 5, 10, 15, 20]) chk(`  诗人 L${lv} 已知法术`, R.spellCapacity(mk('bard', lv, { cha: 18 })).known, B[lv]);
  const RG = { 2: 2, 5: 4, 9: 6, 13: 8, 20: 11 };
  for (const lv of [2, 5, 9, 13, 20]) chk(`  游侠 L${lv} 已知法术`, R.spellCapacity(mk('ranger', lv, { wis: 18 })).known, RG[lv]);
  for (const lv of [1, 5, 20]) chk(`  法师 L${lv} 已准备（智力 18）`, R.spellCapacity(mk('wizard', lv, { int: 18 })).prepared, 4 + lv);
  chk('  20 级法师法术书容量', R.spellCapacity(mk('wizard', 20, { int: 18 })).known, 6 + 19 * 2);
  const cler = mk('cleric', 10, { wis: 18 });
  chk('  牧师 L10 已准备', R.spellCapacity(cler).prepared, 14);
  const pal = mk('paladin', 10, { cha: 18 });
  chk('  圣武士 L10 已准备', R.spellCapacity(pal).prepared, 9);
  const art = mk('artificer', 1, { int: 18 });
  chk('  工匠 L1 已准备（向下取整）', R.spellCapacity(art).prepared, 4);
}

console.log('\n【4】兼职：合并施法等级 + 契约位归属（A1 / A2）');
{
  const a = multi([['wizard', 5], ['cleric', 5]]);
  chk('  法师5/牧师5 法术位', a.slotsMax.slice(0, 5), [4, 3, 3, 3, 2]);
  const b = multi([['wizard', 1], ['cleric', 1]]);
  chk('  法师1/牧师1 法术位', b.slotsMax.slice(0, 5), [3, 0, 0, 0, 0]);
  const c2 = multi([['ranger', 4], ['paladin', 4]]);
  chk('  游侠4/圣武士4 法术位', c2.slotsMax.slice(0, 5), [4, 3, 0, 0, 0]);   // 5e 合并施法等级 4
  const d2 = multi([['wizard', 5], ['ranger', 2]]);
  chk('  法师5/游侠2 法术位', d2.slotsMax.slice(0, 5), [4, 3, 3, 0, 0]);
  const w9 = multi([['wizard', 9], ['warlock', 1]]);
  w9.knownSpells = ['fireball']; w9.prepared = ['fireball']; w9.cantrips = [];
  R.recalc(w9);
  chk('  A2 最高环阶（法9/邪1）', R.maxSpellLevel(w9), 5);
  chk('  A1 火球归属法师', R.spellOwnerOf(w9, 'fireball'), 'wizard');
  chk('  A1 火球不走契约位', R.isPactSpell(w9, 'fireball'), false);
  const eb = NK.Data.get('spells').spells.find((s) => s.id === 'eldritch_blast');
  if (eb) { w9.cantrips = ['eldritch_blast']; chk('  A1 魔能爆走契约位', R.isPactSpell(w9, 'eldritch_blast'), true); }
}

console.log('\n【5】A3 闪避 / A4 兼职熟练 / A5 武僧徒手 / A6 长休重选');
{
  const tier = { id: 'n', hpMul: 1, dmgMul: 1, hitAdd: 0 };
  const en = C.makeEncounter({ pool: ['goblin_cutter'], boss: 'goblin_cutter' }, 'normal', tier, NK.RNG.make(1));
  const pl = mk('warrior', 5, { str: 16, dex: 16, con: 16 });
  const cc = C.start(pl, en, { rng: NK.RNG.make(7), tier, act: 1, source: 'normal', allowSurprise: false });
  cc.turn = { action: true, bonus: true, moved: false };
  C.playerAction(cc, { type: 'dodge' });
  const afterDodge = !!cc.player.dodging;
  // 手动跑一次「敌人回合」再确认闪避还在
  const e0 = cc.enemies[0];
  e0.traits = [];   // 隔离测试：去掉怪物自带优势特性，只看「闪避」本身
  const mode = C.attackMode(cc, e0, cc.player);
  C.endPlayerTurn(cc);
  chk('  A3 闪避后标记生效', afterDodge, true);
  chk('  A3 敌人攻击时处于劣势', mode, 'dis');

  const f = mk('warrior', 1, { str: 16 });
  const before = (f.proficiencies.weapons || []).slice();
  f.classes.push({ id: 'wizard', level: 1, subclassId: null });
  R.normalizeClasses(f); R.recalc(f);
  f.lastLeveledClassId = 'warrior';
  const r4 = R.chooseClassLevel(f, { classId: 'wizard' });
  info('  A4 兼职后的武器熟练', JSON.stringify(f.proficiencies.weapons));
  chk('  A4 兼职不丢原有熟练', before.every((w) => f.proficiencies.weapons.includes(w)), true);

  const m1 = mk('monk', 1, { dex: 18, wis: 16, str: 10 });
  const m5 = mk('monk', 5, { dex: 18, wis: 16, str: 10 });
  const m11 = mk('monk', 11, { dex: 18, wis: 16, str: 10 });
  const m17 = mk('monk', 17, { dex: 18, wis: 16, str: 10 });
  chk('  A5 武僧徒手骰 L1/5/11/17', [R.weaponDice(m1), R.weaponDice(m5), R.weaponDice(m11), R.weaponDice(m17)], ['1d4', '1d6', '1d8', '1d10']);
  chk('  A5 武僧徒手用敏捷', R.attackAbility(m5, null), 'dex');

  const cl = mk('cleric', 5, { wis: 18 });
  cl.prepared = ['cure_wounds'];
  const pool = NK.Data.get('spells').spells.filter((s) => s.classes.includes('cleric') && s.level >= 1 && s.level <= 3).map((s) => s.id);
  const res = R.resetPrepared(cl, pool.slice(0, 20));
  chk('  A6 长休重选准备数', cl.prepared.length, Math.min(20, R.spellCapacity(cl).prepared));
}

console.log('\n【6】2.3 职业资源与特性');
{
  const rage = (lv) => { const q = mk('barbarian', lv, { str: 18, con: 18 }); return q.rageMax; };
  chk('  狂暴次数 L1/3/6/12/17', [rage(1), rage(3), rage(6), rage(12), rage(17)], [2, 3, 4, 5, 6]);
  const b5 = mk('barbarian', 5, { str: 18, con: 18 });
  b5.raging = true; R.recalc(b5);
  chk('  狂暴抗性（钝击/穿刺/挥砍）', ['挥砍', '穿刺', '钝击'].every((t) => b5.resist.includes(t)), true);
  chk('  狂暴增伤 L5', b5.rageDmg, 2);
  const b17 = mk('barbarian', 17, { str: 18, con: 18 });
  chk('  狂暴增伤 L17', b17.rageDmg, 4);
  const b1 = mk('barbarian', 1, { str: 16, con: 18 });
  chk('  无甲防御（10+敏+体）', b1.ac, 10 + R.mod(b1.attrs.dex) + R.mod(b1.attrs.con));
  const b9 = mk('barbarian', 9, { str: 18, con: 18 });
  chk('  凶蛮重击 L9/L13/L17', [b9.mods.brutalCrit || 0, mk('barbarian', 13, { str: 18, con: 18 }).mods.brutalCrit || 0, mk('barbarian', 17, { str: 18, con: 18 }).mods.brutalCrit || 0], [1, 2, 3]);
  const k1 = mk('monk', 5, { dex: 18, wis: 20 });
  chk('  气 = 武僧等级（5）', k1.kiMax, 5);
  const bd = (lv) => mk('bard', lv, { cha: 18 }).bardDie;
  chk('  吟游激励骰 L1/5/10/15', [bd(1), bd(5), bd(10), bd(15)], [6, 8, 10, 12]);
  const s3 = mk('sorcerer', 3, { cha: 18 });
  chk('  术法点 = 术士等级', s3.sorceryMax, 3);
  const s1 = mk('sorcerer', 1, { cha: 18 });
  chk('  1 级术士没有术法点', s1.sorceryMax, 0);
  const d4 = mk('druid', 4, { wis: 18 });
  chk('  野性形态次数', d4.wildShapeMax, 2);
  const w20 = mk('warrior', 20, { str: 16 });
  chk('  战士 20 级攻击次数', 1 + w20.mods.extraAttack, 4);
  const w5 = mk('warrior', 5, { str: 16 });
  chk('  战士 5 级攻击次数', 1 + w5.mods.extraAttack, 2);
  const ro = mk('rogue', 19, { dex: 18 });
  chk('  游荡者 19 级偷袭骰', ro.mods.sneakAttack, 10);
}

console.log('\n【7】专注豁免 / 巨量伤害即死');
{
  const tier = { id: 'n', hpMul: 1, dmgMul: 1, hitAdd: 0 };
  const en = C.makeEncounter({ pool: ['goblin_cutter'], boss: 'goblin_cutter' }, 'normal', tier, NK.RNG.make(3));
  const p = mk('wizard', 5, { int: 18, con: 14 });
  const cc = C.start(p, en, { rng: NK.RNG.make(11), tier, act: 1, source: 'normal', allowSurprise: false });
  p.concentration = 'haste';
  cc.turn = { action: true, bonus: true, moved: false };
  C.damage(cc, p, 30, '火焰', en[0]);
  info('  专注是否被触发', p.concentration === null ? '断（豁免失败）' : '仍在（豁免成功）');

  const en2 = C.makeEncounter({ pool: ['goblin_cutter'], boss: 'goblin_cutter' }, 'normal', tier, NK.RNG.make(5));
  const p2 = mk('warrior', 5, { str: 16, con: 16 });
  const c2 = C.start(p2, en2, { rng: NK.RNG.make(13), tier, act: 1, source: 'normal', allowSurprise: false });
  const massive = p2.hp + p2.maxHp + 10;
  C.damage(c2, p2, massive, '挥砍', en2[0]);
  chk('  巨量伤害即死', [c2.over, c2.result], [true, 'defeat']);
  const en3 = C.makeEncounter({ pool: ['goblin_cutter'], boss: 'goblin_cutter' }, 'normal', tier, NK.RNG.make(9));
  const p3 = mk('warrior', 5, { str: 16, con: 16 });
  const c3 = C.start(p3, en3, { rng: NK.RNG.make(17), tier, act: 1, source: 'normal', allowSurprise: false });
  C.damage(c3, p3, p3.hp + 3, '挥砍', en3[0]);
  chk('  普通倒下不算即死', [p3.hp, p3.dying], [0, true]);
}

console.log('\n【8】奥术恢复只在长休');
{
  const r = NK.Run.start({ rng: NK.RNG.make(31), raceId: 'human', classId: 'wizard', bgId: bg0, attrs: { str: 8, dex: 14, con: 14, int: 18, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'W', equipment: [], cantrips: ['fire_bolt'] });
  const p = r.player;
  p.slots = p.slotsMax.map(() => 0);
  NK.Run.restShort(r, 1);
  const afterShort = p.slots.reduce((a, b) => a + b, 0);
  NK.Run.restLong(r);
  const afterLong = p.slots.reduce((a, b) => a + b, 0);
  chk('  短休不回法术位', afterShort, 0);
  info('  长休后法术位总数', afterLong + '（法师等级 1，奥术恢复预算 1 环）');
}

console.log(fail === 0 ? '\n✔ 全部对照通过。' : `\n✘ 有 ${fail} 项不符。`);
if (fail) process.exit(1);

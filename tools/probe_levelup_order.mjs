/* 专项验证：升级流程顺序 + 近战附赠动作的距离判定
 * 1) 升级后第一个待办必须是「职业进阶」——先定这一级落哪个职业，再选这一级的内容
 * 2) 改投职业后，后续待办（法术容量等）应按新职业重新计算
 * 3) 连续升多级时每一级各有一次职业进阶，不会互相覆盖
 * 4) 疾风连击 / 震慑拳 / 副手攻击 在够不到时应被拦下且标记 blocked
 */
import fs from 'fs';
import vm from 'vm';

const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js'];
const ctx = {
  console,
  document: { readyState: 'complete', getElementById: () => ({ innerHTML: '' }), addEventListener: () => {}, querySelector: () => null },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  setTimeout, clearTimeout, addEventListener: () => {}, prompt: (m, d) => d || 'T',
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of FILES) vm.runInContext(fs.readFileSync(`js/${f}`, 'utf8'), ctx, { filename: f });

const NK = ctx.NK, R = NK.Rules;
await NK.Data.load();

let bad = 0;
const ok = (cond, name, extra) => {
  console.log(`  ${cond ? '✔' : 'X'}  ${name}${extra !== undefined ? '　→ ' + extra : ''}`);
  if (!cond) bad++;
};

/** 起一局并把所有待办按合理默认值处理掉 */
function startRun(classId, attrs, opt) {
  opt = opt || {};
  const cls = R.classDef(classId);
  const a = Object.assign({ str: 13, dex: 13, con: 13, int: 13, wis: 13, cha: 13 }, attrs || {});
  a[cls.primary] = Math.max(a[cls.primary], 15);
  if (cls.spellcasting) a[cls.spellcasting.ability] = Math.max(a[cls.spellcasting.ability], 15);
  const cfg = {
    rng: NK.RNG.make(opt.seed || 11), raceId: 'human', classId, bgId: 'soldier', attrs: a,
    skills: [cls.skillChoices.from[0], cls.skillChoices.from[1]], pack: 0, difficulty: 1, name: 'T', equipment: [],
  };
  if (cls.spellcasting) {
    const eff = R.spellListOf(classId);
    const pool = NK.Data.get('spells').spells.filter((s) => s.classes.some((k) => eff.includes(k)) && s.level <= 1);
    cfg.cantrips = pool.filter((s) => s.level === 0).slice(0, cls.spellcasting.cantrips || 0).map((s) => s.id);
    cfg.knownSpells = pool.filter((s) => s.level === 1).slice(0, 2).map((s) => s.id);
  }
  const r = NK.Run.start(cfg);
  return r;
}

function resolveFirst(run, opt) {
  opt = opt || {};
  const p = run.player;
  const pend = R.pendingChoices(p)[0];
  if (!pend) return null;
  if (pend.kind === 'classlevel') return NK.Run.resolveChoice(run, { classId: opt.classId || pend.classId });
  if (pend.kind === 'subclass') return NK.Run.resolveChoice(run, { subclass: (R.classDef(pend.classId).subclasses[0] || {}).id });
  if (pend.kind === 'asi') { const al = {}; al[R.classDef(pend.classId).primary] = 2; return NK.Run.resolveChoice(run, { alloc: al }); }
  if (pend.kind === 'style') return NK.Run.resolveChoice(run, { style: NK.Data.get('rules').fightingStyles[0].id });
  if (pend.kind === 'expertise') {
    const cand = (p.proficiencies.skills || []).find((s) => !(p.expertise || []).includes(s));
    return NK.Run.resolveChoice(run, { skill: cand });
  }
  if (pend.kind === 'cantrips' || pend.kind === 'spells') {
    const pool = R.spellPool(p, pend.kind === 'cantrips');
    return NK.Run.resolveChoice(run, { spell: pool[0] && pool[0].id });
  }
  return NK.Run.resolveChoice(run, {});
}

/** 只升一级（gainXp 给的经验刚够跨过当前这一级） */
const levelUpOnce = (run) => R.gainXp(run.player, R.xpNeeded(run.player.level));

console.log('【1】升级后第一个待办是「职业进阶」');
{
  const run = startRun('wizard', { int: 16 });
  levelUpOnce(run);
  const q = R.pendingChoices(run.player);
  ok(q.length > 0 && q[0].kind === 'classlevel', '第一个待办是职业进阶', q[0] && q[0].kind);
  ok(q.map((x) => x.kind).indexOf('classlevel') === 0, '职业进阶排在最前而非最后', q.map((x) => x.kind).join(' > '));
}

console.log('\n【2】改投职业后，后续待办按新职业重算');
{
  const run = startRun('wizard', { int: 16, str: 14 });
  levelUpOnce(run);                                                   // 1 → 2 级
  const pend = R.pendingChoices(run.player)[0];
  ok(pend && pend.kind === 'classlevel', '升到 2 级先问职业归属', pend && pend.kind);
  const r = NK.Run.resolveChoice(run, { classId: 'warrior' });       // 把这一级改投战士
  ok(r.ok, '改投战士成功', r.msg);
  const entries = R.classEntries(run.player).map((e) => e.id + ':' + e.level);
  ok(entries.some((x) => x.startsWith('warrior')), '战士已入列', entries.join(' / '));
  // 关键：法师退回 1 级，就不该再按 2 级的容量让法师选法术
  const wizardLv = (R.classEntries(run.player).find((e) => e.id === 'wizard') || {}).level;
  ok(wizardLv === 1, '法师退回 1 级', wizardLv);
  const rest = R.pendingChoices(run.player).map((x) => x.kind);
  ok(!rest.includes('classlevel'), '这一级的职业归属已结清', rest.join(' > ') || '（空）');
  // 对照：同一角色把这一级留在法师，法术容量应该更大 —— 证明容量确实跟着职业等级走，
  // 所以「先定职业再选内容」的顺序才有意义
  const run2 = startRun('wizard', { int: 16, str: 14 }, { seed: 11 });
  levelUpOnce(run2);
  resolveFirst(run2, { classId: 'wizard' });
  const capStay = R.spellCapacity(run2.player).known;
  const capSwap = R.spellCapacity(run.player).known;
  ok(capStay > capSwap, '留在法师时法术容量更大（容量随职业等级走）',
    `法师${(R.classEntries(run2.player).find((e) => e.id === 'wizard') || {}).level}级=${capStay} vs 法师1级=${capSwap}`);
}

{
  // 确认留在原职业：出队后不应残留 classlevel
  const run = startRun('wizard', { int: 16 });
  levelUpOnce(run);
  resolveFirst(run, { classId: 'wizard' });
  const rest = R.pendingChoices(run.player);
  ok(!rest.some((x) => x.kind === 'classlevel'), '处理后该待办出队', rest.map((x) => x.kind).join(' > ') || '（空）');
}

console.log('\n【3】连续升多级：每一级各有一次职业进阶');
{
  const run = startRun('wizard', { int: 16 });
  R.gainXp(run.player, 3000);
  let n = 0, guard = 0;
  while (R.pendingChoices(run.player).length && guard++ < 300) {
    const pend = R.pendingChoices(run.player)[0];
    if (pend.kind === 'classlevel') { n++; resolveFirst(run, { classId: pend.classId }); }
    else resolveFirst(run);
  }
  ok(n >= 2, '连续升级时出现多次职业进阶', `共 ${n} 次（等级 ${run.player.level}）`);
  ok(R.pendingChoices(run.player).length === 0, '待办最终清空', '剩余 ' + R.pendingChoices(run.player).length);
}

console.log('\n【4】近战附赠动作的距离判定');
{
  const run = startRun('monk', { dex: 16, wis: 16 });
  const p = run.player;
  R.gainXp(p, 5000);
  let g = 0;
  while (R.pendingChoices(p).length && g++ < 60) resolveFirst(run);
  const c = NK.Run.startBattle(run, 'normal');
  p.flags.ki = true; p.flags.flurry = true; p.flags.stun = true; p.kiLeft = 5; p.kiMax = 5;
  const e0 = c.enemies.find((x) => x.hp > 0);

  e0.band = 2;                                        // 远距
  let acts = NK.Combat.availableActions(c);
  const fl = acts.bonus.find((b) => b.id === 'flurry');
  const st = acts.bonus.find((b) => b.id === 'stun');
  ok(!!fl && !!fl.blocked, '远距：疾风连击被标记够不到', fl && fl.blocked);
  ok(!!st && !!st.blocked, '远距：震慑拳被标记够不到', st && st.blocked);
  const ki0 = p.kiLeft;
  NK.Combat.playerAction(c, { type: 'bonus', id: 'flurry', target: e0.uid });
  ok(p.kiLeft === ki0, '远距：疾风连击不消耗气', `${ki0} → ${p.kiLeft}`);

  e0.band = 0;                                        // 贴身
  acts = NK.Combat.availableActions(c);
  ok(!acts.bonus.find((b) => b.id === 'flurry').blocked, '贴身：疾风连击恢复可用');
  const ki1 = p.kiLeft;
  NK.Combat.playerAction(c, { type: 'bonus', id: 'flurry', target: e0.uid });
  ok(p.kiLeft === ki1 - 1, '贴身：疾风连击正常消耗 1 气', `${ki1} → ${p.kiLeft}`);
}

{
  // 副手攻击同样走武器距离判定
  const run = startRun('warrior', { str: 16, dex: 14 });
  const p = run.player;
  const w = NK.Items.weapons().find((x) => x.dice && !(x.properties || []).includes('twoHanded'))
    || NK.Items.weapons().find((x) => x.dice);
  if (w) {
    p.items.mainHand = Object.assign({}, w);
    p.items.offHand = Object.assign({}, w);
    const c = NK.Run.startBattle(run, 'normal');
    const e0 = c.enemies.find((x) => x.hp > 0);
    e0.band = 2;
    const oh = NK.Combat.availableActions(c).bonus.find((b) => b.id === 'offhand');
    ok(!!oh && !!oh.blocked, '远距：副手攻击被标记够不到', (oh && oh.blocked) || '（未标记）');
    e0.band = 0;
    const oh2 = NK.Combat.availableActions(c).bonus.find((b) => b.id === 'offhand');
    ok(!!oh2 && !oh2.blocked, '贴身：副手攻击恢复可用', w.name);
  } else console.log('  · 副手攻击：取不到单手武器，跳过');
}

console.log(bad === 0 ? '\n✔ 全部通过。' : `\n❌ 失败 ${bad} 项`);
process.exit(bad === 0 ? 0 : 1);

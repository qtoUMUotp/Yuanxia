// 针对新增职业的专项探针：使用与游戏一致的 Run.start / Run.startBattle 路径
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

const classes = NK.Data.get('classes').classes;
const allSpells = NK.Data.get('spells').spells;
function spellPoolFor(id, maxLv) {
  const eff = R.spellListOf(id);
  return allSpells.filter((x) => x.classes.some((k) => eff.includes(k)) && x.level <= maxLv);
}

let bad = 0, count = 0;
const attr = (id) => {
  if (id === 'warlock') return { str: 10, dex: 13, con: 14, int: 10, wis: 10, cha: 15 };
  if (id === 'monk') return { str: 12, dex: 15, con: 14, int: 10, wis: 14, cha: 8 };
  if (id === 'barbarian') return { str: 16, dex: 13, con: 14, int: 8, wis: 10, cha: 8 };
  if (id === 'druid') return { str: 10, dex: 12, con: 14, int: 10, wis: 15, cha: 8 };
  if (id === 'artificer') return { str: 10, dex: 12, con: 14, int: 15, wis: 10, cha: 8 };
  return { str: 14, dex: 14, con: 14, int: 12, wis: 12, cha: 12 };
};

// 1) 所有职业 × 子职：Run.start + 升级选择 + 校验
for (const c of classes) {
  for (const sub of (c.subclasses || [])) {
    count++;
    try {
      const a = attr(c.id);
      const sc = c.spellcasting;
      const cfg = { rng: NK.RNG.make(count * 7 + 1), raceId: 'human', classId: c.id, bgId: 'soldier', attrs: a, skills: [c.skillChoices.from[0], c.skillChoices.from[1]], pack: 0, difficulty: 1, name: 'P', equipment: [] };
      if (sc) {
        const pool = spellPoolFor(c.id, 1);
        cfg.cantrips = pool.filter((s) => s.level === 0).slice(0, sc.cantrips || 0).map((s) => s.id);
        if (sc.known || sc.prepared) cfg.knownSpells = pool.filter((s) => s.level === 1).slice(0, 1).map((s) => s.id);
        else cfg.spells = pool.filter((s) => s.level === 1).slice(0, 1).map((s) => s.id);
      }
      const r = NK.Run.start(cfg); R.gainXp(r.player, 5000);
      let g = 0;
      while (R.pendingChoices(r.player).length && g++ < 40) {
        const pend = R.pendingChoices(r.player)[0];
        if (pend.kind === 'subclass') NK.Run.resolveChoice(r, { subclass: sub.id });
        else if (pend.kind === 'style') NK.Run.resolveChoice(r, { style: NK.Data.get('rules').fightingStyles[0].id });
        else if (pend.kind === 'expertise') { const cand = r.player.proficiencies.skills.find((s) => !(r.player.expertise || []).includes(s)); if (cand) NK.Run.resolveChoice(r, { skill: cand }); }
        else if (pend.kind === 'asi') { const al = {}; al[c.primary] = 2; NK.Run.resolveChoice(r, { alloc: al }); }
        else if (pend.kind === 'cantrips' || pend.kind === 'spells') {
          const eff = R.spellListOf(c.id);
          const known = pend.kind === 'cantrips' ? r.player.cantrips : (sc.prepared ? r.player.prepared : r.player.knownSpells);
          const p2 = spellPoolFor(c.id, R.maxSpellLevel(r.player) || 1).filter((s) => (pend.kind === 'cantrips' ? s.level === 0 : true) && !known.includes(s.id));
          if (p2.length) NK.Run.resolveChoice(r, { spell: p2[0].id });
        } else NK.Run.resolveChoice(r, {});
      }
      if (r.player.subclassId !== sub.id) throw new Error('子职未生效');
      if (!isFinite(r.player.maxHp) || r.player.maxHp <= 0) throw new Error('maxHp 异常 ' + r.player.maxHp);
    } catch (e) { bad++; console.log('  X', c.id, '/', sub.id, '->', e.message); }
  }
}
console.log(`子职组合校验：共 ${count} 个，失败 ${bad} 个`);

// 2) 战斗机制专项（用 Run.start + startBattle 保证安全）
function startRunBattle(id, subclassId) {
  const a = attr(id);
  const sc = R.classDef(id).spellcasting;
  const cfg = { rng: NK.RNG.make(99), raceId: 'human', classId: id, bgId: 'soldier', attrs: a, skills: [R.classDef(id).skillChoices.from[0], R.classDef(id).skillChoices.from[1]], pack: 0, difficulty: 1, name: 'P', equipment: [] };
  if (sc) {
    const pool = spellPoolFor(id, 1);
    cfg.cantrips = pool.filter((s) => s.level === 0).slice(0, sc.cantrips || 0).map((s) => s.id);
    cfg.knownSpells = pool.filter((s) => s.level === 1).slice(0, 2).map((s) => s.id);
  }
  const r = NK.Run.start(cfg); R.gainXp(r.player, 5000);
  // 升到 10 级并选子职
  let g = 0;
  while (R.pendingChoices(r.player).length && g++ < 40) {
    const pend = R.pendingChoices(r.player)[0];
    if (pend.kind === 'subclass') NK.Run.resolveChoice(r, { subclass: subclassId });
    else if (pend.kind === 'style') NK.Run.resolveChoice(r, { style: NK.Data.get('rules').fightingStyles[0].id });
    else if (pend.kind === 'expertise') { const cand = r.player.proficiencies.skills.find((s) => !(r.player.expertise || []).includes(s)); if (cand) NK.Run.resolveChoice(r, { skill: cand }); }
    else if (pend.kind === 'asi') { const al = {}; al[R.classDef(id).primary] = 2; NK.Run.resolveChoice(r, { alloc: al }); }
    else if (pend.kind === 'cantrips' || pend.kind === 'spells') { const eff = R.spellListOf(id); const known = pend.kind === 'cantrips' ? r.player.cantrips : (sc.prepared ? r.player.prepared : r.player.knownSpells); const p2 = spellPoolFor(id, R.maxSpellLevel(r.player) || 1).filter((s) => (pend.kind === 'cantrips' ? s.level === 0 : true) && !known.includes(s.id)); if (p2.length) NK.Run.resolveChoice(r, { spell: p2[0].id }); }
    else NK.Run.resolveChoice(r, {});
  }
  const c = NK.Run.startBattle(r, 'normal');
  return { r, c, p: r.player };
}

// 野蛮人狂暴
try {
  const { c, p } = startRunBattle('barbarian', 'berserker');
  const acts = NK.Combat.availableActions(c);
  const rage = acts.bonus.find((b) => b.id === 'rage');
  if (!rage) throw new Error('无狂暴附赠动作');
  if (!p.raging) { NK.Combat.playerAction(c, { type: 'bonus', id: 'rage' }); }
  if (!p.raging) throw new Error('狂暴未触发');
  if (p.rageDr <= 0 || p.rageDmg <= 0) throw new Error('狂暴数值缺失');
  console.log(`野蛮人狂暴 OK：raging=${p.raging} rageDr=${p.rageDr} rageDmg=${p.rageDmg} rageLeft=${p.rageLeft}/${p.rageMax}`);
} catch (e) { bad++; console.log('  X 野蛮人狂暴 ->', e.message); }

// 武僧气技
try {
  const { c, p } = startRunBattle('monk', 'openhand');
  const acts = NK.Combat.availableActions(c);
  if (!p.flags.ki || !p.flags.flurry) throw new Error('气/疾风未生效');
  if (!p.flags.acWis) throw new Error("徒手 AC(wis) 未生效");
  const flurry = acts.bonus.find((b) => b.id === 'flurry');
  if (!flurry) throw new Error('无疾风连击');
  const before = p.kiLeft;
  NK.Combat.playerAction(c, { type: 'bonus', id: 'flurry', target: c.enemies.find((e) => e.hp > 0) && c.enemies.find((e) => e.hp > 0).uid });
  if (p.kiLeft !== before - 1) throw new Error('疾风连击未消耗气');
  console.log(`武僧气技 OK：ki ${p.kiLeft}/${p.kiMax} ac=${p.ac}(wis) 徒手增伤=${p.mods.monkDmg}`);
} catch (e) { bad++; console.log('  X 武僧气技 ->', e.message); }

// 邪术师契约魔法
try {
  const { c, p } = startRunBattle('warlock', 'fiend');
  if (!p.pactLevel) throw new Error('pactLevel 未计算');
  const acts = NK.Combat.availableActions(c);
  if (!(p.pactSlots > 0)) throw new Error('邪术环为 0');
  const spell = acts.spells.find((s) => s.slot === p.pactLevel && s.ok);
  if (!spell) throw new Error('无可用契约法术');
  const before = p.pactSlots;
  NK.Combat.playerAction(c, { type: 'cast', spellId: spell.spell.id, slot: p.pactLevel, target: c.enemies.find((e) => e.hp > 0) && c.enemies.find((e) => e.hp > 0).uid });
  if (p.pactSlots !== before - 1) throw new Error('契约法术未消耗邪术环');
  console.log(`邪术师契约魔法 OK：pactLevel=${p.pactLevel} 邪术环 ${p.pactSlots}/${p.pactSlotsMax}`);
} catch (e) { bad++; console.log('  X 邪术师契约魔法 ->', e.message); }

// 德鲁伊/奥术工匠 施法可用
for (const id of ['druid', 'artificer']) {
  try {
    const { c, p } = startRunBattle(id, NK.Data.get('classes').classes.find((x) => x.id === id).subclasses[0].id);
    const acts = NK.Combat.availableActions(c);
    const n = acts.spells.filter((s) => s.ok).length;
    if (n === 0) throw new Error('无可用法术');
    console.log(`  · ${id} 可用法术 ${n} 个，最高环 ${R.maxSpellLevel(p)}`);
  } catch (e) { bad++; console.log('  X', id, '->', e.message); }
}

console.log(bad ? `\n❌ 失败 ${bad} 项` : '\n✔ 全部通过');
process.exit(bad ? 1 : 0);

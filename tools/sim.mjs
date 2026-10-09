// 平衡模拟器：用自动策略跑 N 局，输出通关率、战斗长度、生命消耗等指标
// 用法：node tools/sim.mjs [局数] [难度] [职业]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js'];
const store = {};
const ctx = {
  console,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of FILES) vm.runInContext(readFileSync(join(root, 'js', f), 'utf8'), ctx, { filename: 'js/' + f });
const NK = ctx.NK;
const R = NK.Rules;
await NK.Data.load();

const RUNS = parseInt(process.argv[2] || '120', 10);
const DIFF = parseInt(process.argv[3] || '1', 10);
const ONLY = process.argv[4] || null;

const PB = NK.Data.get('rules').pointBuy;

function pointBuyFor(priority) {
  const attrs = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  let left = PB.total;
  const spend = (k) => {
    while (left > 0 && attrs[k] < PB.max) {
      const cost = PB.cost[String(attrs[k] + 1)] - PB.cost[String(attrs[k])];
      if (cost > left) break;
      attrs[k] += 1; left -= cost;
    }
  };
  for (const k of priority) spend(k);
  for (const k of ['con', 'dex', 'wis', 'str', 'cha', 'int']) spend(k);
  return attrs;
}

const BUILDS = {
  warrior: { race: 'dwarf', bg: 'soldier', pri: ['str', 'con'], pack: 0 },
  paladin: { race: 'half_orc', bg: 'acolyte', pri: ['str', 'cha', 'con'], pack: 0 },
  ranger: { race: 'elf', bg: 'folk_hero', pri: ['dex', 'con', 'wis'], pack: 0 },
  rogue: { race: 'halfling', bg: 'urchin', pri: ['dex', 'con'], pack: 0 },
  cleric: { race: 'dwarf', bg: 'hermit', pri: ['wis', 'con', 'str'], pack: 0 },
  wizard: { race: 'gnome', bg: 'sage', pri: ['int', 'con'], pack: 0 },
};

function buildCharacter(classId, difficulty) {
  const b = BUILDS[classId];
  const cls = R.classDef(classId);
  const attrs = pointBuyFor(b.pri);
  const bg = R.bgDef(b.bg);
  const race = R.raceDef(b.race);
  const granted = new Set(bg.skills.concat(((race.traits || []).flatMap((t) => (t.effects && t.effects.skillProfs) || []))));
  const skills = cls.skillChoices.from.filter((s) => !granted.has(s)).slice(0, cls.skillChoices.count);
  const pack = NK.Items.startingPacks(classId)[b.pack];
  const equipment = NK.Items.packToItems(pack);
  // 法术：戏法挑伤害，一环挑伤害/治疗
  const sc = cls.spellcasting;
  let cantrips = [], spells = [];
  if (sc) {
    const pool0 = NK.Data.get('spells').spells.filter((s) => s.classes.includes(classId) && s.level === 0);
    const rank = (s) => (['spell_attack', 'save', 'auto'].includes(s.kind) ? 0 : s.kind === 'heal' ? 1 : 2);
    cantrips = pool0.slice().sort((a, c) => rank(a) - rank(c)).slice(0, sc.cantrips || 0).map((s) => s.id);
    const pool1 = NK.Data.get('spells').spells.filter((s) => s.classes.includes(classId) && s.level === 1);
    const need = sc.spellbook ? Math.min(sc.spellsAtLevel1 || 6, pool1.length) : sc.prepared ? 3 : 0;
    spells = pool1.slice().sort((a, c) => rank(a) - rank(c)).slice(0, need).map((s) => s.id);
  }
  const run = NK.Run.start({
    rng: NK.RNG.make(), raceId: b.race, classId, subclassId: null, bgId: b.bg, attrs,
    skills, cantrips, spells, pack: b.pack, difficulty, name: '模拟者', equipment,
    knownSpells: sc && !sc.prepared ? spells.slice() : [],
    prepared: sc && sc.prepared ? spells.slice() : [],
  });
  run.player.inventory = [NK.Items.consumableById('potion_healing_lesser'), NK.Items.consumableById('potion_healing_lesser')].filter(Boolean);
  return run;
}

function autoEquip(run) {
  const p = run.player;
  const score = (x) => (x ? (x.price || 0) + (x.bonus ? (x.bonus.dmg || 0) * 30 + (x.bonus.hit || 0) * 30 : 0) : -1);
  for (const it of (p.bag || []).slice()) {
    const slot = it.slot === 'rings' ? 'rings' : it.slot;
    if (slot === 'offHand' && !it.dice && !p.proficiencies.armor.includes('shield')) continue;
    if (slot === 'body' && !p.proficiencies.armor.includes(it.category)) continue;
    if (it.dice && !p.proficiencies.weapons.includes(it.category) && !p.proficiencies.weapons.includes('martial')) continue;
    const cur = slot === 'rings' ? (p.items.rings[p.items.rings.length - 1] || null) : p.items[slot];
    if (score(it) > score(cur)) NK.Run.equip(run, it, slot);
  }
  // 有第二件单手武器就装到左手（副手攻击）
  const off = p.bag.find((it) => it.dice && !it.twoHanded && p.items.mainHand && p.items.mainHand.hands === 1);
  if (off && !p.items.offHand) NK.Run.equip(run, off, 'offHand');
}

function autoDrink(run) {
  const p = run.player;
  let guard = 0;
  while (p.hp / p.maxHp < 0.55 && guard++ < 5) {
    const i = p.inventory.findIndex((it) => it.effect && it.effect.heal);
    if (i < 0) break;
    NK.Run.useConsumable(run, i);
  }
}

function autoLevel(run) {
  const p = run.player;
  let g = 0;
  while (R.pendingChoices(p).length && g++ < 40) {
    const pend = R.pendingChoices(p)[0];
    const cls = R.classDef(p.classId);
    if (pend.kind === 'subclass') R.chooseSubclass(p, cls.subclasses[0].id);
    else if (pend.kind === 'style') R.chooseStyle(p, NK.Data.get('rules').fightingStyles.find((s) => s.id === (cls.primary === 'dex' ? 'fs_archery' : 'fs_defense')).id);
    else if (pend.kind === 'expertise') {
      const cand = p.proficiencies.skills.find((s) => !(p.expertise || []).includes(s));
      if (!cand) break;
      R.chooseExpertise(p, cand);
    } else if (pend.kind === 'asi') {
      // 主属性满了就补体质
      const main = cls.primary;
      const alloc = {};
      if (p.attrs[main] < 20) alloc[main] = 2; else alloc.con = 2;
      R.chooseAsi(p, alloc);
    } else {
      const pool = R.spellPool(p, pend.kind === 'cantrips');
      if (!pool.length) break;
      const rank = (s) => (['spell_attack', 'save', 'auto'].includes(s.kind) ? 0 : s.kind === 'heal' ? 1 : 2);
      R.learnSpell(p, pool.slice().sort((a, c) => rank(a) - rank(c))[0].id, pend.kind === 'cantrips');
      p.spellChoicesTaken = p.spellChoicesTaken || [];
      p.spellChoicesTaken.push(pend.level);
    }
  }
  if (p.flags.layOnHands) p.layPool = Math.max(p.layPool || 0, p.level * p.flags.layOnHands);
  if (p.flags.superiority) p.superiorityLeft = p.flags.superiority;
  R.recalc(p);
}

function simulateOne(classId, difficulty, seed) {
  const run = buildCharacter(classId, difficulty);
  const stats = { battles: 0, rounds: 0, hits: 0, misses: 0, crits: 0, hpCost: {}, hpCostN: {}, events: 0, rests: 0, shortRest: 0, longRest: 0, nodes: 0, wins: 0, deaths: {} };
  let guard = 0;
  while (!run.ended && guard++ < 500) {
    const s = run.state;
    if (s === 'battle') {
      const c = run._combat;
      const hpBefore = run.player.hp;
      const rBefore = c.round;
      NK.Combat.autoPlayerTurn(c);
      stats.battles += 1;
      stats.rounds += Math.max(1, c.round - rBefore + 1);
      const pct = Math.max(0, hpBefore - run.player.hp) / Math.max(1, run.player.maxHp);
      const k = run.battleKind;
      stats.hpCost[k] = (stats.hpCost[k] || 0) + pct;
      stats.hpCostN[k] = (stats.hpCostN[k] || 0) + 1;
      for (const l of c.log) {
        if (l.t.includes('命中！')) stats.hits += 1;
        if (l.t.includes('重击！')) stats.crits += 1;
        if (l.t.includes('未命中。')) stats.misses += 1;
        if (l.t.includes('大失败')) stats.misses += 1;
      }
      const res = NK.Run.finishBattle(run, c);
      if (c.result === 'victory') stats.wins += 1;
      if (res.defeat) { stats.deaths[run.deathCause || '未知'] = (stats.deaths[run.deathCause || '未知'] || 0) + 1; }
      autoLevel(run);
      autoEquip(run);
      autoDrink(run);
      continue;
    }
    if (s === 'levelup') { autoLevel(run); run.state = 'map'; continue; }
    if (s === 'rest') {
      stats.rests += 1;
      const p = run.player;
      const o = NK.Run.restOptions(run);
      const hp = p.hp / p.maxHp;
      if (hp < 0.35 && o.long.ok) { NK.Run.restLong(run); stats.longRest += 1; }
      else if (hp < 0.6 && o.short.ok) { NK.Run.restShort(run, Math.min(3, p.hitDice.left)); stats.shortRest += 1; }
      else if (hp < 0.6 && o.long.ok) { NK.Run.restLong(run); stats.longRest += 1; }
      else {
        const node = NK.Run.node(run);
        if (node) node.done = true;
        run.state = 'map';
      }
      continue;
    }
    if (s === 'event') {
      stats.events += 1;
      const ev = run.event;
      const idxs = ev.options.map((o, i) => i).filter((i) => NK.Events.checkRequire(run, ev.options[i]).ok);
      const pick = run.rng.pick(idxs.length ? idxs : [0]);
      const out = NK.Events.resolve(run, ev.options[pick], run.rng);
      NK.Events.applyEffect(run, out.effect, run.rng);
      if (out.effect.fight) {
        const c = NK.Run.startBattle(run, out.effect.fight);
        NK.Combat.autoPlayerTurn(c);
        NK.Run.finishBattle(run, c);
        autoLevel(run); autoEquip(run); autoDrink(run);
      } else {
        const node = NK.Run.node(run);
        if (node) node.done = true;
        run.state = 'map';
      }
      if (run.forceDown) { run.ended = true; run.victory = false; run.deathCause = '事件'; }
      continue;
    }
    if (s === 'shop') {
      for (const e of run.shop.items.concat(run.shop.consumables).slice().sort((a, b) => a.price - b.price)) {
        if (run.gold >= e.price && (e.kind !== 'gear' || (run.player.bag || []).length < 4)) NK.Shop.buy(run, e);
      }
      autoEquip(run);
      const node = NK.Run.node(run);
      if (node) node.done = true;
      run.state = 'map';
      continue;
    }
    if (s === 'treasure') { const node = NK.Run.node(run); if (node) node.done = true; run.state = 'map'; autoEquip(run); continue; }
    if (s !== 'map') break;
    // 选路
    const avail = NK.MapGen.available(run);
    if (!avail.length) break;
    const hp = run.player.hp / run.player.maxHp;
    const act = run.map.acts[run.actIndex];
    const own = (n) => {
      if (n.type === 'rest') return hp < 0.55 ? 0 : 6;
      if (n.type === 'shop') return hp < 0.5 ? 2.5 : 2;
      if (n.type === 'elite') return hp > 0.85 ? 2 : 6;
      if (n.type === 'battle') return hp < 0.4 ? 4 : 1.5;
      if (n.type === 'event') return 2.2;
      if (n.type === 'treasure') return 2.6;
      if (n.type === 'boss') return 3;
      return 3;
    };
    const look = (n, depth) => {
      const sc = own(n);
      if (depth <= 0) return sc;
      const kids = (n.next || []).map((id) => NK.MapGen.nodeById(act, id)).filter((k) => k && !k.done);
      if (!kids.length) return sc;
      return sc * 0.6 + Math.min.apply(null, kids.map((k) => look(k, depth - 1))) * 0.4;
    };
    const scored = avail.slice().sort((a, b) => look(a, 2) - look(b, 2));
    stats.nodes += 1;
    NK.Run.enterNode(run, scored[0].id);
  }
  return { run, stats };
}

const classes = ONLY ? [ONLY] : ['warrior', 'paladin', 'ranger', 'rogue', 'cleric', 'wizard'];
const rows = [];
for (const cid of classes) {
  const agg = {
    cls: R.classDef(cid).name, n: RUNS, clears: 0, acts: 0, level: 0, kills: 0,
    battles: 0, rounds: 0, hitRate: 0, critRate: 0, events: 0, nodes: 0, hpCost: {}, hpCostN: {}, deaths: {},
  };
  for (let i = 0; i < RUNS; i++) {
    const { run, stats } = simulateOne(cid, DIFF, 1000 + i * 7919);
    if (run.victory) agg.clears += 1;
    agg.acts += run.actIndex + 1;
    agg.level += run.player.level;
    agg.kills += run.kills;
    agg.battles += stats.battles;
    agg.rounds += stats.rounds;
    agg.events += stats.events;
    agg.nodes += stats.nodes;
    agg.hitRate += stats.hits / Math.max(1, stats.hits + stats.misses);
    agg.critRate += stats.crits / Math.max(1, stats.hits);
    for (const k of Object.keys(stats.hpCost)) {
      agg.hpCost[k] = (agg.hpCost[k] || 0) + stats.hpCost[k];
      agg.hpCostN[k] = (agg.hpCostN[k] || 0) + stats.hpCostN[k];
    }
    for (const k of Object.keys(stats.deaths)) agg.deaths[k] = (agg.deaths[k] || 0) + stats.deaths[k];
  }
  const cost = Object.keys(agg.hpCostN).map((k) => `${k} ${(agg.hpCost[k] / agg.hpCostN[k] * 100).toFixed(0)}%×${(agg.hpCostN[k] / RUNS).toFixed(1)}`).join('　');
  rows.push({
    职业: agg.cls,
    通关率: (agg.clears / RUNS * 100).toFixed(0) + '%',
    平均幕数: (agg.acts / RUNS).toFixed(2),
    平均等级: (agg.level / RUNS).toFixed(1),
    平均击杀: (agg.kills / RUNS).toFixed(1),
    场次: (agg.battles / RUNS).toFixed(1),
    回合: (agg.rounds / Math.max(1, agg.battles)).toFixed(1),
    命中率: (agg.hitRate / RUNS * 100).toFixed(0) + '%',
    暴击率: (agg.critRate / RUNS * 100).toFixed(0) + '%',
    节点: (agg.nodes / RUNS).toFixed(1),
    每场消耗: cost,
  });
  const top = Object.entries(agg.deaths).sort((a, b) => b[1] - a[1]).slice(0, 4);
  rows[rows.length - 1].主要死因 = top.map(([k, v]) => `${k}×${v}`).join(' ');
}
console.log(`\n=== 《渊下》平衡模拟（难度 ${DIFF}，每职业 ${RUNS} 局，自动策略是下界）===`);
console.table(rows);

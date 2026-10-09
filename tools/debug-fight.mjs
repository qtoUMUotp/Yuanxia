// 调试：打印一场指定战斗的完整过程（含怪物数值与每回合 HP 变化）
// 用法：node tools/debug-fight.mjs [职业] [怪物id或rank] [难度]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js'];
const store = {};
const ctx = { console, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of FILES) vm.runInContext(readFileSync(join(root, 'js', f), 'utf8'), ctx, { filename: 'js/' + f });
const NK = ctx.NK;
const R = NK.Rules;
await NK.Data.load();

const classId = process.argv[2] || 'rogue';
const which = process.argv[3] || 'boss';
const lvl = parseInt(process.argv[4] || '3', 10);
const diff = parseInt(process.argv[5] || '1', 10);

const PB = NK.Data.get('rules').pointBuy;
const PRI = { warrior: ['str', 'con'], paladin: ['str', 'cha', 'con'], ranger: ['dex', 'con', 'wis'], rogue: ['dex', 'con'], cleric: ['wis', 'con', 'str'], wizard: ['int', 'con'], mage: ['int', 'con'] };
const RACE = { warrior: 'dwarf', paladin: 'half_orc', ranger: 'elf', rogue: 'halfling', cleric: 'dwarf', wizard: 'gnome', mage: 'gnome' };
const BG = { warrior: 'soldier', paladin: 'acolyte', ranger: 'folk_hero', rogue: 'urchin', cleric: 'hermit', wizard: 'sage', mage: 'sage' };

function pointBuyFor(priority) {
  const attrs = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  let left = PB.total;
  const spend = (k) => { while (left > 0 && attrs[k] < PB.max) { const c = PB.cost[String(attrs[k] + 1)] - PB.cost[String(attrs[k])]; if (c > left) break; attrs[k] += 1; left -= c; } };
  for (const k of priority) spend(k);
  for (const k of ['con', 'dex', 'wis', 'str', 'cha', 'int']) spend(k);
  return attrs;
}

const cls = R.classDef(classId === 'mage' ? 'wizard' : classId);
const attrs = pointBuyFor(PRI[classId]);
const bg = R.bgDef(BG[classId]);
const race = R.raceDef(RACE[classId]);
const granted = new Set(bg.skills.concat((race.traits || []).flatMap((t) => (t.effects && t.effects.skillProfs) || [])));
const skills = cls.skillChoices.from.filter((s) => !granted.has(s)).slice(0, cls.skillChoices.count);
const pack = NK.Items.startingPacks(cls.id)[0];
const sc = cls.spellcasting;
let cantrips = [], spells = [];
if (sc) {
  const rank = (s) => (['spell_attack', 'save', 'auto'].includes(s.kind) ? 0 : s.kind === 'heal' ? 1 : 2);
  cantrips = NK.Data.get('spells').spells.filter((s) => s.classes.includes(cls.id) && s.level === 0).sort((a, b) => rank(a) - rank(b)).slice(0, sc.cantrips || 0).map((s) => s.id);
  const p1 = NK.Data.get('spells').spells.filter((s) => s.classes.includes(cls.id) && s.level === 1);
  const need = sc.spellbook ? Math.min(sc.spellsAtLevel1 || 6, p1.length) : sc.prepared ? 3 : 0;
  spells = p1.sort((a, b) => rank(a) - rank(b)).slice(0, need).map((s) => s.id);
}
const p = R.createPlayer({
  raceId: RACE[classId], classId: cls.id, subclassId: cls.id === 'cleric' ? 'life' : null, bgId: BG[classId],
  attrs, skills, cantrips, spells, equipment: NK.Items.packToItems(pack),
  knownSpells: sc && !sc.prepared ? spells.slice() : [], prepared: sc && sc.prepared ? spells.slice() : [],
});
p.inventory = [NK.Items.consumableById('potion_healing_lesser')];
R.gainXp(p, R.xpNeeded(lvl - 1) || 0);
let g = 0;
while (R.pendingChoices(p).length && g++ < 30) {
  const pend = R.pendingChoices(p)[0];
  if (pend.kind === 'subclass') R.chooseSubclass(p, cls.subclasses[0].id);
  else if (pend.kind === 'style') R.chooseStyle(p, NK.Data.get('rules').fightingStyles[0].id);
  else if (pend.kind === 'expertise') { const c2 = p.proficiencies.skills.find((s) => !(p.expertise || []).includes(s)); if (!c2) break; R.chooseExpertise(p, c2); }
  else if (pend.kind === 'asi') { const a = {}; a[cls.primary] = 2; R.chooseAsi(p, a); }
  else { const pool = R.spellPool(p, pend.kind === 'cantrips'); if (!pool.length) break; R.learnSpell(p, pool[0].id, pend.kind === 'cantrips'); p.spellChoicesTaken.push(pend.level); }
}
R.recalc(p);

const d = NK.Run.difficulty(diff);
const tier = { id: d.id, hpMul: d.hpMul, dmgMul: d.dmgMul, hitAdd: d.hitAdd };
const actDef = NK.Data.get('maps').acts[which === 'boss' ? 0 : 0];
const rng = NK.RNG.make(42);
const enemies = NK.Data.get('monsters').monsters.some((m) => m.id === which)
  ? [NK.Combat.makeEnemy(which, tier, rng)]
  : which === 'boss' ? [NK.Combat.makeEnemy(actDef.boss, tier, rng)]
    : which === 'elite' ? [NK.Combat.makeEnemy(rng.pick(actDef.elites), tier, rng)]
      : [NK.Combat.makeEnemy(rng.pick(actDef.pool), tier, rng)];

console.log(`=== ${R.raceDef(p.raceId).name} ${cls.name} Lv.${p.level}${p.subclassId ? '/' + R.subclassOf(p).name : ''} ===`);
console.log(`HP ${p.maxHp}　AC ${p.ac}　命中 ${R.attackBonus(p)}　伤害 ${R.weaponDice(p)}+${R.damageBonus(p)}　偷袭 ${p.mods.sneakAttack || 0}d6　法术DC ${R.spellDc(p)}　法术位 ${p.slots.join('/')}`);
for (const e of enemies) {
  console.log(`--- 敌人 ${e.name}（${e.rank}）HP ${e.maxHp} AC ${e.ac} 命中 ${e.atk.bonus} 伤害 ${e.atk.dice}×${e.dmgMul.toFixed(2)} multi=${e.multiattack}`);
  for (const a of e.abilities) console.log(`      能力 ${a.name} kind=${a.kind} dice=${a.dice || '-'} dc=${a.dc || '-'} cd=${a.cooldown} cond=${a.cond ? a.cond.id : '-'}`);
  for (const t of e.traits) console.log(`      特性 ${t.name} (${t.effect})`);
}
const c = NK.Combat.start(p, enemies, { rng, tier, act: 1, source: which === 'boss' ? 'boss' : which });
let turn = 0;
while (!c.over && turn++ < 60) {
  const before = p.hp;
  NK.Combat.autoPlayerTurn(c);
  console.log(`[第 ${c.round} 回合结束] 玩家 HP ${Math.max(0, p.hp)}/${p.maxHp}（本回合 -${Math.max(0, before - p.hp)}）　敌人 ${enemies.map((e) => `${e.name} ${Math.max(0, e.hp)}/${e.maxHp}`).join(' ')}`);
}
console.log('\n--- 日志 ---');
console.log(c.log.map((l) => l.t).join('\n'));
console.log(`\n结果：${c.result}　玩家 HP ${Math.max(0, p.hp)}/${p.maxHp}　回合数 ${c.round}`);
console.log('结束时玩家状态：' + (p.conditions.map((x) => `${x.name}(${x.turns})`).join(' ') || '无'));

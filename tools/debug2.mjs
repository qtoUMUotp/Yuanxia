import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js'];
const store = {};
const ctx = { console, document: { readyState: 'complete', getElementById: () => ({ innerHTML: '', querySelector: () => null }), addEventListener: () => {}, querySelector: () => null }, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, setTimeout, clearTimeout, addEventListener: () => {}, prompt: () => '' };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of FILES) { const code = readFileSync(join(root, 'js', f), 'utf8'); vm.runInContext(code, ctx, { filename: 'js/' + f }); }
const NK = ctx.NK;
await NK.Data.load();
const Combat = NK.Combat, R = NK.Rules;

// --- Bug 1: 精确复现 smoke 的 fieldBattle('ranger') ---
const rng = NK.RNG.make(101);
const p = R.createPlayer({ raceId: 'human', classId: 'ranger', bgId: 'folk_hero', attrs: { str: 12, dex: 15, con: 14, int: 10, wis: 12, cha: 8 }, skills: [], equipment: [NK.Items.weapon('longbow'), NK.Items.weapon('longsword')] });
const e = Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
const ranged = Combat.makeEnemy('goblin_shaman', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
p.maxHp = 400; p.hp = 400;
console.log('p.conditions BEFORE start=', JSON.stringify(p.conditions));
const c = Combat.start(p, [e, ranged], { rng, tier: { id: 1, hpMul: 1, dmgMul:1, hitAdd: 0 }, act: 1, source: 'normal', allowSurprise: false });
console.log('p.conditions AFTER start=', JSON.stringify(p.conditions));
const melee = e;
console.log('start intentTier=', c.intentTier);
console.log('p.items.mainHand.kind=', p.items.mainHand && p.items.mainHand.kind, 'offHand=', p.items.offHand && p.items.offHand.kind);
melee.band = 0;
console.log('band0 attackMode(ranged)=', JSON.stringify(Combat.attackMode(c, p, melee, { ranged: true })), 'bandOf=', Combat.bandOf(p, melee));
melee.band = 1;
console.log('--- manual attackMode breakdown (band1) ---');
console.log('  p.conditions=', JSON.stringify(p.conditions), 'p.flags.disadv=', p.flags && p.flags.disadvantageAgainst);
console.log('  melee.band=', melee.band, 'bandOf(p,melee)=', Combat.bandOf(p, melee), 'isPlayer(melee)=', (NK.Combat.isPlayer ? NK.Combat.isPlayer(melee) : '?'));
console.log('  atkWeapon.kind=', p.items.mainHand && p.items.mainHand.kind, 'rangedAttack=', (p.items.mainHand && p.items.mainHand.kind === 'ranged'));
console.log('  bandOf===0 ?', Combat.bandOf(p, melee) === 0);
console.log('band1 attackMode(ranged)=', JSON.stringify(Combat.attackMode(c, p, melee, { ranged: true })), 'bandOf=', Combat.bandOf(p, melee));
console.log('band1 attackMode(noFlag)=', JSON.stringify(Combat.attackMode(c, p, melee)), 'bandOf=', Combat.bandOf(p, melee));
melee.band = 2;
console.log('band2 attackMode(ranged)=', JSON.stringify(Combat.attackMode(c, p, melee, { ranged: true })), 'bandOf=', Combat.bandOf(p, melee));

// --- Bug 2: planIntent web_sanctuary detail ---
const rng2 = NK.RNG.make(71);
const p2 = R.createPlayer({ raceId: 'human', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, skills: [] });
const e2 = Combat.makeEnemy('spider_queen_priestess', { id: 1, hpMul: 0.22, dmgMul: 0.68, hitAdd: 0 }, rng2);
const c2 = Combat.start(p2, [e2], { rng: rng2, tier: { id: 1, hpMul: 0.22, dmgMul: 0.68, hitAdd: 0 }, act: 1, source: 'boss', allowSurprise: false });
console.log('boss intentTier=', c2.intentTier);
console.log('e2.intent=', JSON.stringify(e2.intent));
const it = Combat.planIntent(c2, e2);
console.log('planIntent(tier default)=', JSON.stringify(it));

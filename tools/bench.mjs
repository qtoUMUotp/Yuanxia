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
  setTimeout, clearTimeout, addEventListener: () => {}, prompt: (msg, def) => (def || '测试配置'),
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of FILES) { const code = readFileSync(join(root, 'js', f), 'utf8'); vm.runInContext(code, ctx, { filename: 'js/' + f }); }
const NK = ctx.NK;
await NK.Data.load();

const R = NK.Rules;
const rng = NK.RNG.make(7);
const p = R.createPlayer({ raceId: 'half_orc', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 10 }, skills: ['athletics', 'perception'], equipment: [NK.Items.weapon('longsword'), NK.Items.armor('chain_mail')] });
const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal', allowSurprise: false });
console.log('start enemies hp', c.enemies.map(x=>x.hp), 'player hp', p.hp, 'maxHp', p.maxHp);

const t0 = Date.now();
let turns = 0;
const BIG = 200;
for (let i = 0; i < BIG && !c.over; i++) {
  NK.Combat.autoPlayerTurn(c);
  if (!c.over) NK.Combat.endPlayerTurn(c);
  turns++;
}
const dt = Date.now() - t0;
console.log(`full player+enemy turns x${turns}: ${dt}ms  (${(dt/turns).toFixed(2)}ms/turn)  over=${c.over}  enemyHp=${c.enemies.map(x=>x.hp)} playerHp=${p.hp}`);

// 测 map 节点生成
const t1 = Date.now();
const r = NK.Run.start({ rng: NK.RNG.make(3), raceId: 'half_orc', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 10 }, skills: ['athletics','perception'], pack: 0, difficulty: 1, name: 'B' });
let nodes = 0;
for (let i = 0; i < 50; i++) { const av = NK.MapGen.available(r); if (!av.length) break; nodes++; NK.Run.enterNode(r, av[0].id); if (r.screen === 'battle' && r._combat) { r._combat.over = true; r._combat.result='victory'; NK.Run.finishBattle(r); } }
const dt2 = Date.now() - t1;
console.log(`map/enterNode x${nodes}: ${dt2}ms  (${(dt2/nodes).toFixed(2)}ms/node)`);

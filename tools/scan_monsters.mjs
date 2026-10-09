// 逐怪物扫描：定位会让自动战斗死循环/超时的敌人
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js'];
const store = {};
const html = { innerHTML: '', querySelector: () => null };
const ctx = {
  console, document: { readyState: 'complete', getElementById: () => html, addEventListener: () => {}, querySelector: () => null },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  setTimeout, clearTimeout, addEventListener: () => {}, prompt: (m, d) => (d || ''),
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of FILES) { const code = readFileSync(join(root, 'js', f), 'utf8'); vm.runInContext(code, ctx, { filename: 'js/' + f }); }
const NK = ctx.NK;
await NK.Data.load();
const R = NK.Rules, Combat = NK.Combat;

// 收集真正的怪物 id（monsters.json 顶层 monsters 数组）
const monsters = NK.Data.get('monsters').monsters.map((m) => m.id);
const NODE = '/c/Users/black/.workbuddy/binaries/node/versions/22.22.2-6/node.exe';
console.log(`共 ${monsters.length} 个怪物，逐个跑自动战斗（每回合含敌方回合），单怪超 2s 视为死循环`);

const bad = [];
for (const mid of monsters) {
  const src = `const R=ctx.NK.R, Combat=ctx.NK.Combat;
const p = R.createPlayer({ raceId:'dwarf', classId:'warrior', bgId:'soldier', attrs:{str:15,dex:14,con:14,int:8,wis:10,cha:8}, skills:[], equipment:[R.Items.weapon('longsword'), R.Items.armor('chain_mail')] });
p.maxHp=400; p.hp=400;
const e = Combat.makeEnemy(${JSON.stringify(mid)}, { id:1, hpMul:1, dmgMul:1, hitAdd:0 }, ctx.NK.RNG.make(7));
e.maxHp=400; e.hp=400;
const c = Combat.start(p, [e], { rng: ctx.NK.RNG.make(7), tier:{id:1,hpMul:1,dmgMul:1,hitAdd:0}, act:1, source:'normal', allowSurprise:false });
let guard=0; const t0=Date.now();
while(!c.over && guard++<400){ if(c.player.dying){Combat.autoDeathSaves(c); if(c.over) break; Combat.endPlayerTurn(c);} else { Combat.autoPlayerTurn(c); } }
console.log(JSON.stringify({id:${JSON.stringify(mid)}, over:c.over, result:c.result, turns:guard, ms:Date.now()-t0}));`;
  const f = join(root, 'tools', '_mon_tmp.js');
  writeFileSyncSafe(f, `const ctx = globalThis.__CTX; ${src}`);
  ctx.__CTX = ctx;
  let out = '';
  try {
    out = execSync(`${NODE} ${f}`, { timeout: 3000, cwd: root, env: process.env }).toString();
  } catch (e) { out = 'TIMEOUT_OR_ERR:' + (e.stdout?.toString() || '') + (e.message || ''); }
  // 取最后一行 JSON
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop() || out.trim();
  if (line.startsWith('{')) {
    const j = JSON.parse(line);
    if (j.ms > 2000 || !j.over) { bad.push(j); console.log(`  ⚠ ${j.id} over=${j.over} result=${j.result} turns=${j.turns} ms=${j.ms}`); }
    else console.log(`  ✔ ${j.id} over=${j.over} (${j.ms}ms)`);
  } else {
    bad.push({ id: mid, err: line.slice(0, 80) });
    console.log(`  ⚠ ${mid} ${line.slice(0, 80)}`);
  }
}
function writeFileSyncSafe(p, c) { const fs = require('fs'); fs.writeFileSync(p, c); }
console.log(`\n异常怪物：${bad.length}`);

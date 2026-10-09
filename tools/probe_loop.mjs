// 探针：验证 __NO_RENDER__ 是否生效，并定位整局循环的内存增长来源
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
const R = NK.Rules, UI = NK.UI, App = UI.App;
UI.init(); UI.act('t:new');
UI.act('c:race', { id: 'half_orc' });
UI.act('c:class', { id: 'warrior' });
UI.act('c:bg', { id: 'soldier' });
const c = App.create;
c.attrs = { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 10 };
UI.act('c:skill', { id: 'athletics' }); UI.act('c:skill', { id: 'perception' });
function stepsNow() { const cl = c.classId ? R.classDef(c.classId) : null; const s = ['race', 'class']; if (cl && cl.subclassLevel === 1) s.push('subclass'); s.push('bg', 'attrs', 'skills'); if (cl && cl.spellcasting) s.push('spells'); s.push('pack', 'difficulty'); return s[c.step]; }
while (['attrs', 'skills'].includes(stepsNow())) UI.act('c:next');
while (stepsNow() === 'pack') UI.act('c:next');
UI.act('c:diff', { id: '1' }); UI.act('c:start');

// 验证渲染钩子
ctx.__NO_RENDER__ = true;
const before = html.innerHTML.length;
UI.render();
const after = html.innerHTML.length;
console.log(`NO_RENDER 钩子：${ctx.__NO_RENDER__ ? '已设' : '未设'} → render 前后 innerHTML 长度 ${before} → ${after} （${after === before ? '生效（未重建）' : '未生效（仍重建）'}）`);
ctx.__NO_RENDER__ = false;

ctx.__NO_RENDER__ = true; // 循环期间关闭渲染
let guard = 0; const seen = {};
const t0 = Date.now();
let maxDt = 0, maxDtAt = 0;
while (App.run && !App.run.ended && guard++ < 500) {
  const s = App.screen; seen[s] = (seen[s] || 0) + 1;
  const itT0 = Date.now();
  if (s === 'map') { const av = NK.MapGen.available(App.run); if (!av.length) { console.log('地图无路'); break; } UI.act('node', { id: av[0].id }); }
  else if (s === 'battle') {
    const cc = App.run._combat;
    if (cc.over) { UI.act('b:continue'); continue; }
    const p = App.run.player; if (p.dying) { UI.act('b:pass'); continue; }
    const a = NK.Combat.autoAction(cc);
    if (a.type === 'cast') UI.act('b:cast', { id: a.spellId, slot: String(a.slot) });
    else if (a.type === 'bonus') UI.act('b:bonus', { id: a.id });
    else if (a.type === 'item') UI.act('b:item', { index: String(a.index) });
    else if (a.type === 'move') UI.act('b:move', { dir: a.dir });
    else if (a.type === 'attack') { App.targetUid = a.target; UI.act('b:attack'); }
    else UI.act('b:end');
  } else if (s === 'levelup') {
    const p = App.run.player; const pend = R.pendingChoices(p)[0];
    if (!pend) { UI.act('l:done'); continue; }
    if (pend.kind === 'subclass') UI.act('l:subclass', { id: R.classDef(p.classId).subclasses[0].id });
    else if (pend.kind === 'style') UI.act('l:style', { id: NK.Data.get('rules').fightingStyles[0].id });
    else if (pend.kind === 'expertise') UI.act('l:expertise', { id: p.proficiencies.skills[0] });
    else if (pend.kind === 'asi') { UI.act('l:attr:add', { k: R.classDef(p.classId).primary }); UI.act('l:attr:add', { k: R.classDef(p.classId).primary }); UI.act('l:asi'); }
    else if (pend.kind === 'classlevel') UI.act('l:classlevel', { id: p.lastLeveledClassId });
    else if (pend.kind === 'invocation') UI.act('l:invocation', { id: NK.Data.get('rules').invocations[0].id });
    else if (pend.kind === 'metamagic') UI.act('l:metamagic', { id: NK.Data.get('rules').metamagics[0].id });
    else if (pend.kind === 'pactBoon') UI.act('l:pactboon', { id: NK.Data.get('rules').pactBoons[0].id });
    else { const cls = R.classDef(p.classId); const known = pend.kind === 'cantrips' ? p.cantrips : (cls.spellcasting.prepared ? p.prepared : p.knownSpells); const maxLv = R.maxSpellLevel(p) || 1; const pool = NK.Data.get('spells').spells.filter((x) => x.classes.includes(p.classId) && (pend.kind === 'cantrips' ? x.level === 0 : (x.level >= 1 && x.level <= maxLv)) && !known.includes(x.id)); UI.act('l:spell', { id: pool[0].id }); }
  } else if (s === 'event') { if (App.run.eventResult) UI.act('ev:next'); else { const i = App.run.event.options.findIndex((o) => NK.Events.checkRequire(App.run, o).ok); UI.act('ev:opt', { index: String(i < 0 ? 0 : i) }); } }
  else if (s === 'shop') { UI.act('buy', { id: App.run.shop.items.concat(App.run.shop.consumables).find((x) => !x.sold && App.run.gold >= x.price)?.id }); UI.act('shop:leave'); }
  else if (s === 'rest') { const o = NK.Run.restOptions(App.run); const useLong = App.run.player.hp / App.run.player.maxHp < 0.3 && o.long.ok; UI.act(useLong ? 'rest:long' : (o.short.ok ? 'rest:short' : 'rest:none'), { n: '2' }); }
  else if (s === 'treasure') UI.act('t:continue');
  else if (s === 'over') break;
  else break;
  const dt = Date.now() - itT0;
  if (dt > maxDt) { maxDt = dt; maxDtAt = guard + ':' + s; }
  if (guard % 50 === 0) {
    const mem = process.memoryUsage().heapUsed / 1048576;
    console.log(`  #${guard} ${s} heap=${mem.toFixed(1)}MB 累计最慢=${maxDt}ms@${maxDtAt}`);
  }
}
console.log(`循环 ${guard} 步：${JSON.stringify(seen)} 用时 ${((Date.now()-t0)/1000).toFixed(1)}s 最慢=${maxDt}ms@${maxDtAt}`);

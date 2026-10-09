// 压力测试：13 个职业各自冲到 20 级，解析完全部升级选择，再打一场自动战斗。
// 目的：确保等级上限提到 20 之后，升级队列不会卡死、施法不会崩。
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
const R = NK.Rules, C = NK.Combat;
const bg0 = NK.Data.get('backgrounds').backgrounds[0].id;
const ids = NK.Data.get('classes').classes.map((c) => c.id);

let bad = 0;
for (const cid of ids) {
  try {
    const cls = R.classDef(cid);
    const p = R.createPlayer({
      raceId: 'human', bgId: bg0, classId: cid,
      attrs: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
      skills: [cls.skillChoices.from[0]], cantrips: [], knownSpells: [], prepared: [], name: 'S',
    });
    R.gainXp(p, 999999);
    let g = 0;
    while (R.pendingChoices(p).length && g++ < 600) {
      const pend = R.pendingChoices(p)[0];
      const oc = pend.classId || cid;
      if (pend.kind === 'classlevel') R.chooseClassLevel(p, { classId: p.lastLeveledClassId });
      else if (pend.kind === 'subclass') R.chooseSubclass(p, R.classDef(oc).subclasses[0].id, oc);
      else if (pend.kind === 'style') R.chooseStyle(p, NK.Data.get('rules').fightingStyles[0].id, oc);
      else if (pend.kind === 'expertise') {
        const cand = p.proficiencies.skills.find((s) => !(p.expertise || []).includes(s));
        if (!cand) p.expertise = p.proficiencies.skills.slice(0, 4);
        else R.chooseExpertise(p, cand);
      } else if (pend.kind === 'asi') { const a = {}; a[cls.primary] = 2; R.chooseAsi(p, a); }
      else if (pend.kind === 'invocation') {
        const list = NK.Data.get('rules').invocations; const n = (p.invocations || []).length;
        R.chooseInvocation(p, list[n % list.length].id);
      } else if (pend.kind === 'metamagic') {
        const list = NK.Data.get('rules').metamagics; const n = (p.metamagics || []).length;
        if (n >= list.length) { p.metamagics = []; continue; }
        R.chooseMetamagic(p, list[n].id);
      } else if (pend.kind === 'pactBoon') R.choosePactBoon(p, NK.Data.get('rules').pactBoons[0].id);
      else {
        const scx = R.classDef(oc).spellcasting || {};
        const store2 = (scx.spellbook || !scx.prepared) ? p.knownSpells : p.prepared;
        const known = pend.kind === 'cantrips' ? p.cantrips : store2;
        const eff = R.spellListOf(oc);
        const pool = NK.Data.get('spells').spells.filter((x) => x.classes.some((c) => eff.includes(c))
          && (pend.kind === 'cantrips' ? x.level === 0 : x.level <= R.maxSpellLevel(p)) && !known.includes(x.id));
        if (!pool.length) { p.spellChoicesTaken.push(pend.level); if (pend.kind === 'cantrips') { p.cantrips = R.classSpells(p).filter((s) => s.level === 0).slice(0, R.spellCapacity(p).cantrips).map((s) => s.id); } continue; }
        R.learnSpell(p, pool[0].id, pend.kind === 'cantrips', oc);
        p.spellChoicesTaken.push(pend.level);
      }
    }
    const pend2 = R.pendingChoices(p);
    const tier = { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 };
    const enemies = C.makeEncounter(NK.Data.get('maps').acts[0], 'normal', tier, NK.RNG.make(3));
    p.maxHp = 2000; p.hp = 2000;
    const c = C.start(p, enemies, { rng: NK.RNG.make(9), tier, act: 1, source: 'normal' });
    let t = 0;
    while (!c.over && t++ < 40) { C.autoPlayerTurn(c); if (c.over) break; const e = c.enemies.find((x) => !C.dead(x)); if (e) C.enemyTurn(c, e); }
    console.log(`${cid.padEnd(10)} Lv${p.level} HP${p.maxHp} 可施法${R.castableSpells(p).length} 剩余待办${pend2.length} 战斗${c.result || '进行中'} 迭代${g}`);
    if (pend2.length) bad += 1;
  } catch (e) { bad += 1; console.log(`${cid.padEnd(10)} ✘ ${e.message}`); }
}
console.log(bad ? `\n✘ ${bad} 个职业有问题` : '\n✔ 13 个职业冲到 20 级全流程无异常');
if (bad) process.exit(1);

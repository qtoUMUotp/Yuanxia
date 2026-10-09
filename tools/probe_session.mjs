/* 本轮六项改动的专项验证：
 * 1) 重渲染保持滚动位置（不再莫名其妙回到顶部）
 * 2) 动作失败后能改选（不会被「记住上一手」锁死）
 * 3) 职业 / 子职特性做到 20 级
 * 4) 每幕难度递增算法
 * 5) 取消通关，改为记录最远距离
 * 6) 地图直观化（绝对定位 + SVG 连线）
 */
import fs from 'fs';
import vm from 'vm';

const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js'];
// 图鉴/记录要写 localStorage，用一份真内存实现，不然读回来永远是空的
const store = {};
const ctx = {
  console,
  document: { readyState: 'complete', getElementById: () => ({ innerHTML: '' }), addEventListener: () => {}, querySelector: () => null },
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  setTimeout, clearTimeout, addEventListener: () => {}, prompt: (m, d) => d || 'T',
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of FILES) vm.runInContext(fs.readFileSync(`js/${f}`, 'utf8'), ctx, { filename: f });

const NK = ctx.NK, R = NK.Rules, UI = NK.UI, App = UI.App;
await NK.Data.load();

let bad = 0;
const ok = (cond, name, extra) => {
  console.log(`  ${cond ? '✔' : 'X'}  ${name}${extra !== undefined ? '　→ ' + extra : ''}`);
  if (!cond) bad++;
};

function drainChoices(run) {
  let g = 0;
  while (run.player.pendingChoices && run.player.pendingChoices.length && g++ < 400) {
    const b = run.player.pendingChoices[0];
    NK.Run.resolveChoice(run, null);
    if (run.player.pendingChoices[0] === b) run.player.pendingChoices.shift();
  }
  return run;
}

function startRun(classId, attrs, toLevel) {
  const cls = R.classDef(classId);
  const a = Object.assign({ str: 13, dex: 13, con: 13, int: 13, wis: 13, cha: 13 }, attrs || {});
  a[cls.primary] = Math.max(a[cls.primary], 15);
  const run = NK.Run.start({
    rng: NK.RNG.make(11), raceId: 'human', classId, bgId: 'soldier', name: 'T',
    attrs: a, skills: ['athletics', 'intimidation'], pack: 0, difficulty: 1, equipment: [],
  });
  drainChoices(run);
  // 需要高等级特性的用例：一级级升上去（一次给太多经验会连跳，子职等选择会被挤在一起）
  while (toLevel && run.player.level < toLevel) {
    R.gainXp(run.player, R.xpNeeded(run.player.level));
    drainChoices(run);
  }
  return run;
}

/* ================= 【1】滚动位置 ================= */
console.log('【1】重渲染不再把页面弹回顶部');
{
  let y = 0;
  const calls = [];
  ctx.scrollY = 0;
  ctx.scrollTo = (a, b) => { calls.push(b); };
  const get = () => calls[calls.length - 1];

  let captured = '';
  ctx.document.getElementById = () => ({ set innerHTML(v) { captured = v; }, get innerHTML() { return captured; }, addEventListener() {}, querySelector: () => null });

  const run = startRun('warrior', { str: 16 });
  App.run = run;

  App.screen = 'map'; UI.render();            // 首次进地图：应回到顶部
  ok(get() === 0, '换屏后回到顶部', get());

  ctx.scrollY = 640;                          // 用户往下滚了
  calls.length = 0;
  App.sheetTab = 'core'; UI.render();         // 同屏重渲染
  ok(get() === 640, '同屏重渲染保持滚动位置', get());

  ctx.scrollY = 900;
  calls.length = 0;
  App.screen = 'battle'; UI.render();         // 换到战斗屏
  ok(get() === 0, '切到战斗屏回到顶部', get());

  delete ctx.scrollTo;
}

/* ================= 【2】动作失败后能改选 ================= */
console.log('\n【2】动作失败后不会锁死在同一手上');
{
  const run = startRun('monk', { dex: 16, wis: 14 }, 5);   // 升到 5 级才有疾风连击
  const p = run.player;
  ok(p.level >= 5 && !!p.flags.flurry, '武僧 5 级有疾风连击', `Lv.${p.level}`);
  const c = NK.Run.startBattle(run, 'normal');
  // 把敌人全推到远距，让疾风连击（徒手 5 尺）够不到
  for (const e of c.enemies) e.band = 2;

  const acts = NK.Combat.availableActions(c);
  const flurry = acts.bonus.find((b) => b.id === 'flurry');
  ok(!!flurry && !!flurry.blocked, '远距时疾风连击被标记为够不到', flurry && flurry.blocked);

  const kiBefore = p.kiLeft;
  NK.Combat.playerAction(c, { type: 'bonus', id: 'flurry', target: c.enemies[0].uid });
  ok(!!c.actionFailed, '失败会在 c.actionFailed 上留下原因', c.actionFailed || '（空）');
  ok(p.kiLeft === kiBefore, '失败不消耗气', `${kiBefore} → ${p.kiLeft}`);
  ok(c.turn.bonus === true, '失败不消耗附赠动作');

  // UI 层：b:do 选中够不到的一项时不应执行，也不应记进「上一手」
  App.run = run; App.screen = 'battle';
  let captured = '';
  ctx.document.getElementById = () => ({ set innerHTML(v) { captured = v; }, get innerHTML() { return captured; }, addEventListener() {}, querySelector: () => null });
  UI.render();
  const usable = NK.Combat.availableActions(c).bonus.filter((b) => b.id);
  const idx = usable.findIndex((b) => b.id === 'flurry');
  App.selAction = idx;
  App.lastActionKey = 'bonus:flurry';
  UI.act('b:do');
  ok(App.lastActionKey === null, '执行失败后不记住这一手（否则下回合又选回它）', String(App.lastActionKey));

  // 改选后不会被记忆覆盖回去：挑一项「能用」的（不是够不到的），改选后应保持不动
  const acts2 = NK.Combat.availableActions(c);
  const okIdx = acts2.bonus.findIndex((b) => !b.blocked);
  ok(okIdx >= 0, '至少还有一项能用的附赠动作', acts2.bonus.map((b) => b.id + (b.blocked ? '(够不到)' : '')).join(' '));
  App.lastActionKey = 'bonus:flurry';
  App._memTurn = `${c.round}:${c.turnIndex}`;   // 本回合已经应用过记忆
  App.selAction = okIdx;
  UI.render();
  ok(App.selAction === okIdx, '同一回合内改选不会被「记住上一手」覆盖回去', `${okIdx} → ${App.selAction}`);
  run._combat = null;
}

/* ================= 【3】特性到 20 级 ================= */
console.log('\n【3】职业 / 子职特性覆盖到 20 级');
{
  const ANCHOR = {
    warrior: [3, 7, 10, 15, 18], rogue: [3, 9, 13, 17], paladin: [3, 7, 15, 20],
    ranger: [3, 7, 11, 15], monk: [3, 6, 11, 17], sorcerer: [1, 6, 14, 18],
    cleric: [1, 2, 6, 8, 17], bard: [3, 6, 14], artificer: [3, 6, 14],
    druid: [2, 6, 10, 14], wizard: [2, 6, 10, 14], warlock: [1, 6, 10, 14],
    barbarian: [3, 6, 10, 14],
  };
  const cls = NK.Data.get('classes').classes;
  let mainBad = [], subBad = [], anchorBad = [];
  for (const c of cls) {
    const lv = (c.features || []).map((f) => f.level);
    if (!lv.includes(20)) mainBad.push(c.id);
    for (const s of (c.subclasses || [])) {
      const sl = (s.features || []).map((f) => f.level).sort((a, b) => a - b);
      const max = Math.max(...sl, 0);
      const a = ANCHOR[c.id] || [];
      // 锚点等级必须原样出现在子职特性里
      if (!a.every((x) => sl.includes(x))) anchorBad.push(`${c.id}/${s.id}[${sl.join(',')}]`);
      if (max < 14) subBad.push(`${c.id}/${s.id} 只到 ${max}`);
    }
  }
  ok(!mainBad.length, '13 个主职都有 L20 特性', mainBad.join(' ') || '全部到 L20');
  ok(!anchorBad.length, '子职特性包含 5e 的全部锚点等级', anchorBad.join(' ') || '31 个子职全部符合');
  ok(!subBad.length, '没有子职停在 L14 以下', subBad.join(' ') || '无');

  // 20 级角色的人物卡要能看到这些特性
  const run = startRun('paladin', { str: 16, cha: 15 });
  run.player.classes[0].subclassId = 'devotion';
  R.gainXp(run.player, 400000);
  let g = 0;
  while (run.player.pendingChoices && run.player.pendingChoices.length && g++ < 400) {
    const b = run.player.pendingChoices[0];
    NK.Run.resolveChoice(run, null);
    if (run.player.pendingChoices[0] === b) run.player.pendingChoices.shift();
  }
  let captured = '';
  ctx.document.getElementById = () => ({ set innerHTML(v) { captured = v; }, get innerHTML() { return captured; }, addEventListener() {}, querySelector: () => null });
  App.run = run; App.modal = 'sheet'; App.sheetTab = 'features'; UI.render();
  const lvs = [...captured.matchAll(/<td class="hint"[^>]*>Lv\.(\d+)</g)].map((m) => +m[1]);
  ok(lvs.includes(20), '人物卡特性页出现 Lv.20 条目', `最高 Lv.${Math.max(...lvs, 0)}`);
  ok(lvs.some((x) => x >= 15 && x <= 19), '子职的 L15~L19 特性也在', lvs.filter((x) => x >= 15).join(','));
  ok(captured.includes('多才多艺'), '人物卡列出了种族特性');
  ok(captured.includes('背景'), '人物卡列出了背景特性');
  App.modal = null;
}

/* ================= 【4】每幕难度递增 ================= */
console.log('\n【4】每幕难度递增');
{
  const run = startRun('warrior', { str: 16 });
  const samples = [];
  const actCount = run.map.acts.length;
  for (let ai = 0; ai < actCount; ai++) {
    run.actIndex = ai;
    const layers = run.map.acts[ai].layers.length;
    for (let li = 0; li < layers; li++) {
      run.current = run.map.acts[ai].layers[li][0].id;
      samples.push(NK.Run.battleTier(run));
    }
  }
  const mono = (key) => samples.every((s, i) => i === 0 || s[key] >= samples[i - 1][key]);
  ok(mono('hpMul'), 'HP 倍率随深度单调不减', `${samples[0].hpMul.toFixed(2)} → ${samples[samples.length - 1].hpMul.toFixed(2)}`);
  ok(mono('dmgMul'), '伤害倍率随深度单调不减', `${samples[0].dmgMul.toFixed(2)} → ${samples[samples.length - 1].dmgMul.toFixed(2)}`);
  ok(mono('hitAdd'), '命中加值随深度单调不减', `${samples[0].hitAdd} → ${samples[samples.length - 1].hitAdd}`);
  ok(mono('acAdd'), 'AC 加值随深度单调不减', `${samples[0].acAdd} → ${samples[samples.length - 1].acAdd}`);
  ok(samples[samples.length - 1].hpMul > samples[0].hpMul * 1.3, '第 3 幕末明显硬于第 1 幕初', `${samples[0].hpMul.toFixed(2)} → ${samples[samples.length - 1].hpMul.toFixed(2)}`);
  ok(samples[samples.length - 1].xpMul > samples[0].xpMul, '深入的经验回报也更高', `${samples[0].xpMul.toFixed(2)} → ${samples[samples.length - 1].xpMul.toFixed(2)}`);

  // 实际生成的敌人要吃这套系数
  run.actIndex = 0; run.current = run.map.acts[0].layers[0][0].id;
  const e1 = NK.Combat.makeEnemy(run.map.acts[0].actDef.pool[0], NK.Run.battleTier(run), run.rng);
  run.actIndex = actCount - 1;
  const last = run.map.acts[actCount - 1].layers;
  run.current = last[last.length - 1][0].id;
  const e2 = NK.Combat.makeEnemy(run.map.acts[0].actDef.pool[0], NK.Run.battleTier(run), run.rng);
  ok(e2.maxHp > e1.maxHp, '同一只怪在深层血更厚', `${e1.maxHp} → ${e2.maxHp}`);
  ok(e2.atk.bonus >= e1.atk.bonus, '同一只怪在深层命中更高', `${e1.atk.bonus} → ${e2.atk.bonus}`);
}

/* ================= 【5】无通关，只记最远距离 ================= */
console.log('\n【5】不再有通关，只记录最远距离');
{
  const run = startRun('warrior', { str: 16 });
  const acts0 = run.map.acts.length;

  // 打完最后一幕的关底：不应结束，而是继续往下挖
  run.actIndex = acts0 - 1;
  const lastLayer = run.map.acts[acts0 - 1].layers;
  run.current = lastLayer[lastLayer.length - 1][0].id;
  const msg = NK.Run.advanceAct(run);
  ok(!run.ended, '打完最后一幕关底不会「通关」结束');
  ok(run.map.acts.length === acts0 + 1, '会继续生成更深的一幕', `${acts0} → ${run.map.acts.length}`);
  ok(run.actIndex === acts0, '进入新的一幕', run.actIndex + 1);
  ok(typeof msg === 'string' && msg.length > 0, '有推进文案', msg.slice(0, 24) + '…');

  // 最远距离
  const p1 = NK.Run.progress(run);
  ok(p1.act === acts0 + 1, '进度读到第 N+1 幕', `第 ${p1.act} 幕`);
  ok(run.farthest && run.farthest.depth >= p1.depth, 'farthest 已记录', NK.Run.progressLabel(run.farthest));
  const deeper = NK.Run.battleTier(run).depth;
  ok(deeper > acts0 - 1, '新幕的难度继续往上叠', deeper.toFixed(2));

  // 主动收手
  const label = NK.Run.progressLabel(run.farthest);
  const sum = NK.Run.abandon(run);
  ok(run.ended === true, '收手后这一局结束');
  ok(sum.victory === false, '结算里没有「通关」', `victory=${sum.victory}`);
  ok(!!sum.farthestLabel, '结算带最远距离', sum.farthestLabel);
  ok(sum.farthestLabel === label, '最远距离与进度一致', `${sum.farthestLabel} / ${label}`);

  const recs = NK.Codex.records();
  ok(recs.length >= 1, '写入了行走记录');
  const rec = recs[0];
  ok(rec.depth !== undefined && !!rec.farthestLabel, '记录里有最远距离', `${rec.farthestLabel}（depth ${rec.depth}）`);
  ok(rec.result !== 'victory', '记录里没有通关结果', rec.result);
  const st = NK.Codex.recordStats();
  ok(!!st.bestDepthLabel && st.bestDepthLabel !== '—', '统计能给出最远距离', st.bestDepthLabel);
  ok(st.wins === 0 && st.rate === 0, '不再统计通关率', `wins=${st.wins} rate=${st.rate}`);
}

/* ================= 【6】地图直观化 ================= */
console.log('\n【6】地图：坐标布局 + 连线');
{
  const run = startRun('warrior', { str: 16 });
  App.run = run; App.screen = 'map'; App.modal = null; App.confirmAbandon = false;
  let captured = '';
  ctx.document.getElementById = () => ({ set innerHTML(v) { captured = v; }, get innerHTML() { return captured; }, addEventListener() {}, querySelector: () => null });
  UI.render();
  const h = captured;
  ok(h.includes('class="mapwrap"'), '地图用了定位容器');
  ok(/<svg class="maplinks"/.test(h), '有 SVG 连线层');
  ok(/<line class="link/.test(h), '画出了节点之间的连线');
  ok(/class="node[^"]*"[^>]*left:[\d.]+%/.test(h), '节点按百分比定位', (h.match(/left:([\d.]+)%/g) || []).slice(0, 4).join(' '));
  ok(h.includes('class="layer-no"'), '标出了层号');
  ok(h.includes('class="maplegend"'), '有图例');
  ok(h.includes('收手'), '有「收手」出口');
  const lines = (h.match(/<line/g) || []).length;
  ok(lines > 0, `连线数量 ${lines}`);

  // 走进一个节点后应出现「你在这」
  const av = NK.MapGen.available(run);
  if (av.length) {
    NK.Run.enterNode(run, av[0].id);
    if (run.state === 'battle') { run._combat.over = true; run._combat.result = 'victory'; run.state = 'map'; }
    captured = ''; UI.render();
    ok(captured.includes('你在这') || captured.includes('class="you"'), '当前位置有标记');
  }
}

console.log(bad === 0 ? '\n✔ 本轮改动全部验证通过。' : `\nX ${bad} 项未通过。`);
process.exit(bad === 0 ? 0 : 1);

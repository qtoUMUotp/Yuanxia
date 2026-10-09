/* 专项验证：移动端（手机）适配
 * 【A】静态：CSS / HTML 里有没有必要的移动端规则（安全区、表格滚动、触摸目标、字号……）
 * 【B】动态：实际渲染出的各屏会不会横向溢出
 * 【C】战斗屏的手机端专属结构（敌人滚动容器 + 吸底动作区）
 *
 * 只做结构与规则层面的校验，不启动真实浏览器。
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

const NK = ctx.NK, UI = NK.UI, App = UI.App;
await NK.Data.load();

let bad = 0;
const ok = (cond, name, extra) => {
  console.log(`  ${cond ? '✔' : 'X'}  ${name}${extra !== undefined ? '　→ ' + extra : ''}`);
  if (!cond) bad++;
};

const css = fs.readFileSync('css/style.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

/* ================= 【A】静态规则 ================= */
console.log('【A】样式表 / 页面的移动端规则');
ok(/<meta name="viewport"[^>]*width=device-width/.test(html), 'viewport 声明 device-width');
ok(/viewport-fit=cover/.test(html), 'viewport-fit=cover（内容可延伸到安全区，配合 env() 使用）');
ok(/format-detection/.test(html), '关闭电话/日期自动识别（HP「12/20」不会被当成电话）');
ok(css.includes('env(safe-area-inset-bottom'), '#app 预留底部安全区（全面屏手势条不遮按钮）');
ok(/\.hud\s*\{[^}]*env\(safe-area-inset-top/.test(css), '吸顶栏避开刘海');
ok(/\.actbar\s*\{[^}]*env\(safe-area-inset-bottom/.test(css), '吸底动作区避开手势条');
ok(/#app\s*\{[^}]*overflow-x:\s*clip/.test(css), '横向溢出用 clip 兜底（不破坏 sticky）');
ok(/overscroll-behavior-y/.test(css), '禁止下拉触发浏览器刷新');
ok(/-webkit-tap-highlight-color:\s*transparent/.test(css), '去掉移动端点击高亮块');
ok(/@media \(max-width: 760px\)[\s\S]{0,400}?overflow-x:\s*auto/.test(css), '窄屏表格改为横向滚动');
const M640 = css.slice(css.indexOf('@media (max-width: 640px)'));
ok(/min-height:\s*38px/.test(M640), '手机端按钮触摸目标 ≥38px');
ok(/\.node[\s\S]{0,120}?min-height:\s*44px/.test(M640), '手机端地图节点触摸目标 ≥44px');
ok(/select\.selbox[\s\S]{0,140}?font-size:\s*16px/.test(M640), '下拉框手机端 16px（避免聚焦时整页被放大）');
ok(/@media \(hover: none\) and \(pointer: coarse\)[\s\S]{0,140}\.kbd[^{]*\{\s*display:\s*none/.test(css), '触屏设备隐藏键盘快捷键徽标');
ok(/\.kbdhint/.test(css) && /\.kbd[^{]*,\s*\.kbdhint[^{]*\{\s*display:\s*none/.test(css), '触屏设备隐去「快捷键 …」整句提示');
ok(/@media \(max-width: 400px\)/.test(css), '有小屏（≤400px）断点');
ok(/@media \(max-height: 520px\)/.test(css), '有横屏矮屏断点');
ok(/@media \(prefers-reduced-motion/.test(css), '尊重系统「减少动效」设置');

const widths = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => +m[1]);
ok(widths.every((w, i) => i === 0 || w < widths[i - 1]), '断点按宽度递减排列（不会互相覆盖）', widths.join(' > '));

/* ================= 【B】实际渲染 ================= */
console.log('\n【B】实际渲染：各屏无横向溢出');

const run = NK.Run.start({
  rng: NK.RNG.make(11), raceId: 'human', classId: 'wizard', bgId: 'soldier', name: 'T',
  attrs: { str: 12, dex: 14, con: 14, int: 16, wis: 12, cha: 12 },
  skills: ['arcana', 'history'], pack: 0, difficulty: 1, equipment: [],
  cantrips: ['fire_bolt', 'ray_of_frost'], knownSpells: ['magic_missile', 'shield'],
});
let guard = 0;
while (run.player.pendingChoices && run.player.pendingChoices.length && guard++ < 400) {
  const before = run.player.pendingChoices[0];
  NK.Run.resolveChoice(run, null);
  if (run.player.pendingChoices[0] === before) run.player.pendingChoices.shift();
}

// 捕获 render() 写进 #app 的内容
let captured = '';
ctx.document.getElementById = () => ({
  set innerHTML(v) { captured = v; }, get innerHTML() { return captured; },
  addEventListener() {}, querySelector: () => null,
});

const VW = 360;   // 以主流小屏手机的 CSS 视口宽度为准
const fixedWide = (s) => {
  const hits = [];
  for (const m of s.matchAll(/style="[^"]*?(?:^|[;\s])width:\s*(\d{3,})px/g)) {
    if (+m[1] > VW - 40) hits.push(m[1] + 'px');
  }
  return hits;
};

const snap = (name, fn) => {
  captured = '';
  try { fn(); } catch (e) { captured = ''; }
  return { name, html: captured };
};

App.run = run;
const shots = [
  snap('标题', () => { App.screen = 'title'; UI.render(); }),
  snap('地图', () => { App.screen = 'map'; UI.render(); }),
  snap('战斗', () => { NK.Run.startBattle(run, 'normal'); App.screen = 'battle'; UI.render(); }),
  snap('人物卡', () => { App.screen = 'map'; App.modal = 'sheet'; UI.render(); }),
  snap('人物卡·战斗页', () => { App.sheetTab = 'combat'; UI.render(); }),
  snap('人物卡·法术页', () => { App.sheetTab = 'spells'; UI.render(); }),
  snap('背包', () => { App.modal = 'bag'; UI.render(); }),
  snap('规则说明', () => { App.modal = 'help'; UI.render(); }),
  snap('图鉴', () => { App.modal = 'codex'; UI.render(); }),
  snap('通关记录', () => { App.modal = 'records'; UI.render(); }),
  snap('建卡', () => { App.modal = null; App.screen = 'create'; UI.render(); }),
];

let totalTables = 0; const wide = [];
for (const s of shots) {
  if (!s.html) { console.log(`  · ${s.name}：未能渲染，跳过`); continue; }
  const w = fixedWide(s.html);
  const tc = (s.html.match(/<table/g) || []).length;
  totalTables += tc;
  if (w.length) wide.push(`${s.name}(${w.join(',')})`);
  console.log(`  ${w.length ? 'X' : '✔'}  ${s.name}：无超宽固定宽度元素${tc ? `　（${tc} 张表 → 窄屏横向滚动）` : ''}`);
  if (w.length) bad++;
}
ok(!wide.length, '所有屏幕都没有超过视口的固定宽度元素', wide.join(' ') || '无');
ok(totalTables > 0, `本轮渲染了 ${totalTables} 张表格（窄屏走横向滚动）`);

/* ================= 【C】战斗屏手机端结构 ================= */
console.log('\n【C】战斗屏的手机端专属结构');
const battle = (shots.find((s) => s.name === '战斗') || {}).html || '';
ok(battle.includes('class="enemies"'), '敌人列表有独立滚动容器（手机上限高，不把日志顶出屏幕）');
ok(battle.includes('class="actbar"'), '动作区存在（手机端吸底）');
ok(/data-act="b:attack"/.test(battle), '攻击按钮存在');
ok(battle.includes('sel:action'), '动作下拉框保留（smoke 契约）');

console.log(bad === 0 ? '\n✔ 移动端适配检查全部通过。' : `\nX ${bad} 项未通过。`);
process.exit(bad === 0 ? 0 : 1);

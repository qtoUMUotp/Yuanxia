/* 子职特性等级对齐 5e，并延伸到 20 级。
 *
 * 背景：之前所有子职被统一填成 3/6/7/10/14，但 5e 各职业的子职进阶等级并不相同。
 * 目标锚点（5e 核心规则书）：
 *   战士 3/7/10/15/18　游荡者 3/9/13/17　圣武士 3/7/15/20　游侠 3/7/11/15
 *   武僧 3/6/11/17　　术士 1/6/14/18　　牧师 1/2/6/8/17
 *   诗人 3/6/14　　工匠 3/6/14　　德鲁伊 2/6/10/14　法师 2/6/10/14
 *   邪术师 1/6/10/14　野蛮人 3/6/10/14
 *
 * 处理原则：**不合并、不裁剪**。锚点不够放时，把剩余特性沿等级轴往高等级延伸（最多到 20），
 * 这样既保住了原有的强度递增顺序，也不会把 L10 的能力塞进 L3。
 */
import fs from 'fs';

const ANCHOR = {
  warrior: [3, 7, 10, 15, 18],
  rogue: [3, 9, 13, 17],
  paladin: [3, 7, 15, 20],
  ranger: [3, 7, 11, 15],
  monk: [3, 6, 11, 17],
  sorcerer: [1, 6, 14, 18],
  cleric: [1, 2, 6, 8, 17],
  bard: [3, 6, 14],
  artificer: [3, 6, 14],
  druid: [2, 6, 10, 14],
  wizard: [2, 6, 10, 14],
  warlock: [1, 6, 10, 14],
  barbarian: [3, 6, 10, 14],
};

/** 把 n 个特性铺到锚点等级上；锚点不够就在高位补，最后一级不超过 20 */
function spread(anchor, n) {
  const lv = anchor.slice();
  let guard = 0;
  while (lv.length < n && guard++ < 40) {
    const last = lv[lv.length - 1];
    if (last < 16) { lv.push(last + 3); continue; }
    if (last < 19) { lv.push(last + 2); continue; }
    if (last < 20) { lv.push(20); continue; }
    // 20 已占满：往回找空隙插一个等级
    let inserted = false;
    for (let i = lv.length - 1; i > 0; i--) {
      if (lv[i] - lv[i - 1] > 1) { lv.splice(i, 0, lv[i] - 1); inserted = true; break; }
    }
    if (!inserted) break;
  }
  // 去重 + 严格递增
  const seen = new Set(); const out = [];
  for (const x of lv) { const v = Math.min(20, Math.max(1, x)); if (!seen.has(v)) { seen.add(v); out.push(v); } }
  out.sort((a, b) => a - b);
  return out;
}

/** 重排后可能出现「L7 奉献光环·进阶、L15 奉献光环」这种倒挂：把名字换回来 */
function fixNames(feats) {
  for (let i = 0; i < feats.length; i++) {
    const a = feats[i];
    if (!/·进阶$/.test(a.name)) continue;
    const base = a.name.replace(/·进阶$/, '');
    for (let j = i + 1; j < feats.length; j++) {
      if (feats[j].name === base) { const t = a.name; a.name = feats[j].name; feats[j].name = t; break; }
    }
  }
}

const path = 'data/classes.json';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));
const classes = j.classes || j;

let touched = 0; let problems = 0;
for (const c of classes) {
  const anchor = ANCHOR[c.id];
  if (!anchor) { console.log(`  · ${c.id}：无锚点表，跳过`); continue; }
  for (const s of (c.subclasses || [])) {
    const feats = (s.features || []).slice().sort((a, b) => a.level - b.level);
    if (!feats.length) continue;
    const before = feats.map((f) => f.level).join(',');
    const lv = spread(anchor, feats.length);
    if (lv.length < feats.length) {
      console.log(`  ! ${c.id}/${s.id}：等级位不够（要 ${feats.length} 个，只有 ${lv.length} 个）`);
      problems++; continue;
    }
    feats.forEach((f, i) => { f.level = lv[i]; });
    fixNames(feats);
    s.features = feats;
    touched++;
    const after = feats.map((f) => f.level).join(',');
    if (before !== after) console.log(`  ${c.id}/${s.id}: [${before}] → [${after}]`);
  }
}

fs.writeFileSync(path, JSON.stringify(j, null, 2), 'utf8');
console.log(`\n已对齐 ${touched} 个子职${problems ? `，${problems} 个有问题` : ''}。`);

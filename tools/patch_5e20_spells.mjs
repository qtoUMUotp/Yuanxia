// 一次性补丁：spells.json —— 补 4~9 环法术，让 20 级的高环法术位真正可用
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = join(root, 'data', 'spells.json');
const D = JSON.parse(readFileSync(p, 'utf8'));
const have = new Set(D.spells.map((s) => s.id));

const NEW = [
  /* ---- 四环 ---- */
  { id: 'wall_of_fire', name: '火焰墙', level: 4, classes: ['wizard', 'sorcerer'], school: '塑能', action: '动作', range: '120 尺', concentration: true, kind: 'save', targets: 'all', save: 'dex', half: true, dice: '5d8', dmgType: '火焰', upcast: { per: '1d8' }, desc: '一堵半透明的火墙横在石窟中央，靠过去的人都会被烤得皮开肉绽。' },
  { id: 'greater_invisibility', name: '高等隐形', level: 4, classes: ['wizard', 'sorcerer', 'bard'], school: '幻术', action: '附赠动作', range: '接触', concentration: true, kind: 'buff', turns: 4, mods: { ac: 2 }, desc: '你抬手抹过自己的轮廓，身形就此淡去——这次连攻击都不会让你现形。' },
  { id: 'ice_storm', name: '冰风暴', level: 4, classes: ['wizard', 'sorcerer', 'druid'], school: '塑能', action: '动作', range: '300 尺', concentration: false, kind: 'save', targets: 'all', save: 'dex', half: true, dice: '4d8', dmgType: '冰霜', upcast: { per: '1d8' }, desc: '拳头大的冰雹自穹顶砸下，落地处腾起一层白茫茫的寒雾。' },
  { id: 'banishment', name: '放逐术', level: 4, classes: ['cleric', 'paladin', 'wizard', 'sorcerer'], school: '防护', action: '动作', range: '60 尺', concentration: true, kind: 'save', save: 'cha', dice: '4d10', dmgType: '力场', cond: { id: 'restrained', name: '束缚', turns: 2 }, upcast: { per: '1d10' }, desc: '你念出那个名字，目标脚下的影子塌陷下去——它被短暂地挤出这个世界。' },
  /* ---- 五环 ---- */
  { id: 'cone_of_cold', name: '寒冰锥', level: 5, classes: ['wizard', 'sorcerer'], school: '塑能', action: '动作', range: '60 尺锥形', concentration: false, kind: 'save', targets: 'all', save: 'con', half: true, dice: '8d8', dmgType: '冰霜', upcast: { per: '1d8' }, desc: '你双掌一推，一股刺骨的寒气卷过整条通道，水汽在半空凝成霜针。' },
  { id: 'flame_strike', name: '焰击', level: 5, classes: ['cleric'], school: '塑能', action: '动作', range: '60 尺', concentration: false, kind: 'save', targets: 'all', save: 'dex', half: true, dice: '8d6', dmgType: '光耀', upcast: { per: '1d6' }, desc: '一道纯粹的白光自穹顶笔直落下，撞在地面的瞬间炸开一圈圣焰。' },
  { id: 'mass_cure_wounds', name: '群体治疗伤口', level: 5, classes: ['cleric', 'druid', 'bard'], school: '塑能', action: '动作', range: '60 尺', concentration: false, kind: 'heal', dice: '3d8', upcast: { per: '1d8' }, desc: '你摊开手掌，暖意从指缝漫出去，把伤口一寸寸合上。' },
  { id: 'dominate_person', name: '支配人类', level: 5, classes: ['wizard', 'sorcerer', 'bard', 'warlock'], school: '附魔', action: '动作', range: '60 尺', concentration: true, kind: 'save', save: 'wis', dice: '4d10', dmgType: '心灵', cond: { id: 'restrained', name: '束缚', turns: 3 }, upcast: null, desc: '你说出一个词，对方的瞳孔散开——它现在听你的了。' },
  /* ---- 六环 ---- */
  { id: 'disintegrate', name: '解离术', level: 6, classes: ['wizard', 'sorcerer', 'warlock'], school: '变化', action: '动作', range: '60 尺', concentration: false, kind: 'save', save: 'dex', half: false, dice: '10d6', dmgType: '力场', upcast: { per: '3d6' }, desc: '一道细得几乎看不见的绿线掠过——被它扫到的东西不再存在，只剩一撮灰。' },
  { id: 'chain_lightning', name: '连锁闪电', level: 6, classes: ['wizard', 'sorcerer', 'warlock'], school: '塑能', action: '动作', range: '150 尺', concentration: false, kind: 'save', targets: 'all', save: 'dex', half: true, dice: '10d8', dmgType: '闪电', upcast: { per: '1d8' }, desc: '电弧从你指尖窜出，撞上第一个目标后炸开四道分叉，继续往前咬。' },
  { id: 'heal', name: '治疗术', level: 6, classes: ['cleric', 'druid'], school: '塑能', action: '动作', range: '60 尺', concentration: false, kind: 'heal', dice: '10d6', upcast: { per: '1d6' }, desc: '你把掌心按在伤口上，光从指缝里渗进去，血立刻止住了。' },
  /* ---- 七环 ---- */
  { id: 'finger_of_death', name: '死亡一指', level: 7, classes: ['wizard', 'sorcerer', 'warlock'], school: '死灵', action: '动作', range: '60 尺', concentration: false, kind: 'save', save: 'con', half: true, dice: '12d8', dmgType: '暗蚀', upcast: null, desc: '你伸出一根手指，指尖爬满黑霜。被指到的人，心口先冷，然后才倒下。' },
  { id: 'fire_storm', name: '火焰风暴', level: 7, classes: ['cleric', 'druid'], school: '塑能', action: '动作', range: '150 尺', concentration: false, kind: 'save', targets: 'all', save: 'dex', half: true, dice: '12d10', dmgType: '火焰', upcast: null, desc: '一片火海自地面涌起，所过之处只剩下一层薄薄的灰。' },
  /* ---- 八环 ---- */
  { id: 'sunburst', name: '日耀爆', level: 8, classes: ['wizard', 'sorcerer', 'cleric', 'druid'], school: '塑能', action: '动作', range: '150 尺', concentration: false, kind: 'save', targets: 'all', save: 'con', half: true, dice: '12d10', dmgType: '光耀', upcast: null, desc: '你把一颗太阳捏碎在掌心里。光漫过整座洞窟，阴影被强行抹去。' },
  /* ---- 九环 ---- */
  { id: 'meteor_swarm', name: '陨石风暴', level: 9, classes: ['wizard', 'sorcerer'], school: '塑能', action: '动作', range: '1 里', concentration: false, kind: 'save', targets: 'all', save: 'dex', half: true, dice: '20d10', dmgType: '钝击', upcast: null, desc: '四颗燃烧的石块撕裂穹顶砸下来。它们落地之后，这里已经没有地形可言了。' },
  { id: 'true_resurrection', name: '真复活术', level: 9, classes: ['cleric', 'druid'], school: '死灵', action: '动作', range: '接触', concentration: false, kind: 'heal', dice: '10d10', upcast: null, desc: '你念了整整一小时。最后一口气被塞回那具身体里，它睁开眼睛。' },
];

let added = 0;
for (const s of NEW) {
  if (have.has(s.id)) continue;
  D.spells.push(s);
  added += 1;
}
D.spells.sort((a, b) => (a.level - b.level) || a.id.localeCompare(b.id));
writeFileSync(p, JSON.stringify(D, null, 2) + '\n', 'utf8');
console.log(`spells.json 已更新：新增 ${added} 个法术（4~9 环），总数 ${D.spells.length}。`);

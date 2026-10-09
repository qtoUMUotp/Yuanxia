/* 装备与战利品 */
(function (global) {
  const NK = (global.NK = global.NK || {});
  const U = NK.Util;

  const RARITY_ORDER = ['common', 'uncommon', 'rare', 'very_rare', 'legendary'];
  const RARITY_NAME = { common: '普通', uncommon: '非凡', rare: '稀有', very_rare: '极珍', legendary: '传说' };
  const RARITY_COLOR = { common: '#b9b3a4', uncommon: '#7fd0a0', rare: '#6fb3e0', very_rare: '#a58ad6', legendary: '#d9b45a' };

  /** 装备槽位定义（顺序即界面显示顺序） */
  const SLOTS = [
    { id: 'mainHand', name: '右手', hands: true },
    { id: 'offHand', name: '左手', hands: true },
    { id: 'body', name: '上身' },
    { id: 'legs', name: '下身' },
    { id: 'helm', name: '头盔' },
    { id: 'neck', name: '项链' },
    { id: 'bracers', name: '护腕' },
    { id: 'greaves', name: '护腿' },
    { id: 'boots', name: '鞋' },
    { id: 'rings', name: '戒指', multiple: true },
  ];
  const SLOT_NAME = SLOTS.reduce((a, s) => { a[s.id] = s.name; return a; }, {});

  /** 旧 trinket 里各项归到哪个新槽位 */
  const TRINKET_SLOT = {
    vitality_charm: 'neck', hunter_brooch: 'neck', voidheart_amulet: 'neck',
    ash_ward_ring: 'rings', spellweaver_ring: 'rings',
    steadfast_helm: 'helm', crown_of_second_breath: 'helm', first_strike_visor: 'helm',
    stone_grip_gauntlets: 'bracers',
  };
  /** 数据表里戒指写的是单数 ring，槽位数组叫 rings */
  const normSlot = (s) => (s === 'ring' ? 'rings' : s);

  const Items = {
    RARITY_NAME, RARITY_COLOR, RARITY_ORDER, SLOTS, SLOT_NAME,
    all() { return NK.Data.get('items'); },
    weapons() { return Items.all().weapons; },
    armors() { return Items.all().armors; },
    magicList() { return Items.all().magicItems; },
    mundane() { return Items.all().mundane || []; },
    consumables() { return Items.all().consumables; },
    baseById(id) { return Items.weapons().concat(Items.armors()).find((x) => x.id === id); },
    magicById(id) { return Items.magicList().find((x) => x.id === id); },
    consumableById(id) { return Items.consumables().find((x) => x.id === id); },
    /** 卷轴：effect.cast 指向一个法术 */
    isScroll(it) { return !!(it && it.effect && it.effect.cast); },
    scrollSpell(it) { return Items.isScroll(it) ? NK.Rules.spellDef(it.effect.cast) : null; },
    /** 抄写卷轴的花费：法术环阶的平方 ×25（一环 25、二环 100、三环 225） */
    copyCost(spell) { return Math.max(1, spell.level) * Math.max(1, spell.level) * 25; },
    slotName(slot) { return slot === 'rings' ? '戒指' : (SLOT_NAME[slot] || slot); },

    /** 普通武器（默认进右手；一/轻型武器也可以放左手） */
    weapon(baseId) {
      const b = Items.weapons().find((x) => x.id === baseId);
      if (!b) throw new Error('未知武器: ' + baseId);
      const twoHanded = (b.properties || []).includes('two_handed');
      return {
        id: 'w_' + b.id, baseId: b.id, name: b.name, slot: 'mainHand', kind: b.kind,
        category: b.category, dice: b.dice, versatile: b.versatile || null, dmgType: b.type,
        properties: b.properties || [], verbs: b.verbs || ['攻击'],
        twoHanded, hands: twoHanded ? 2 : 1,
        bonus: {}, mods: {}, resist: [], rarity: 'common', price: b.price,
        desc: '', dynamic: true,
      };
    },
    weaponDesc(b) {
      const props = { finesse: '灵巧', versatile: '双手', two_handed: '双手必需', light: '轻型', heavy: '重型', reach: '触及', thrown: '投掷', loading: '装填', ammunition: '弹药' };
      const p = (b.properties || []).map((x) => props[x]).filter(Boolean).join('、');
      return `${b.kind === 'ranged' ? '远程' : '近战'} ${b.dice}${b.versatile ? '/' + b.versatile : ''} ${b.type}${p ? '（' + p + '）' : ''}`;
    },

    /** 护甲 / 盾牌 */
    armor(baseId) {
      const b = Items.armors().find((x) => x.id === baseId);
      if (!b) throw new Error('未知护甲: ' + baseId);
      const isShield = b.category === 'shield';
      return {
        id: 'a_' + b.id, baseId: b.id, name: b.name, slot: isShield ? 'offHand' : 'body',
        category: b.category, base: b.base, dexCap: b.dexCap === undefined ? null : b.dexCap,
        minStr: b.minStr || 0, stealthDisadvantage: !!b.stealthDisadvantage,
        bonus: {}, mods: {}, resist: [], rarity: 'common', price: b.price,
        desc: isShield ? '盾牌：AC +2' : `AC ${b.base}${b.dexCap === null ? ' + 敏捷' : ` + 敏捷（上限 ${b.dexCap}）`}${b.minStr ? `，需要力量 ${b.minStr}` : ''}`,
        dynamic: true,
      };
    },

    /** 普通饰品（头盔 / 项链 / 戒指 / 护腕 / 下身 / 护腿 / 鞋） */
    mundaneItem(id) {
      const m = Items.mundane().find((x) => x.id === id);
      if (!m) throw new Error('未知饰品: ' + id);
      return {
        id: 'n_' + m.id, baseId: m.id, name: m.name, slot: normSlot(m.slot),
        bonus: {}, mods: Object.assign({}, m.mods || {}), resist: [], rarity: 'common',
        price: m.price || 30, desc: m.desc || '', dynamic: true,
      };
    },

    /** 魔法物品（基于普通装备或独立饰品） */
    magic(magicId) {
      const m = Items.magicById(magicId);
      if (!m) throw new Error('未知魔法物品: ' + magicId);
      const base = m.base ? (Items.weapons().find((x) => x.id === m.base) || Items.armors().find((x) => x.id === m.base)) : null;
      // 槽位：新词汇直接用；旧词汇 weapon→mainHand / armor→body / shield→offHand / trinket→查表
      const NEW_SLOTS = ['mainHand', 'offHand', 'body', 'legs', 'neck', 'rings', 'bracers', 'greaves', 'helm', 'boots', 'ring'];
      const slot = NEW_SLOTS.indexOf(m.slot) >= 0 ? normSlot(m.slot)
        : m.slot === 'weapon' ? 'mainHand' : m.slot === 'armor' ? 'body' : m.slot === 'shield' ? 'offHand'
          : normSlot(TRINKET_SLOT[m.id] || 'neck');
      const it = {
        id: 'm_' + m.id, magicId: m.id, name: m.name, slot,
        rarity: m.rarity,
        bonus: Object.assign({}, m.bonus || {}),
        mods: Object.assign({}, m.mods || {}),
        resist: (m.resist || []).slice(),
        extraDice: m.extraDice || null, extraType: m.extraType || null,
        onHitCond: m.cond_on_hit || null,
        daily: m.daily || null,
        price: { uncommon: 400, rare: 2500, very_rare: 12000, legendary: 40000 }[m.rarity] || 500,
        desc: m.desc || '', flavor: m.flavor || '', magic: true,
      };
      if (base) {
        const twoHanded = (base.properties || []).includes('two_handed');
        Object.assign(it, {
          baseId: base.id,
          kind: base.kind, category: base.category, dice: base.dice, versatile: base.versatile || null,
          dmgType: base.type, properties: base.properties || [], verbs: base.verbs || ['攻击'],
          twoHanded, hands: twoHanded ? 2 : 1,
          base: base.base, dexCap: base.dexCap === undefined ? null : base.dexCap,
          minStr: base.minStr || 0, stealthDisadvantage: !!base.stealthDisadvantage,
        });
      }
      return it;
    },

    randomWeapon(rng, category) {
      let pool = Items.weapons();
      if (category) pool = pool.filter((w) => w.category === category);
      return Items.weapon(rng.pick(pool).id);
    },
    randomArmor(rng, cats) {
      let pool = Items.armors();
      if (cats) pool = pool.filter((a) => cats.includes(a.category));
      return Items.armor(rng.pick(pool).id);
    },
    randomMagic(rng, rarity) {
      let pool = Items.magicList().filter((m) => m.rarity === rarity);
      if (!pool.length) pool = Items.magicList();
      return Items.magic(rng.pick(pool).id);
    },
    randomMundane(rng, slotFilter) {
      let pool = Items.mundane();
      if (slotFilter) pool = pool.filter((x) => x.slot === slotFilter);
      if (!pool.length) pool = Items.mundane();
      return Items.mundaneItem(rng.pick(pool).id);
    },
    randomConsumable(rng) { return U.clone(rng.pick(Items.consumables())); },

    /** 按战斗档位抽战利品 */
    loot(rng, rank, opts) {
      const tables = Items.all().lootTables || {};
      const table = tables[rank] || tables.normal || [['common', 100]];
      let rarity = rng.weighted(table);
      if (opts && opts.betterLoot) rarity = RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, RARITY_ORDER.indexOf(rarity) + 1)];
      if (rarity === 'common') {
        const roll = rng.next();
        if (roll < 0.45) return Items.randomWeapon(rng);
        if (roll < 0.7) return Items.randomArmor(rng);
        return Items.randomMundane(rng);
      }
      return Items.randomMagic(rng, rarity);
    },

    describe(it) {
      if (!it) return '';
      const bits = [];
      if (it.dice) bits.push(Items.weaponDesc({ kind: it.kind, dice: it.dice, versatile: it.versatile, type: it.dmgType, properties: it.properties }));
      if (it.slot === 'body' && it.base !== undefined && it.base !== null) bits.push(`AC ${it.base}${it.dexCap === null ? ' + 敏捷' : ` + 敏捷（上限 ${it.dexCap}）`}${it.minStr ? `，需要力量 ${it.minStr}` : ''}`);
      if (it.slot === 'offHand' && !it.dice) bits.push(`AC +${it.base || 2}`);
      if (it.desc) bits.push(it.desc);
      if (it.extraDice) bits.push(`命中时额外 ${it.extraDice} ${it.extraType || ''}伤害`);
      if (it.cond_on_hit) bits.push(`命中时使目标「${it.cond_on_hit.name}」${it.cond_on_hit.turns || 2} 回合`);
      if (it.daily) bits.push(`【装备技能】${it.daily.name}：${it.daily.desc}`);
      if (it.resist && it.resist.length) bits.push(`抗性：${it.resist.join('、')}`);
      const labels = { hit: '命中', dmg: '伤害', ac: 'AC', maxHp: '最大生命', spellDc: '法术DC', spellDmg: '法术强度', dr: '减伤', initBonus: '先攻', initiative: '先攻', spellHit: '法术命中', healBonus: '治疗量', saveBonus: '所有豁免' };
      for (const k of Object.keys(it.mods || {})) {
        const v = it.mods[k];
        if (!v) continue;
        bits.push(`${labels[k] || k} ${v > 0 ? '+' : ''}${v}`);
      }
      for (const k of Object.keys(it.bonus || {})) {
        const v = it.bonus[k];
        if (!v) continue;
        bits.push(`${labels[k] || k} ${v > 0 ? '+' : ''}${v}`);
      }
      return bits.join('，');
    },
    sellValue(it) { return Math.round((it.price || 20) * 0.4); },

    /** 只列出「这件装备到底给了我什么」，给背包界面用 */
    effects(it) {
      if (!it) return [];
      const out = [];
      const labels = { hit: '命中', dmg: '伤害', ac: 'AC', maxHp: '最大生命', spellDc: '法术DC', spellDmg: '法术强度', dr: '减伤', initBonus: '先攻', initiative: '先攻', spellHit: '法术命中', healBonus: '治疗量', saveBonus: '所有豁免' };
      const all = Object.assign({}, it.bonus || {}, it.mods || {});
      for (const k of Object.keys(all)) {
        const v = all[k];
        if (!v) continue;
        out.push({ kind: 'mod', text: `${labels[k] || k} ${v > 0 ? '+' : ''}${v}` });
      }
      if (it.dice) out.push({ kind: 'base', text: `伤害 ${it.dice}${it.versatile ? '/' + it.versatile : ''} ${it.dmgType || ''}${(it.properties || []).length ? '（' + it.properties.map((x) => ({ finesse: '灵巧', versatile: '双手', two_handed: '双手必需', light: '轻型', heavy: '重型', reach: '触及', thrown: '投掷', loading: '装填', ammunition: '弹药' })[x] || x).join('、') + '）' : ''}` });
      if (it.slot === 'body' && it.base !== undefined && it.base !== null) out.push({ kind: 'base', text: `AC ${it.base}${it.dexCap === null ? ' + 敏捷' : ` + 敏捷（上限 ${it.dexCap}）`}${it.minStr ? `，需要力量 ${it.minStr}` : ''}${it.stealthDisadvantage ? '，隐匿劣势' : ''}` });
      if (it.slot === 'offHand' && !it.dice) out.push({ kind: 'base', text: `AC +${it.base || 2}` });
      if (it.hands === 2) out.push({ kind: 'base', text: '双手武器：同时占用右手与左手' });
      if (it.resist && it.resist.length) out.push({ kind: 'resist', text: `抗性：${it.resist.join('、')}` });
      if (it.extraDice) out.push({ kind: 'onhit', text: `命中时额外 ${it.extraDice} ${it.extraType || ''}伤害` });
      if (it.cond_on_hit) out.push({ kind: 'onhit', text: `命中时使目标「${it.cond_on_hit.name}」${it.cond_on_hit.turns || 2} 回合` });
      if (it.daily) out.push({ kind: 'skill', text: `${it.daily.name}：${it.daily.desc}` });
      return out;
    },

    /** 起始装备包（按职业给 2 套，让玩家在创建时做第一次取舍） */
    startingPacks(classId) {
      const P = {
        warrior: [
          { name: '重装', desc: '防御优先：长剑 + 盾牌 + 锁子甲。AC 最高，伤害一般。', weapons: ['longsword'], armor: 'chain_mail', shield: 'shield' },
          { name: '狂攻', desc: '输出优先：巨剑 + 皮甲。双手重武器，伤害骰 2d6。', weapons: ['greatsword'], armor: 'leather_armor', shield: null },
        ],
        paladin: [
          { name: '圣盾', desc: '长剑 + 盾牌 + 锁子甲。最稳的开局，配合圣疗很难被打死。', weapons: ['longsword'], armor: 'chain_mail', shield: 'shield' },
          { name: '战锤', desc: '战锤 + 盾牌 + 鳞甲。对构装与亡灵更有说服力。', weapons: ['warhammer'], armor: 'scale_mail', shield: 'shield' },
        ],
        ranger: [
          { name: '弓手', desc: '长弓 + 皮甲 + 匕首。远程输出，怕被贴脸。', weapons: ['longbow', 'dagger'], armor: 'leather_armor', shield: null },
          { name: '双持', desc: '细剑 + 短弓 + 镶钉皮甲。远近都能打。', weapons: ['rapier', 'shortbow'], armor: 'studded_leather', shield: null },
        ],
        rogue: [
          { name: '刺客', desc: '细剑 + 匕首 + 皮甲。灵巧武器吃敏捷，偷袭骰是主要输出。', weapons: ['rapier', 'dagger'], armor: 'leather_armor', shield: null },
          { name: '飞贼', desc: '短弓 + 匕首 + 镶钉皮甲。躲在后面射，靠隐匿拿优势。', weapons: ['shortbow', 'dagger'], armor: 'studded_leather', shield: null },
        ],
        cleric: [
          { name: '战牧', desc: '长矛 + 盾牌 + 鳞甲。AC 高，站得住才能救人。', weapons: ['spear'], armor: 'scale_mail', shield: 'shield' },
          { name: '苦修', desc: '短棒 + 皮甲 + 盾牌。轻装，靠法术位输出。', weapons: ['club'], armor: 'leather_armor', shield: 'shield' },
        ],
        wizard: [
          { name: '法杖', desc: '短棒（当法器握着）+ 法袍。法师护甲让你在不穿甲时也有可观 AC——穿着不熟练的护甲会让你根本无法施法。', weapons: ['club'], armor: null, shield: null, consumables: ['scroll_shield'] },
          { name: '匕首', desc: '匕首 + 法袍。近身时至少有一件能用的东西，也能投出去。', weapons: ['dagger'], armor: null, shield: null, consumables: ['scroll_shield'] },
        ],
        sorcerer: [
          { name: '血脉之刃', desc: '匕首 + 法袍。术士没有任何护甲熟练，靠魔法和走位活着；灵巧匕首是唯一的近身保险。', weapons: ['dagger'], armor: null, shield: null, consumables: ['scroll_burning_hands'] },
          { name: '远裔', desc: '短弓 + 法袍。远远地射，把法术位与术法点留给真正需要的时候。', weapons: ['shortbow'], armor: null, shield: null, consumables: ['scroll_burning_hands'] },
        ],
        warlock: [
          { name: '影契', desc: '匕首 + 皮甲。邪术师只有轻甲熟练——魔能爆才是你的武器，皮甲已经是你该穿的上限。', weapons: ['dagger'], armor: 'leather_armor', shield: null, consumables: ['scroll_mirror_image'] },
          { name: '远契', desc: '短弓 + 皮甲。拉开距离，让魔能爆一束一束地打出去。', weapons: ['shortbow'], armor: 'leather_armor', shield: null, consumables: ['scroll_mirror_image'] },
        ],
        bard: [
          { name: '游吟', desc: '短弓 + 皮甲。站在后面输出，把动作留给法术与吟游灵感。', weapons: ['shortbow'], armor: 'leather_armor', shield: null, consumables: ['potion_healing_lesser'] },
          { name: '剑伶', desc: '匕首 + 镶钉皮甲。灵巧近身，AC 高一档，适合贴着前排唱。', weapons: ['dagger'], armor: 'studded_leather', shield: null, consumables: ['potion_healing_lesser'] },
        ],
        druid: [
          { name: '守望', desc: '长矛 + 盾牌 + 皮甲。德鲁伊不穿金属甲，皮甲配盾已经很稳。', weapons: ['spear'], armor: 'leather_armor', shield: 'shield', consumables: ['antidote'] },
          { name: '荒野', desc: '短棒 + 盾牌 + 镶钉皮甲。轻装，把动作与法术位留给野性形态。', weapons: ['club'], armor: 'studded_leather', shield: 'shield', consumables: ['antidote'] },
        ],
        artificer: [
          { name: '工匠', desc: '手斧 + 轻锤 + 皮甲。两把都能投，近远都不吃亏；第二把进左手。', weapons: ['handaxe', 'light_hammer'], armor: 'leather_armor', shield: null, consumables: ['caltrop_pouch'] },
          { name: '机械', desc: '短弓 + 镶钉皮甲。躲在后面，让奥术冲量与法术去干活。', weapons: ['shortbow'], armor: 'studded_leather', shield: null, consumables: ['caltrop_pouch'] },
        ],
        barbarian: [
          { name: '狂战', desc: '巨剑（双手 2d6）+ 皮甲。野蛮人只有轻甲熟练，但狂暴的减伤替你扛下剩下的。', weapons: ['greatsword'], armor: 'leather_armor', shield: null, consumables: ['potion_rage'] },
          { name: '双斧', desc: '手斧 ×2 + 皮甲。轻型可投掷，第二把进左手，每回合能用附赠动作多打一次。', weapons: ['handaxe', 'handaxe'], armor: 'leather_armor', shield: null, consumables: ['potion_rage'] },
        ],
        monk: [
          { name: '空行', desc: '不持武器。武僧不穿甲也不用武器——徒手打击就是武器，AC 靠敏捷与感知。', weapons: [], armor: null, shield: null, consumables: ['potion_jump'] },
          { name: '行脚', desc: '长矛 + 无甲。双手持用 1d8，比徒手更重，但会占用你的手。', weapons: ['spear'], armor: null, shield: null, consumables: ['potion_jump'] },
        ],
      };
      const cls = NK.Rules.classDef(classId);
      const packs = P[classId] || Items.defaultPacks(cls) || P.warrior;
      return packs.map((k) => Items.sanitizePack(k, cls));
    },

    /** 没写死装备包的职业：按护甲/武器熟练推导，避免「法术职业发把巨剑」 */
    defaultPacks(cls) {
      if (!cls) return null;
      const ap = cls.armorProfs || [];
      const armor = ap.includes('heavy') ? 'chain_mail' : ap.includes('medium') ? 'scale_mail' : ap.includes('light') ? 'leather_armor' : null;
      const shield = ap.includes('shield');
      const martial = (cls.weaponProfs || []).includes('martial');
      const melee = armor ? (martial ? 'longsword' : 'spear') : 'dagger';
      return [
        { name: '近战', desc: '近战武器 + 你能穿的护甲。', weapons: [melee], armor, shield: shield ? 'shield' : null },
        { name: '远程', desc: '短弓 + 匕首。安全优先，怕被贴脸。', weapons: ['shortbow', 'dagger'], armor, shield: null },
      ];
    },

    /** 熟练校验：把装备包里职业用不了的东西换掉（护甲不熟练会导致无法施法与检定劣势） */
    sanitizePack(pack, cls) {
      const out = Object.assign({}, pack);
      if (!cls) return out;
      const ap = cls.armorProfs || [];
      if (out.armor) {
        const a = Items.armors().find((x) => x.id === out.armor);
        if (a && !ap.includes(a.category)) {
          const fallback = ['heavy', 'medium', 'light'].find((k) => ap.includes(k));
          out.armor = { heavy: 'chain_mail', medium: 'scale_mail', light: 'leather_armor' }[fallback] || null;
          out.desc += '（原配护甲超出你的熟练，已换成你能穿的）';
        }
      }
      if (out.shield && !ap.includes('shield')) { out.shield = null; out.desc += '（你不熟练盾牌，已去掉）'; }
      return out;
    },

    /** 把装备包变成实际物品；第二件单手武器会进左手（可以副手攻击） */
    packToItems(pack) {
      const out = [];
      const weapons = (pack.weapons || []).map((w) => Items.weapon(w));
      if (weapons.length) {
        out.push(weapons[0]);
        for (let i = 1; i < weapons.length; i++) {
          const w = weapons[i];
          const main = weapons[0];
          const canOff = main.hands === 1 && w.hands === 1 && !w.twoHanded;
          if (canOff) { const c = Object.assign({}, w); c.slot = 'offHand'; out.push(c); }
          else { const c = Object.assign({}, w); c.backup = true; out.push(c); }
        }
      }
      if (pack.armor) out.push(Items.armor(pack.armor));
      if (pack.shield) out.push(Items.armor(pack.shield));
      return out;
    },
  };

  NK.Items = Items;
})(typeof window !== 'undefined' ? window : globalThis);

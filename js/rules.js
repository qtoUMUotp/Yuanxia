/* 规则引擎：属性、熟练、技能、豁免、法术位、装备、升级选择 */
(function (global) {
  const NK = (global.NK = global.NK || {});
  const U = NK.Util;

  // 数值型修正键（其余进 flags）
  const NUM = ['hit', 'dmg', 'ac', 'maxHp', 'maxHpPerLevel', 'critRange', 'critMult', 'initBonus', 'initiative',
    'saveBonus', 'saveBonusStr', 'saveBonusDex', 'saveBonusCon', 'saveBonusInt', 'saveBonusWis', 'saveBonusCha',
    'spellDc', 'spellDmg', 'dr', 'skillBonus', 'extraAttack', 'sneakAttack', 'layerOnHands', 'layOnHands',
    'rangedHit', 'rangedDmg', 'oneHandDmg', 'offhandDmg', 'critExtraDice', 'elemDmg', 'healBonus', 'healBonusPerLevel',
    'undeadSlayer', 'favoredEnemy', 'superiority', 'superiorityDie', 'luckPoints', 'restShort', 'restLong',
    'startGold', 'shopDiscount', 'restHealBonus', 'battleStartTempHp', 'divineStrike', 'poisonDice', 'giantKiller',
    'ringSlots', 'interference', 'steadyAim', 'rageDr', 'rageDmg', 'monkDmg',
    // 5e 20 级补完：资源次数 / 骰子尺寸 / 属性上限
    'brutalCrit', 'bardDie', 'channelUses', 'actionSurgeUses', 'indomitableUses', 'rageMax', 'attrCap',
    'attrStr', 'attrDex', 'attrCon', 'attrInt', 'attrWis', 'attrCha', 'destroyUndead', 'wildShapeCR'];

  const FLAG = ['resist', 'immune', 'vuln', 'skillProfs', 'expertiseSkills', 'secondWind', 'actionSurge', 'indomitable',
    'cunningAction', 'uncannyDodge', 'evasion', 'divineSmite', 'channelDivinity', 'channelHeal', 'channelBurst',
    'arcaneRecovery', 'auraSave', 'relentless', 'savageAttacks', 'halflingLuck', 'riposte', 'breathWeapon',
    'freeSpellPerBattle', 'assassinate', 'executeCrit', 'fastHands', 'firstAttackAdvantage', 'sacredWeapon',
    'vowOfEnmity', 'relentlessAvenger', 'divineIntervention', 'wardingFlare', 'arcaneWard', 'extraSpellPerLevel',
    'cleaveOnKill', 'noSurprise', 'extraSkill', 'defensiveTactics', 'dreadAmbusher', 'undeadSlayer',
    'fearImmune', 'charmImmune', 'acSet', 'acWis', 'flight', 'disadvantageAgainst', 'mirror', 'nextAttackAdvantage',
    'rage', 'ki', 'flurry', 'stun',
    // 邪术师：魔能祈愿
    'ebAgonizing', 'ebRepelling', 'ebGrasping', 'ebLance',
    // 奥术工匠：奥术附魔 / 奥术冲量
    'magicalStrikes', 'arcaneJolt',
    // 其它职业核心开关
    'metamagic', 'bardicInspiration', 'songOfRest', 'wildShape', 'pactTome', 'pactChain', 'pactBlade',
    // 5e 20 级补完：核心机制开关
    'unarmoredCon', 'reckless', 'wildShapeShortRest', 'fontOfInspiration', 'improvedSmite', 'reliableTalent',
    'blindsense', 'saveProfExtra', 'diamondSoul', 'elusive', 'strokeOfLuck', 'persistentRage', 'relentlessRage',
    'primalChampion', 'perfectSelf', 'archdruid', 'sorcerousRestoration', 'spellMastery', 'signatureSpell',
    'magicalSecrets', 'arcaneRecoveryLong', 'divineInterventionImproved', 'cleansingTouch', 'farShot',
    'poisonImmune', 'beastSpells', 'timelessBody', 'emptyBody', 'eldritchMaster', 'sacredOath', 'shadowMaster',
    'spellStoringItem', 'superiorInspiration', 'auraRange'];

  const Rules = {
    NUM,
    FLAG,
    LEVEL_CAP: 20,          // 5e 等级上限
    MAX_SLOT: 9,            // 最高法术环阶（九环）
    EQUIP_SLOTS: ['mainHand', 'offHand', 'body', 'legs', 'helm', 'neck', 'bracers', 'greaves', 'boots'],
    RING_CAP: 20,
    mod(score) { return Math.floor(((score || 10) - 10) / 2); },
    profBonus(level) {
      const t = NK.Data.get('rules').proficiencyByLevel;
      return t[U.clamp(level, 1, t.length) - 1];
    },
    xpNeeded(level) {
      const t = NK.Data.get('rules').xpTable;
      return level >= t.length ? null : t[level];
    },

    /* ---------- 查表 ---------- */
    classDef(id) { return NK.Data.get('classes').classes.find((c) => c.id === id); },
    raceDef(id) { return NK.Data.get('races').races.find((r) => r.id === id); },
    bgDef(id) { return NK.Data.get('backgrounds').backgrounds.find((b) => b.id === id); },
    spellDef(id) { return NK.Data.get('spells').spells.find((s) => s.id === id); },
    featDef(id) { return NK.Data.get('rules').feats.find((f) => f.id === id); },
    invocationDef(id) { return (NK.Data.get('rules').invocations || []).find((x) => x.id === id); },
    metamagicDef(id) { return (NK.Data.get('rules').metamagics || []).find((x) => x.id === id); },
    pactBoonDef(id) { return (NK.Data.get('rules').pactBoons || []).find((x) => x.id === id); },
    styleDef(id) { return NK.Data.get('rules').fightingStyles.find((f) => f.id === id); },
    skillDef(id) { return NK.Data.get('rules').skills.find((s) => s.id === id); },
    skills() { return NK.Data.get('rules').skills; },
    subclassOf(p) {
      const cls = Rules.classDef(p.classId);
      return (cls.subclasses || []).find((s) => s.id === p.subclassId) || null;
    },
    subclassDef(classId, subId) {
      const cls = Rules.classDef(classId);
      return (cls.subclasses || []).find((s) => s.id === subId) || null;
    },
    /** 角色的全部职业条目（主职 + 兼职）。旧存档没有 classes 字段时，用 classId/level/subclassId 退化出单职业条目。 */
    classEntries(p) {
      if (!p.classes || !p.classes.length) return [{ id: p.classId, level: p.level, subclassId: p.subclassId || null }];
      return p.classes;
    },
    /** 总等级 = 各职业等级之和（决定熟练加值等） */
    totalLevel(p) { return Rules.classEntries(p).reduce((a, e) => a + (e.level || 0), 0); },
    /** 把 p.classes 与 p.level 同步成一致，并补默认值。每个 recalc 都跑一次。 */
    normalizeClasses(p) {
      if (!p.classes || !p.classes.length) {
        p.classes = [{ id: p.classId, level: p.level, subclassId: p.subclassId || null }];
      } else {
        p.classId = p.classes[0].id;
        // 单职业：兼容「外部直接设置 p.level」（如测试 p.level=10）。
        // 必须取 max 而非直接赋值——否则会覆盖 levelUp 刚刚做的 entry.level += 1，
        // 导致 p.level 永远不增长、gainXp 死循环（OOM）。
        if (p.classes.length === 1) p.classes[0].level = Math.max(p.classes[0].level, p.level);
      }
      p.level = Rules.totalLevel(p);
      // 仅在 styles 与 styleClasses 长度不一致时重建，避免每次 recalc 把多职业的风格归属洗回主职
      if (!p.styleClasses || p.styleClasses.length !== (p.styles || []).length) {
        p.styleClasses = (p.styles || []).map(() => p.classId);
      }
      if (!p.asiTaken) p.asiTaken = [];
    },
    /** 给 UI / 结算用的职业标签，例如「战士 5 / 游侠 2」 */
    classLabel(p) {
      return Rules.classEntries(p).map((e) => { const c = Rules.classDef(e.id); return c ? (c.name + ' ' + e.level) : e.id; }).join(' / ');
    },
    /** 所有会施法的职业条目 */
    castingEntries(p) {
      return Rules.classEntries(p).filter((e) => { const c = Rules.classDef(e.id); return c && c.spellcasting; });
    },
    /** 一个职业「实际能学」的法术归属集合：自身 id + 它继承的法术列表（spellList，例如术士继承法师列表） */
    spellListOf(clsId) {
      const def = Rules.classDef(clsId);
      const base = [clsId];
      if (def && Array.isArray(def.spellList)) base.push.apply(base, def.spellList);
      return base;
    },
    /** 还能学的新法术（戏法或环阶法术）：并集所有施法职业、排除已学会的 */
    spellPool(p, isCantrip) {
      const cs = Rules.castingEntries(p);
      if (!cs.length) return [];
      const owned = isCantrip ? new Set(p.cantrips || []) : new Set((p.prepared || []).concat(p.knownSpells || []));
      const maxLv = isCantrip ? 0 : Math.max(1, Rules.maxSpellLevel(p) || 1);
      const ids = new Set();
      for (const e of cs) {
        const eff = Rules.spellListOf(e.id);
        NK.Data.get('spells').spells.forEach((s) => {
          if (s.classes.some((c) => eff.includes(c)) && !owned.has(s.id) && (isCantrip ? s.level === 0 : (s.level >= 1 && s.level <= maxLv))) ids.add(s.id);
        });
      }
      return NK.Data.get('spells').spells.filter((s) => ids.has(s.id));
    },
    /** 这个法术属于哪个职业（决定它吃常规法术位还是契约位）。
     *  5e：兼职邪术师时，只有邪术师的法术能用契约位；法师/牧师的法术照走常规法术位。
     *  归属判断：取「能学到它的施法职业」里第一个非契约职业；只有邪术师能学时才归邪术师。 */
    spellOwnerOf(p, spellId) {
      const sp = Rules.spellDef(spellId);
      if (!sp) return null;
      const cs = Rules.castingEntries(p);
      if (!cs.length) return null;
      const cand = cs.filter((e) => (sp.classes || []).some((c) => Rules.spellListOf(e.id).includes(c)));
      if (!cand.length) return cs[0].id;
      const nonPact = cand.filter((e) => { const sc = (Rules.classDef(e.id) || {}).spellcasting; return !sc || sc.type !== 'pact'; });
      return (nonPact[0] || cand[0]).id;
    },
    /** 这个法术是不是「契约法术」（走邪术师的契约位而不是常规法术位） */
    isPactSpell(p, spellId) {
      const owner = Rules.spellOwnerOf(p, spellId);
      if (!owner) return false;
      const sc = (Rules.classDef(owner) || {}).spellcasting;
      return !!(sc && sc.type === 'pact');
    },
    /** 取所有施法职业中的最高可施放环阶：常规法术位、契约位、玄奥秘术三者取最大（5e） */
    maxSpellLevel(p) {
      let max = 0;
      const row = Rules.slotsMax(p);
      row.forEach((n, i) => { if (n > 0) max = i + 1; });
      if ((p.pactLevel || 0) > max) max = p.pactLevel;
      return max;
    },
    /** 兼职「合并施法等级」：全施法 1 级/级，半施法（游侠/圣武士）每 2 级 1 级，工匠向上取整 */
    casterLevel(p) {
      const cs = Rules.castingEntries(p).filter((e) => { const sc = Rules.classDef(e.id).spellcasting; return sc && sc.type !== 'pact'; });
      let lv = 0;
      for (const e of cs) {
        const sc = Rules.classDef(e.id).spellcasting;
        if (sc.type === 'full') lv += e.level;
        else if (sc.halfUp) lv += Math.ceil(e.level / 2);
        else lv += Math.floor(e.level / 2);
      }
      return U.clamp(lv, 0, Rules.LEVEL_CAP);
    },
    /** 法术位（1-9 环）。多职业按 5e 的「合并施法等级」表取；玄奥秘术（六~九环各 1 个）并入常规法术位。 */
    slotsMax(p) {
      const cs = Rules.castingEntries(p).filter((e) => { const sc = Rules.classDef(e.id).spellcasting; return sc && sc.type !== 'pact'; });
      const out = new Array(Rules.MAX_SLOT).fill(0);
      // 玄奥秘术（邪术师 11/13/15/17 级）：六~九环各多一个「每日一次」的法术位（长休恢复）
      const wl = Rules.classEntries(p).find((e) => { const c = Rules.classDef(e.id); return c && c.spellcasting && c.spellcasting.type === 'pact'; });
      if (wl) {
        for (const a of (NK.Data.get('rules').mysticArcanum || [])) {
          if (wl.level >= a.level) out[a.slot - 1] = (out[a.slot - 1] || 0) + 1;
        }
      }
      if (!cs.length) return out;
      if (cs.length === 1) {
        // 单职业：直接查本职表（全施法用等级，半施法用职业等级）
        const e = cs[0];
        const sc = Rules.classDef(e.id).spellcasting;
        const table = sc.type === 'full' ? NK.Data.get('rules').fullCasterSlots : NK.Data.get('rules').halfCasterSlots;
        const key = String(U.clamp(sc.halfUp ? Math.min(Rules.LEVEL_CAP, e.level + 1) : e.level, 1, Rules.LEVEL_CAP));
        const row = table[key] || [];
        for (let i = 0; i < Rules.MAX_SLOT; i++) out[i] = row[i] || 0;
      } else {
        const cl = Rules.casterLevel(p);
        if (cl > 0) {
          const row = NK.Data.get('rules').fullCasterSlots[String(cl)] || [];
          for (let i = 0; i < Rules.MAX_SLOT; i++) out[i] = row[i] || 0;
        }
      }
      return out;
    },
    /** 契约魔法（邪术师）：返回 {level, slots} 或 null。所有契约法术都以同一最高环阶施放，短休恢复。 */
    pactMax(p) {
      const ent = Rules.classEntries(p).find((e) => { const c = Rules.classDef(e.id); return c && c.spellcasting && c.spellcasting.type === 'pact'; });
      if (!ent) return null;
      const table = NK.Data.get('rules').pactSlotsByLevel;
      const r = (table && table[U.clamp(ent.level, 1, Rules.LEVEL_CAP)]) || null;
      return r ? { level: r[1], slots: r[0] } : null;
    },
    /** 施法属性：优先主职业；主职业不施法时取第一个施法兼职的属性 */
    spellAbility(p) {
      const cs = Rules.castingEntries(p);
      if (!cs.length) return null;
      const primary = Rules.classEntries(p)[0];
      const pc = Rules.classDef(primary.id);
      if (pc && pc.spellcasting) return pc.spellcasting.ability;
      return Rules.classDef(cs[0].id).spellcasting.ability;
    },
    spellMod(p) {
      const a = Rules.spellAbility(p);
      return a ? Rules.mod(p.attrs[a]) : 0;
    },
    /** 该角色所有施法职业可用的法术列表（并集） */
    classSpells(p) {
      const cs = Rules.castingEntries(p);
      const ids = new Set();
      for (const e of cs) { const eff = Rules.spellListOf(e.id); NK.Data.get('spells').spells.forEach((s) => { if (s.classes.some((c) => eff.includes(c))) ids.add(s.id); }); }
      return NK.Data.get('spells').spells.filter((s) => ids.has(s.id));
    },
    /** 现在能施放的法术（含戏法）：并集所有施法职业——法师=法术书，牧师/圣武士=已准备，游侠=已知 */
    castableSpells(p) {
      const cs = Rules.castingEntries(p);
      if (!cs.length) return [];
      const ids = new Set();
      for (const e of cs) {
        const sc = Rules.classDef(e.id).spellcasting;
        const list = sc.prepared ? (p.prepared || []) : (p.knownSpells || []);
        list.forEach((id) => ids.add(id));
      }
      (p.cantrips || []).forEach((id) => ids.add(id));
      return Array.from(ids).map((id) => Rules.spellDef(id)).filter(Boolean);
    },
    /** 某职业在 lv 级会几个戏法（5e 分段表） */
    cantripsKnown(clsId, lv) {
      const sc = Rules.classDef(clsId).spellcasting;
      const table = (sc && sc.cantripsByLevel) || null;
      if (table) return table[U.clamp(lv, 1, table.length) - 1] || 0;
      return (sc && sc.cantrips) || 0;
    },
    /** 法术容量：各施法职业按各自职业等级累加（已准备/已知/戏法分别求和） */
    spellCapacity(p) {
      const cs = Rules.castingEntries(p);
      if (!cs.length) return { cantrips: 0, prepared: 0, known: 0 };
      let cantrips = 0, prepared = 0, known = 0;
      const epl = (p.flags && p.flags.extraSpellPerLevel) || 0;
      for (const e of cs) {
        const cls = Rules.classDef(e.id);
        const sc = cls.spellcasting;
        const mod = Rules.spellMod(p);
        cantrips += Rules.cantripsKnown(e.id, e.level);
        if (sc.spellbook) {
          // 法术书：每级抄进去的法术（5e 法师 1 级 6 个，之后每级 +2）
          known += (sc.spellsAtLevel1 || 0) + (e.level - 1) * ((sc.spellsPerLevel || 2) + epl);
        } else if (!sc.prepared) {
          const table = sc.knownByLevel || [];
          known += table[U.clamp(e.level, 1, table.length) - 1] || 0;
        }
        if (sc.prepared) {
          // 5e：已准备 = 施法属性调整值 + 职业等级（半施法职业取等级的一半，向下取整，最低 1）
          const half = sc.type === 'half' ? Math.floor(e.level / 2) : e.level;
          const noSlots = sc.type === 'half' && !sc.halfUp && e.level < 2;
          if (!noSlots) prepared += Math.max(1, mod + half);
        }
      }
      // 书之契约：额外的 3 个戏法
      if (p.flags && p.flags.pactTome) cantrips += 3;
      return { cantrips, prepared, known };
    },

    /** 术法点上限：5e —— 术士 2 级起，术法点 = 术士职业等级 */
    sorceryMax(p) {
      let lv = 0;
      for (const e of Rules.classEntries(p)) {
        const cls = Rules.classDef(e.id);
        if (cls && (cls.features || []).some((f) => f.choice === 'metamagic')) lv += e.level;
      }
      return lv >= 2 ? lv : 0;
    },

    /* ---------- 修正值聚合 ---------- */
    agg(p) {
      const mods = {};
      const flags = {};
      const sources = [];
      const add = (src, eff) => {
        if (!eff) return;
        let touched = false;
        for (const k of Object.keys(eff)) {
          const v = eff[k];
          if (Array.isArray(v)) { flags[k] = (flags[k] || []).concat(v); touched = true; }
          else if (typeof v === 'boolean') { if (v) flags[k] = true; touched = true; }
          else if (typeof v === 'string') { flags[k] = v; touched = true; }
          else if (typeof v === 'number') {
            // 数值键进 mods；同时也在 flags 上留一份，方便 `if (p.flags.sneakAttack)` 这类开关写法
            if (NUM.includes(k)) mods[k] = (mods[k] || 0) + v;
            flags[k] = (typeof flags[k] === 'number' ? flags[k] : 0) + v;
            touched = true;
          } else { flags[k] = v; touched = true; }
        }
        if (touched) sources.push(src);
      };

      const race = Rules.raceDef(p.raceId);
      if (race) race.traits.forEach((t) => add('种族·' + t.name, t.effects));
      const bg = Rules.bgDef(p.bgId);
      if (bg) add('背景·' + bg.name, bg.effects);

      for (const e of Rules.classEntries(p)) {
        const cls = Rules.classDef(e.id);
        if (!cls) continue;
        for (const f of cls.features) if (f.level <= e.level) add('职业·' + cls.name + '·' + f.name, f.effects);
        const sub = (cls.subclasses || []).find((s) => s.id === e.subclassId);
        if (sub) for (const f of sub.features) if (f.level <= e.level) add('子职·' + sub.name + '·' + f.name, f.effects);
      }
      for (const fid of p.feats || []) { const ft = Rules.featDef(fid); if (ft) add('专长·' + ft.name, ft.effects); }
      for (const sid of p.styles || []) { const st = Rules.styleDef(sid); if (st) add('战斗风格·' + st.name, st.effects); }
      // 职业专属选项：魔能祈愿 / 超魔 / 魔契恩泽（选了才生效）
      for (const id of p.invocations || []) { const o = Rules.invocationDef(id); if (o) add('魔能祈愿·' + o.name, o.effects); }
      for (const id of p.metamagics || []) { const o = Rules.metamagicDef(id); if (o) add('超魔·' + o.name, o.effects || {}); }
      const boon = p.pactBoon ? Rules.pactBoonDef(p.pactBoon) : null;
      if (boon) add('魔契·' + boon.name, boon.effects);
      // 装备（10 个槽位 + 戒指数组）
      const equip = (label, it) => {
        const m = Object.assign({}, it.bonus || {}, it.mods || {});
        if (it.resist) m.resist = (m.resist || []).concat(it.resist);
        add(label + '·' + it.name, m);
      };
      for (const slot of Rules.EQUIP_SLOTS) {
        const it = p.items[slot];
        if (it) equip('装备', it);
      }
      for (const it of (p.items.rings || [])) equip('戒指', it);
      // Buff / 状态
      for (const b of (p.buffs || [])) add((b.kind === 'curse' ? '诅咒·' : '增益·') + b.name, b.mods);
      for (const c of (p.conditions || [])) if (c.mods) add('状态·' + c.name, c.mods);

      return { mods, flags, sources };
    },

    isProficient(p, item) {
      if (!item) return true;
      const profs = p.proficiencies || {};
      if (item.dice) return (profs.weapons || []).includes(item.category);
      if (item.slot === 'body') return (profs.armor || []).includes(item.category);
      if (item.slot === 'offHand' && !item.dice) return (profs.armor || []).includes('shield');
      return true;
    },

    /* ---------- 装备限制与惩罚 ---------- */
    ringCap(p) { return Math.min(Rules.RING_CAP, 1 + (p.mods.ringSlots || 0)); },
    ringCount(p) { return (p.items.rings || []).length; },
    /** 能量干涉：从第 2 枚戒指开始，每多一枚，所有 d20 检定 -1 */
    interference(p) { return Math.max(0, Rules.ringCount(p) - 1); },

    /** 未熟练的护甲/盾牌：力量与敏捷检定/豁免劣势，且无法施法 */
    armorPenalty(p) {
      const body = p.items.body;
      const off = p.items.offHand;
      const shield = off && !off.dice && off.category === 'shield' ? off : null;
      const profs = p.proficiencies.armor || [];
      const badArmor = !!(body && !profs.includes(body.category));
      const badShield = !!(shield && !profs.includes('shield'));
      return {
        strDexDisadvantage: badArmor || badShield,
        noSpellcasting: badArmor || badShield,
        stealthDisadvantage: !!(body && body.stealthDisadvantage),
        heavyStrPenalty: !!(body && body.minStr && p.attrs.str < body.minStr),
        badArmor, badShield,
      };
    },

    /** 某属性的豁免检定用什么掷法（护甲惩罚会带来劣势） */
    saveMode(p, attr) {
      const pen = Rules.armorPenalty(p);
      if (pen.strDexDisadvantage && (attr === 'str' || attr === 'dex')) return 'dis';
      if (p.mods.saveDisadvantage) return 'dis';
      return null;
    },
    /** 技能/属性检定用什么掷法 */
    checkMode(p, skillId, attr) {
      const pen = Rules.armorPenalty(p);
      const a = attr || (skillId ? Rules.skillDef(skillId).attr : null);
      if (pen.strDexDisadvantage && (a === 'str' || a === 'dex')) return 'dis';
      if (skillId === 'stealth' && pen.stealthDisadvantage) return 'dis';
      if (p.mods.checkDisadvantage) return 'dis';
      return null;
    },

    /** 能不能把 item 放到 slot 里 */
    canEquip(p, item, slot) {
      if (!item) return { ok: false, msg: '没有这件物品。' };
      const SN = NK.Items.SLOT_NAME;
      if (slot === 'rings') {
        if (item.slot !== 'rings') return { ok: false, msg: `${item.name} 不是戒指。` };
        if (Rules.ringCount(p) >= Rules.ringCap(p)) {
          return { ok: false, msg: `戒指上限是 ${Rules.ringCap(p)} 枚。再多就需要通过事件或专长提升上限（能量干涉会随之增加）。` };
        }
        return { ok: true };
      }
      if (item.hands === 2 && slot !== 'mainHand') return { ok: false, msg: '双手武器只能装备在右手——它会同时占用左手。' };
      if (slot === 'offHand' && p.items.mainHand && p.items.mainHand.hands === 2) {
        return { ok: false, msg: '右手是双手武器，左手腾不出来。先换掉右手的武器。' };
      }
      if (item.slot === 'mainHand' && (slot === 'mainHand' || slot === 'offHand')) return { ok: true };
      if (item.slot === slot) return { ok: true };
      return { ok: false, msg: `${item.name} 不能装备在${SN[slot] || slot}。` };
    },

    /* ---------- 派生数值 ---------- */
    recalc(p) {
      Rules.normalizeClasses(p);
      const agg = Rules.agg(p);
      p.mods = agg.mods;
      p.flags = agg.flags;
      p.sources = agg.sources;

      // 属性：购点 + 种族 + 自选 + 特性加值（如野蛮人 20 级「原始勇士」力量/体质 +4）
      // 以 baseAttrs 为基准重算，避免反复 recalc 时叠加；封顶 20（原始勇士提到 24）
      if (p.baseAttrs) {
        const race = Rules.raceDef(p.raceId);
        const cap = 20 + (p.mods.attrCap || 0);
        for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
          const extra = p.mods['attr' + k.charAt(0).toUpperCase() + k.slice(1)] || 0;
          const v = (p.baseAttrs[k] || 10) + ((race && race.bonus && race.bonus[k]) || 0) + ((p.bonusChoice || {})[k] || 0) + extra;
          p.attrs[k] = Math.min(cap, Math.max(1, v));
        }
      }
      // 额外豁免熟练（游荡者 L15 滑溜心智、武僧 L14 金刚之魂）
      if (p.flags.diamondSoul || (p.flags.saveProfExtra || []).length) {
        for (const a of (p.flags.diamondSoul ? ['str', 'dex', 'con', 'int', 'wis', 'cha'] : p.flags.saveProfExtra)) {
          if (a && !(p.proficiencies.saves || []).includes(a)) p.proficiencies.saves.push(a);
        }
      }

      // AC
      let ac = 10 + Rules.mod(p.attrs.dex);
      const armor = p.items.body;
      if (armor) {
        const dexMod = Rules.mod(p.attrs.dex);
        const cap = armor.dexCap === null || armor.dexCap === undefined ? dexMod : Math.min(dexMod, armor.dexCap);
        ac = armor.base + cap;
        if (armor.minStr && p.attrs.str < armor.minStr) ac -= 2;   // 力量不足：AC -2
      } else if (agg.flags.acSet) {
        ac = agg.flags.acSet.base + (agg.flags.acSet.addDex ? Rules.mod(p.attrs.dex) : 0);
      } else if (agg.flags.unarmoredCon) {
        ac = 10 + Rules.mod(p.attrs.dex) + Rules.mod(p.attrs.con);   // 野蛮人无甲防御
      }
      const off = p.items.offHand;
      if (off && !off.dice) ac += (off.base || 2);   // 盾牌
      if (agg.flags.acWis) ac += Rules.mod(p.attrs.wis);   // 以智力加值为基础 AC（如某些法师）
      p.ac = ac + (p.mods.ac || 0);
      p.acPenalty = Rules.armorPenalty(p);

      // 生命（多职业：逐职业累加最大生命骰 + 每级固定值，每级都加体质调整值）
      const conMod = Rules.mod(p.attrs.con);
      const mcfg = NK.Data.get('maps') || {};
      let hpSum = 0;
      for (const e of Rules.classEntries(p)) {
        const cls = Rules.classDef(e.id);
        if (!cls) continue;
        const avg = Math.max(1, Math.floor(cls.hitDie / 2) + 1);
        hpSum += cls.hitDie + conMod + (e.level - 1) * (avg + conMod);
      }
      const base = hpSum + (p.mods.maxHp || 0) + (p.level - 1) * (p.mods.maxHpPerLevel || 0);
      p.maxHp = Math.max(1, Math.round(base * (mcfg.playerHpMul || 1) + (mcfg.playerHpFlat || 0)));
      p.hp = U.clamp(p.hp === undefined ? p.maxHp : p.hp, 0, p.maxHp);
      p.tempHp = p.tempHp || 0;

      // 抗性 / 免疫 / 易伤（种族 + 装备 + 增益）
      p.resist = (p.flags.resist || []).slice();
      p.immune = (p.flags.immune || []).slice();
      p.vuln = (p.flags.vuln || []).slice();

      // 装备技能：把已装备物品上的 daily 收集起来
      p.itemAbilities = [];
      p.itemPassives = {};
      for (const it of Rules.equippedList(p)) {
        if (!it || !it.daily) continue;
        if (it.daily.id === 'second_breath' || it.daily.id === 'read_the_room') p.itemPassives[it.daily.id] = true;
        else p.itemAbilities.push({ id: it.daily.id, name: it.daily.name, desc: it.daily.desc, source: it.name, slot: it.slot });
      }

      // 法术位（1~9 环）
      const newMax = Rules.slotsMax(p);
      if (!p.slotsMax || !p.slots || p.slotsMax.length !== Rules.MAX_SLOT || p.slots.length !== Rules.MAX_SLOT) {
        p.slotsMax = newMax.slice();
        p.slots = newMax.slice();
      } else {
        for (let i = 0; i < Rules.MAX_SLOT; i++) {
          const diff = newMax[i] - p.slotsMax[i];
          if (diff > 0) p.slots[i] = (p.slots[i] || 0) + diff;
          p.slots[i] = Math.min(p.slots[i] || 0, newMax[i]);
        }
        p.slotsMax = newMax.slice();
      }

      // 契约魔法（邪术师）：所有契约法术皆以同一最高环阶施放，短休恢复
      const pm = Rules.pactMax(p);
      if (pm) {
        p.pactLevel = pm.level;
        if (p.pactSlotsMax !== pm.slots) { p.pactSlotsMax = pm.slots; p.pactSlots = pm.slots; }
      } else { p.pactLevel = 0; p.pactSlots = 0; p.pactSlotsMax = 0; }

      // 气（武僧）：5e —— 气点 = 武僧职业等级
      if (p.flags.ki) {
        const monk = Rules.classEntries(p).find((e) => e.id === 'monk');
        p.kiMax = monk ? monk.level : 0;
        if (p.kiLeft === undefined) p.kiLeft = p.kiMax;
        p.kiLeft = Math.min(p.kiLeft, p.kiMax);
      } else { p.kiMax = 0; p.kiLeft = 0; }

      // 狂暴（野蛮人）：5e —— 每日次数 2 / 3(L3) / 4(L6) / 5(L12) / 6(L17)
      if (p.flags.rage) {
        p.rageDr = 0;   // 5e 狂暴是「抗性（减半）」而不是固定减值，见上方 p.resist
        const barb = Rules.classEntries(p).find((e) => e.id === 'barbarian');
        const bl0 = barb ? barb.level : 0;
        p.rageDmg = bl0 >= 17 ? 4 : bl0 >= 9 ? 3 : 2;   // 5e 狂暴增伤 +2/+3/+4
        const bl = barb ? barb.level : 0;
        p.rageMax = 2 + (bl >= 3 ? 1 : 0) + (bl >= 6 ? 1 : 0) + (bl >= 12 ? 1 : 0) + (bl >= 17 ? 1 : 0);
        if (p.rageLeft === undefined) p.rageLeft = p.rageMax;
      } else { p.rageDr = 0; p.rageDmg = 0; p.rageLeft = 0; }
      // 狂暴时对钝击/穿刺/挥砍的「抗性」（5e 原版是减半，不是固定减值）
      if (p.raging) {
        for (const t of ['挥砍', '穿刺', '钝击']) if (!p.resist.includes(t)) p.resist.push(t);
      }

      // 圣武士：圣疗池 = 圣武士职业等级 × 5（5e，不按总等级算）
      if (p.flags.layOnHands) {
        const pal = Rules.classEntries(p).find((e) => e.id === 'paladin');
        const lmax = (pal ? pal.level : p.level) * p.flags.layOnHands;
        p.layPoolMax = lmax;
        if (p.layPool === undefined) p.layPool = lmax;
        p.layPool = Math.min(p.layPool, lmax);
      }
      // 战斗大师：卓越骰
      if (p.flags.superiority) {
        p.superiorityMax = p.flags.superiority;
        if (p.superiorityLeft === undefined) p.superiorityLeft = p.flags.superiority;
      }
      // 每场战斗可用次数：动作如潮 / 引导神力 / 不屈（5e 是每次休息，这里按战斗重置）
      p.actionSurgeMax = p.flags.actionSurge ? 1 + (p.mods.actionSurgeUses || 0) : 0;
      p.channelMax = p.flags.channelDivinity ? 1 + (p.mods.channelUses || 0) : 0;
      p.indomitableMax = p.flags.indomitable ? 1 + (p.mods.indomitableUses || 0) : 0;
      // 吟游激励骰（5e：d6 → d8(L5) → d10(L10) → d12(L15)）
      p.bardDie = p.mods.bardDie || 6;
      // 偷袭骰（5e：游荡者等级的向上取整一半，1d6 → 10d6）
      const rog = Rules.classEntries(p).find((e) => e.id === 'rogue');
      if (rog && p.flags.sneakAttack) p.mods.sneakAttack = Math.ceil(rog.level / 2);

      // 上限提高时补差额、上限不变时只在超限时收敛（升到能用的等级就该立刻能用）
      const refill = (cur, prev, max) => {
        if (prev === undefined || cur === undefined) return max;
        if (max > prev) return Math.min(max, cur + (max - prev));
        return Math.min(cur, max);
      };
      // 术法点（术士超魔）
      const smax = Rules.sorceryMax(p);
      p.sorceryLeft = refill(p.sorceryLeft, p.sorceryMaxPrev, smax);
      p.sorceryMaxPrev = smax;
      p.sorceryMax = smax;

      // 野性形态（德鲁伊）：次数来自特性数值
      const wmax = typeof p.flags.wildShape === 'number' ? p.flags.wildShape : (p.flags.wildShape ? 2 : 0);
      p.wildShapeLeft = refill(p.wildShapeLeft, p.wildShapeMaxPrev, wmax);
      p.wildShapeMaxPrev = wmax;
      p.wildShapeMax = wmax;

      // 吟游灵感（诗人）：次数 = 魅力调整值（最少 1）
      const imax = p.flags.bardicInspiration ? Math.max(1, Rules.mod(p.attrs.cha)) : 0;
      p.inspirationLeft = refill(p.inspirationLeft, p.inspirationMaxPrev, imax);
      p.inspirationMaxPrev = imax;
      p.inspirationMax = imax;

      p.prof = Rules.profBonus(p.level);
      p.critRange = Math.min(p.mods.critRange || 20, 20);
      p.critMult = p.mods.critMult || 2;
      return p;
    },

    /** 所有已装备物品（含戒指） */
    equippedList(p) {
      const out = [];
      for (const slot of Rules.EQUIP_SLOTS) if (p.items[slot]) out.push(p.items[slot]);
      for (const it of (p.items.rings || [])) out.push(it);
      return out;
    },

    skillBonus(p, skillId) {
      const sk = Rules.skillDef(skillId);
      if (!sk) return 0;
      let b = Rules.mod(p.attrs[sk.attr]);
      if ((p.proficiencies.skills || []).includes(skillId)) b += p.prof;
      if ((p.expertise || []).includes(skillId)) b += 3;
      b += (p.mods.skillBonus || 0);
      b -= Rules.interference(p);          // 能量干涉
      return b;
    },
    /** 技能的来源拆解，给人物卡用 */
    skillInfo(p, skillId) {
      const sk = Rules.skillDef(skillId);
      const prof = (p.proficiencies.skills || []).includes(skillId);
      const exp = (p.expertise || []).includes(skillId);
      return { attr: sk.attr, mod: Rules.mod(p.attrs[sk.attr]), proficient: prof, expertise: exp, total: Rules.skillBonus(p, skillId) };
    },
    saveBonus(p, attr) {
      let b = Rules.mod(p.attrs[attr]);
      if ((p.proficiencies.saves || []).includes(attr)) b += p.prof;
      b += (p.mods.saveBonus || 0) + (p.mods['saveBonus' + attr.charAt(0).toUpperCase() + attr.slice(1)] || 0);
      if (p.flags.auraSave) b += Rules.mod(p.attrs.cha);
      b -= Rules.interference(p);           // 能量干涉
      return b;
    },

    /** 武僧武技骰：1d4（1-4 级）→ 1d6（5-10）→ 1d8（11-16）→ 1d10（17+） */
    monkDie(p) {
      const m = Rules.classEntries(p).find((e) => e.id === 'monk');
      const lv = m ? m.level : 0;
      return lv >= 17 ? 10 : lv >= 11 ? 8 : lv >= 5 ? 6 : 4;
    },
    /** 攻击属性（徒手时武僧可以用敏捷；灵巧/远程用敏捷，其余用力量） */
    attackAbility(p, weapon) {
      if (!weapon) return (p.flags && p.flags.ki) ? 'dex' : 'str';
      if (weapon.kind === 'ranged') return 'dex';
      if ((weapon.properties || []).includes('finesse')) return Rules.mod(p.attrs.dex) >= Rules.mod(p.attrs.str) ? 'dex' : 'str';
      return 'str';
    },
    /** 法师能不能把这张卷轴抄进法术书 */
    canCopyScroll(p, item) {
      const cls = Rules.classDef(p.classId);
      const sc = cls.spellcasting;
      const sp = NK.Items.scrollSpell(item);
      if (!sp) return { ok: false, msg: '这不是法术卷轴。' };
      if (!sc || !sc.spellbook) return { ok: false, msg: '只有把法术记在法术书里的职业才能抄写卷轴（法师）。' };
      if (!(sp.classes || []).includes(cls.id)) return { ok: false, msg: `${sp.name}不在${cls.name}的法术列表上，抄了也读不出来。` };
      const maxLv = Rules.maxSpellLevel(p);
      if (sp.level > maxLv) return { ok: false, msg: `你目前最高只能施放 ${maxLv} 环法术，还读不懂 ${sp.level} 环。` };
      if ((p.knownSpells || []).includes(sp.id)) return { ok: false, msg: `法术书里已经有${sp.name}了。` };
      const cost = NK.Items.copyCost(sp);
      return { ok: true, spell: sp, cost, msg: `${sp.name}（${sp.level} 环），抄写需要 ${cost} 金币。` };
    },

    attackBonus(p, weapon) {
      const w = weapon || p.items.mainHand;
      const abil = Rules.attackAbility(p, w);
      let b = Rules.mod(p.attrs[abil]);
      if (Rules.isProficient(p, w)) b += p.prof;
      b += (p.mods.hit || 0);
      if (w && w.kind === 'ranged') b += (p.mods.rangedHit || 0);
      if (w) b += (w.bonus && w.bonus.hit) || 0;
      b -= Rules.interference(p);           // 能量干涉
      return b;
    },
    /** 伤害骰：右手武器；左手空着时双手武器才吃双手骰 */
    weaponDice(p, weapon) {
      const w = (weapon === undefined) ? p.items.mainHand : weapon;
      if (!w) return (p.flags && p.flags.ki) ? ('1d' + Rules.monkDie(p)) : '1d2';   // 武僧徒手走武技骰
      if (w.versatile && !p.items.offHand) return w.versatile;
      return w.dice;
    },
    damageBonus(p, weapon, opts) {
      const w = (weapon === undefined) ? p.items.mainHand : weapon;
      const o = opts || {};
      const abil = Rules.attackAbility(p, w);
      // 副手攻击不加属性调整值（5e 双武器战斗），除非有「双武器战斗」风格
      let b = (o.offhand ? 0 : Rules.mod(p.attrs[abil])) + (p.mods.dmg || 0);
      if (!w && (p.flags && p.flags.ki)) b += (p.mods.monkDmg || 0);   // 武僧徒手加值
      if (w) b += (w.bonus && w.bonus.dmg) || 0;
      if (w && w.kind === 'ranged') b += (p.mods.rangedDmg || 0);
      if (o.offhand) b += (p.mods.offhandDmg || 0);
      else if (w && !w.twoHanded && !p.items.offHand) b += (p.mods.oneHandDmg || 0);
      return b;
    },
    spellAttack(p) { return p.prof + Rules.spellMod(p) + (p.mods.spellHit || 0); },
    spellDc(p) { return 8 + p.prof + Rules.spellMod(p) + (p.mods.spellDc || 0); },
    /** 5e 戏法随角色等级成长：5 级 ×2、11 级 ×3、17 级 ×4 */
    cantripMul(p) {
      const lv = Rules.totalLevel(p);
      return lv >= 17 ? 4 : lv >= 11 ? 3 : lv >= 5 ? 2 : 1;
    },
    /** 把骰子表达式的骰数乘一个倍数 */
    scaleDice(spec, mul) {
      if (!mul || mul === 1) return spec;
      const d = NK.Dice.parse(spec);
      return `${d.count * mul}d${d.sides}${d.mod ? (d.mod > 0 ? '+' + d.mod : d.mod) : ''}`;
    },
    initiative(p) { return Rules.mod(p.attrs.dex) + (p.mods.initBonus || 0) + (p.mods.initiative || 0); },

    /* ---------- 创建角色 ---------- */
    pointBuyCost(attrs) {
      const pb = NK.Data.get('rules').pointBuy;
      let cost = 0;
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v < pb.min || v > pb.max) return -1;
        cost += pb.cost[String(v)] || 0;
      }
      return cost;
    },

    createPlayer(c) {
      // 多职业：c.classes 是权威；缺省退化为单职业
      const entries = (c.classes && c.classes.length)
        ? c.classes.map((e) => ({ id: e.id, level: e.level || 1, subclassId: e.subclassId || null }))
        : [{ id: c.classId, level: 1, subclassId: c.subclassId || null }];
      const primary = entries[0];
      const cls = Rules.classDef(primary.id);
      const race = Rules.raceDef(c.raceId);
      const bg = Rules.bgDef(c.bgId);
      const baseAttrs = {};
      const finalAttrs = {};
      for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
        baseAttrs[k] = c.attrs[k];
        finalAttrs[k] = c.attrs[k] + ((race.bonus || {})[k] || 0) + ((c.bonusChoice || {})[k] || 0);
      }
      // 熟练：并集所有职业条目（多职业应获得各职业的豁免/护甲/武器熟练）
      const saves = Array.from(new Set(entries.flatMap((e) => (Rules.classDef(e.id) || {}).saveProfs || [])));
      const armor = Array.from(new Set(entries.flatMap((e) => (Rules.classDef(e.id) || {}).armorProfs || [])));
      const weapons = Array.from(new Set(entries.flatMap((e) => (Rules.classDef(e.id) || {}).weaponProfs || [])));
      const p = {
        isPlayer: true,
        name: c.name || '无名者',
        raceId: c.raceId, classId: primary.id, subclassId: primary.subclassId || null, bgId: c.bgId,
        level: entries.reduce((a, e) => a + e.level, 0), xp: 0,
        classes: entries,
        baseAttrs,                    // 购点结果（不含种族加值）
        bonusChoice: c.bonusChoice || {},
        attrs: finalAttrs,
        proficiencies: {
          skills: (c.skills || []).slice(),
          saves, armor, weapons,
        },
        expertise: [],
        feats: [], styles: c.styles ? c.styles.slice() : [],
        asiTaken: [], choicesTaken: {}, spellChoicesTaken: [],
        invocations: [], metamagics: [], pactBoon: null,
        sorceryLeft: 0, wildShapeLeft: 0, inspirationLeft: 0,
        knownSpells: (c.knownSpells || []).slice(),
        prepared: (c.prepared || []).slice(),
        cantrips: (c.cantrips || []).slice(),
        items: {
          mainHand: null, offHand: null, body: null, legs: null, helm: null,
          neck: null, bracers: null, greaves: null, boots: null, rings: [],
        },
        bag: [], inventory: [],
        buffs: [], conditions: [],
        hp: 1, tempHp: 0,
        gold: c.gold || cls.startGold || 100,
        hitDice: { die: cls.hitDie, total: 1, left: 1 },
        flags: {}, meta: {},
      };
      // 起始装备
      for (const it of (c.equipment || [])) {
        const slot = it.slot;
        if (slot === 'rings') { if ((p.items.rings || []).length < Rules.ringCap(p)) p.items.rings.push(it); else p.bag.push(it); }
        else if (!p.items[slot]) p.items[slot] = it;
        else p.bag.push(it);
      }
      // 背景已给的技能去重
      p.proficiencies.skills = Array.from(new Set(p.proficiencies.skills.concat(bg.skills)));
      Rules.recalc(p);
      p.hp = p.maxHp;
      return p;
    },

    /* ---------- 升级 ---------- */
    levelUp(p) {
      if (Rules.totalLevel(p) >= Rules.LEVEL_CAP) return null;
      // 默认把新等级加在「当前等级最低」的职业上（保持多职业均衡）；单职业则加在主职
      const entries = Rules.classEntries(p);
      const entry = entries.reduce((a, b) => (b.level < a.level ? b : a));
      const before = p.maxHp;
      entry.level += 1;
      p.lastLeveledClassId = entry.id;   // 记下这一级落在哪个职业，供升级界面「职业进阶」选择
      Rules.normalizeClasses(p);   // 重新同步 p.level = 总等级、p.classId = 主职
      p.hitDice = p.hitDice || { die: Rules.classDef(p.classId).hitDie, total: 0, left: 0 };
      p.hitDice.total = p.level;
      p.hitDice.left = Math.min(p.hitDice.total, p.hitDice.left + 1);
      Rules.recalc(p);
      const gain = p.maxHp - before;
      p.hp = Math.min(p.maxHp, p.hp + gain);
      const cls = Rules.classDef(entry.id);
      const sub = (cls.subclasses || []).find((s) => s.id === entry.subclassId) || null;
      const f = cls.features.find((x) => x.level === entry.level) || (sub ? sub.features.find((x) => x.level === entry.level) : null);
      return { level: entry.level, total: p.level, className: cls.name, feature: f ? f.name : null, featureDesc: f ? f.desc : null, hpGain: gain };
    },

    gainXp(p, amount) {
      p.xp += amount;
      const ups = [];
      while (p.level < Rules.LEVEL_CAP && p.xp >= Rules.xpNeeded(p.level)) {
        const u = Rules.levelUp(p);
        if (!u) break;
        ups.push(u);
      }
      return ups;
    },

    /** 待处理的选择（多职业：遍历每个职业条目，分别产生子职/属性/风格/专精/法术） */
    pendingChoices(p) {
      const out = [];
      const seen = {};   // 避免同一类选择重复入列
      // 职业特性类：子职 / 属性提升 / 战斗风格 / 专精
      for (const e of Rules.classEntries(p)) {
        const cls = Rules.classDef(e.id);
        if (!cls) continue;
        if (e.level >= (cls.subclassLevel || 99) && !e.subclassId) out.push({ kind: 'subclass', classId: e.id, level: cls.subclassLevel || e.level });
        for (const lv of (cls.asiLevels || [])) {
          if (e.level >= lv && !p.asiTaken.includes(e.id + ':' + lv)) out.push({ kind: 'asi', classId: e.id, level: lv });
        }
        // 战斗风格：持久化判断——每个提供风格的职业条目各获得其风格特性数量的风格（5e 内通常是 1 个）
        const styleFeats = (cls.features || []).filter((f) => f.choice === 'fightingStyle' && f.level <= e.level);
        if (styleFeats.length) {
          const have = (p.styleClasses || []).filter((c) => c === e.id).length;
          if (have < styleFeats.length) out.push({ kind: 'style', classId: e.id, level: styleFeats[0].level });
        }
        for (const f of (cls.features || [])) {
          if (f.choice === 'expertise' && f.level <= e.level) {
            const have = (p.expertise || []).length;
            const cands = (p.proficiencies.skills || []).filter((s) => !(p.expertise || []).includes(s));
            const remain = (f.choiceCount || 2) - have;
            if (remain > 0 && cands.length > 0) out.push({ kind: 'expertise', classId: e.id, level: f.level, count: Math.min(remain, cands.length) });
          }
        }
        // 职业专属选项：魔能祈愿 / 超魔 / 魔契恩泽（按「已解锁数量 − 已选数量」入列）
        const choiceKinds = [
          { kind: 'invocation', store: 'invocations', list: 'invocations' },
          { kind: 'metamagic', store: 'metamagics', list: 'metamagics' },
          { kind: 'pactBoon', store: null, list: 'pactBoons' },
        ];
        for (const ck of choiceKinds) {
          const feats = (cls.features || []).filter((f) => f.choice === ck.kind && f.level <= e.level);
          if (!feats.length) continue;
          const granted = feats.reduce((a, f) => a + (f.choiceCount || 1), 0);
          const have = ck.store ? (p[ck.store] || []).length : (p.pactBoon ? 1 : 0);
          const remain = granted - have;
          if (remain > 0 && (NK.Data.get('rules')[ck.list] || []).length > 0) {
            out.push({ kind: ck.kind, classId: e.id, level: feats[0].level, count: remain });
          }
        }
      }
      // 法术：遍历所有施法职业，按总容量补足（戏法 / 已准备 / 已知分别只入列一次）
      for (const e of Rules.castingEntries(p)) {
        const cls = Rules.classDef(e.id);
        const sc = cls.spellcasting;
        if (!seen.cantrips && (p.cantrips || []).length < Rules.spellCapacity(p).cantrips) {
          const pool = Rules.spellPool(p, true);
          if (pool.length === 0) { p.cantrips = Rules.classSpells(p).filter((s) => s.level === 0).map((s) => s.id).slice(0, Rules.spellCapacity(p).cantrips || 0); }
          else { out.push({ kind: 'cantrips', classId: e.id, level: p.level, count: Math.min(Rules.spellCapacity(p).cantrips - (p.cantrips || []).length, pool.length) }); seen.cantrips = true; }
        }
        const cap = Rules.spellCapacity(p);
        // 法师这类「有法术书 + 需准备」的职业：按法术书的容量去学（学到的自动进入已准备，直到准备位满）
        const bookOwn = !!sc.spellbook;
        if (bookOwn) {
          if (!seen.spellsKnown && (p.knownSpells || []).length < cap.known) {
            const pool = Rules.spellPool(p, false);
            if (pool.length === 0) { p.spellChoicesTaken = p.spellChoicesTaken || []; if (!p.spellChoicesTaken.includes(p.level)) p.spellChoicesTaken.push(p.level); }
            else { out.push({ kind: 'spells', classId: e.id, level: p.level, count: Math.min(cap.known - (p.knownSpells || []).length, pool.length) }); seen.spellsKnown = true; }
          }
        } else if (sc.prepared) {
          if (!seen.spellsPrepared && (p.prepared || []).length < cap.prepared) {
            const pool = Rules.spellPool(p, false);
            if (pool.length === 0) { p.spellChoicesTaken = p.spellChoicesTaken || []; if (!p.spellChoicesTaken.includes(p.level)) p.spellChoicesTaken.push(p.level); }
            else { out.push({ kind: 'spells', classId: e.id, level: p.level, count: Math.min(cap.prepared - (p.prepared || []).length, pool.length) }); seen.spellsPrepared = true; }
          }
        } else {
          if (!seen.spellsKnown && (p.knownSpells || []).length < cap.known) {
            const pool = Rules.spellPool(p, false);
            if (pool.length === 0) { p.spellChoicesTaken = p.spellChoicesTaken || []; if (!p.spellChoicesTaken.includes(p.level)) p.spellChoicesTaken.push(p.level); }
            else { out.push({ kind: 'spells', classId: e.id, level: p.level, count: Math.min(cap.known - (p.knownSpells || []).length, pool.length) }); seen.spellsKnown = true; }
          }
        }
      }
      out.sort((a, b) => a.level - b.level);
      // 职业进阶（兼职）：放在最后，先让玩家把子职/属性/法术这类本职成长处理完，再决定这一级落在哪个职业
      if (p.lastLeveledClassId) out.push({ kind: 'classlevel', level: p.level, classId: p.lastLeveledClassId });
      return out;
    },

    chooseSubclass(p, id, classId) {
      const cid = classId || p.classId;
      const cls = Rules.classDef(cid);
      const sub = (cls.subclasses || []).find((s) => s.id === id);
      if (!sub) return { ok: false, msg: '没有这个子职' };
      // 定位 classEntries 中对应的条目写入 subclassId
      if (p.classes && p.classes.length) {
        const e = p.classes.find((x) => x.id === cid);
        if (e) e.subclassId = id;
      }
      if (cid === p.classId) p.subclassId = id;
      Rules.recalc(p);
      return { ok: true, msg: `你选择了「${cls.name}·${sub.name}」。${sub.desc}` };
    },
    chooseAsi(p, alloc) {
      const total = Object.keys(alloc).reduce((a, k) => a + alloc[k], 0);
      if (total !== 2) return { ok: false, msg: '属性提升总计必须为 2 点' };
      for (const k of Object.keys(alloc)) { p.baseAttrs[k] += alloc[k]; p.attrs[k] += alloc[k]; }
      const pend = Rules.pendingChoices(p).find((x) => x.kind === 'asi');
      if (pend) p.asiTaken.push(pend.classId + ':' + pend.level);
      const before = p.maxHp;
      Rules.recalc(p);
      p.hp += (p.maxHp - before);
      const labels = NK.Data.get('rules').attrLabels;
      return { ok: true, msg: '属性提升：' + Object.keys(alloc).map((k) => labels[k] + ' +' + alloc[k]).join('，') };
    },
    chooseFeat(p, id) {
      const ft = Rules.featDef(id);
      if (!ft) return { ok: false, msg: '没有这个专长' };
      if (p.feats.includes(id)) return { ok: false, msg: '已经拥有该专长' };
      p.feats.push(id);
      if (ft.attrChoice) { const k = ft.attrChoice[0]; p.baseAttrs[k] += 1; p.attrs[k] += 1; }
      const pend = Rules.pendingChoices(p).find((x) => x.kind === 'asi');
      if (pend) p.asiTaken.push(pend.classId + ':' + pend.level);
      const before = p.maxHp;
      Rules.recalc(p);
      p.hp += (p.maxHp - before);
      return { ok: true, msg: `获得专长「${ft.name}」：${ft.desc}` };
    },
    chooseStyle(p, id, classId) {
      const st = Rules.styleDef(id);
      if (!st) return { ok: false, msg: '没有这个战斗风格' };
      if (!p.styles) p.styles = [];
      if (p.styles.includes(id)) return { ok: false, msg: '已经拥有' };
      // 多职业：每个提供战斗风格的职业各可拥有一个风格（不再强制唯一）
      // 记录该风格归属于哪个职业条目，供 pendingChoices 做持久化去重
      p.styles.push(id);
      p.styleClasses = p.styleClasses || [];
      p.styleClasses.push(classId || p.classId);
      Rules.recalc(p);
      return { ok: true, msg: `战斗风格：${st.name} —— ${st.desc}` };
    },
    chooseInvocation(p, id) {
      const o = Rules.invocationDef(id);
      if (!o) return { ok: false, msg: '没有这个魔能祈愿' };
      if (!p.invocations) p.invocations = [];
      if (p.invocations.includes(id)) return { ok: false, msg: '已经拥有该魔能祈愿' };
      p.invocations.push(id);
      Rules.recalc(p);
      return { ok: true, msg: `魔能祈愿「${o.name}」：${o.desc}` };
    },
    chooseMetamagic(p, id) {
      const o = Rules.metamagicDef(id);
      if (!o) return { ok: false, msg: '没有这个超魔' };
      if (!p.metamagics) p.metamagics = [];
      if (p.metamagics.includes(id)) return { ok: false, msg: '已经拥有该超魔' };
      p.metamagics.push(id);
      Rules.recalc(p);
      const max = Rules.sorceryMax(p);
      if (max > 0 && p.sorceryLeft === undefined) p.sorceryLeft = max;
      return { ok: true, msg: `超魔「${o.name}」：${o.desc}（术法点上限 ${max}）` };
    },
    choosePactBoon(p, id) {
      const o = Rules.pactBoonDef(id);
      if (!o) return { ok: false, msg: '没有这个魔契' };
      if (p.pactBoon) return { ok: false, msg: '已经结下魔契' };
      p.pactBoon = id;
      Rules.recalc(p);
      return { ok: true, msg: `魔契「${o.name}」：${o.desc}` };
    },
    chooseExpertise(p, skillId) {
      if (!(p.proficiencies.skills || []).includes(skillId)) return { ok: false, msg: '只能专精已熟练的技能' };
      if (!p.expertise) p.expertise = [];
      if (p.expertise.includes(skillId)) return { ok: false, msg: '已经专精' };
      p.expertise.push(skillId);
      return { ok: true, msg: `专精「${Rules.skillDef(skillId).name}」：该技能检定 +3。` };
    },
    /** 5e 兼职熟练表：新开一个兼职职业时，只授予它「兼职栏」里列的那些熟练（不含豁免熟练） */
    MULTICLASS_PROFS: {
      barbarian: { armor: ['shield'], weapons: ['simple', 'martial'] },
      bard: { armor: ['light'], weapons: ['simple'] },
      cleric: { armor: ['light', 'medium', 'shield'], weapons: [] },
      druid: { armor: ['light', 'medium', 'shield'], weapons: [] },
      warrior: { armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'] },
      monk: { armor: [], weapons: ['simple'] },
      paladin: { armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'] },
      ranger: { armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'] },
      rogue: { armor: ['light'], weapons: ['simple'] },
      sorcerer: { armor: [], weapons: [] },
      warlock: { armor: ['light'], weapons: ['simple'] },
      wizard: { armor: [], weapons: [] },
      artificer: { armor: ['light', 'medium', 'shield'], weapons: ['simple'] },
    },
    /** 新开兼职时授予熟练，返回新增的熟练描述（5e：不给新职业的豁免熟练） */
    grantMulticlassProfs(p, clsId) {
      const t = Rules.MULTICLASS_PROFS[clsId];
      if (!t) return [];
      const profs = p.proficiencies || (p.proficiencies = {});
      profs.armor = profs.armor || [];
      profs.weapons = profs.weapons || [];
      const got = [];
      for (const a of t.armor) if (!profs.armor.includes(a)) { profs.armor.push(a); got.push(a === 'shield' ? '盾牌' : (a === 'light' ? '轻甲' : '中甲')); }
      for (const w of t.weapons) if (!profs.weapons.includes(w)) { profs.weapons.push(w); got.push(w === 'simple' ? '简易武器' : '军用武器'); }
      return got;
    },
    /** 职业进阶：把刚获得的等级重新分配到指定职业（确认默认 / 改投其它已有职业 / 新开一个兼职） */
    chooseClassLevel(p, payload) {
      const fromId = p.lastLeveledClassId;
      if (!fromId) return { ok: false, msg: '没有可分配的等级' };
      const targetId = (payload && (payload.newClassId || payload.classId)) || null;
      if (!targetId) return { ok: false, msg: '请选择要进阶的职业' };
      const from = (p.classes || []).find((e) => e.id === fromId);
      if (!from || from.level < 1) return { ok: false, msg: '来源职业等级不足' };
      if (targetId === fromId) {
        p.lastLeveledClassId = null;
        return { ok: true, msg: `确认进阶：${Rules.classDef(fromId).name} 提升 1 级（现为 ${from.level} 级）。` };
      }
      let to = (p.classes || []).find((e) => e.id === targetId);
      let gotProfs = [];
      if (!to) {
        if (Rules.totalLevel(p) >= Rules.LEVEL_CAP) return { ok: false, msg: `总等级已达 ${Rules.LEVEL_CAP}，不能再开新职业。` };
        to = { id: targetId, level: 0, subclassId: null };
        p.classes.push(to);
        gotProfs = Rules.grantMulticlassProfs(p, targetId);   // 兼职会授予新职业的部分熟练
      }
      from.level -= 1;
      to.level += 1;
      if (from.level <= 0) p.classes = p.classes.filter((e) => !(e.id === fromId && e.level <= 0));
      p.lastLeveledClassId = null;
      Rules.normalizeClasses(p);
      Rules.recalc(p);
      const profMsg = gotProfs.length ? `　新职业带来熟练：${gotProfs.join('、')}。` : '';
      return { ok: true, msg: `重新分配等级：${Rules.classDef(fromId).name} −1，${Rules.classDef(targetId).name} +1（现为 ${Rules.classDef(targetId).name} ${to.level} 级）。${profMsg}` };
    },
    learnSpell(p, spellId, asCantrip, classId) {
      const sp = Rules.spellDef(spellId);
      if (!sp) return { ok: false, msg: '没有这个法术' };
      const cs = Rules.castingEntries(p);
      const cid = (classId && cs.some((e) => e.id === classId)) ? classId : (cs[0] || {}).id;
      const cls = Rules.classDef(cid);
      const sc = cls && cls.spellcasting;
      if (asCantrip) {
        if (!p.cantrips.includes(spellId)) p.cantrips.push(spellId);
      } else if (sc && sc.spellbook) {
        if (!p.knownSpells.includes(spellId)) p.knownSpells.push(spellId);
        // 抄进法术书的法术会自动占一个「已准备」位（直到准备位满，长休时可以重选）
        const capP = Rules.spellCapacity(p).prepared;
        if (sc.prepared && !p.prepared.includes(spellId) && (p.prepared || []).length < capP) p.prepared.push(spellId);
      } else if (sc && sc.prepared) {
        if (!p.prepared.includes(spellId)) p.prepared.push(spellId);
      } else {
        if (!p.knownSpells.includes(spellId)) p.knownSpells.push(spellId);
      }
      p.spellChoicesTaken = p.spellChoicesTaken || [];
      return { ok: true, msg: `学会了「${sp.name}」` };
    },
    /** 长休时重新准备法术：法师只能从法术书里挑；牧师/德鲁伊等可以从整个职业列表里挑 */
    resetPrepared(p, ids) {
      const cap = Rules.spellCapacity(p).prepared;
      const cs = Rules.castingEntries(p);
      const hasBook = cs.some((e) => (Rules.classDef(e.id).spellcasting || {}).spellbook);
      const ok = (ids || []).filter((id) => {
        const sp = Rules.spellDef(id);
        if (!sp || sp.level === 0) return false;
        if (hasBook) return (p.knownSpells || []).includes(id);
        return (sp.classes || []).some((c) => cs.some((e) => Rules.spellListOf(e.id).includes(c)));
      });
      p.prepared = ok.slice(0, cap);
      return { ok: true, msg: `已重新准备 ${p.prepared.length} 个法术（上限 ${cap}）。` };
    },
  };

  NK.Rules = Rules;
})(typeof window !== 'undefined' ? window : globalThis);

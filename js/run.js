/* 单局流程：开局 → 节点 → 结算。没有跨局成长。 */
(function (global) {
  const NK = (global.NK = global.NK || {});
  const R = NK.Rules;
  const U = NK.Util;

  function difficulty(id) {
    return NK.Data.get('maps').difficulties.find((d) => d.id === id) || NK.Data.get('maps').difficulties[0];
  }

  /** 每幕难度递增：把「玩家选的难度」与「走到多深」合成为一个战斗系数。
   *
   *  进度 t = 幕序号 + 本幕内的层级进度（0~1），所以第 1 幕第一层 t≈0，第 3 幕关底 t≈3。
   *  各项随 t 线性增长，参数在 data/maps.json 的 actScaling 里，方便调。
   *
   *    hp   ×(1 + 0.20 t)     第 1 幕 1.00 → 第 3 幕末 1.60
   *    dmg  ×(1 + 0.12 t)     1.00 → 1.36
   *    命中 +(1.0 t)          每深入一幕 +1
   *    AC   +(0.8 t)          每幕约 +1
   *    额外敌人概率 +(0.09 t)
   *    经验 ×(1 + 0.30 t)     深入有回报
   *    金币 ×(1 + 0.25 t)
   */
  function battleTier(run) {
    const cfg = (NK.Data.get('maps').actScaling) || {};
    const base = run.tier || {};
    const act = run.actIndex || 0;
    let layerProgress = 0;
    if (cfg.useLayerProgress !== false) {
      const actData = (run.map && run.map.acts) ? run.map.acts[run.actIndex] : null;
      const layers = (actData && actData.layers) ? actData.layers.length : 0;
      const node = Run.node(run);
      const li = node ? (node.layer || 0) : 0;
      layerProgress = layers > 1 ? Math.min(1, li / (layers - 1)) : 0;
    }
    const t = Math.max(0, act + layerProgress);
    return Object.assign({}, base, {
      depth: t,
      hpMul: (base.hpMul || 1) * (1 + (cfg.hpPerAct || 0) * t),
      dmgMul: (base.dmgMul || 1) * (1 + (cfg.dmgPerAct || 0) * t),
      hitAdd: (base.hitAdd || 0) + Math.floor((cfg.hitPerAct || 0) * t),
      acAdd: Math.floor((cfg.acPerAct || 0) * t),
      extraChance: (cfg.extraEnemyBase || 0) + (cfg.extraEnemyPerAct || 0) * t,
      xpMul: (base.xpMul || 1) * (1 + (cfg.xpPerAct || 0) * t),
      goldMul: (base.goldMul || 1) * (1 + (cfg.goldPerAct || 0) * t),
    });
  }

  const Run = {
    difficulty,
    battleTier,

    start(config) {
      const rng = config.rng || NK.RNG.make(config.seed);
      const d = difficulty(config.difficulty || 1);
      const p = R.createPlayer(config);
      const tier = { id: d.id, hpMul: d.hpMul, dmgMul: d.dmgMul, hitAdd: d.hitAdd };
      const run = {
        version: 2, difficulty: d.id, seed: rng.seed, rng, tier,
        actIndex: 0, map: NK.MapGen.generate(tier, rng), current: null, state: 'map',
        player: p, gold: p.gold || 100, food: 4,
        // 休息不设全局次数上限：营地节点的数量本身就限制了你能休息几次
        seenEvents: {}, revealAll: false, log: [], ended: false, victory: false,
        kills: 0, elites: 0, bosses: 0, damageDealt: 0, damageTaken: 0,
        startedAt: Date.now(),
      };
      if (p.flags.layOnHands) p.layPool = p.level * p.flags.layOnHands;
      if (p.flags.superiority) p.superiorityLeft = p.flags.superiority;
      if (p.flags.luckPoints) p.luckLeft = p.flags.luckPoints;
      Run.log(run, `${run.map.acts[0].name}。${run.map.acts[0].flavor}`);
      Run.log(run, `${R.raceDef(p.raceId).name} ${R.classLabel(p)}　HP ${p.maxHp}　AC ${p.ac}`);
      Run.checkChoices(run);
      return run;
    },

    log(run, t) { run.log.push({ t, at: Date.now() }); },

    node(run) {
      return run.current ? NK.MapGen.nodeById(run.map.acts[run.actIndex], run.current) : null;
    },

    enterNode(run, nodeId) {
      const node = NK.MapGen.nodeById(run.map.acts[run.actIndex], nodeId);
      if (!node) return { ok: false, msg: '节点不存在' };
      run.current = nodeId;
      node.visited = true;
      Run.touchProgress(run);   // 每踏上一个节点就刷新「最远距离」
      switch (node.type) {
        case 'battle': Run.startBattle(run, 'normal'); break;
        case 'elite': Run.startBattle(run, 'elite'); break;
        case 'boss': Run.startBattle(run, 'boss'); break;
        case 'event':
          run.state = 'event';
          run.event = NK.Events.pick(run, run.rng);
          run.eventResult = null;
          break;
        case 'shop':
          run.state = 'shop';
          run.shop = NK.Shop.stock(run, run.rng);
          break;
        case 'rest':
          run.state = 'rest';
          run.restMsg = null;
          break;
        case 'treasure':
          Run.openTreasure(run);
          break;
        default: break;
      }
      Run.save(run);
      return { ok: true, node };
    },

    /* ---------------- 战斗 ---------------- */
    startBattle(run, kind) {
      const actDef = run.map.acts[run.actIndex].actDef;
      const tier = battleTier(run);          // 难度 × 当前深度
      run._battleTier = tier;                // 结算经验/金币时要用同一套系数
      const enemies = NK.Combat.makeEncounter(actDef, kind, tier, run.rng);
      run.battleKind = kind;
      run.state = 'battle';
      // 每场战斗重置「气 / 狂暴 / 契约魔法」等资源，并清除上一场的狂暴状态
      R.recalc(run.player);
      const pp = run.player;
      if (pp.kiMax > 0) pp.kiLeft = pp.kiMax;
      if (pp.rageMax > 0) { pp.raging = false; pp.rageLeft = pp.rageMax; }
      if (pp.pactLevel > 0) pp.pactSlots = pp.pactSlotsMax;
      run._combat = NK.Combat.start(run.player, enemies, {
        rng: run.rng, tier, act: run.actIndex + 1, source: kind,
      });
      if (NK.Codex) NK.Codex.discoverMany('monsters', enemies.map((e) => e.baseId || e.id));
      return run._combat;
    },

    finishBattle(run, c) {
      c = c || run._combat;
      const lines = [];
      const p = run.player;
      const d = difficulty(run.difficulty);
      const node = Run.node(run);
      const kind = run.battleKind;

      if (c.result === 'defeat') {
        run.ended = true; run.victory = false; run.state = 'over';
        run.deathCause = (c.enemies.find((e) => e.hp > 0) || {}).name || '未知';
        run._combat = null;
        return { lines: [], defeat: true };
      }

      if (c.result === 'fled') {
        lines.push('你逃出了这场战斗。没有战利品，但你还活着。');
        if (node) node.done = true;
        run._combat = null;
        run.state = 'map';
        return { lines, fled: true };
      }

      const alive = c.enemies;
      run.kills += alive.length;
      if (kind === 'elite') run.elites += 1;
      if (kind === 'boss') run.bosses += 1;
      run.damageDealt += c.playerStats.dmgDealt;
      run.damageTaken += c.playerStats.dmgTaken;

      let xp = 0, gold = 0;
      for (const e of alive) {
        const def = NK.Data.get('monsters').monsters.find((m) => m.id === e.id);
        xp += e.xp;
        gold += run.rng.int((def.gold && def.gold[0]) || 5, (def.gold && def.gold[1]) || 15);
      }
      const bt = run._battleTier || d;   // 已含「玩家难度 × 当前深度」的加成
      xp = Math.round(xp * bt.xpMul);
      gold = Math.round(gold * bt.goldMul * (1 + (p.mods.goldMul || 0)));
      run.gold += gold;
      lines.push(`战利品：经验 +${xp}，金币 +${gold}（共 ${run.gold}）`);

      // 食物：长休的燃料
      let food = 0;
      if (kind === 'boss') food = 2;
      else if (kind === 'elite') food = 1;
      else if (run.rng.chance(0.4)) food = 1;
      if (food) { run.food += food; lines.push(`食物 +${food}（共 ${run.food} 份）——长休需要消耗 1 份。`); }

      const loot = [];
      if (kind === 'boss') {
        for (let i = 0; i < 2; i++) { const it = NK.Items.loot(run.rng, 'boss'); Run.grantItem(run, it); loot.push(it); }
      } else if (kind === 'elite') {
        const it = NK.Items.loot(run.rng, 'elite'); Run.grantItem(run, it); loot.push(it);
      } else if (run.rng.chance(0.4)) {
        const it = NK.Items.loot(run.rng, 'normal'); Run.grantItem(run, it); loot.push(it);
      }
      for (const it of loot) lines.push(`获得：${it.name}${it.magic ? '（魔法物品）' : ''}`);

      const ups = R.gainXp(p, xp);
      for (const u of ups) lines.push(`⬆ 升级！${u.className || ''} Lv.${u.total}${u.feature ? `　新特性「${u.feature}」` : ''}（最大生命 +${u.hpGain}）`);
      if (ups.length) {
        p.hitDice.total = p.level;
        if (p.flags.layOnHands) p.layPool = Math.max(p.layPool || 0, 0) + ups.length * p.flags.layOnHands;
        if (p.flags.superiority) p.superiorityLeft = p.flags.superiority;
      }

      p.conditions = [];
      p.buffs = p.buffs.filter((b) => b.permanent || b.kind === 'curse' || b.kind === 'buff');
      p.dying = false;
      p.deathSaves = { success: 0, fail: 0 };
      p.tempHp = 0;
      p.wardHp = 0;
      p.mirrorLeft = 0;
      p.concentration = null;
      R.recalc(p);

      if (node) node.done = true;
      run._combat = null;

      if (kind === 'boss') {
        const adv = Run.advanceAct(run);
        if (adv) lines.push(adv);
      }
      if (!run.ended) run.state = Run.checkChoices(run) ? 'levelup' : 'map';
      Run.save(run);
      return { lines, loot, victory: true };
    },

    /** 打完关底就继续往下。没有「通关」这一说，走得越深算得越远。 */
    advanceAct(run) {
      run.actIndex += 1;
      run.current = null;
      const p = run.player;
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.3));
      p.slots = p.slotsMax.slice();
      let act = run.map.acts[run.actIndex];
      let deeper = false;
      if (!act) { act = NK.MapGen.generateDeeperAct(run); run.map.acts.push(act); deeper = true; }
      Run.touchProgress(run);
      Run.log(run, `—— ${act.name} ——`);
      const head = deeper ? '剧本到这里就写完了，可裂缝还在往下。' : '你沿着裂缝继续往下。';
      return `${head}${act.flavor}（回复 ${p.hp - before} 点生命，法术位恢复）`;
    },

    /** 最远距离：以「第几幕 · 第几层」记，取到过的最大值 */
    progress(run) {
      const actData = (run.map && run.map.acts) ? run.map.acts[run.actIndex] : null;
      const node = Run.node(run);
      const layer = node ? (node.layer || 0) : 0;
      const layers = actData && actData.layers ? actData.layers.length : 1;
      return { act: (run.actIndex || 0) + 1, layer, layers, depth: (run.actIndex || 0) + (layers > 1 ? layer / (layers - 1) : 0) };
    },

    touchProgress(run) {
      const cur = Run.progress(run);
      const f = run.farthest;
      if (!f || cur.depth > f.depth) run.farthest = cur;
      return run.farthest;
    },

    progressLabel(pr) {
      if (!pr) return '—';
      return `第 ${pr.act} 幕 · 第 ${pr.layer} 层`;
    },

    /** 主动收手：这一局到此为止，按最远距离记分 */
    abandon(run) {
      if (run.ended) return;
      run.ended = true;
      run.abandoned = true;
      run.state = 'over';
      run.deathCause = '主动离开';
      Run.touchProgress(run);
      return Run.settle(run);
    },

    /* ---------------- 休整 ---------------- */
    restOptions(run) {
      const p = run.player;
      const die = p.hitDice.die;
      const per = Math.max(1, Math.floor(die / 2) + 1 + R.mod(p.attrs.con));
      const shortBack = [];
      if (p.pactLevel) shortBack.push(`邪术环回满（${p.pactSlots}/${p.pactSlotsMax} → ${p.pactSlotsMax}）`);
      if (p.flags.ki) shortBack.push(`气回满（${p.kiLeft}/${p.kiMax} → ${p.kiMax}）`);
      if (p.flags.superiority) shortBack.push(`卓越骰回满（${p.superiorityLeft || 0} → ${p.flags.superiority}）`);
      if (p.flags.wildShape) shortBack.push(`野性形态次数回满（${p.wildShapeLeft || 0} → ${p.wildShapeMax || 2}）`);
      if (p.flags.sorcerousRestoration) shortBack.push(`法术转生：术法点 +4（${p.sorceryLeft || 0} → 最多 ${p.sorceryMax}）`);
      if (p.flags.fontOfInspiration && p.inspirationMax > 0) shortBack.push(`吟游灵感回满（${p.inspirationLeft || 0} → ${p.inspirationMax}）`);
      const longBack = ['生命回满', '所有法术位回满'];
      if (p.pactLevel) longBack.push('邪术环回满');
      if (p.flags.arcaneRecovery && p.slotsMax.some((x) => x > 0)) longBack.push(`奥术恢复：补回约 ${Math.ceil(p.level / 2)} 环的法术位`);
      const prepClasses = R.classEntries(p).filter((e) => { const sc = (R.classDef(e.id) || {}).spellcasting; return sc && sc.prepared; });
      if (prepClasses.length) longBack.push('可以重新选择「已准备」的法术');
      if (p.flags.rage) longBack.push(`狂暴次数回满（${p.rageLeft || 0} → ${p.rageMax}）`);
      if (p.flags.ki) longBack.push(`气回满（${p.kiLeft}/${p.kiMax} → ${p.kiMax}）`);
      if (p.flags.superiority) longBack.push(`卓越骰回满（${p.superiorityLeft || 0} → ${p.flags.superiority}）`);
      if (p.flags.layOnHands) longBack.push(`圣疗池回满（→ ${p.level * p.flags.layOnHands}）`);
      if (p.sorceryMax > 0) longBack.push(`术法点回满（${p.sorceryLeft || 0} → ${p.sorceryMax}）`);
      if (p.wildShapeMax > 0) longBack.push(`野性形态次数回满（${p.wildShapeLeft || 0} → ${p.wildShapeMax}）`);
      if (p.inspirationMax > 0) longBack.push(`吟游灵感回满（${p.inspirationLeft || 0} → ${p.inspirationMax}）`);
      longBack.push(`生命骰回复 ${Math.max(1, Math.floor(p.hitDice.total / 2))} 颗`);
      longBack.push('清除全部负面状态');
      return {
        short: {
          ok: p.hitDice.left > 0,
          dice: p.hitDice.left, perDie: per,
          label: '短休',
          detail: `喘口气，包扎伤口。花掉几颗生命骰换血，不消耗食物。`,
          restores: shortBack.length ? shortBack : ['只回血（你没有短休恢复的资源）'],
          cost: '不消耗食物',
          costKind: 'free',
          note: '法术位（除邪术环）与生命骰总量不会恢复。',
        },
        long: {
          ok: run.food >= 1,
          food: run.food,
          label: '长休',
          detail: `睡一整夜。吃 1 份食物，换回一个完整的自己。`,
          restores: longBack,
          cost: `消耗 1 份食物（现有 ${run.food} 份）`,
          costKind: run.food >= 1 ? 'gold' : 'red',
          note: '生命骰只在长休时回复一半，所以别把长休浪费在满血的时候。',
        },
      };
    },

    restShort(run, diceCount) {
      const p = run.player;
      if (p.hitDice.left <= 0) return { ok: false, msg: '生命骰已经用完了——只有长休能回复它。' };
      const n = Math.min(diceCount || 1, p.hitDice.left);
      const die = p.hitDice.die;
      const conMod = R.mod(p.attrs.con);
      let total = 0;
      const rolls = [];
      for (let i = 0; i < n; i++) {
        const r = run.rng.int(1, die);
        rolls.push(r);
        total += Math.max(1, r + conMod);
      }
      p.hitDice.left -= n;
      p.hp = Math.min(p.maxHp, p.hp + total);
      const extra = (p.flags.restHealBonus || 0) > 0 ? Math.round(p.maxHp * p.flags.restHealBonus) : 0;
      if (extra) p.hp = Math.min(p.maxHp, p.hp + extra);
      let arcane = '';
      const msg = `短休：投了 ${n} 颗生命骰（${rolls.join('+')}${conMod >= 0 ? '+' + conMod : conMod}），回复 ${total + extra} 点生命。生命骰剩余 ${p.hitDice.left}/${p.hitDice.total}。${arcane}`;
      if (p.pactLevel) { p.pactSlots = p.pactSlotsMax; arcane += ` 契约魔法：邪术环已恢复。`; }
      // 其它「短休恢复」的职业资源：武僧的气、战斗大师的卓越骰、德鲁伊的野性形态（5e）
      if (p.flags.ki) { p.kiLeft = p.kiMax; arcane += ` 气已回满（${p.kiMax}）。`; }
      if (p.flags.superiority) { p.superiorityLeft = p.flags.superiority; arcane += ` 卓越骰已回满（${p.superiorityLeft}）。`; }
      if (p.wildShapeMax > 0) { p.wildShapeLeft = p.wildShapeMax; arcane += ` 野性形态次数已回满（${p.wildShapeMax}）。`; }
      // 术士 L20「法术转生」：短休恢复 4 点术法点
      if (p.flags.sorcerousRestoration && p.sorceryMax > 0) { p.sorceryLeft = Math.min(p.sorceryMax, (p.sorceryLeft || 0) + 4); arcane += ` 法术转生：术法点 +4（${p.sorceryLeft}/${p.sorceryMax}）。`; }
      // 吟游诗人 L5「激励之泉」：短休即可恢复灵感
      if (p.flags.fontOfInspiration && p.inspirationMax > 0) { p.inspirationLeft = p.inspirationMax; arcane += ` 吟游灵感已回满（${p.inspirationMax}）。`; }
      run.player.poison = null;
      Run.log(run, msg);
      Run.save(run);
      return { ok: true, msg };
    },

    restLong(run) {
      const p = run.player;
      if (run.food < 1) return { ok: false, msg: '没有食物了。长休需要 1 份食物——从怪物身上找，或者去商店买。' };
      run.food -= 1;
      p.hp = p.maxHp;
      p.tempHp = 0;
      p.slots = p.slotsMax.slice();
      // 奥术恢复（法师）：5e 是「每次长休一次」，补回总量 ≤ 半个法师等级（向上取整）的法术位
      if (p.flags.arcaneRecovery && p.slotsMax.some((x) => x > 0)) {
        let budget = Math.ceil(p.level / 2), gained = 0;
        for (let i = R.MAX_SLOT - 1; i >= 0 && budget > 0; i--) {
          while (p.slots[i] < p.slotsMax[i] && budget - (i + 1) >= 0) { p.slots[i] += 1; budget -= (i + 1); gained += 1; if (budget <= 0) break; }
        }
        if (gained) p.arcaneRecovered = gained;
      }
      if (p.pactLevel) p.pactSlots = p.pactSlotsMax;
      p.conditions = [];
      p.hitDice.left = Math.min(p.hitDice.total, p.hitDice.left + Math.max(1, Math.floor(p.hitDice.total / 2)));
      p.dying = false;
      p.deathSaves = { success: 0, fail: 0 };
      // 职业资源：全部回满
      if (p.flags.layOnHands) p.layPool = p.level * p.flags.layOnHands;
      if (p.flags.rage) p.rageLeft = p.rageMax;
      if (p.flags.ki) p.kiLeft = p.kiMax;
      if (p.flags.superiority) p.superiorityLeft = p.flags.superiority;
      if (p.sorceryMax > 0) p.sorceryLeft = p.sorceryMax;                 // 术法点
      if (p.wildShapeMax > 0) p.wildShapeLeft = p.wildShapeMax;           // 野性形态
      if (p.inspirationMax > 0) p.inspirationLeft = p.inspirationMax;     // 吟游灵感
      p.joltQueued = false;
      const msg = `长休：吃掉 1 份食物（剩 ${run.food} 份）。生命与法术位全部恢复，生命骰恢复至 ${p.hitDice.left}/${p.hitDice.total}。${p.arcaneRecovered ? ` 奥术恢复补回了 ${p.arcaneRecovered} 个法术位。` : ''}`;
      p.arcaneRecovered = 0;
      // 长休后可以重新选择「已准备」的法术（5e：牧师/德鲁伊/圣武士/工匠/法师）
      run.needReprepare = R.classEntries(p).some((e) => { const sc = (R.classDef(e.id) || {}).spellcasting; return sc && sc.prepared; });
      Run.log(run, msg);
      Run.save(run);
      return { ok: true, msg };
    },

    /* ---------------- 宝库 ---------------- */
    openTreasure(run) {
      const rng = run.rng;
      const p = run.player;
      const lines = [];
      const gold = rng.int(20, 90) * (run.difficulty + 1);
      run.gold += gold;
      lines.push(`金币 +${gold}（共 ${run.gold}）`);
      const table = NK.Data.get('maps').treasureLoot;
      const rarity = rng.weighted(Object.keys(table).map((k) => [k, table[k]]));
      const it = NK.Items.randomMagic(rng, rarity);
      Run.grantItem(run, it);
      lines.push(`获得魔法物品：${it.name}（${NK.Items.RARITY_NAME[it.rarity]}）`);
      if (rng.chance(0.5)) { run.food += 1; lines.push(`箱底压着几包干粮（食物 +1，共 ${run.food} 份）。`); }
      // 陷阱
      if (rng.chance(0.3)) {
        const dc = 13;
        const bonus = R.saveBonus(p, 'dex');
        const res = NK.Dice.check(rng, bonus, null);
        const ok = res.total >= dc;
        if (!ok) {
          const dmg = NK.Dice.rollDice('2d6', rng);
          p.hp = Math.max(0, p.hp - dmg);
          lines.push(`箱子底下连着东西——${dmg} 点伤害（敏捷豁免 ${res.total} < DC ${dc}，${p.hp}/${p.maxHp}）`);
          if (p.hp <= 0) run.forceDown = true;
        } else {
          lines.push(`你在针刺弹出来之前缩回了手（敏捷豁免 ${res.total} ≥ DC ${dc}）。`);
        }
      }
      const node = Run.node(run);
      if (node) node.done = true;
      run.state = run.forceDown ? 'over' : (Run.checkChoices(run) ? 'levelup' : 'map');
      if (run.forceDown) { run.ended = true; run.victory = false; run.deathCause = '宝库的陷阱'; }
      run.treasureResult = lines;
      Run.save(run);
      return lines;
    },

    /* ---------------- 升级选择 ---------------- */
    checkChoices(run) {
      const pend = R.pendingChoices(run.player);
      run.pendingLevelUps = pend;
      return pend.length > 0;
    },

    resolveChoice(run, payload) {
      const p = run.player;
      const pend = R.pendingChoices(p)[0];
      if (!pend) return { ok: false, msg: '没有待处理的选择' };
      let res;
      if (pend.kind === 'subclass') res = R.chooseSubclass(p, payload.subclass, pend.classId);
      else if (pend.kind === 'asi') res = payload.feat ? R.chooseFeat(p, payload.feat) : R.chooseAsi(p, payload.alloc || {});
      else if (pend.kind === 'style') res = R.chooseStyle(p, payload.style, pend.classId);
      else if (pend.kind === 'expertise') res = R.chooseExpertise(p, payload.skill);
      else if (pend.kind === 'classlevel') res = R.chooseClassLevel(p, payload);
      else if (pend.kind === 'invocation') res = R.chooseInvocation(p, payload.id);
      else if (pend.kind === 'metamagic') res = R.chooseMetamagic(p, payload.id);
      else if (pend.kind === 'pactBoon') res = R.choosePactBoon(p, payload.id);
      else res = R.learnSpell(p, payload.spell, pend.kind === 'cantrips', pend.classId);
      if (res.ok) {
        if (p.flags.layOnHands) p.layPool = Math.max(p.layPool || 0, p.level * p.flags.layOnHands);
        if (p.flags.superiority) p.superiorityLeft = p.flags.superiority;
        Run.log(run, res.msg);
        R.recalc(p);
      }
      Run.checkChoices(run);
      Run.save(run);
      return res;
    },

    /* ---------------- 物品 ---------------- */
    grantItem(run, item) {
      const p = run.player;
      p.bag = p.bag || [];
      p.bag.push(item);
      if (item.magicId && NK.Codex) NK.Codex.discover('items', item.magicId);
      return item;
    },
    grantConsumable(run, con) {
      const p = run.player;
      p.inventory = p.inventory || [];
      if (p.inventory.length >= 10) return null;
      p.inventory.push(con);
      if (con.id && NK.Codex) NK.Codex.discover('items', con.id);
      return con;
    },
    /** 装备一件背包装备。slot 省略时用物品自身的槽位 */
    equip(run, item, slot) {
      const p = run.player;
      const target = slot || item.slot;
      const chk = R.canEquip(p, item, target);
      if (!chk.ok) return { ok: false, msg: chk.msg };
      p.bag = (p.bag || []).filter((x) => x !== item);
      const moving = [];
      let old = null;
      if (target === 'rings') {
        p.items.rings.push(item);
      } else {
        old = p.items[target];
        p.items[target] = item;
        if (old) moving.push(old);
        // 双手武器同时占用左右手
        if (item.hands === 2) {
          if (p.items.offHand) { moving.push(p.items.offHand); p.items.offHand = null; }
        }
      }
      for (const m of moving) p.bag.push(m);
      R.recalc(p);
      p.hp = Math.min(p.hp, p.maxHp);
      Run.save(run);
      const extra = item.hands === 2 ? '（双手武器：同时占用右手与左手）' : (target === 'rings' ? `（戒指 ${R.ringCount(p)}/${R.ringCap(p)}）` : '');
      return { ok: true, old, msg: `装备了 ${item.name}${extra}。${R.interference(p) > 0 ? ` 能量干涉 -${R.interference(p)}。` : ''}` };
    },

    unequip(run, slot, index) {
      const p = run.player;
      let it = null;
      if (slot === 'rings') {
        const i = index === undefined ? p.items.rings.length - 1 : index;
        if (i < 0 || i >= p.items.rings.length) return null;
        it = p.items.rings.splice(i, 1)[0];
      } else {
        it = p.items[slot];
        if (!it) return null;
        p.items[slot] = null;
      }
      p.bag = p.bag || [];
      p.bag.push(it);
      R.recalc(p);
      p.hp = Math.min(p.hp, p.maxHp);
      Run.save(run);
      return it;
    },
    useConsumable(run, index) {
      const p = run.player;
      const it = p.inventory[index];
      if (!it) return { ok: false, msg: '没有这个物品' };
      const eff = it.effect || {};
      const lines = [];
      if (eff.heal) { const amt = typeof eff.heal === 'string' ? NK.Dice.rollDice(eff.heal, run.rng) : eff.heal; const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + amt + (p.mods.healBonus || 0)); lines.push(`回复 ${p.hp - before} 点生命`); }
      if (eff.cleanse) { p.conditions = []; lines.push('状态被清除了'); }
      if (eff.tempHp) { p.tempHp += eff.tempHp; lines.push(`临时生命 +${eff.tempHp}`); }
      if (eff.buff) { NK.Events.pushBuff(run, Object.assign({ kind: 'buff', name: it.name }, eff.buff), 'buff'); lines.push(`获得「${eff.buff.name || it.name}」`); }
      if (eff.cast) return { ok: false, msg: `${it.name} 只能在战斗中使用。` };
      if (eff.dice && !eff.heal) return { ok: false, msg: `${it.name} 只能在战斗中使用。` };
      p.inventory.splice(index, 1);
      R.recalc(p);
      Run.save(run);
      return { ok: true, msg: `${it.name}：${lines.join('，') || '使用了。'}` };
    },
    /** 抄写卷轴：花钱把它记进法术书，之后就能正常准备/施放 */
    copyScroll(run, index) {
      const p = run.player;
      const it = p.inventory[index];
      const chk = R.canCopyScroll(p, it);
      if (!chk.ok) return chk;
      if (run.gold < chk.cost) return { ok: false, msg: `抄写需要 ${chk.cost} 金币，你只有 ${run.gold}。` };
      if (run.state === 'battle') return { ok: false, msg: '战斗中没法静下心抄写。' };
      run.gold -= chk.cost;
      p.knownSpells = (p.knownSpells || []).concat(chk.spell.id);
      p.inventory.splice(index, 1);
      R.recalc(p);
      Run.log(run, `抄写卷轴：把「${chk.spell.name}」记进法术书（花费 ${chk.cost} 金币，剩 ${run.gold}）。`);
      Run.save(run);
      return { ok: true, msg: `抄写完成：「${chk.spell.name}」已经记进法术书，花费 ${chk.cost} 金币。`, spell: chk.spell };
    },
    sell(run, item) {
      const p = run.player;
      const v = NK.Items.sellValue(item);
      p.bag = (p.bag || []).filter((x) => x !== item);
      run.gold += v;
      Run.save(run);
      return { ok: true, msg: `卖出 ${item.name}，获得 ${v} 金币（共 ${run.gold}）。` };
    },

    /* ---------------- 结算 ---------------- */
    settle(run) {
      const p = run.player;
      Run.touchProgress(run);
      const far = run.farthest || Run.progress(run);
      const summary = {
        victory: false,                       // 不再有通关：一局的结局只有「倒下」或「收手」
        abandoned: !!run.abandoned,
        act: run.actIndex + 1,
        actName: run.map.acts[run.actIndex].name,
        farthest: far, farthestLabel: Run.progressLabel(far), depth: far.depth,
        deathCause: run.deathCause || null,
        level: p.level, className: R.classLabel(p), subclass: p.subclassId ? R.subclassOf(p).name : null,
        race: R.raceDef(p.raceId).name, bg: R.bgDef(p.bgId).name,
        kills: run.kills, elites: run.elites, bosses: run.bosses,
        gold: run.gold, maxHp: p.maxHp, ac: p.ac, hit: R.attackBonus(p),
        minutes: Math.max(1, Math.round((Date.now() - run.startedAt) / 60000)),
        marks: run.marks || 0,
      };
      // 写进通关记录，并把这一局见过的东西补进图鉴（图鉴是纯记录，不提供任何加成）
      if (NK.Codex) {
        NK.Codex.syncFromRun(run);
        NK.Codex.addRecord({
          at: Date.now(),
          result: run.victory ? 'victory' : 'defeat',
          name: p.name, race: summary.race, className: summary.className, subclass: summary.subclass,
          level: summary.level, difficulty: run.difficulty, difficultyName: difficulty(run.difficulty).name,
          act: summary.act, actName: summary.actName, deathCause: summary.deathCause,
          farthest: summary.farthest, farthestLabel: summary.farthestLabel, depth: summary.depth,
          kills: summary.kills, elites: summary.elites, bosses: summary.bosses,
          gold: summary.gold, minutes: summary.minutes,
        });
      }
      return summary;
    },

    /** 单局存档。RunStore 定义在本文件下方，但只在调用时才会被求值。 */
    save(run) { if (run) RunStore.save(run); },
  };

  /* 存档：只存当前这一局，没有跨局数据 */
  const RunStore = {
    KEY: 'yuanxia_run_v1',
    save(run) {
      try {
        if (!run) { global.localStorage && global.localStorage.removeItem(RunStore.KEY); return; }
        const copy = Object.assign({}, run);
        delete copy.rng; delete copy._combat; delete copy.map_rng;
        global.localStorage && global.localStorage.setItem(RunStore.KEY, JSON.stringify(copy));
      } catch (e) { console.warn('[渊下] 存档失败', e); }
    },
    load() {
      try {
        const raw = global.localStorage && global.localStorage.getItem(RunStore.KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    clear() { try { global.localStorage && global.localStorage.removeItem(RunStore.KEY); } catch (e) {} },
  };

  NK.Run = Run;
  NK.RunStore = RunStore;
})(typeof window !== 'undefined' ? window : globalThis);

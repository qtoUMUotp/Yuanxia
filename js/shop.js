/* 商店 */
(function (global) {
  const NK = (global.NK = global.NK || {});
  const U = NK.Util;

  const Shop = {
    price(run, base) {
      const d = NK.Data.get('maps').difficulties.find((x) => x.id === run.difficulty) || { goldMul: 1 };
      const disc = 1 - (run.player.mods.shopDiscount || 0);
      return Math.max(1, Math.round(base * (0.9 + d.goldMul * 0.2) * disc));
    },

    stock(run, rng) {
      const cfg = NK.Data.get('maps').shopSize;
      const items = [], consumables = [], services = [];
      for (let i = 0; i < cfg.items; i++) {
        const rarity = rng.weighted([['common', 25], ['uncommon', 45], ['rare', 30]]);
        const it = rarity === 'common' ? (rng.chance(0.5) ? NK.Items.randomWeapon(rng) : NK.Items.randomArmor(rng)) : NK.Items.randomMagic(rng, rarity);
        items.push({ id: U.uid('s'), kind: 'gear', item: it, price: Shop.price(run, it.price), sold: false });
      }
      for (let i = 0; i < cfg.consumables; i++) {
        const c = NK.Items.randomConsumable(rng);
        consumables.push({ id: U.uid('s'), kind: 'consumable', item: c, price: Shop.price(run, c.price), sold: false });
      }
      const svcPool = rng.sample([
        { id: 'svc_heal', name: '治疗服务（回满生命）', price: 120, effect: { fullHeal: true } },
        { id: 'svc_slots', name: '冥想（恢复全部法术位）', price: 150, effect: { fullSlots: true } },
        { id: 'svc_hitdie', name: '休整（恢复 2 颗生命骰）', price: 110, effect: { hitDice: 2 } },
        { id: 'svc_hitdie4', name: '长时间疗养（恢复 4 颗生命骰）', price: 200, effect: { hitDice: 4 } },
        { id: 'svc_cleanse', name: '净化（移除所有诅咒）', price: 140, effect: { cleanse: true } },
        { id: 'svc_food2', name: '干粮 ×2（长休用）', price: 60, effect: { food: 2 } },
        { id: 'svc_food4', name: '一整袋干粮 ×4', price: 110, effect: { food: 4 } },
        { id: 'svc_sharpen', name: '磨砺（本局武器伤害 +1）', price: 260, effect: { buff: { name: '磨砺', desc: '武器伤害 +1（本局持续）', mods: { dmg: 1 } } } },
      ], cfg.services);
      for (const s of svcPool) services.push({ id: U.uid('s'), kind: 'service', item: s, price: Shop.price(run, s.price), sold: false });
      return { items, consumables, services };
    },

    buy(run, entry) {
      if (entry.sold) return { ok: false, msg: '已经卖掉了。' };
      if (run.gold < entry.price) return { ok: false, msg: `金币不足（需要 ${entry.price}）。` };
      run.gold -= entry.price;
      entry.sold = true;
      const p = run.player;
      if (entry.kind === 'gear') { NK.Run.grantItem(run, entry.item); return { ok: true, msg: `买下了 ${entry.item.name}（放入背包）。` }; }
      if (entry.kind === 'consumable') { NK.Run.grantConsumable(run, entry.item); return { ok: true, msg: `买下了 ${entry.item.name}。` }; }
      const e = entry.item.effect || {};
      const out = [];
      if (e.fullHeal) { p.hp = p.maxHp; out.push('生命回满'); }
      if (e.fullSlots) { p.slots = p.slotsMax.slice(); out.push('法术位全部恢复'); }
      if (e.food) { run.food += e.food; out.push(`食物 +${e.food}（共 ${run.food} 份）`); }
      if (e.hitDice) { p.hitDice.left = Math.min(p.hitDice.total, p.hitDice.left + e.hitDice); out.push(`生命骰 +${e.hitDice}（${p.hitDice.left}/${p.hitDice.total}）`); }
      if (e.buff) { p.buffs.push(Object.assign({ kind: 'buff', turns: null }, e.buff)); NK.Rules.recalc(p); out.push(`获得「${e.buff.name}」`); }
      if (e.cleanse) { const n = p.buffs.filter((b) => b.kind === 'curse').length; p.buffs = p.buffs.filter((b) => b.kind !== 'curse'); NK.Rules.recalc(p); out.push(`移除 ${n} 个诅咒`); }
      return { ok: true, msg: `${entry.item.name}：${out.join('，')}` };
    },
  };

  NK.Shop = Shop;
})(typeof window !== 'undefined' ? window : globalThis);

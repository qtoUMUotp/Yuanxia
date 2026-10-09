/* 分支地图生成与推进 */
(function (global) {
  const NK = (global.NK = global.NK || {});

  const MapGen = {
    nodeMeta(type) {
      return NK.Data.get('maps').nodeMeta[type] || { name: type, icon: '?', color: '#999', desc: '' };
    },
    generate(tier, rng) {
      const cfg = NK.Data.get('maps');
      const diff = NK.Data.get('maps').difficulties.find((d) => d.id === (tier.id || 1)) || { id: 1 };
      return { acts: cfg.acts.map((actDef, ai) => MapGen.generateAct(actDef, ai, diff, rng)) };
    },

    generateAct(actDef, actIndex, diff, rng) {
      const cfg = NK.Data.get('maps');
      const gen = cfg.generation;
      const layers = [];
      const total = actDef.layers;
      for (let li = 0; li <= total; li++) {
        const isBoss = li === total;
        const isEntry = li === 0;
        const count = isBoss ? 1 : (isEntry ? gen.entryNodes : rng.int(gen.nodesPerLayer[0], gen.nodesPerLayer[1]));
        const layer = [];
        for (let ni = 0; ni < count; ni++) {
          layer.push({
            id: `a${actIndex}l${li}n${ni}`, act: actIndex, layer: li, idx: ni,
            type: isBoss ? 'boss' : (isEntry ? gen.firstLayerForce : null),
            next: [], done: false, visited: false,
          });
        }
        layers.push(layer);
      }
      for (let li = 0; li < layers.length - 1; li++) {
        const cur = layers[li], nxt = layers[li + 1];
        for (const c of cur) {
          const k = nxt.length === 1 ? 1 : (rng.chance(0.5) ? 2 : 1);
          const order = nxt.map((n, i) => i).sort((a, b) => Math.abs(a - c.idx * 1.5) - Math.abs(b - c.idx * 1.5));
          for (const i of order.slice(0, k)) if (!c.next.includes(nxt[i].id)) c.next.push(nxt[i].id);
        }
        for (const n of nxt) {
          if (!cur.some((c) => c.next.includes(n.id))) {
            const nearest = cur.slice().sort((a, b) => Math.abs(a.idx - n.idx) - Math.abs(b.idx - n.idx))[0];
            nearest.next.push(n.id);
          }
        }
      }
      const weights = Object.assign({}, cfg.nodeWeights);
      const flat = [];
      for (const layer of layers) for (const n of layer) if (!n.type) flat.push(n);
      const entries = Object.keys(weights).map((k) => [k, weights[k]]);
      for (const n of flat) n.type = rng.weighted(entries);
      for (const type of Object.keys(gen.guarantee)) {
        const need = gen.guarantee[type];
        let have = flat.filter((n) => n.type === type).length;
        let guard = 0;
        while (have < need && guard++ < 20) {
          const counts = {};
          flat.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
          const cands = flat.filter((n) => n.type !== type && counts[n.type] > (gen.guarantee[n.type] || 0))
            .sort((a, b) => counts[b.type] - counts[a.type]);
          if (!cands.length) break;
          cands[0].type = type;
          have += 1;
        }
      }
      for (const t of ['shop', 'rest', 'treasure']) {
        flat.filter((n) => n.type === t).slice(2).forEach((n) => { n.type = 'event'; });
      }
      return { id: actDef.id, name: actDef.name, theme: actDef.theme, flavor: actDef.flavor, layers, bossId: actDef.boss, actDef };
    },

    nodeById(actData, id) {
      for (const layer of actData.layers) { const n = layer.find((x) => x.id === id); if (n) return n; }
      return null;
    },

    available(run) {
      const actData = run.map.acts[run.actIndex];
      if (!actData) return [];
      const cur = run.current ? MapGen.nodeById(actData, run.current) : null;
      const nexts = cur ? cur.next.map((id) => MapGen.nodeById(actData, id)).filter((n) => n && !n.done) : [];
      if (nexts.length) return nexts;
      for (const layer of actData.layers) {
        const open = layer.filter((n) => !n.done);
        if (open.length) return open;
      }
      return [];
    },

    isVisible(run, node) {
      const cur = run.current ? MapGen.nodeById(run.map.acts[run.actIndex], run.current) : null;
      const curLayer = cur ? cur.layer : -1;
      if (run.revealAll) return true;
      return node.layer <= curLayer + NK.Data.get('maps').generation.visibleLayers + 1;
    },
  };

  NK.MapGen = MapGen;
})(typeof window !== 'undefined' ? window : globalThis);

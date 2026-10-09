/* 数据加载：http(s) 下 fetch JSON；file:// 下回退内嵌数据 */
(function (global) {
  const NK = (global.NK = global.NK || {});
  const FILES = ['rules', 'races', 'backgrounds', 'classes', 'spells', 'monsters', 'items', 'events', 'maps'];

  const Data = {
    tables: {},
    source: 'none',
    loaded: false,
    async load() {
      const proto = (global.location && global.location.protocol) || 'file:';
      if (proto !== 'file:') {
        try {
          const results = await Promise.all(FILES.map((f) => fetch(`data/${f}.json`, { cache: 'no-store' }).then((r) => {
            if (!r.ok) throw new Error(f + ' ' + r.status);
            return r.json();
          })));
          FILES.forEach((f, i) => { Data.tables[f] = results[i]; });
          Data.source = 'fetch';
          Data.loaded = true;
          return Data;
        } catch (e) {
          console.warn('[渊下] fetch 数据失败，回退内嵌数据：', e.message);
        }
      }
      if (!global.NK_EMBEDDED) throw new Error('缺少内嵌数据，请先运行 node tools/build-data.mjs');
      Data.tables = global.NK_EMBEDDED;
      Data.source = 'embedded';
      Data.loaded = true;
      return Data;
    },
    get(name) {
      const t = Data.tables[name];
      if (!t) throw new Error('数据表不存在: ' + name);
      return t;
    },
  };

  NK.Data = Data;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * 查询数据库内容 - 命令行工具
 * 用法: node scripts/query-db.js [表名]
 * 示例: node scripts/query-db.js          (显示统计)
 *       node scripts/query-db.js nodes    (查看节点)
 *       node scripts/query-db.js edges    (查看边)
 *       node scripts/query-db.js pois     (查看POI)
 *       node scripts/query-db.js pois scenic  (按分类查看POI)
 *       node scripts/query-db.js routes   (查看路线)
 */
const initSqlJs = require('sql.js');
const MapDatabase = require('../src/engine/database');
const sampleData = require('../assets/data/sample-data.json');

(async () => {
  const SQL = await initSqlJs();
  const db = new MapDatabase();
  await db.init(SQL);
  db.importFromJSON(sampleData);

  const table = process.argv[2];
  const filter = process.argv[3];

  if (!table) {
    // 显示统计
    const stats = db.getStats();
    console.log('\n=== 数据库概览 ===');
    console.log('  节点(nodes):  ' + stats.nodeCount);
    console.log('  边(edges):   ' + stats.edgeCount);
    console.log('  POI:         ' + stats.poiCount);
    console.log('  路线(routes): ' + stats.routeCount);

    // POI 分类统计
    const categories = db._rows('SELECT category, COUNT(*) as cnt FROM pois GROUP BY category');
    console.log('\n  POI 分类:');
    for (const c of categories) {
      console.log('    ' + c.category + ': ' + c.cnt);
    }

    // 前5个节点
    console.log('\n  前5个节点:');
    const nodes = db._rows('SELECT * FROM nodes LIMIT 5');
    for (const n of nodes) {
      console.log('    #' + n.id + ' (' + n.lat.toFixed(4) + ', ' + n.lng.toFixed(4) + ')');
    }

    // 前5条边
    console.log('\n  前5条边:');
    const edges = db._rows('SELECT * FROM edges LIMIT 5');
    for (const e of edges) {
      console.log('    #' + e.id + ': ' + e.from_id + '->' + e.to_id + ' ' + e.distance + 'm ' + e.name);
    }
    return;
  }

  // 查询指定表
  let rows;
  if (table === 'pois' && filter) {
    rows = db.getPOIs(filter);
    console.log('\n=== POI (分类: ' + filter + ') ===');
  } else if (table === 'pois') {
    rows = db.getPOIs();
    console.log('\n=== POI (全部) ===');
  } else if (table === 'routes') {
    rows = db.getRoutes();
    console.log('\n=== 路线 ===');
  } else {
    rows = db._rows('SELECT * FROM ' + table + ' LIMIT 20');
    console.log('\n=== ' + table + ' ===');
  }

  for (const r of rows) {
    console.log('  ' + JSON.stringify(r));
  }
  console.log('共 ' + rows.length + ' 条记录');
})();

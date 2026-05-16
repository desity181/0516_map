/**
 * 导出 SQLite 数据库为 .db 文件
 * 用法: node scripts/export-db.js [输出路径]
 * 然后用 DB Browser for SQLite 打开
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const MapDatabase = require('../src/engine/database');
const sampleData = require('../assets/data/sample-data.json');

(async () => {
  const SQL = await initSqlJs();
  const db = new MapDatabase();
  await db.init(SQL);
  db.importFromJSON(sampleData);

  const outPath = process.argv[2] || path.join(__dirname, '..', 'dist', 'offlinemap.db');
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const buf = db.exportBuffer();
  fs.writeFileSync(outPath, buf);
  console.log('数据库已导出: ' + outPath);
  console.log('   大小: ' + (buf.length / 1024).toFixed(1) + ' KB');

  const stats = db.getStats();
  console.log('   节点: ' + stats.nodeCount + ', 边: ' + stats.edgeCount + ', POI: ' + stats.poiCount + ', 路线: ' + stats.routeCount);
  console.log('\n用 DB Browser for SQLite 打开即可浏览: https://sqlitebrowser.org/');
})();

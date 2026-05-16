/**
 * MapDatabase - 基于 sql.js 的本地 SQLite 数据库
 * 支持路网、POI、路线、偏好设置的持久化存储
 * 浏览器端使用 IndexedDB 持久化，Node.js 端使用内存
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
    id   INTEGER PRIMARY KEY,
    lat  REAL NOT NULL,
    lng  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id       INTEGER NOT NULL,
    to_id         INTEGER NOT NULL,
    distance      REAL NOT NULL,
    speed         REAL NOT NULL,
    mode          TEXT NOT NULL DEFAULT '',
    name          TEXT NOT NULL DEFAULT '',
    bidirectional INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (from_id) REFERENCES nodes(id),
    FOREIGN KEY (to_id) REFERENCES nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_lat ON nodes(lat);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);

CREATE TABLE IF NOT EXISTS pois (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    category TEXT NOT NULL,
    lat      REAL NOT NULL,
    lng      REAL NOT NULL,
    address  TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_pois_lat ON pois(lat);

CREATE TABLE IF NOT EXISTS routes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL DEFAULT '未命名路线',
    mode       TEXT NOT NULL DEFAULT 'driving',
    optimize   TEXT NOT NULL DEFAULT 'fastest',
    waypoints  TEXT NOT NULL,
    path       TEXT NOT NULL,
    distance  REAL DEFAULT 0,
    time      REAL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS preferences (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('data_source', '');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('import_timestamp', '0');
`;

class MapDatabase {
  constructor() {
    this.db = null;
    this.SQL = null;
  }

  /**
   * 初始化数据库（创建新库）
   * @param {object} sqlJsModule - sql.js 模块实例
   */
  async init(sqlJsModule) {
    this.SQL = sqlJsModule;
    this.db = new this.SQL.Database();
    this.db.run(SCHEMA_SQL);
  }

  /**
   * 从二进制缓冲区加载数据库
   */
  async loadFromBuffer(buffer, sqlJsModule) {
    if (sqlJsModule) this.SQL = sqlJsModule;
    this.db = new this.SQL.Database(new Uint8Array(buffer));
  }

  /**
   * 导出数据库为二进制缓冲区
   */
  exportBuffer() {
    return this.db.export();
  }

  /**
   * 从 JSON 数据批量导入
   * @param {object} data - { graph: { nodes, edges }, pois }
   */
  importFromJSON(data) {
    this.db.run('BEGIN TRANSACTION');

    // 清空旧数据
    this.db.run('DELETE FROM edges');
    this.db.run('DELETE FROM nodes');
    this.db.run('DELETE FROM pois');

    // 导入节点
    const insertNode = this.db.prepare('INSERT INTO nodes (id, lat, lng) VALUES (?, ?, ?)');
    for (const [id, lat, lng] of data.graph.nodes) {
      insertNode.bind([id, lat, lng]);
      insertNode.step();
      insertNode.reset();
    }
    insertNode.free();

    // 导入边（去重：双向边只存一次）
    const insertEdge = this.db.prepare(
      'INSERT INTO edges (from_id, to_id, distance, speed, mode, name, bidirectional) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const seenPairs = new Set();
    for (const [from, to, dist, speed, mode, name] of data.graph.edges) {
      const pairKey = `${Math.min(from, to)}-${Math.max(from, to)}`;
      const bidi = seenPairs.has(pairKey) ? 0 : 1;
      seenPairs.add(pairKey);
      insertEdge.bind([from, to, dist, speed, mode, name, bidi]);
      insertEdge.step();
      insertEdge.reset();
    }
    insertEdge.free();

    // 导入 POI
    const insertPOI = this.db.prepare(
      'INSERT INTO pois (name, category, lat, lng, address) VALUES (?, ?, ?, ?, ?)'
    );
    for (const poi of (data.pois || [])) {
      insertPOI.bind([poi.name, poi.category, poi.lat, poi.lng, poi.address || '']);
      insertPOI.step();
      insertPOI.reset();
    }
    insertPOI.free();

    this.db.run('COMMIT');

    // 更新元数据
    this.db.run("UPDATE metadata SET value = ? WHERE key = 'import_timestamp'", [Date.now().toString()]);
  }

  /**
   * 导出为 Graph 对象
   */
  toGraph() {
    const Graph = require('./graph');
    const graph = new Graph();

    const nodeRows = this.db.exec('SELECT id, lat, lng FROM nodes');
    if (nodeRows.length > 0) {
      for (const [id, lat, lng] of nodeRows[0].values) {
        graph.addNode(id, lat, lng);
      }
    }

    const edgeRows = this.db.exec('SELECT from_id, to_id, distance, speed, mode, name, bidirectional FROM edges');
    if (edgeRows.length > 0) {
      for (const [from, to, dist, speed, mode, name, bidi] of edgeRows[0].values) {
        graph.addEdge(from, to, dist, speed, mode, name, !!bidi);
      }
    }

    graph.buildSpatialIndex();
    return graph;
  }

  /**
   * 获取所有 POI
   */
  getPOIs(category = null) {
    if (category) {
      return this._rows('SELECT * FROM pois WHERE category = ?', [category]);
    }
    return this._rows('SELECT * FROM pois');
  }

  /**
   * 保存路线
   */
  saveRoute(name, mode, optimize, waypoints, path, distance, time) {
    this.db.run(
      'INSERT INTO routes (name, mode, optimize, waypoints, path, distance, time) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, mode, optimize, JSON.stringify(waypoints), JSON.stringify(path), distance, time]
    );
  }

  /**
   * 获取所有保存的路线
   */
  getRoutes() {
    return this._rows('SELECT * FROM routes ORDER BY created_at DESC');
  }

  /**
   * 删除路线
   */
  deleteRoute(id) {
    this.db.run('DELETE FROM routes WHERE id = ?', [id]);
  }

  /**
   * 偏好设置
   */
  getPreference(key, defaultValue = null) {
    const rows = this._rows('SELECT value FROM preferences WHERE key = ?', [key]);
    return rows.length > 0 ? rows[0].value : defaultValue;
  }

  setPreference(key, value) {
    this.db.run('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', [key, String(value)]);
  }

  /**
   * 获取元数据
   */
  getMetadata(key) {
    const rows = this._rows('SELECT value FROM metadata WHERE key = ?', [key]);
    return rows.length > 0 ? rows[0].value : null;
  }

  /**
   * 统计信息
   */
  getStats() {
    const nodeCount = this.db.exec('SELECT COUNT(*) FROM nodes')[0]?.values[0][0] || 0;
    const edgeCount = this.db.exec('SELECT COUNT(*) FROM edges')[0]?.values[0][0] || 0;
    const poiCount = this.db.exec('SELECT COUNT(*) FROM pois')[0]?.values[0][0] || 0;
    const routeCount = this.db.exec('SELECT COUNT(*) FROM routes')[0]?.values[0][0] || 0;
    return { nodeCount, edgeCount, poiCount, routeCount };
  }

  /**
   * 浏览器端持久化 - 保存到 IndexedDB
   */
  async saveToIndexedDB(dbName = 'offlinemap_db', storeName = 'databases') {
    const buf = this.db.export();

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(storeName)) {
          idb.createObjectStore(storeName);
        }
      };
      request.onsuccess = (e) => {
        const idb = e.target.result;
        const tx = idb.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(buf, 'main');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 浏览器端持久化 - 从 IndexedDB 加载
   */
  async loadFromIndexedDB(sqlJsModule, dbName = 'offlinemap_db', storeName = 'databases') {
    this.SQL = sqlJsModule;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(storeName)) {
          idb.createObjectStore(storeName);
        }
      };
      request.onsuccess = (e) => {
        const idb = e.target.result;
        const tx = idb.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const getReq = store.get('main');
        getReq.onsuccess = () => {
          if (getReq.result) {
            this.db = new this.SQL.Database(new Uint8Array(getReq.result));
            resolve(true);
          } else {
            resolve(false);
          }
        };
        getReq.onerror = () => reject(getReq.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 辅助方法 - 执行查询返回对象数组
   */
  _rows(sql, params = []) {
    const result = this.db.exec(sql, params);
    if (!result.length) return [];
    const cols = result[0].columns;
    return result[0].values.map(row =>
      Object.fromEntries(cols.map((c, i) => [c, row[i]]))
    );
  }
}

module.exports = MapDatabase;

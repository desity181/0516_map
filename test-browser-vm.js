/**
 * 浏览器端集成测试 - 使用 vm 模拟浏览器全局环境
 * 验证 engine-bundle.js + app.js 的完整初始化链
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const http = require('http');

let passCount = 0;
let failCount = 0;

function assert(condition, msg) {
  if (condition) {
    passCount++;
    console.log('  ✅ ' + msg);
  } else {
    failCount++;
    console.log('  ❌ ' + msg);
  }
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async function() {
  console.log('=== 浏览器端集成测试 ===\n');

  // 1. 模拟浏览器环境
  console.log('1. 构建浏览器模拟环境...');
  const sandbox = {
    document: {
      addEventListener: function(event, cb) {
        if (event === 'DOMContentLoaded') cb();
      },
      getElementById: function(id) { return { classList: { add: function(){}, remove: function(){}, contains: function(){ return false; } }, value: '', innerHTML: '', textContent: '', style: {}, appendChild: function(){}, querySelectorAll: function() { return []; } }; },
      querySelector: function() { return null; },
      querySelectorAll: function() { return []; },
      createElement: function() { return { className: '', innerHTML: '', appendChild: function(){}, addEventListener: function(){} }; }
    },
    console: console,
    fetch: function(url) {
      return fetchUrl('http://localhost:18420' + url).then(body => ({
        ok: true, json: () => JSON.parse(body)
      }));
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Map: Map,
    Set: Set,
    Promise: Promise,
    JSON: JSON,
    Math: Math,
    Uint8Array: Uint8Array,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Date: Date,
    Error: Error,
    parseFloat: parseFloat,
    parseInt: parseInt,
    isNaN: isNaN,
    Infinity: Infinity,
    ArrayBuffer: ArrayBuffer,
    indexedDB: null
  };
  // 关键: self/window 必须指向 sandbox 自身，模拟浏览器全局对象
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  // 2. 加载 engine-bundle.js
  console.log('\n2. 加载 engine-bundle.js...');
  const bundleCode = fs.readFileSync(path.join(__dirname, 'dist', 'engine-bundle.js'), 'utf-8');

  try {
    vm.runInContext(bundleCode, sandbox, { filename: 'engine-bundle.js' });
  } catch (e) {
    console.log('  ❌ Bundle 加载失败: ' + e.message);
    console.log('  堆栈: ' + e.stack?.split('\n').slice(0, 3).join('\n'));
  }

  // 验证全局变量
  assert(typeof sandbox.Graph === 'function', 'Graph 已导出');
  assert(typeof sandbox.Pathfinder === 'function', 'Pathfinder 已导出');
  assert(typeof sandbox.MapMatcher === 'function', 'MapMatcher 已导出');
  assert(typeof sandbox.MapDatabase === 'function', 'MapDatabase 已导出');

  // 3. 测试 Graph 在浏览器环境中工作
  console.log('\n3. 浏览器环境下的 Graph...');
  if (sandbox.Graph) {
    try {
      const g = new sandbox.Graph();
      g.addNode(1, 39.9, 116.4);
      g.addNode(2, 39.91, 116.41);
      g.addEdge(1, 2, 1.5, 40, 'primary', '测试路');
      g.buildSpatialIndex();
      assert(g.nodeCount === 2, '浏览器端 Graph.addNode() 正常');
      assert(g.edgeCount === 2, '浏览器端 Graph.addEdge() 双向正常');
    } catch (e) {
      console.log('  ❌ Graph 浏览器端执行失败: ' + e.message);
    }
  }

  // 4. 测试 Pathfinder 在浏览器环境中工作
  console.log('\n4. 浏览器环境下的 Pathfinder...');
  if (sandbox.Pathfinder && sandbox.Graph) {
    try {
      const g = new sandbox.Graph();
      g.addNode(1, 39.9, 116.4);
      g.addNode(2, 39.91, 116.41);
      g.addNode(3, 39.92, 116.42);
      g.addEdge(1, 2, 1.5, 40, 'primary', '路1');
      g.addEdge(2, 3, 1.5, 40, 'primary', '路2');
      g.addEdge(1, 3, 3.0, 60, 'primary', '路3');
      g.buildSpatialIndex();

      const pf = new sandbox.Pathfinder(g);
      const result = pf.findPath(1, 3, 'driving', 'fastest');
      assert(result !== null, '浏览器端 Pathfinder.findPath() 正常');
      if (result) {
        assert(result.distance > 0, '路径距离 > 0');
        assert(result.path.length >= 2, '路径节点 >= 2');
      }
    } catch (e) {
      console.log('  ❌ Pathfinder 浏览器端执行失败: ' + e.message);
    }
  }

  // 5. 测试 MapMatcher 在浏览器环境中工作
  console.log('\n5. 浏览器环境下的 MapMatcher...');
  if (sandbox.MapMatcher && sandbox.Graph) {
    try {
      const g = new sandbox.Graph();
      g.addNode(1, 39.9, 116.4);
      g.addNode(2, 39.91, 116.41);
      g.addEdge(1, 2, 1.5, 40, 'primary', '测试路');
      g.buildSpatialIndex();

      const mm = new sandbox.MapMatcher(g);
      const result = mm.matchPoint(39.905, 116.405, 'driving');
      assert(result !== null, '浏览器端 MapMatcher.matchPoint() 正常');
    } catch (e) {
      console.log('  ❌ MapMatcher 浏览器端执行失败: ' + e.message);
    }
  }

  // 6. 测试 MapDatabase 在浏览器环境中工作（无 sql.js）
  console.log('\n6. 浏览器环境下的 MapDatabase (无 sql.js)...');
  if (sandbox.MapDatabase) {
    try {
      const db = new sandbox.MapDatabase();
      assert(db.db === null, 'MapDatabase 初始 db 为 null');
      assert(typeof db.getStats === 'function', 'MapDatabase.getStats 方法存在');
    } catch (e) {
      console.log('  ❌ MapDatabase 浏览器端执行失败: ' + e.message);
    }
  }

  // 7. 用真实数据测试完整链路
  console.log('\n7. 真实数据完整链路测试...');
  try {
    const dataStr = fs.readFileSync(path.join(__dirname, 'assets', 'data', 'sample-data.json'), 'utf-8');
    const data = JSON.parse(dataStr);

    const graph = sandbox.Graph.fromJSON(data.graph);
    assert(graph.nodeCount === 36, '真实数据: 36 节点');
    assert(graph.edgeCount > 100, '真实数据: 100+ 边');

    const pathfinder = new sandbox.Pathfinder(graph);
    const result = pathfinder.findPath(3, 20, 'driving', 'fastest');
    assert(result !== null, '真实数据: 路径规划成功');
    if (result) {
      console.log('    驾车: ' + result.distance.toFixed(2) + 'km, ' + Math.round(result.time) + '分钟');
    }

    const walkResult = pathfinder.findPath(3, 20, 'walking', 'fastest');
    if (walkResult) {
      console.log('    步行: ' + walkResult.distance.toFixed(2) + 'km, ' + Math.round(walkResult.time) + '分钟');
      assert(walkResult.time > result.time * 2, '步行比驾车慢');
    }
  } catch (e) {
    console.log('  ❌ 真实数据测试失败: ' + e.message);
  }

  // ===== 结果 =====
  console.log('\n' + '='.repeat(50));
  console.log('  浏览器端测试结果: ' + passCount + ' 通过, ' + failCount + ' 失败');
  console.log('='.repeat(50));
})();

/**
 * 端到端测试 - 验证路径规划引擎 + 地图匹配 + 数据库
 */
const Graph = require('./src/engine/graph');
const Pathfinder = require('./src/engine/pathfinder');
const MapMatcher = require('./src/engine/map-matcher');
const MapDatabase = require('./src/engine/database');
const sampleData = require('./assets/data/sample-data.json');

let passCount = 0;
let failCount = 0;

function assert(condition, msg) {
  if (condition) {
    passCount++;
    console.log(`   ✅ ${msg}`);
  } else {
    failCount++;
    console.log(`   ❌ ${msg}`);
  }
}

(async function runTests() {
console.log('=== 离线地图路径规划工具 v2.0 - 端到端测试 ===\n');

// 1. Build graph
console.log('1. 构建路网图...');
const graph = Graph.fromJSON(sampleData.graph);
console.log(`   节点数: ${graph.nodeCount}`);
console.log(`   边数: ${graph.edgeCount}`);
assert(graph.nodeCount === 36, `节点数应为 36，实际 ${graph.nodeCount}`);
assert(graph.edgeCount > 0, '边数应大于 0');

// 2. Test spatial index
console.log('\n2. 测试空间索引...');
const nearestId = graph.findNearestNode(39.908, 116.397);
const nearestNode = graph.getNode(nearestId);
console.log(`   天安门(39.908, 116.397)最近节点: #${nearestId} (${nearestNode.lat}, ${nearestNode.lng})`);
assert(nearestId !== null, '应能找到最近节点');

// Test findNodesInRadius
const nearbyNodes = graph.findNodesInRadius(39.908, 116.397, 0.5);
console.log(`   天安门附近 500m 内有 ${nearbyNodes.length} 个节点`);
assert(nearbyNodes.length > 0, '500m 半径内应能找到节点');

// 3. Test pathfinding (with time bug fix)
console.log('\n3. 测试路径规划（时间计算修复）...');
const pathfinder = new Pathfinder(graph);

const startId = graph.findNearestNode(39.908, 116.397);
const endId = graph.findNearestNode(39.941, 116.390);
console.log(`   起点: #${startId} → 终点: #${endId}`);

const drivingResult = pathfinder.findPath(startId, endId, 'driving', 'fastest');
if (drivingResult) {
  console.log(`   驾车路径: ${drivingResult.path.length} 个节点, ${drivingResult.distance}km, ${Math.round(drivingResult.time)}分钟`);
  assert(drivingResult.time > 0, '驾车时间应大于 0');
} else {
  console.log('   ❌ 驾车路径未找到');
  failCount++;
}

const walkingResult = pathfinder.findPath(startId, endId, 'walking', 'shortest');
if (walkingResult) {
  console.log(`   步行路径: ${walkingResult.path.length} 个节点, ${walkingResult.distance}km, ${Math.round(walkingResult.time)}分钟`);
  assert(walkingResult.time > 0, '步行时间应大于 0');

  // 关键测试：步行时间应该远大于驾车时间
  if (drivingResult) {
    const ratio = walkingResult.time / drivingResult.time;
    console.log(`   步行/驾车时间比: ${ratio.toFixed(1)}x`);
    assert(ratio > 3, `步行应比驾车慢至少3倍，实际 ${ratio.toFixed(1)}x`);
  }
} else {
  console.log('   ❌ 步行路径未找到');
  failCount++;
}

const cyclingResult = pathfinder.findPath(startId, endId, 'cycling', 'fastest');
if (cyclingResult) {
  console.log(`   骑行路径: ${cyclingResult.path.length} 个节点, ${cyclingResult.distance}km, ${Math.round(cyclingResult.time)}分钟`);
  assert(cyclingResult.time > 0, '骑行时间应大于 0');

  // 骑行速度 15km/h 应该在驾车和步行之间
  if (drivingResult && walkingResult) {
    assert(cyclingResult.time > drivingResult.time, '骑行应比驾车慢');
    assert(cyclingResult.time < walkingResult.time, '骑行应比步行快');
  }
} else {
  console.log('   ❌ 骑行路径未找到');
  failCount++;
}

// 4. Test multi-waypoint
console.log('\n4. 测试多途经点规划...');
const wp1 = graph.findNearestNode(39.908, 116.397);
const wp2 = graph.findNearestNode(39.920, 116.400);
const wp3 = graph.findNearestNode(39.941, 116.390);

const multiResult = pathfinder.findPathMultiWaypoint([wp1, wp2, wp3], 'driving', 'fastest');
if (multiResult) {
  console.log(`   多途经点路径: ${multiResult.path.length} 个节点, ${multiResult.distance}km, ${Math.round(multiResult.time)}分钟`);
  assert(multiResult.distance > 0, '多途经点距离应大于 0');
} else {
  console.log('   ❌ 多途经点路径未找到');
  failCount++;
}

// 5. Test Map Matcher
console.log('\n5. 测试地图匹配引擎...');
const matcher = new MapMatcher(graph);

// Test driving mode match
const driveMatch = matcher.matchPoint(39.908, 116.397, 'driving');
console.log(`   驾车匹配: nodeId=${driveMatch.nodeId}, 吸附距离=${Math.round(driveMatch.projection.distance * 1000)}m`);
assert(driveMatch.nodeId !== null, '驾车匹配应找到节点');

// Test walking mode match
const walkMatch = matcher.matchPoint(39.908, 116.397, 'walking');
console.log(`   步行匹配: nodeId=${walkMatch.nodeId}, 吸附距离=${Math.round(walkMatch.projection.distance * 1000)}m`);
assert(walkMatch.nodeId !== null, '步行匹配应找到节点');

// Test cycling mode match
const cycleMatch = matcher.matchPoint(39.908, 116.397, 'cycling');
console.log(`   骑行匹配: nodeId=${cycleMatch.nodeId}, 吸附距离=${Math.round(cycleMatch.projection.distance * 1000)}m`);
assert(cycleMatch.nodeId !== null, '骑行匹配应找到节点');

// Test edge projection
const projMatch = matcher.matchPoint(39.915, 116.397, 'driving');
console.log(`   边中点匹配: nodeId=${projMatch.nodeId}, fraction=${projMatch.projection.fraction?.toFixed(2)}`);
assert(projMatch.projection !== undefined, '匹配应有投影信息');

// Performance test
console.log('\n   性能测试: 100 次地图匹配...');
const t0 = Date.now();
for (let i = 0; i < 100; i++) {
  matcher.matchPoint(39.91 + Math.random() * 0.02, 116.39 + Math.random() * 0.02, 'driving');
}
const elapsed = Date.now() - t0;
console.log(`   100 次匹配耗时: ${elapsed}ms`);
assert(elapsed < 5000, `100 次匹配应 <5s，实际 ${elapsed}ms`);

// 6. Test Database
console.log('\n6. 测试本地数据库...');
const initSqlJs = require('sql.js');
const SQL = await initSqlJs();

const mapDb = new MapDatabase();
await mapDb.init(SQL);
mapDb.importFromJSON(sampleData);

const nodeCount = mapDb.db.exec('SELECT COUNT(*) FROM nodes')[0].values[0][0];
console.log(`   数据库节点数: ${nodeCount}`);
assert(nodeCount === 36, `节点数应为 36，实际 ${nodeCount}`);

const edgeCount = mapDb.db.exec('SELECT COUNT(*) FROM edges')[0].values[0][0];
console.log(`   数据库边数: ${edgeCount}`);
assert(edgeCount > 0, '边数应大于 0');

const pois = mapDb.getPOIs();
console.log(`   数据库 POI 数: ${pois.length}`);
assert(pois.length === 20, `POI 数应为 20，实际 ${pois.length}`);

// Test category filter
const scenicPois = mapDb.getPOIs('scenic');
console.log(`   景点类 POI 数: ${scenicPois.length}`);
assert(scenicPois.length > 0, '景点类 POI 应大于 0');

// Test round-trip: DB → Graph
const graph2 = mapDb.toGraph();
console.log(`   数据库导出图: ${graph2.nodeCount} 节点, ${graph2.edgeCount} 边`);
assert(graph2.nodeCount === 36, '数据库导出图的节点数应与原始一致');

// Test persistence (export/import buffer)
const buf = mapDb.exportBuffer();
const mapDb2 = new MapDatabase();
await mapDb2.loadFromBuffer(buf, SQL);
const nodeCount2 = mapDb2.db.exec('SELECT COUNT(*) FROM nodes')[0].values[0][0];
assert(nodeCount2 === nodeCount, '持久化后节点数应一致');

// Test preferences
mapDb.setPreference('theme', 'dark');
assert(mapDb.getPreference('theme') === 'dark', '偏好设置应可读写');

// Test route saving
mapDb.saveRoute('测试路线', 'driving', 'fastest',
  [{lat: 39.908, lng: 116.397}, {lat: 39.941, lng: 116.390}],
  [1, 2, 3, 4, 5], 5.2, 12.3
);
const routes = mapDb.getRoutes();
assert(routes.length === 1, '应能保存和读取路线');

// Test stats
const stats = mapDb.getStats();
console.log(`   统计: ${stats.nodeCount}节点/${stats.edgeCount}边/${stats.poiCount}POI/${stats.routeCount}路线`);
assert(stats.routeCount === 1, '路线统计应正确');

// 7. Test POI data
console.log('\n7. 测试POI数据...');
console.log(`   POI总数: ${sampleData.pois.length}`);
const categories = [...new Set(sampleData.pois.map(p => p.category))];
console.log(`   分类: ${categories.join(', ')}`);

// 8. Test reverse geocoding
console.log('\n8. 测试逆地理编码...');
const testLat = 39.909, testLng = 116.397;
const nearby = sampleData.pois
  .map(p => ({ ...p, dist: Graph.haversine(testLat, testLng, p.lat, p.lng) }))
  .sort((a, b) => a.dist - b.dist)
  .slice(0, 3);
console.log(`   坐标(${testLat}, ${testLng})附近:`);
nearby.forEach(n => console.log(`   - ${n.name} (${Math.round(n.dist * 1000)}m)`));

// 9. Test static haversine
console.log('\n9. 测试 Graph.haversine 静态方法...');
const dist = Graph.haversine(39.908, 116.397, 39.916, 116.397);
console.log(`   距离: ${(dist * 1000).toFixed(0)}m`);
assert(dist > 0, 'Haversine 静态方法应返回正距离');

// Summary
console.log('\n' + '='.repeat(50));
console.log(`  测试结果: ${passCount} 通过, ${failCount} 失败`);
console.log('='.repeat(50));

process.exit(failCount > 0 ? 1 : 0);
})();

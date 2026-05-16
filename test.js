/**
 * 端到端测试 - 验证路径规划引擎正确性
 */
const Graph = require('./src/engine/graph');
const Pathfinder = require('./src/engine/pathfinder');
const sampleData = require('./assets/data/sample-data.json');

console.log('=== 离线地图路径规划工具 - 端到端测试 ===\n');

// 1. Build graph
console.log('1. 构建路网图...');
const graph = new Graph();
for (const [id, lat, lng] of sampleData.graph.nodes) {
  graph.addNode(id, lat, lng);
}
for (const [from, to, distance, speed, mode, name] of sampleData.graph.edges) {
  graph.addEdge(from, to, distance, speed, mode, name, false);
}
graph.buildSpatialIndex();

console.log(`   节点数: ${graph.nodeCount}`);
console.log(`   边数: ${graph.edgeCount}`);

// 2. Test spatial index
console.log('\n2. 测试空间索引...');
const nearestId = graph.findNearestNode(39.908, 116.397);
const nearestNode = graph.getNode(nearestId);
console.log(`   天安门(39.908, 116.397)最近节点: #${nearestId} (${nearestNode.lat}, ${nearestNode.lng})`);

// 3. Test pathfinding
console.log('\n3. 测试路径规划...');
const pathfinder = new Pathfinder(graph);

// Test: 天安门 → 鼓楼 (driving, fastest)
const startId = graph.findNearestNode(39.908, 116.397);
const endId = graph.findNearestNode(39.941, 116.390);

console.log(`   起点: #${startId} → 终点: #${endId}`);

const drivingResult = pathfinder.findPath(startId, endId, 'driving', 'fastest');
if (drivingResult) {
  console.log(`   ✅ 驾车路径: ${drivingResult.path.length} 个节点, ${drivingResult.distance}km, ${Math.round(drivingResult.time)}分钟`);
  console.log(`   路线: ${drivingResult.steps.map(s => s.name).join(' → ')}`);
} else {
  console.log('   ❌ 驾车路径未找到');
}

// Test: walking
const walkingResult = pathfinder.findPath(startId, endId, 'walking', 'shortest');
if (walkingResult) {
  console.log(`   ✅ 步行路径: ${walkingResult.path.length} 个节点, ${walkingResult.distance}km, ${Math.round(walkingResult.time)}分钟`);
} else {
  console.log('   ❌ 步行路径未找到');
}

// Test: cycling
const cyclingResult = pathfinder.findPath(startId, endId, 'cycling', 'fastest');
if (cyclingResult) {
  console.log(`   ✅ 骑行路径: ${cyclingResult.path.length} 个节点, ${cyclingResult.distance}km, ${Math.round(cyclingResult.time)}分钟`);
} else {
  console.log('   ❌ 骑行路径未找到');
}

// 4. Test multi-waypoint
console.log('\n4. 测试多途经点规划...');
const wp1 = graph.findNearestNode(39.908, 116.397); // 天安门
const wp2 = graph.findNearestNode(39.920, 116.400); // 王府井
const wp3 = graph.findNearestNode(39.941, 116.390); // 鼓楼

const multiResult = pathfinder.findPathMultiWaypoint([wp1, wp2, wp3], 'driving', 'fastest');
if (multiResult) {
  console.log(`   ✅ 多途经点路径: ${multiResult.path.length} 个节点, ${multiResult.distance}km, ${Math.round(multiResult.time)}分钟`);
} else {
  console.log('   ❌ 多途经点路径未找到');
}

// 5. Test POI data
console.log('\n5. 测试POI数据...');
console.log(`   POI总数: ${sampleData.pois.length}`);
const categories = [...new Set(sampleData.pois.map(p => p.category))];
console.log(`   分类: ${categories.join(', ')}`);

// 6. Test reverse geocoding
console.log('\n6. 测试逆地理编码...');
const testLat = 39.909, testLng = 116.397;
const nearby = sampleData.pois
  .map(p => ({ ...p, dist: haversine(testLat, testLng, p.lat, p.lng) }))
  .sort((a, b) => a.dist - b.dist)
  .slice(0, 3);
console.log(`   坐标(${testLat}, ${testLng})附近:`);
nearby.forEach(n => console.log(`   - ${n.name} (${Math.round(n.dist * 1000)}m)`));

console.log('\n=== 测试完成 ===');

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

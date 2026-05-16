/**
 * MapMatcher - 模式差异化地图匹配引擎
 * 支持驾车、步行、骑行三种模式的差异化匹配策略
 * 包含点到边投影、道路类型权重排序、虚拟节点插入
 */
const Graph = require('./graph');

class MapMatcher {
  constructor(graph) {
    this.graph = graph;
  }

  /**
   * 模式配置 - 搜索半径、道路类型权重、转向惩罚
   */
  static MODE_CONFIG = {
    driving: {
      searchRadiusKm: 0.5,   // 500m
      typePenalty: {
        motorway: 0, trunk: 0, primary: 0, secondary: 0.1,
        tertiary: 0.2, residential: 0.3, cycleway: 5,
        footway: 10, pedestrian: 10, path: 10, walking: 10, cycling: 5
      },
      turnPenaltyKm: 0.05     // ~50m 转向惩罚
    },
    walking: {
      searchRadiusKm: 0.2,   // 200m
      typePenalty: {
        motorway: 10, trunk: 5, primary: 1, secondary: 0.5,
        tertiary: 0.2, residential: 0, footway: 0, pedestrian: 0,
        path: 0, cycleway: 0.1, walking: 0, cycling: 0.1
      },
      turnPenaltyKm: 0.01    // ~10m 转向惩罚
    },
    cycling: {
      searchRadiusKm: 0.3,   // 300m
      typePenalty: {
        motorway: 10, trunk: 10, primary: 0.5, secondary: 0,
        tertiary: 0, residential: 0.1, cycleway: 0, footway: 3,
        pedestrian: 2, path: 1, walking: 3, cycling: 0
      },
      turnPenaltyKm: 0.02    // ~20m 转向惩罚
    }
  };

  /**
   * 匹配点到路网
   * @param {number} lat - 纬度
   * @param {number} lng - 经度
   * @param {string} mode - 出行模式
   * @returns {{ nodeId: number, projection: object, virtualNode: object|null, score: number }}
   */
  matchPoint(lat, lng, mode = 'driving') {
    const config = MapMatcher.MODE_CONFIG[mode] || MapMatcher.MODE_CONFIG.driving;
    const radius = config.searchRadiusKm;
    const candidates = [];

    // Step 1: 找到半径范围内的节点
    const nearbyNodes = this.graph.findNodesInRadius(lat, lng, radius);

    // Step 2: 收集候选边
    const seenEdges = new Set();
    for (const node of nearbyNodes) {
      const edges = this.graph.getNeighbors(node.id);
      for (const edge of edges) {
        const edgeKey = `${Math.min(node.id, edge.to)}-${Math.max(node.id, edge.to)}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        // 检查道路类型是否可通行
        const typePenalty = config.typePenalty[edge.mode] ?? 0;
        if (typePenalty >= 10) continue; // 不可通行道路直接跳过

        // Step 3: 点到边投影
        const nodeA = this.graph.getNode(node.id);
        const nodeB = this.graph.getNode(edge.to);
        if (!nodeA || !nodeB) continue;

        const projection = this._projectPointOnEdge(lat, lng, nodeA, nodeB);
        if (projection.distance > radius) continue;

        // Step 4: 计算候选得分
        const score = projection.distance + (typePenalty * 0.1);

        candidates.push({
          type: 'edge',
          nodeId: node.id,
          edge,
          projection,
          score
        });
      }
    }

    // Step 5: 添加纯节点候选（交叉点）
    for (const node of nearbyNodes) {
      const edges = this.graph.getNeighbors(node.id);
      let bestTypePenalty = Infinity;
      for (const edge of edges) {
        const p = config.typePenalty[edge.mode] ?? 0;
        if (p < bestTypePenalty) bestTypePenalty = p;
      }
      if (bestTypePenalty >= 10) continue;

      const score = node.distance + (bestTypePenalty * 0.1);
      candidates.push({
        type: 'node',
        nodeId: node.id,
        projection: { lat: node.lat, lng: node.lng, distance: node.distance, fraction: 0 },
        score
      });
    }

    // 无候选则回退到最近节点
    if (candidates.length === 0) {
      const fallbackId = this.graph.findNearestNode(lat, lng);
      const fallbackNode = this.graph.getNode(fallbackId);
      return {
        nodeId: fallbackId,
        projection: {
          lat: fallbackNode?.lat || lat,
          lng: fallbackNode?.lng || lng,
          distance: 0,
          fraction: 0
        },
        virtualNode: null,
        score: Infinity
      };
    }

    // Step 6: 排序选最优
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];

    // Step 7: 如果吸附到边中点，创建虚拟节点
    if (best.type === 'edge' && best.projection.fraction > 0.05 && best.projection.fraction < 0.95) {
      const virtualNode = this.graph.insertVirtualNode(best.nodeId, best.edge, best.projection);
      return {
        nodeId: virtualNode.id,
        projection: best.projection,
        virtualNode,
        score: best.score
      };
    }

    // 吸附到端点附近，使用已有节点
    const snapNodeId = best.type === 'node'
      ? best.nodeId
      : (best.projection.fraction < 0.5 ? best.nodeId : best.edge.to);

    return {
      nodeId: snapNodeId,
      projection: best.projection,
      virtualNode: null,
      score: best.score
    };
  }

  /**
   * 点到边的垂直投影
   * @returns {{ lat, lng, distance, fraction }}
   */
  _projectPointOnEdge(lat, lng, nodeA, nodeB) {
    const ax = nodeA.lng, ay = nodeA.lat;
    const bx = nodeB.lng, by = nodeB.lat;
    const px = lng, py = lat;

    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
      // 退化边（零长度）
      return {
        lat: ay, lng: ax,
        distance: Graph.haversine(lat, lng, ay, ax),
        fraction: 0
      };
    }

    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t)); // 钳位到线段上

    const projLng = ax + t * dx;
    const projLat = ay + t * dy;

    const distance = Graph.haversine(lat, lng, projLat, projLng);
    return { lat: projLat, lng: projLng, distance, fraction: t };
  }
}

module.exports = MapMatcher;

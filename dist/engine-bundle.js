/* engine-bundle.js - 自动生成，请勿手动编辑 */
/* 生成时间: 2026-05-16T05:14:20.875Z */

// === graph.js (UMD) ===
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Graph = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';
/**
 * Graph - 路网图数据结构
 * 使用邻接表存储，支持空间索引快速查找
 */
class Graph {
  constructor() {
    this.nodes = new Map();   // id -> { id, lat, lng }
    this.edges = new Map();   // id -> [{ to, distance, speed, mode, name }]
    this.spatialIndex = null; // R-tree 空间索引
    this._virtualIdCounter = -1; // 虚拟节点 ID 计数器（负数避免碰撞）
  }

  addNode(id, lat, lng) {
    this.nodes.set(id, { id, lat, lng });
    if (!this.edges.has(id)) {
      this.edges.set(id, []);
    }
  }

  addEdge(from, to, distance, speed, mode, name, bidirectional = true) {
    if (!this.edges.has(from)) this.edges.set(from, []);
    this.edges.get(from).push({ to, distance, speed, mode, name });

    if (bidirectional) {
      if (!this.edges.has(to)) this.edges.set(to, []);
      this.edges.get(to).push({ to: from, distance, speed, mode, name });
    }
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  getNeighbors(id) {
    return this.edges.get(id) || [];
  }

  get nodeCount() {
    return this.nodes.size;
  }

  get edgeCount() {
    let count = 0;
    for (const edges of this.edges.values()) count += edges.length;
    return count;
  }

  /**
   * 构建空间索引 - 基于 GeoHash 的简化 R-tree
   */
  buildSpatialIndex() {
    this.spatialIndex = [];
    for (const [id, node] of this.nodes) {
      this.spatialIndex.push({ id, lat: node.lat, lng: node.lng });
    }
    // Sort by lat for binary search
    this.spatialIndex.sort((a, b) => a.lat - b.lat);
  }

  /**
   * 查找最近节点 - O(n) 对于简化索引，O(log n) 可升级
   */
  findNearestNode(lat, lng) {
    if (!this.spatialIndex) this.buildSpatialIndex();

    let minDist = Infinity;
    let nearestId = null;

    // Optimization: narrow search to nearby lat range first
    const latRange = 0.01; // ~1km
    const startIdx = this._binarySearchLat(lat - latRange);
    const endIdx = this._binarySearchLat(lat + latRange);

    for (let i = startIdx; i <= endIdx && i < this.spatialIndex.length; i++) {
      const entry = this.spatialIndex[i];
      const dist = this._haversine(lat, lng, entry.lat, entry.lng);
      if (dist < minDist) {
        minDist = dist;
        nearestId = entry.id;
      }
    }

    // Fallback to full scan if nothing found nearby
    if (nearestId === null) {
      for (const entry of this.spatialIndex) {
        const dist = this._haversine(lat, lng, entry.lat, entry.lng);
        if (dist < minDist) {
          minDist = dist;
          nearestId = entry.id;
        }
      }
    }

    return nearestId;
  }

  _binarySearchLat(targetLat) {
    let lo = 0, hi = this.spatialIndex.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.spatialIndex[mid].lat < targetLat) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Haversine 距离计算 (km)
   */
  _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * 查找半径范围内的节点 - 基于空间索引
   */
  findNodesInRadius(lat, lng, radiusKm) {
    if (!this.spatialIndex) this.buildSpatialIndex();

    const latRange = radiusKm / 111.0; // 1度纬度 ≈ 111km
    const lngRange = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));

    const startIdx = this._binarySearchLat(lat - latRange);
    const endIdx = this._binarySearchLat(lat + latRange);

    const results = [];
    for (let i = startIdx; i <= endIdx && i < this.spatialIndex.length; i++) {
      const entry = this.spatialIndex[i];
      const dist = this._haversine(lat, lng, entry.lat, entry.lng);
      if (dist <= radiusKm) {
        results.push({ id: entry.id, lat: entry.lat, lng: entry.lng, distance: dist });
      }
    }

    return results;
  }

  /**
   * 插入虚拟节点（地图匹配时在边中点插入）
   */
  insertVirtualNode(fromId, edge, projection) {
    const virtualId = this._virtualIdCounter--;
    this.addNode(virtualId, projection.lat, projection.lng);

    const dist1 = edge.distance * projection.fraction;
    const dist2 = edge.distance * (1 - projection.fraction);

    this.addEdge(fromId, virtualId, dist1, edge.speed, edge.mode, edge.name, false);
    this.addEdge(virtualId, edge.to, dist2, edge.speed, edge.mode, edge.name, false);

    // 删除原始正向边
    this._removeEdge(fromId, edge.to);
    // 删除原始反向边（如果存在）
    this._removeEdge(edge.to, fromId);
    // 添加新的反向边
    this.addEdge(virtualId, fromId, dist1, edge.speed, edge.mode, edge.name, false);
    this.addEdge(edge.to, virtualId, dist2, edge.speed, edge.mode, edge.name, false);

    // 重建空间索引
    this.buildSpatialIndex();

    return { id: virtualId, lat: projection.lat, lng: projection.lng };
  }

  /**
   * 删除指定边
   */
  _removeEdge(fromId, toId) {
    const neighbors = this.edges.get(fromId);
    if (!neighbors) return;
    const idx = neighbors.findIndex(e => e.to === toId);
    if (idx !== -1) neighbors.splice(idx, 1);
  }

  /**
   * 静态 Haversine 方法
   */
  static haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * 导出为紧凑 JSON 格式
   */
  toJSON() {
    const nodesArr = [];
    const edgesArr = [];
    for (const [id, node] of this.nodes) {
      nodesArr.push([id, node.lat, node.lng]);
    }
    for (const [fromId, neighbors] of this.edges) {
      for (const e of neighbors) {
        edgesArr.push([fromId, e.to, e.distance, e.speed, e.mode, e.name || '']);
      }
    }
    return { nodes: nodesArr, edges: edgesArr };
  }

  /**
   * 从 JSON 格式导入
   */
  static fromJSON(data) {
    const g = new Graph();
    for (const [id, lat, lng] of data.nodes) {
      g.addNode(id, lat, lng);
    }
    for (const [from, to, distance, speed, mode, name] of data.edges) {
      g.addEdge(from, to, distance, speed, mode, name, false);
    }
    g.buildSpatialIndex();
    return g;
  }
}


  return Graph;
});


// === pathfinder.js (UMD) ===
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require(./graph));
  } else {
    root.Pathfinder = factory(root.Graph);
  }
})(typeof self !== 'undefined' ? self : this, function(Graph) {
  'use strict';
/**
 * Pathfinder - 路径规划引擎
 * 实现 Dijkstra 和 A* 算法，支持多途经点和多模态
 */
;

class Pathfinder {
  constructor(graph) {
    this.graph = graph;
  }

  /**
   * A* 最短路径算法
   * @param {number} startId - 起点节点 ID
   * @param {number} endId - 终点节点 ID
   * @param {string} mode - 出行模式: 'driving'|'walking'|'cycling'
   * @param {string} optimize - 优化目标: 'shortest'|'fastest'
   * @returns {{ path: number[], distance: number, time: number, steps: object[] }}
   */
  findPath(startId, endId, mode = 'driving', optimize = 'fastest') {
    if (startId === endId) {
      return { path: [startId], distance: 0, time: 0, steps: [] };
    }

    const endNode = this.graph.getNode(endId);
    const openSet = new Set();
    const closedSet = new Set();
    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();   // id -> { parent, edge }
    const h = this._heuristic.bind(this, endNode);

    gScore.set(startId, 0);
    fScore.set(startId, h(startId));
    openSet.add(startId);
    cameFrom.set(startId, { parent: null, edge: null });

    let iterations = 0;
    const maxIter = 100000;

    while (openSet.size > 0 && iterations++ < maxIter) {
      // Find node with minimum f score
      let currentId = null;
      let currentF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id) || Infinity;
        if (f < currentF) {
          currentF = f;
          currentId = id;
        }
      }

      if (currentId === endId) {
        return this._reconstructPath(cameFrom, currentId, mode);
      }

      openSet.delete(currentId);
      closedSet.add(currentId);

      // Explore neighbors
      for (const edge of this.graph.getNeighbors(currentId)) {
        if (closedSet.has(edge.to)) continue;

        // Check mode compatibility
        if (!this._edgeCompatible(edge, mode)) continue;

        const edgeWeight = this._calcWeight(edge, mode, optimize);
        const tentativeG = (gScore.get(currentId) || 0) + edgeWeight;

        const existingG = gScore.get(edge.to);
        if (existingG === undefined || tentativeG < existingG) {
          cameFrom.set(edge.to, { parent: currentId, edge });
          gScore.set(edge.to, tentativeG);
          fScore.set(edge.to, tentativeG + h(edge.to));
          openSet.add(edge.to);
        }
      }
    }

    return null; // No path found
  }

  /**
   * 多途经点路径规划
   * 使用贪心最近邻 + 2-opt 优化
   */
  findPathMultiWaypoint(waypointIds, mode = 'driving', optimize = 'fastest') {
    if (waypointIds.length < 2) return null;

    // Fix start and end, optimize middle waypoints
    const startId = waypointIds[0];
    const endId = waypointIds[waypointIds.length - 1];
    const middleIds = waypointIds.slice(1, -1);

    let bestOrder;
    if (middleIds.length <= 1) {
      bestOrder = [...middleIds];
    } else {
      bestOrder = this._optimizeWaypointOrder(startId, endId, middleIds, mode, optimize);
    }

    const orderedIds = [startId, ...bestOrder, endId];

    // Calculate path segments between consecutive waypoints
    let totalDistance = 0;
    let totalTime = 0;
    let fullPath = [];
    let allSteps = [];

    for (let i = 0; i < orderedIds.length - 1; i++) {
      const result = this.findPath(orderedIds[i], orderedIds[i + 1], mode, optimize);
      if (!result) return null;

      totalDistance += result.distance;
      totalTime += result.time;

      if (i === 0) {
        fullPath = [...result.path];
      } else {
        fullPath = [...fullPath, ...result.path.slice(1)];
      }

      allSteps.push(...result.steps);
    }

    return {
      path: fullPath,
      distance: totalDistance,
      time: totalTime,
      steps: allSteps,
      waypointOrder: orderedIds
    };
  }

  /**
   * 2-opt 途经点优化
   */
  _optimizeWaypointOrder(startId, endId, middleIds, mode, optimize) {
    if (middleIds.length <= 1) return [...middleIds];

    // Pre-compute distance matrix between all waypoints
    const allPoints = [startId, ...middleIds, endId];
    const distMatrix = new Map();

    for (let i = 0; i < allPoints.length; i++) {
      for (let j = i + 1; j < allPoints.length; j++) {
        const result = this.findPath(allPoints[i], allPoints[j], mode, optimize);
        const dist = result ? result.distance : Infinity;
        distMatrix.set(`${i}-${j}`, dist);
        distMatrix.set(`${j}-${i}`, dist);
      }
    }

    // Greedy nearest-neighbor initial solution
    let order = this._greedyNN(startId, endId, middleIds, distMatrix, allPoints);

    // 2-opt improvement (limited iterations)
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 50) {
      improved = false;
      iterations++;

      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const newOrder = [...order];
          [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];

          if (this._routeCost(startId, endId, newOrder, distMatrix, allPoints) <
              this._routeCost(startId, endId, order, distMatrix, allPoints)) {
            order = newOrder;
            improved = true;
          }
        }
      }
    }

    return order.map(idx => middleIds[idx]);
  }

  _greedyNN(startId, endId, middleIds, distMatrix, allPoints) {
    const n = middleIds.length;
    const visited = new Set();
    const order = [];
    let current = 0; // startId index

    while (order.length < n) {
      let nearest = -1;
      let nearestDist = Infinity;

      for (let i = 0; i < n; i++) {
        if (visited.has(i)) continue;
        const midIdx = i + 1; // offset in allPoints
        const d = distMatrix.get(`${current}-${midIdx}`) || Infinity;
        if (d < nearestDist) {
          nearestDist = d;
          nearest = i;
        }
      }

      if (nearest === -1) break;
      visited.add(nearest);
      order.push(nearest);
      current = nearest + 1;
    }

    return order;
  }

  _routeCost(startId, endId, order, distMatrix, allPoints) {
    let cost = 0;
    let prev = 0;
    for (const idx of order) {
      const midIdx = idx + 1;
      cost += distMatrix.get(`${prev}-${midIdx}`) || Infinity;
      prev = midIdx;
    }
    cost += distMatrix.get(`${prev}-${allPoints.length - 1}`) || Infinity;
    return cost;
  }

  /**
   * 启发函数 - 欧氏距离估计
   */
  _heuristic(endNode, nodeId) {
    const node = this.graph.getNode(nodeId);
    if (!node || !endNode) return 0;

    const R = 6371;
    const dLat = (endNode.lat - node.lat) * Math.PI / 180;
    const dLng = (endNode.lng - node.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(node.lat * Math.PI / 180) * Math.cos(endNode.lat * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * 计算边权重
   */
  _calcWeight(edge, mode, optimize) {
    if (optimize === 'shortest') {
      return edge.distance; // km
    }
    // fastest: time-based weight
    const speed = this._getSpeed(edge, mode); // km/h
    return speed > 0 ? edge.distance / speed : edge.distance; // hours
  }

  /**
   * 获取边在指定模式下的速度
   */
  _getSpeed(edge, mode) {
    const modeSpeeds = {
      walking: 5,
      cycling: 15,
      driving: edge.speed || 50
    };
    return modeSpeeds[mode] || 50;
  }

  /**
   * 检查边是否兼容指定出行模式
   */
  _edgeCompatible(edge, mode) {
    if (!edge.mode) return true; // No mode restriction
    const modeMap = {
      driving: ['driving', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential'],
      walking: ['walking', 'footway', 'pedestrian', 'path', 'driving', 'residential', 'secondary', 'primary', 'trunk', 'tertiary'],
      cycling: ['cycling', 'cycleway', 'driving', 'residential', 'secondary', 'tertiary', 'primary', 'trunk']
    };
    const allowed = modeMap[mode] || ['driving'];
    return allowed.includes(edge.mode);
  }

  /**
   * 路径重建
   */
  _reconstructPath(cameFrom, endId, mode) {
    const path = [];
    const steps = [];
    let currentId = endId;
    let totalDistance = 0;
    let totalTime = 0;

    while (currentId !== null) {
      const record = cameFrom.get(currentId);
      if (!record && currentId !== endId) break;

      path.unshift(currentId);

      if (record && record.edge) {
        totalDistance += record.edge.distance;
        const speed = this._getSpeed(record.edge, mode);
        totalTime += record.edge.distance / speed;
        steps.unshift({
          from: record.parent,
          to: currentId,
          distance: record.edge.distance,
          name: record.edge.name || '未命名道路',
          speed: speed
        });
      }

      currentId = record ? record.parent : null;
    }

    return {
      path,
      distance: Math.round(totalDistance * 100) / 100,
      time: Math.round(totalTime * 60 * 10) / 10,
      steps
    };
  }
}


  return Pathfinder;
});


// === map-matcher.js (UMD) ===
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require(./graph));
  } else {
    root.MapMatcher = factory(root.Graph);
  }
})(typeof self !== 'undefined' ? self : this, function(Graph) {
  'use strict';
/**
 * MapMatcher - 模式差异化地图匹配引擎
 * 支持驾车、步行、骑行三种模式的差异化匹配策略
 * 包含点到边投影、道路类型权重排序、虚拟节点插入
 */
;

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


  return MapMatcher;
});


// === database.js (UMD) ===
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require(./graph));
  } else {
    root.MapDatabase = factory(root.Graph);
  }
})(typeof self !== 'undefined' ? self : this, function(Graph) {
  'use strict';
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
    ;
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


  return MapDatabase;
});


/**
 * Pathfinder - 路径规划引擎
 * 实现 Dijkstra 和 A* 算法，支持多途经点和多模态
 */
const Graph = require('./graph');

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
        return this._reconstructPath(cameFrom, currentId);
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
  _reconstructPath(cameFrom, endId) {
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
        const speed = record.edge.speed || 50;
        totalTime += record.edge.distance / speed;
        steps.unshift({
          from: record.parent,
          to: currentId,
          distance: record.edge.distance,
          name: record.edge.name || '未命名道路',
          speed: record.edge.speed || 50
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

module.exports = Pathfinder;

import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import { analyzeSchema } from "./parser";

const NODE_WIDTH = 280;
const NODE_HEIGHT = 180;
const GRID_X = 340;
const GRID_Y = 240;
const START_X = 80;
const START_Y = 80;

export type NodePositionMap = Record<string, { x: number; y: number }>;

function buildRawNodesFromTables(
  tables: ReturnType<typeof analyzeSchema>["tables"],
): Node[] {
  return tables.map((table) => ({
    id: table.name,
    type: "tableNode",
    position: { x: 0, y: 0 },
    data: {
      label: table.name,
      fields: table.fields,
    },
    draggable: true,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));
}

function buildRawEdgesFromTables(
  tables: ReturnType<typeof analyzeSchema>["tables"],
  positionedNodes: Node[],
): Edge[] {
  const edges: Edge[] = [];
  const nodeMap = new Map(positionedNodes.map((node) => [node.id, node]));
  const tableMap = new Map(tables.map((table) => [table.name, table]));

  tables.forEach((table) => {
    table.fields.forEach((field) => {
      if (!field.reference) return;

      const targetTable = tableMap.get(field.reference.table);
      if (!targetTable) return;

      const sourceNode = nodeMap.get(table.name);
      const targetNode = nodeMap.get(targetTable.name);
      if (!sourceNode || !targetNode) return;

      const sourceCenterX = sourceNode.position.x + NODE_WIDTH / 2;
      const targetCenterX = targetNode.position.x + NODE_WIDTH / 2;
      const sourceIsLeftOfTarget = sourceCenterX < targetCenterX;

      edges.push({
        id: `${table.name}-${field.name}-${field.reference.table}-${field.reference.field}`,
        source: table.name,
        target: targetTable.name,
        sourceHandle: sourceIsLeftOfTarget
          ? `source-right-${field.name}`
          : `source-left-${field.name}`,
        targetHandle: sourceIsLeftOfTarget
          ? `target-left-${field.reference.field}`
          : `target-right-${field.reference.field}`,
        type: "bezier",
        style: {
          stroke: "#3b82f6",
          strokeWidth: 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color: "#3b82f6",
        },
      });
    });
  });

  return edges;
}

export function buildRawNodes(text: string): Node[] {
  return buildRawNodesFromTables(analyzeSchema(text).tables);
}

export function buildRawEdges(text: string, positionedNodes: Node[]): Edge[] {
  return buildRawEdgesFromTables(analyzeSchema(text).tables, positionedNodes);
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  padding = 32,
) {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

function findFreePosition(existingNodes: Node[]) {
  const occupied = existingNodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));

  for (let row = 0; row < 100; row += 1) {
    for (let col = 0; col < 100; col += 1) {
      const candidate = {
        x: START_X + col * GRID_X,
        y: START_Y + row * GRID_Y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };

      const collides = occupied.some((box) => rectsOverlap(candidate, box));
      if (!collides) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  return {
    x: START_X,
    y: START_Y,
  };
}

export function hydrateNodePositions(
  nodes: Node[],
  persistedPositions: NodePositionMap,
): Node[] {
  return nodes.map((node) => {
    const persisted = persistedPositions[node.id];
    if (!persisted) return node;

    return {
      ...node,
      position: persisted,
    };
  });
}

export function mergeNodesPreservingPositions(
  prevNodes: Node[],
  nextRawNodes: Node[],
  persistedPositions: NodePositionMap,
): Node[] {
  const prevMap = new Map(prevNodes.map((node) => [node.id, node]));
  const merged: Node[] = [];

  for (const rawNode of nextRawNodes) {
    const existing = prevMap.get(rawNode.id);

    if (existing) {
      merged.push({
        ...rawNode,
        position: existing.position,
        selected: existing.selected,
        dragging: false,
      });
      continue;
    }

    const persisted = persistedPositions[rawNode.id];
    if (persisted) {
      merged.push({
        ...rawNode,
        position: persisted,
      });
      continue;
    }

    merged.push({
      ...rawNode,
      position: findFreePosition(merged),
    });
  }

  return merged;
}

export function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  const graph = new dagre.graphlib.Graph();

  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 48,
    ranksep: 96,
    marginx: 24,
    marginy: 24,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  const layoutedNodes = nodes.map((node) => {
    const positioned = graph.node(node.id);

    return {
      ...node,
      position: {
        x: positioned.x - NODE_WIDTH / 2,
        y: positioned.y - NODE_HEIGHT / 2,
      },
    };
  });

  return {
    nodes: layoutedNodes,
    edges,
  };
}

export function buildInitialGraph(
  text: string,
  persistedPositions: NodePositionMap,
) {
  const analysis = analyzeSchema(text);
  const rawNodes = buildRawNodesFromTables(analysis.tables);
  const rawEdges = buildRawEdgesFromTables(analysis.tables, rawNodes);

  const layoutedNodes = getLayoutedElements(rawNodes, rawEdges).nodes;
  const hydratedNodes = hydrateNodePositions(layoutedNodes, persistedPositions);
  const hydratedEdges = buildRawEdgesFromTables(analysis.tables, hydratedNodes);

  return {
    nodes: hydratedNodes,
    edges: hydratedEdges,
  };
}

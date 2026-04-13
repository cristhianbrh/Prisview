import dagre from "@dagrejs/dagre";
import { useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import TableNode from "./TableNode";
import { parseSchema, validateSchema } from "./parser";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { linter, lintGutter } from "@codemirror/lint";
import { autocompletion } from "@codemirror/autocomplete";

const initialText = `User
  id int pk
  name string
  email string

Post
  id int pk
  title string
  userId int ref User.id

Comment
  id int pk
  body string
  postId int ref Post.id
  userId int ref User.id`;

const nodeTypes = {
  tableNode: TableNode,
};

const NODE_WIDTH = 280;
const NODE_HEIGHT = 180;
const GRID_X = 340;
const GRID_Y = 240;
const START_X = 80;
const START_Y = 80;

function buildRawNodes(text: string): Node[] {
  const tables = parseSchema(text);

  return tables.map((table) => ({
    id: table.name,
    type: "tableNode",
    position: { x: 0, y: 0 },
    data: {
      label: table.name,
      fields: table.fields,
    },
    draggable: true,
    sourcePosition: "right",
    targetPosition: "left",
  }));
}

function buildRawEdges(text: string, positionedNodes: Node[]): Edge[] {
  const tables = parseSchema(text);
  const edges: Edge[] = [];

  const nodeMap = new Map(positionedNodes.map((node) => [node.id, node]));

  tables.forEach((table) => {
    table.fields.forEach((field) => {
      if (!field.reference) return;

      const targetTable = tables.find(
        (candidate) => candidate.name === field.reference?.table,
      );

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
        // type: "smoothstep",
        type: "bezier",
        style: {
          stroke: "#3b82f6",
          strokeWidth: 1.5,
        },
        markerEnd: {
          type: "arrowclosed",
          width: 18,
          height: 18,
          color: "#3b82f6",
        },
      });
    });
  });

  return edges;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function mergeNodesPreservingPositions(
  prevNodes: Node[],
  nextRawNodes: Node[],
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

    const position = findFreePosition(merged);

    merged.push({
      ...rawNode,
      position,
    });
  }

  return merged;
}

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
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

const staticSchemaKeywords = [
  { label: "pk", type: "keyword" as const },
  { label: "not null", type: "keyword" as const },
  { label: "null", type: "keyword" as const },
  { label: "unique", type: "keyword" as const },
  { label: "default", type: "keyword" as const },
  { label: "ref", type: "keyword" as const },
  { label: "autoincrement", type: "keyword" as const },

  { label: "int", type: "type" as const },
  { label: "integer", type: "type" as const },
  { label: "string", type: "type" as const },
  { label: "text", type: "type" as const },
  { label: "boolean", type: "type" as const },
  { label: "bool", type: "type" as const },
  { label: "date", type: "type" as const },
  { label: "datetime", type: "type" as const },
  { label: "float", type: "type" as const },
  { label: "uuid", type: "type" as const },
];

function schemaCompletionSource(context: any) {
  const word = context.matchBefore(/[A-Za-z_][\w.]*/);
  const doc = context.state.doc.toString();
  const tables = parseSchema(doc);

  if (!word && !context.explicit) {
    return null;
  }

  const from = word ? word.from : context.pos;
  const text = word ? word.text : "";

  const line = context.state.doc.lineAt(context.pos).text;
  const beforeCursor = line.slice(
    0,
    context.pos - context.state.doc.lineAt(context.pos).from,
  );

  // Caso 1: después de "ref " sugerir tablas
  if (/\bref\s+[A-Za-z_]*$/.test(beforeCursor)) {
    return {
      from,
      options: tables.map((table) => ({
        label: table.name,
        type: "class",
      })),
    };
  }

  // Caso 2: escribiendo "Tabla." sugerir campos de esa tabla
  const tableDotMatch = text.match(/^([A-Za-z_]\w*)\.$/);
  if (tableDotMatch) {
    const tableName = tableDotMatch[1];
    const table = tables.find((t) => t.name === tableName);

    if (!table) return null;

    return {
      from,
      options: table.fields.map((field) => ({
        label: `${tableName}.${field.name}`,
        type: "property",
      })),
      validFor: /^[A-Za-z_][\w.]*$/,
    };
  }

  // Caso 3: escribiendo "Tabla.id" filtrar campos de esa tabla
  const tableFieldMatch = text.match(/^([A-Za-z_]\w*)\.([\w]*)$/);
  if (tableFieldMatch) {
    const tableName = tableFieldMatch[1];
    const fieldPrefix = tableFieldMatch[2].toLowerCase();
    const table = tables.find((t) => t.name === tableName);

    if (!table) return null;

    return {
      from,
      options: table.fields
        .filter((field) => field.name.toLowerCase().startsWith(fieldPrefix))
        .map((field) => ({
          label: `${tableName}.${field.name}`,
          type: "property",
        })),
      validFor: /^[A-Za-z_][\w.]*$/,
    };
  }

  // Caso 4: sugerencias generales, incluyendo nombres de tablas
  const tableOptions = tables.map((table) => ({
    label: table.name,
    type: "class" as const,
  }));

  return {
    from,
    options: [...staticSchemaKeywords, ...tableOptions],
    validFor: /^[A-Za-z_]\w*$/,
  };
}

function buildInitialGraph(text: string) {
  const rawNodes = buildRawNodes(text);
  const layoutedNodes = getLayoutedElements(rawNodes, []).nodes;
  const rawEdges = buildRawEdges(text, layoutedNodes);

  return {
    nodes: layoutedNodes,
    edges: rawEdges,
  };
}

type SqlDialect = "postgres" | "mysql" | "sqlite";

function mapFieldTypeToSQL(type: string, dialect: SqlDialect = "postgres") {
  const normalized = type.toLowerCase();

  switch (normalized) {
    case "int":
    case "integer":
      return "INTEGER";
    case "string":
      return dialect === "mysql" ? "VARCHAR(255)" : "TEXT";
    case "text":
      return "TEXT";
    case "boolean":
    case "bool":
      return dialect === "sqlite" ? "INTEGER" : "BOOLEAN";
    case "date":
      return "DATE";
    case "datetime":
      if (dialect === "mysql") return "DATETIME";
      if (dialect === "sqlite") return "TEXT";
      return "TIMESTAMP";
    case "float":
      return dialect === "postgres" ? "REAL" : "FLOAT";
    case "uuid":
      if (dialect === "mysql") return "CHAR(36)";
      if (dialect === "sqlite") return "TEXT";
      return "UUID";
    default:
      return type.toUpperCase();
  }
}

function formatDefaultValue(
  value: string | number | boolean | null | undefined,
  dialect: SqlDialect = "postgres",
) {
  if (value === undefined) return null;
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);

  if (typeof value === "boolean") {
    if (dialect === "sqlite") return value ? "1" : "0";
    return value ? "TRUE" : "FALSE";
  }

  const raw = String(value).trim();

  if (raw.toLowerCase() === "now") {
    if (dialect === "sqlite") return "CURRENT_TIMESTAMP";
    return "CURRENT_TIMESTAMP";
  }

  if (raw.toLowerCase() === "true") {
    return dialect === "sqlite" ? "1" : "TRUE";
  }

  if (raw.toLowerCase() === "false") {
    return dialect === "sqlite" ? "0" : "FALSE";
  }

  if (raw.toLowerCase() === "uuid_generate_v4()") {
    return dialect === "postgres" ? raw : `'${raw}'`;
  }

  return `'${raw.replace(/'/g, "''")}'`;
}

function quoteIdentifier(name: string, dialect: SqlDialect = "postgres") {
  if (dialect === "mysql") return `\`${name}\``;
  return `"${name}"`;
}

function generateSQLFromText(text: string, dialect: SqlDialect = "postgres") {
  const tables = parseSchema(text);

  return tables
    .map((table) => {
      const lines: string[] = [];

      for (const field of table.fields) {
        const columnName = quoteIdentifier(field.name, dialect);

        const isSQLiteAutoPk =
          dialect === "sqlite" &&
          field.isPrimary &&
          field.isAutoIncrement &&
          ["int", "integer"].includes(field.type.toLowerCase());

        let sqlType = mapFieldTypeToSQL(field.type, dialect);

        if (field.isAutoIncrement) {
          if (dialect === "postgres") {
            sqlType = "SERIAL";
          } else if (dialect === "mysql") {
            sqlType = "INT";
          } else if (isSQLiteAutoPk) {
            sqlType = "INTEGER";
          }
        }

        if (isSQLiteAutoPk) {
          lines.push(`  ${columnName} INTEGER PRIMARY KEY AUTOINCREMENT`);
          continue;
        }

        const parts = [`  ${columnName}`, sqlType];

        if (field.isPrimary) parts.push("PRIMARY KEY");
        if (field.isUnique && !field.isPrimary) parts.push("UNIQUE");
        if (field.isNullable === false) parts.push("NOT NULL");
        if (field.isNullable === true && !field.isPrimary) parts.push("NULL");

        if (field.isAutoIncrement && dialect === "mysql") {
          parts.push("AUTO_INCREMENT");
        }

        const formattedDefault = formatDefaultValue(
          field.defaultValue,
          dialect,
        );
        if (formattedDefault !== null && !field.isAutoIncrement) {
          parts.push(`DEFAULT ${formattedDefault}`);
        }

        lines.push(parts.join(" "));
      }

      for (const field of table.fields) {
        if (!field.reference) continue;

        lines.push(
          `  FOREIGN KEY (${quoteIdentifier(field.name, dialect)}) REFERENCES ${quoteIdentifier(field.reference.table, dialect)}(${quoteIdentifier(field.reference.field, dialect)})`,
        );
      }

      return `CREATE TABLE ${quoteIdentifier(table.name, dialect)} (\n${lines.join(",\n")}\n);`;
    })
    .join("\n\n");
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/sql;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

function ERDBoardInner() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [sqlDialect, setSqlDialect] = useState<SqlDialect>("postgres");
  const [debouncedText, setDebouncedText] = useState(initialText);
  const [showSqlPreview, setShowSqlPreview] = useState(false);
  const [schemaText, setSchemaText] = useState(initialText);
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const [sqlPreview, setSqlPreview] = useState("");
  const [schemaErrors, setSchemaErrors] = useState<
    Array<{ line?: number; message: string }>
  >([]);

  const initialGraphRef = useRef(buildInitialGraph(initialText));

  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialGraphRef.current.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialGraphRef.current.edges,
  );

  const downloadSQL = () => {
    if (!sqlPreview) return;

    const extension =
      sqlDialect === "postgres" ? "postgres.sql" : `${sqlDialect}.sql`;

    downloadTextFile(sqlPreview, `schema.${extension}`);
  };

  const schemaLinter = linter((view) => {
    const text = view.state.doc.toString();
    const tables = parseSchema(text);
    const validation = validateSchema(tables, text);

    return validation.errors
      .filter((error) => typeof error.line === "number")
      .map((error) => {
        const line = view.state.doc.line(error.line!);

        return {
          from: line.from,
          to: line.to,
          severity: "error",
          message: error.message,
        };
      });
  });

  const schemaAutocomplete = autocompletion({
    override: [schemaCompletionSource],
  });

  const editorExtensions = [
    EditorView.lineWrapping,
    lintGutter(),
    schemaLinter,
    schemaAutocomplete,
    EditorView.theme({
      "&": {
        height: "100%",
        minHeight: "0",
        backgroundColor: "#020617",
        color: "#e2e8f0",
        fontSize: "14px",
      },
      ".cm-editor": {
        height: "100%",
        minHeight: "0",
      },
      ".cm-scroller": {
        overflow: "auto",
      },
      //   ".cm-scroller": {
      //     fontFamily:
      //       'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      //     lineHeight: "1.5rem",
      //   },
      ".cm-gutters": {
        backgroundColor: "#0f172a",
        color: "#64748b",
        borderRight: "1px solid #1e293b",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "#94a3b8",
      },
      ".cm-content": {
        padding: "16px",
        minHeight: "100%",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-line": {
        padding: 0,
      },
      ".cm-diagnostic": {
        fontSize: "12px",
      },
    }),
  ];

  const exportSQL = async () => {
    const tables = parseSchema(schemaText);
    const validation = validateSchema(tables, schemaText);

    if (!validation.valid) {
      setSchemaErrors(
        validation.errors.map((error) => ({
          line: error.line,
          message: error.message,
        })),
      );
      setSqlPreview("");
      setShowSqlPreview(false);
      return;
    }

    setSchemaErrors([]);

    const sql = generateSQLFromText(schemaText, sqlDialect);
    setSqlPreview(sql);
    setShowSqlPreview(true);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedText(schemaText);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [schemaText]);

  useEffect(() => {
    const nextRawNodes = buildRawNodes(debouncedText);

    setNodes((prevNodes) => {
      const mergedNodes = mergeNodesPreservingPositions(
        prevNodes,
        nextRawNodes,
      );
      const nextEdges = buildRawEdges(debouncedText, mergedNodes);
      setEdges(nextEdges);
      return mergedNodes;
    });
  }, [debouncedText, setNodes, setEdges]);

  useEffect(() => {
    if (!showSqlPreview) return;

    const tables = parseSchema(schemaText);
    const validation = validateSchema(tables, schemaText);

    if (!validation.valid) {
      setSqlPreview("");
      return;
    }

    setSqlPreview(generateSQLFromText(schemaText, sqlDialect));
  }, [schemaText, sqlDialect, showSqlPreview]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const nextWidth = ((event.clientX - rect.left) / rect.width) * 100;

      setLeftPanelWidth(clamp(nextWidth, 25, 75));
    };

    const handlePointerUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  useEffect(() => {
    setEdges(buildRawEdges(debouncedText, nodes));
  }, [nodes, debouncedText, setEdges]);

  const clearAll = () => {
    setSchemaText("");
    setDebouncedText("");
    setNodes([]);
    setEdges([]);
  };

  const autoLayout = () => {
    setNodes((prevNodes) => {
      const layoutedNodes = getLayoutedElements(prevNodes, edges).nodes;
      const nextEdges = buildRawEdges(debouncedText, layoutedNodes);
      setEdges(nextEdges);
      return layoutedNodes;
    });
  };

  const handleResizeStart = () => {
    setIsResizing(true);
  };

  return (
    <div
      ref={containerRef}
      className="flex h-screen w-full overflow-hidden bg-slate-950 text-slate-100"
    >
      <section
        className="flex h-full min-w-[320px] flex-col bg-slate-900"
        style={{ width: `${leftPanelWidth}%` }}
      >
        <div className="border-b border-slate-800 px-4 py-3">
          <h1 className="text-sm font-semibold text-slate-100">
            Schema Editor
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Las tablas movidas conservan su posición. Las nuevas se colocan
            solas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500">
            <button
              onClick={exportSQL}
              className="text-slate-200 hover:text-blue-400"
            >
              Ver SQL
            </button>

            <span className="text-slate-500">|</span>

            <select
              value={sqlDialect}
              onChange={(e) => setSqlDialect(e.target.value as SqlDialect)}
              className="bg-transparent text-blue-400 outline-none"
            >
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
              <option value="sqlite">SQLite</option>
            </select>
          </div>

          <button
            onClick={clearAll}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-400"
          >
            Limpiar
          </button>

          <button
            onClick={autoLayout}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-400"
          >
            Auto ordenar
          </button>

          <button className="rounded-lg border border-blue-500 bg-blue-500/10 px-3 py-2 text-xs text-blue-400 transition hover:bg-blue-500/20">
            Copiar Imagen
          </button>
        </div>
        {schemaErrors.length > 0 ? (
          <div className="border-b border-red-900/40 bg-red-950/40 px-4 py-3">
            <p className="mb-2 text-xs font-medium text-red-300">
              Corrige estos errores antes de exportar:
            </p>
            <ul className="space-y-1 text-xs text-red-200">
              {schemaErrors.map((error, index) => (
                <li key={`${error.message}-${index}`}>
                  • {error.line ? `Línea ${error.line}: ` : ""}
                  {error.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {showSqlPreview && sqlPreview ? (
          <div className="border-b border-slate-800 bg-slate-950/80">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <h2 className="text-xs font-medium text-slate-200">
                  Preview SQL
                </h2>
                <p className="mt-1 text-[11px] text-slate-400">
                  Dialecto: {sqlDialect}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={downloadSQL}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-400"
                >
                  Descargar .sql
                </button>

                <button
                  onClick={() => setShowSqlPreview(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-red-500 hover:text-red-400"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="max-h-72 overflow-auto p-4">
              <pre className="whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs leading-6 text-slate-200">
                <code>{sqlPreview}</code>
              </pre>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 p-4">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
            <CodeMirror
              value={schemaText}
              theme="dark"
              basicSetup={{
                foldGutter: false,
                dropCursor: false,
                allowMultipleSelections: false,
                indentOnInput: false,
                lineNumbers: true,
                autocompletion: true,
              }}
              extensions={editorExtensions}
              onChange={(value) => setSchemaText(value)}
              className="h-full min-h-0 text-sm"
            />
          </div>
        </div>
      </section>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar paneles"
        onPointerDown={handleResizeStart}
        className="group relative w-2 cursor-col-resize bg-slate-900"
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 transition group-hover:bg-blue-500" />
      </div>

      <section className="h-full flex-1 bg-slate-950">
        <div className="h-full w-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap className="!bg-slate-900" pannable zoomable />
            <Controls className="!border !border-slate-700 !bg-slate-900" />
            <Background gap={24} size={1} />
          </ReactFlow>
        </div>
      </section>
    </div>
  );
}

export default function ERDBoard() {
  return (
    <ReactFlowProvider>
      <ERDBoardInner />
    </ReactFlowProvider>
  );
}

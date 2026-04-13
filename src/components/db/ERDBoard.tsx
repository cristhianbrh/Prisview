import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import CodeMirror from "@uiw/react-codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import TableNode from "./TableNode";
import { schemaCompletionSource } from "./autocomplete";
import {
  buildInitialGraph,
  buildRawEdges,
  buildRawNodes,
  getLayoutedElements,
  mergeNodesPreservingPositions,
  type NodePositionMap,
} from "./graph";
import { parseSchema, validateSchema } from "./parser";
import { generateSQLFromText, type SqlDialect } from "./sql";
import {
  getStoredJson,
  getStoredNumberInRange,
  getStoredString,
  removeStoredValues,
  setStoredValue,
} from "./storage";

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

const nodeTypes: NodeTypes = {
  tableNode: TableNode as NodeTypes[string],
};

const STORAGE_KEYS = {
  schemaText: "erd-builder:schemaText",
  sqlDialect: "erd-builder:sqlDialect",
  nodePositions: "erd-builder:nodePositions",
  viewport: "erd-builder:viewport",
  leftPanelWidth: "erd-builder:leftPanelWidth",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function getInitialDialect(): SqlDialect {
  const saved = getStoredString(STORAGE_KEYS.sqlDialect, "postgres");
  return saved === "postgres" || saved === "mysql" || saved === "sqlite"
    ? saved
    : "postgres";
}

function ERDBoardInner() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [schemaText, setSchemaText] = useState(() =>
    getStoredString(STORAGE_KEYS.schemaText, initialText),
  );

  const [debouncedText, setDebouncedText] = useState(() =>
    getStoredString(STORAGE_KEYS.schemaText, initialText),
  );

  const [sqlDialect, setSqlDialect] = useState<SqlDialect>(getInitialDialect);

  const { setViewport, getViewport } = useReactFlow();

  const [showSqlPreview, setShowSqlPreview] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [sqlPreview, setSqlPreview] = useState("");
  const [schemaErrors, setSchemaErrors] = useState<
    Array<{ line?: number; message: string }>
  >([]);

  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    getStoredNumberInRange(STORAGE_KEYS.leftPanelWidth, 50, 25, 75),
  );

  const persistedNodePositionsRef = useRef<NodePositionMap>(
    getStoredJson(STORAGE_KEYS.nodePositions, {}),
  );

  const initialGraphRef = useRef(
    buildInitialGraph(schemaText, persistedNodePositionsRef.current),
  );

  const nodesRef = useRef(initialGraphRef.current.nodes);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialGraphRef.current.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialGraphRef.current.edges,
  );

  const handleMoveEnd = () => {
    setStoredValue(STORAGE_KEYS.viewport, JSON.stringify(getViewport()));
  };

  const handleInit = () => {
    const viewport = getStoredJson<{
      x: number;
      y: number;
      zoom: number;
    } | null>(STORAGE_KEYS.viewport, null);

    if (viewport) {
      setViewport(viewport);
    }
  };

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    setStoredValue(STORAGE_KEYS.leftPanelWidth, String(leftPanelWidth));
  }, [leftPanelWidth]);

  useEffect(() => {
    setStoredValue(STORAGE_KEYS.schemaText, schemaText);
  }, [schemaText]);

  useEffect(() => {
    setStoredValue(STORAGE_KEYS.sqlDialect, sqlDialect);
  }, [sqlDialect]);

  useEffect(() => {
    const positions = Object.fromEntries(
      nodes.map((node) => [
        node.id,
        {
          x: node.position.x,
          y: node.position.y,
        },
      ]),
    );

    setStoredValue(STORAGE_KEYS.nodePositions, JSON.stringify(positions));
  }, [nodes]);

  const downloadSQL = () => {
    if (!sqlPreview) return;

    const extension =
      sqlDialect === "postgres" ? "postgres.sql" : `${sqlDialect}.sql`;

    downloadTextFile(sqlPreview, `schema.${extension}`);
  };

  const schemaLinter = useMemo(
    () =>
      linter((view) => {
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
              severity: "error" as const,
              message: error.message,
            };
          });
      }),
    [],
  );

  const schemaAutocomplete = useMemo(
    () =>
      autocompletion({
        override: [schemaCompletionSource],
      }),
    [],
  );

  const autocompleteTheme = EditorView.theme({
    ".cm-tooltip": {
      backgroundColor: "#020617",
      border: "1px solid #1e293b",
      borderRadius: "12px",
      padding: "4px",
    },
    ".cm-tooltip-autocomplete": {
      backgroundColor: "#020617",
    },
    ".cm-tooltip-autocomplete ul": {
      fontSize: "13px",
    },
    ".cm-tooltip-autocomplete li": {
      padding: "6px 10px",
      borderRadius: "8px",
      color: "#cbd5f5",
      cursor: "pointer",
    },
    ".cm-tooltip-autocomplete li[aria-selected]": {
      backgroundColor: "#1e293b",
      color: "#60a5fa",
    },
    ".cm-tooltip-autocomplete li:hover": {
      backgroundColor: "#1e293b",
    },
  });

  const editorExtensions = useMemo(
    () => [
      EditorView.lineWrapping,
      lintGutter(),
      schemaLinter,
      schemaAutocomplete,
      autocompleteTheme,
      EditorView.theme({
        "&": {
          height: "100%",
          minHeight: "0",
          //   backgroundColor: "#020617",
          backgroundColor: "transparent !important",

          color: "#e2e8f0",
          fontSize: "14px",
        },
        ".cm-editor": {
          height: "100%",
          minHeight: "0",
          backgroundColor: "transparent",
        },
        ".cm-scroller": {
          overflow: "auto",
        },
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
          backgroundColor: "transparent",
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
        "cm-activeLine": {
          backgroundColor: "#0f172a",
        },
      }),
    ],
    [schemaAutocomplete, schemaLinter],
  );

  const exportSQL = () => {
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
    setSqlPreview(generateSQLFromText(schemaText, sqlDialect));
    setShowSqlPreview(true);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedText(schemaText);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [schemaText]);

  useEffect(() => {
    const persistedPositions = getStoredJson<NodePositionMap>(
      STORAGE_KEYS.nodePositions,
      {},
    );

    const nextRawNodes = buildRawNodes(debouncedText);
    const mergedNodes = mergeNodesPreservingPositions(
      nodesRef.current,
      nextRawNodes,
      persistedPositions,
    );

    setNodes(mergedNodes);
  }, [debouncedText, setNodes]);

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
    setSchemaErrors([]);
    setSqlPreview("");
    setShowSqlPreview(false);
    setSqlDialect("postgres");
    setLeftPanelWidth(50);
    setViewport({ x: 0, y: 0, zoom: 1 });

    removeStoredValues([
      STORAGE_KEYS.schemaText,
      STORAGE_KEYS.sqlDialect,
      STORAGE_KEYS.nodePositions,
      STORAGE_KEYS.viewport,
      STORAGE_KEYS.leftPanelWidth,
    ]);
  };

  const autoLayout = () => {
    setNodes((prevNodes) => {
      const layoutedNodes = getLayoutedElements(prevNodes, edges).nodes;
      setEdges(buildRawEdges(debouncedText, layoutedNodes));
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
            Las tablas movidas conservan su posicion. Las nuevas se colocan
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
                  - {error.line ? `Linea ${error.line}: ` : ""}
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
            onMoveEnd={handleMoveEnd}
            proOptions={{ hideAttribution: true }}
            onInit={handleInit}
          >
            <MiniMap className="bg-slate-900!" pannable zoomable />
            <Controls className="border! border-slate-700! bg-slate-900!" />
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

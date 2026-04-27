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
import EnumNode from "./EnumNode";
import { schemaCompletionSource } from "./autocomplete";
import { convertOrmToDsl, type SupportedOrmType } from "./ormImport";
import {
  buildInitialGraph,
  buildRawEdges,
  buildRawNodes,
  getLayoutedElements,
  mergeNodesPreservingPositions,
  type NodePositionMap,
} from "./graph";
import { analyzeSchema } from "./schemaAnalysis";
import { generateSQLFromAnalysis, type SqlDialect } from "./sql";
import {
  getStoredJson,
  getStoredNumberInRange,
  getStoredString,
  removeStoredValues,
  setStoredValue,
} from "./storage";
import { toBlob } from "html-to-image";

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
  enumNode: EnumNode as NodeTypes[string],
};

const STORAGE_KEYS = {
  schemaText: "erd-builder:schemaText",
  sqlDialect: "erd-builder:sqlDialect",
  nodePositions: "erd-builder:nodePositions",
  viewport: "erd-builder:viewport",
  leftPanelWidth: "erd-builder:leftPanelWidth",
};

type PersistedViewport = {
  x: number;
  y: number;
  zoom: number;
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

async function copyBlobToClipboard(blob: Blob) {
  if (
    typeof window === "undefined" ||
    typeof ClipboardItem === "undefined" ||
    !navigator.clipboard?.write
  ) {
    throw new Error("Tu navegador no soporta copiar imágenes al portapapeles.");
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob,
    }),
  ]);
}

function ERDBoardInner() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const hasRestoredPanelWidthRef = useRef(false);
  const hasRestoredViewportRef = useRef(false);
  const isReactFlowReadyRef = useRef(false);

  const [schemaText, setSchemaText] = useState(() =>
    getStoredString(STORAGE_KEYS.schemaText, initialText),
  );

  const [debouncedText, setDebouncedText] = useState(() =>
    getStoredString(STORAGE_KEYS.schemaText, initialText),
  );

  const [sqlDialect, setSqlDialect] = useState<SqlDialect>(getInitialDialect);

  const { setViewport, getViewport } = useReactFlow();

  const [showSqlPreview, setShowSqlPreview] = useState(false);
  const [sqlPreview, setSqlPreview] = useState("");
  const [schemaErrors, setSchemaErrors] = useState<
    Array<{ line?: number; message: string }>
  >([]);

  const [leftPanelWidth, setLeftPanelWidth] = useState(50);

  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importMode, setImportMode] = useState<"text" | "file">("text");
  const [importOrmType, setImportOrmType] =
    useState<SupportedOrmType>("prisma");
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isCanvasLoading, setIsCanvasLoading] = useState(false);
  const isDraggingRef = useRef(false);
  const positionPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagramExportRef = useRef<HTMLDivElement | null>(null);
  const [isCopyingImage, setIsCopyingImage] = useState(false);

  const persistedNodePositionsRef = useRef<NodePositionMap>(
    getStoredJson(STORAGE_KEYS.nodePositions, {}),
  );

  const initialGraphRef = useRef(
    buildInitialGraph(schemaText, persistedNodePositionsRef.current),
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialGraphRef.current.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialGraphRef.current.edges,
  );

  const nodesRef = useRef(initialGraphRef.current.nodes);

  const schemaAnalysis = useMemo(() => analyzeSchema(schemaText), [schemaText]);
  const debouncedSchemaAnalysis = useMemo(
    () => analyzeSchema(debouncedText),
    [debouncedText],
  );

  const persistViewport = () => {
    if (!isReactFlowReadyRef.current) return;
    if (!hasRestoredViewportRef.current) return;

    setStoredValue(STORAGE_KEYS.viewport, JSON.stringify(getViewport()));
  };

  const handleMoveEnd = () => {
    persistViewport();
  };

  const handleInit = () => {
    isReactFlowReadyRef.current = true;

    const storedViewport = getStoredJson<PersistedViewport | null>(
      STORAGE_KEYS.viewport,
      null,
    );

    if (storedViewport) {
      setViewport(storedViewport);
    }

    hasRestoredViewportRef.current = true;
  };

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    const storedWidth = getStoredNumberInRange(
      STORAGE_KEYS.leftPanelWidth,
      50,
      25,
      75,
    );

    setLeftPanelWidth(storedWidth);
    hasRestoredPanelWidthRef.current = true;
  }, []);

  useEffect(() => {
    if (!hasRestoredPanelWidthRef.current) return;
    setStoredValue(STORAGE_KEYS.leftPanelWidth, String(leftPanelWidth));
  }, [leftPanelWidth]);

  useEffect(() => {
    setStoredValue(STORAGE_KEYS.schemaText, schemaText);
  }, [schemaText]);

  useEffect(() => {
    setStoredValue(STORAGE_KEYS.sqlDialect, sqlDialect);
  }, [sqlDialect]);

  useEffect(() => {
    if (positionPersistTimerRef.current !== null) {
      clearTimeout(positionPersistTimerRef.current);
    }

    positionPersistTimerRef.current = setTimeout(() => {
      const positions = Object.fromEntries(
        nodes.map((node) => [
          node.id,
          { x: node.position.x, y: node.position.y },
        ]),
      );
      setStoredValue(STORAGE_KEYS.nodePositions, JSON.stringify(positions));
    }, 400);
  }, [nodes]);

  const downloadSQL = () => {
    if (!sqlPreview) return;

    const extension =
      sqlDialect === "postgres" ? "postgres.sql" : `${sqlDialect}.sql`;

    downloadTextFile(sqlPreview, `schema.${extension}`);
  };

  const copyDiagramImage = async () => {
    const target = diagramExportRef.current;

    if (!target || isCopyingImage) return;

    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      typeof ClipboardItem === "undefined" ||
      !navigator.clipboard?.write
    ) {
      window.alert("Tu navegador no soporta copiar imágenes al portapapeles.");
      return;
    }

    setIsCopyingImage(true);

    try {
      const blob = await toBlob(target, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#020617",
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;

          // No copies UI auxiliar.
          if (node.classList.contains("react-flow__minimap")) return false;
          if (node.classList.contains("react-flow__controls")) return false;
          if (node.classList.contains("react-flow__panel")) return false;

          return true;
        },
      });

      if (!blob) {
        throw new Error("No se pudo generar la imagen.");
      }

      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
    } catch (error) {
      console.error(error);
      window.alert("No pude copiar la imagen del diagrama.");
    } finally {
      setIsCopyingImage(false);
    }
  };

  const schemaLinter = useMemo(
    () =>
      linter((view) => {
        const text = view.state.doc.toString();
        const analysis = analyzeSchema(text);

        return analysis.validation.errors
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

  const resetImportPanel = () => {
    setImportMode("text");
    setImportOrmType("prisma");
    setImportText("");
    setImportErrors([]);
    setImportWarnings([]);
    setIsImporting(false);
  };

  const openImportPanel = () => {
    resetImportPanel();
    setShowImportPanel(true);
  };

  const closeImportPanel = () => {
    setShowImportPanel(false);
    resetImportPanel();
  };

  const applyImportedSchema = (
    importedSchemaText: string,
    keepPanelOpen = false,
  ) => {
    const normalizedImported = importedSchemaText.trim();
    if (!normalizedImported) return;

    setIsCanvasLoading(true);

    setSchemaText((prev) => {
      const trimmedPrev = prev.trim();
      if (!trimmedPrev) return normalizedImported;
      return `${trimmedPrev}\n\n${normalizedImported}`;
    });

    setShowSqlPreview(false);
    setSqlPreview("");
    setSchemaErrors([]);

    if (!keepPanelOpen) closeImportPanel();
  };

  const handleImportSave = async () => {
    setImportErrors([]);
    setIsImporting(true);

    try {
      const result = convertOrmToDsl(importOrmType, importText);

      if (!result.success) {
        setImportErrors(result.errors);
        return;
      }

      const warnings = result.warnings ?? [];
      setImportWarnings(warnings);
      applyImportedSchema(result.schemaText, warnings.length > 0);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportErrors([]);
    setImportText("");
    setIsReadingFile(true);

    try {
      const text = await file.text();
      setImportText(text);
    } catch {
      setImportErrors(["No pude leer el archivo seleccionado."]);
    } finally {
      setIsReadingFile(false);
      event.target.value = "";
    }
  };

  const autocompleteTheme = useMemo(
    () =>
      EditorView.theme({
        ".cm-tooltip": {
          backgroundColor: "#020617",
          border: "1px solid #1e293b",
          borderRadius: "12px",
          padding: "4px",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
        },
        ".cm-tooltip-autocomplete": {
          backgroundColor: "#020617",
        },
        ".cm-tooltip-autocomplete ul": {
          fontSize: "13px",
          maxHeight: "240px",
        },
        ".cm-tooltip-autocomplete li": {
          padding: "6px 10px",
          borderRadius: "8px",
          color: "#cbd5e1",
        },
        ".cm-tooltip-autocomplete li[aria-selected]": {
          backgroundColor: "#1e293b",
          color: "#60a5fa",
        },
      }),
    [],
  );

  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        "&": {
          height: "100%",
          minHeight: "0",
          color: "#e2e8f0",
          fontSize: "14px",
          backgroundColor: "transparent !important",
        },
        "&.cm-editor": {
          height: "100%",
          minHeight: "0",
          backgroundColor: "transparent !important",
        },
        ".cm-scroller": {
          overflow: "auto",
          backgroundColor: "transparent !important",
        },
        ".cm-gutters": {
          backgroundColor: "#0f172a !important",
          color: "#64748b",
          borderRight: "1px solid #1e293b",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "transparent !important",
          color: "#94a3b8",
        },
        ".cm-content": {
          padding: "16px",
          minHeight: "100%",
          backgroundColor: "transparent !important",
        },
        "&.cm-focused": {
          outline: "none",
        },
        ".cm-line": {
          padding: "0",
        },
        ".cm-diagnostic": {
          fontSize: "12px",
        },
      }),
    [],
  );

  const editorExtensions = useMemo(
    () => [
      EditorView.lineWrapping,
      lintGutter(),
      schemaLinter,
      schemaAutocomplete,
      autocompleteTheme,
      editorTheme,
    ],
    [schemaAutocomplete, schemaLinter, autocompleteTheme, editorTheme],
  );

  const exportSQL = () => {
    if (!schemaAnalysis.validation.valid) {
      setSchemaErrors(
        schemaAnalysis.validation.errors.map((error) => ({
          line: error.line,
          message: error.message,
        })),
      );
      setSqlPreview("");
      setShowSqlPreview(false);
      return;
    }

    setSchemaErrors([]);
    setSqlPreview(generateSQLFromAnalysis(schemaAnalysis, sqlDialect));
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

    const nextRawNodes = buildRawNodes(debouncedSchemaAnalysis.text);
    const mergedNodes = mergeNodesPreservingPositions(
      nodesRef.current,
      nextRawNodes,
      persistedPositions,
    );

    setNodes(mergedNodes);
    setIsCanvasLoading(false);
  }, [debouncedSchemaAnalysis, setNodes]);

  useEffect(() => {
    if (isDraggingRef.current) return;
    setEdges(buildRawEdges(debouncedSchemaAnalysis.text, nodes));
  }, [nodes, debouncedSchemaAnalysis, setEdges]);

  const handleNodeDragStart = () => {
    isDraggingRef.current = true;
  };

  const handleNodeDragStop = () => {
    isDraggingRef.current = false;
    setEdges(buildRawEdges(debouncedSchemaAnalysis.text, nodesRef.current));
  };

  useEffect(() => {
    if (!showSqlPreview) return;

    if (!schemaAnalysis.validation.valid) {
      setSqlPreview("");
      return;
    }

    setSqlPreview(generateSQLFromAnalysis(schemaAnalysis, sqlDialect));
  }, [schemaAnalysis, sqlDialect, showSqlPreview]);

  const clearAll = () => {
    hasRestoredPanelWidthRef.current = true;
    hasRestoredViewportRef.current = true;

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
      return layoutedNodes;
    });
  };

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    const separator = event.currentTarget;
    const container = containerRef.current;

    if (!container) return;

    event.preventDefault();
    separator.setPointerCapture(event.pointerId);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const updateWidth = (clientX: number) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;

      const nextWidth = ((clientX - rect.left) / rect.width) * 100;
      setLeftPanelWidth(clamp(nextWidth, 25, 75));
    };

    updateWidth(event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateWidth(moveEvent.clientX);
    };

    const cleanup = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);

      try {
        if (separator.hasPointerCapture(event.pointerId)) {
          separator.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignorar errores de pointer capture.
      }
    };

    const handlePointerUp = () => {
      cleanup();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-screen w-full overflow-hidden bg-slate-950 text-slate-100"
    >
      <section
        className="flex h-full min-w-[320px] shrink-0 flex-col bg-slate-900"
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
            onClick={openImportPanel}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-400"
          >
            Importar
          </button>

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

          <button
            onClick={copyDiagramImage}
            disabled={isCopyingImage || nodes.length === 0}
            className="rounded-lg border border-blue-500 bg-blue-500/10 px-3 py-2 text-xs text-blue-400 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCopyingImage ? "Copiando..." : "Copiar Imagen"}
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
                  - {error.line ? `Línea ${error.line}: ` : ""}
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
              className="h-full min-h-0 bg-transparent text-sm [&_.cm-editor]:bg-transparent [&_.cm-scroller]:bg-transparent [&_.cm-content]:bg-transparent"
            />
          </div>
        </div>
      </section>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar paneles"
        onPointerDown={handleResizeStart}
        className="group relative w-2 shrink-0 cursor-col-resize touch-none bg-slate-900"
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 transition group-hover:bg-blue-500" />
      </div>

      <section className="relative h-full min-w-0 flex-1 bg-slate-950">
        {isCanvasLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
              <span className="text-xs text-slate-400">Construyendo diagrama…</span>
            </div>
          </div>
        ) : null}
        <div ref={diagramExportRef} className="h-full w-full bg-slate-950">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onMoveEnd={handleMoveEnd}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            proOptions={{ hideAttribution: true }}
            onInit={handleInit}
          >
            <MiniMap className="bg-slate-900!" pannable zoomable />
            <Controls className="border! border-slate-700! bg-slate-900!" />
            <Background gap={24} size={1} />
          </ReactFlow>
        </div>
      </section>
      {showImportPanel ? (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
          onClick={closeImportPanel}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-5">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Importar esquema ORM
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Pega un esquema o carga un archivo. Esta primera versión
                  soporta Prisma.
                </p>
              </div>

              <button
                onClick={closeImportPanel}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-red-500 hover:text-red-400"
              >
                Cerrar
              </button>
            </div>

            <div className="flex-1 overflow-auto px-6 py-5">
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={importMode === "text"}
                    onChange={() => setImportMode("text")}
                  />
                  Editor de texto
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={importMode === "file"}
                    onChange={() => setImportMode("file")}
                  />
                  Archivo
                </label>

                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm text-slate-400">Tipo ORM:</span>
                  <select
                    value={importOrmType}
                    onChange={(e) =>
                      setImportOrmType(e.target.value as SupportedOrmType)
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-blue-400 outline-none"
                  >
                    <option value="prisma">Prisma</option>
                  </select>
                </div>
              </div>

              {importMode === "file" ? (
                <div className="mb-5">
                  <label className="mb-2 block text-sm text-slate-400">
                    Selecciona un archivo ORM
                  </label>

                  <div className="relative">
                    <input
                      type="file"
                      accept=".prisma,.txt,.schema"
                      onChange={handleImportFileChange}
                      disabled={isReadingFile}
                      className="block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:text-slate-200 disabled:opacity-50"
                    />
                    {isReadingFile ? (
                      <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-slate-950/80">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
                        <span className="text-xs text-slate-400">Leyendo archivo…</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="mb-5">
                <label className="mb-2 block text-sm text-slate-400">
                  {importMode === "text"
                    ? "Pega aquí tu esquema ORM"
                    : "Contenido cargado del archivo"}
                </label>

                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={`model User {
  id Int @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id Int @id @default(autoincrement())
  title String
  userId Int
  user User @relation(fields: [userId], references: [id])
}`}
                  className="min-h-[300px] w-full resize-y rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-blue-500"
                />
              </div>

              {importErrors.length > 0 ? (
                <div className="rounded-2xl border border-red-900/40 bg-red-950/40 px-4 py-3">
                  <p className="mb-2 text-sm font-medium text-red-300">
                    No pude importar este esquema:
                  </p>
                  <ul className="space-y-1 text-sm text-red-200">
                    {importErrors.map((error, index) => (
                      <li key={`${error}-${index}`}>- {error}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importWarnings.length > 0 ? (
                <div className="rounded-2xl border border-yellow-900/40 bg-yellow-950/30 px-4 py-3">
                  <p className="mb-2 text-sm font-medium text-yellow-300">
                    Importado con advertencias:
                  </p>
                  <ul className="space-y-1 text-sm text-yellow-200">
                    {importWarnings.map((w, index) => (
                      <li key={`${w}-${index}`}>- {w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-6 py-4">
              <button
                onClick={closeImportPanel}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
              >
                Cancelar
              </button>

              <button
                onClick={handleImportSave}
                disabled={isImporting || !importText.trim()}
                className="rounded-lg border border-blue-500 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isImporting ? "Importando..." : "Convertir y agregar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import TableNode from "./TableNode";
import { parseSchema } from "./parser";

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

function buildNodesFromText(text: string): Node[] {
  const tables = parseSchema(text);

  return tables.map((table, index) => ({
    id: table.name,
    type: "tableNode",
    position: {
      x: 80 + (index % 3) * 340,
      y: 80 + Math.floor(index / 3) * 280,
    },
    data: {
      label: table.name,
      fields: table.fields,
    },
    draggable: true,
  }));
}

function buildEdgesFromText(text: string): Edge[] {
  const tables = parseSchema(text);
  const edges: Edge[] = [];

  tables.forEach((table) => {
    table.fields.forEach((field) => {
      if (!field.reference) return;

      const targetTable = tables.find(
        (candidate) => candidate.name === field.reference?.table,
      );

      if (!targetTable) return;

      edges.push({
        id: `${table.name}-${field.name}-${field.reference.table}-${field.reference.field}`,
        source: table.name,
        target: targetTable.name,
        label: `${field.name} → ${field.reference.table}.${field.reference.field}`,
        style: {
          stroke: "#3b82f6",
          strokeWidth: 1.5,
        },
        labelStyle: {
          fill: "#94a3b8",
          fontSize: 10,
        },
      });
    });
  });

  return edges;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function ERDBoardInner() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [schemaText, setSchemaText] = useState(initialText);
  const [debouncedText, setDebouncedText] = useState(initialText);
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedText(schemaText);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [schemaText]);

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

  const nodes = useMemo(
    () => buildNodesFromText(debouncedText),
    [debouncedText],
  );
  const edges = useMemo(
    () => buildEdgesFromText(debouncedText),
    [debouncedText],
  );

  const clearAll = () => {
    setSchemaText("");
    setDebouncedText("");
    textareaRef.current?.focus();
  };

  const handleResizeStart = () => {
    setIsResizing(true);
  };

  const handleTextareaKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const textarea = event.currentTarget;

    if (event.key !== "Tab") return;

    event.preventDefault();

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const indent = "  ";

    if (event.shiftKey) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const selectedText = value.slice(lineStart, end);
      const lines = selectedText.split("\n");

      const updatedLines = lines.map((line, index) => {
        const isFirstLine = index === 0;
        const effectiveLine = isFirstLine
          ? value.slice(lineStart, lineStart + lines[0].length)
          : line;

        if (effectiveLine.startsWith(indent))
          return effectiveLine.slice(indent.length);
        if (effectiveLine.startsWith("\t")) return effectiveLine.slice(1);
        if (effectiveLine.startsWith(" ")) return effectiveLine.slice(1);
        return effectiveLine;
      });

      const replacement = updatedLines.join("\n");
      const before = value.slice(0, lineStart);
      const after = value.slice(end);
      const nextValue = before + replacement + after;

      setSchemaText(nextValue);

      requestAnimationFrame(() => {
        const firstLineRemoved = lines[0]?.startsWith(indent)
          ? indent.length
          : lines[0]?.startsWith("\t")
            ? 1
            : lines[0]?.startsWith(" ")
              ? 1
              : 0;

        const removedTotal = lines.reduce((acc, line) => {
          if (line.startsWith(indent)) return acc + indent.length;
          if (line.startsWith("\t")) return acc + 1;
          if (line.startsWith(" ")) return acc + 1;
          return acc;
        }, 0);

        textarea.selectionStart = Math.max(lineStart, start - firstLineRemoved);
        textarea.selectionEnd = Math.max(lineStart, end - removedTotal);
      });

      return;
    }

    if (start !== end && value.slice(start, end).includes("\n")) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const selectedText = value.slice(lineStart, end);
      const lines = selectedText.split("\n");
      const updatedLines = lines.map((line) => `${indent}${line}`);
      const replacement = updatedLines.join("\n");

      const before = value.slice(0, lineStart);
      const after = value.slice(end);
      const nextValue = before + replacement + after;

      setSchemaText(nextValue);

      requestAnimationFrame(() => {
        textarea.selectionStart = start + indent.length;
        textarea.selectionEnd = end + indent.length * lines.length;
      });

      return;
    }

    const nextValue = value.slice(0, start) + indent + value.slice(end);
    setSchemaText(nextValue);

    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + indent.length;
    });
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
            Usa Tab para indentar y Shift+Tab para quitar indentación.
          </p>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <button className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-400">
            Exportar SQL
          </button>

          <button
            onClick={clearAll}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-400"
          >
            Limpiar
          </button>

          <button className="rounded-lg border border-blue-500 bg-blue-500/10 px-3 py-2 text-xs text-blue-400 transition hover:bg-blue-500/20">
            Copiar Imagen
          </button>
        </div>

        <div className="flex-1 p-4">
          <textarea
            ref={textareaRef}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            spellCheck={false}
            className="h-full w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500"
            placeholder={`User
  id int pk
  name string
  email string`}
          />
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

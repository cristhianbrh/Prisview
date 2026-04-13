import { useEffect, useMemo, useState } from "react";
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

const initialText = `User id int, name string, email string
Post id int, title string, userId int
Comment id int, body string, postId int, userId int`;

const nodeTypes = {
  tableNode: TableNode,
};

function buildNodesFromText(text: string): Node[] {
  const tables = parseSchema(text);

  return tables.map((table, index) => ({
    id: table.name,
    type: "tableNode",
    position: {
      x: 80 + (index % 3) * 320,
      y: 80 + Math.floor(index / 3) * 260,
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
      const fieldName = field.name.toLowerCase();

      if (!fieldName.endsWith("id") || fieldName === "id") {
        return;
      }

      const guessedTarget = field.name.replace(/Id$/i, "").toLowerCase();
      const targetTable = tables.find(
        (candidate) => candidate.name.toLowerCase() === guessedTarget,
      );

      if (!targetTable) {
        return;
      }

      edges.push({
        id: `${table.name}-${field.name}-${targetTable.name}`,
        source: table.name,
        target: targetTable.name,
        animated: false,
        style: { stroke: "#3b82f6", strokeWidth: 1.5 },
      });
    });
  });

  return edges;
}

function ERDBoardInner() {
  const [schemaText, setSchemaText] = useState(initialText);
  const [debouncedText, setDebouncedText] = useState(initialText);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedText(schemaText);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [schemaText]);

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
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-950 text-slate-100">
      <section className="flex h-full w-1/2 min-w-[320px] flex-col border-r border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-4 py-3">
          <h1 className="text-sm font-semibold text-slate-100">
            Schema Editor
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Sintaxis: Tabla campo tipo, campo tipo
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
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500"
            placeholder="User id int, name string, email string"
          />
        </div>
      </section>

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

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface TableNodeData {
  label: string;
  fields: Array<{
    name: string;
    type: string;
    isPrimary?: boolean;
    reference?: {
      table: string;
      field: string;
    };
  }>;
}

export default function TableNode({ data }: NodeProps<TableNodeData>) {
  return (
    <div className="relative min-w-[260px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl">
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-blue-300 !bg-blue-500"
      />

      <div className="border-b border-slate-700 bg-slate-900 px-4 py-3">
        <h3 className="text-sm font-semibold tracking-wide text-blue-400">
          {data.label}
        </h3>
      </div>

      <div className="divide-y divide-slate-700">
        {data.fields.map((field) => (
          <div
            key={`${data.label}-${field.name}`}
            className="flex items-center justify-between gap-4 px-4 py-2 text-xs text-slate-200"
          >
            <div className="flex min-w-0 items-center gap-2">
              {field.isPrimary ? (
                <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                  PK
                </span>
              ) : null}

              {field.reference ? (
                <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                  ∞→1
                </span>
              ) : null}

              <span className="truncate">{field.name}</span>
            </div>

            <span className="shrink-0 text-slate-400">{field.type}</span>
          </div>
        ))}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-blue-300 !bg-blue-500"
      />
    </div>
  );
}

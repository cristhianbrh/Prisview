import type { NodeProps } from "@xyflow/react";

interface TableNodeData {
  label: string;
  fields: Array<{
    name: string;
    type: string;
    isPrimary?: boolean;
  }>;
}

export default function TableNode({ data }: NodeProps<TableNodeData>) {
  return (
    <div className="min-w-[240px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl">
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
            <span className="flex items-center gap-2">
              {field.isPrimary ? (
                <span className="text-blue-500">PK</span>
              ) : null}
              <span>{field.name}</span>
            </span>

            <span className="text-slate-400">{field.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

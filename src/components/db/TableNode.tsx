import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { useEffect } from "react";

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

export default function TableNode({ id, data }: NodeProps<TableNodeData>) {
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    updateNodeInternals(id);
  }, [data.fields, id, updateNodeInternals]);

  return (
    <div className="relative min-w-[260px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl">
      <div className="border-b border-slate-700 bg-slate-900 px-4 py-3">
        <h3 className="text-sm font-semibold tracking-wide text-blue-400">
          {data.label}
        </h3>
      </div>

      <div className="divide-y divide-slate-700">
        {data.fields.map((field) => (
          <div
            key={`${data.label}-${field.name}`}
            className="relative flex items-center justify-between gap-4 px-4 py-2 text-xs text-slate-200"
          >
            <Handle
              type="target"
              position={Position.Left}
              id={`target-left-${field.name}`}
              className="!left-[-6px] !h-3 !w-3 !border-slate-200 !bg-slate-600"
              style={{ top: "50%", transform: "translateY(-50%)" }}
            />

            <Handle
              type="target"
              position={Position.Right}
              id={`target-right-${field.name}`}
              className="!right-[-6px] !h-3 !w-3 !border-slate-200 !bg-slate-600"
              style={{ top: "50%", transform: "translateY(-50%)" }}
            />

            {field.reference ? (
              <>
                <Handle
                  type="source"
                  position={Position.Left}
                  id={`source-left-${field.name}`}
                  className="!left-[-6px] !h-3 !w-3 !border-blue-300 !bg-blue-500"
                  style={{ top: "50%", transform: "translateY(-50%)" }}
                />

                <Handle
                  type="source"
                  position={Position.Right}
                  id={`source-right-${field.name}`}
                  className="!right-[-6px] !h-3 !w-3 !border-blue-300 !bg-blue-500"
                  style={{ top: "50%", transform: "translateY(-50%)" }}
                />
              </>
            ) : null}

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
    </div>
  );
}

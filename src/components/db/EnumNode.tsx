import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

interface EnumNodeData extends Record<string, unknown> {
  label: string;
  values: string[];
}

type EnumNodeType = Node<EnumNodeData, "enumNode">;

export default function EnumNode({ data }: NodeProps<EnumNodeType>) {
  return (
    <div className="relative min-w-44 overflow-hidden rounded-2xl border border-purple-700 bg-slate-800 shadow-2xl">
      <Handle
        type="target"
        position={Position.Left}
        id="enum-target-left"
        className="-left-1.5! h-3! w-3! border-purple-400! bg-purple-700!"
        style={{ top: "50%", transform: "translateY(-50%)" }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="enum-target-right"
        className="-right-1.5! h-3! w-3! border-purple-400! bg-purple-700!"
        style={{ top: "50%", transform: "translateY(-50%)" }}
      />

      <div className="border-b border-purple-800 bg-purple-950/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
            ENUM
          </span>
          <h3 className="text-sm font-semibold tracking-wide text-purple-300">
            {data.label}
          </h3>
        </div>
      </div>

      <div className="divide-y divide-slate-700/60">
        {data.values.map((value) => (
          <div
            key={value}
            className="px-4 py-1.5 text-xs text-slate-300"
          >
            {value}
          </div>
        ))}
      </div>
    </div>
  );
}

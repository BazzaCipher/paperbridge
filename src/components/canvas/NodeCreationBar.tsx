import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '../../store/canvasStore';
import { getCreatableTypes } from '../../core/nodes/nodeRegistry';
import { NodeIcon } from '../ui/NodeIcon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { LynkNodeData, LynkNodeType } from '../../types';

export function NodeCreationBar() {
  const addNode = useCanvasStore((state) => state.addNode);
  const { screenToFlowPosition } = useReactFlow();

  const handleAddNode = (type: LynkNodeType, data: LynkNodeData) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const position = screenToFlowPosition({
      x: centerX + (Math.random() - 0.5) * 100,
      y: centerY + (Math.random() - 0.5) * 100,
    });
    addNode(type, position, data);
  };

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10
                 flex items-center gap-1 bg-white/85 backdrop-blur-md
                 border border-paper-100 rounded-xl shadow-[0_2px_12px_rgba(16,42,67,0.06)]
                 px-1.5 py-1 max-w-[calc(100vw-4rem)] overflow-x-auto
                 animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
    >
      {getCreatableTypes().map((def) => (
        <Tooltip key={def.type}>
          <TooltipTrigger asChild>
            <Button
              variant="chip"
              size="sm"
              onClick={() => handleAddNode(def.type as LynkNodeType, def.defaultData as LynkNodeData)}
              className="touch-manipulation shrink-0"
            >
              <NodeIcon type={def.icon} />
              <span>{def.shortLabel || def.label}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Add {def.label}
            {def.description ? ` - ${def.description}` : ''}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

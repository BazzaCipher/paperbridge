import { Panel, useReactFlow, useStore } from '@xyflow/react';
import { Plus, Minus, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function CanvasZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);

  return (
    <Panel position="bottom-left">
      <div
        className="flex items-center gap-0.5 bg-white/85 backdrop-blur-md
                   border border-paper-100 rounded-xl shadow-[0_2px_12px_rgba(16,42,67,0.06)]
                   px-1 py-1 animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => zoomOut()}>
              <Minus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>

        <span className="text-[11px] tabular-nums text-bridge-500 w-10 text-center select-none">
          {Math.round(zoom * 100)}%
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => zoomIn()}>
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => fitView({ duration: 250, padding: 0.2 })}>
              <Maximize2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Fit view</TooltipContent>
        </Tooltip>
      </div>
    </Panel>
  );
}

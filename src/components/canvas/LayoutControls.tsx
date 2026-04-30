import { Panel } from '@xyflow/react';
import { Network, Grid3x3 } from 'lucide-react';
import { useCanvasStore } from '../../store/canvasStore';
import { useToast } from '../ui/Toast';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function LayoutControls() {
  const applyLayout = useCanvasStore((state) => state.applyLayout);
  const pushHistory = useCanvasStore((state) => state.pushHistory);
  const nodes = useCanvasStore((state) => state.nodes);
  const { showToast } = useToast();

  const handleLayout = (type: 'tree' | 'grid') => {
    if (nodes.length === 0) {
      showToast('No nodes to layout', 'warning');
      return;
    }
    pushHistory();
    applyLayout(type);
    showToast(`Applied ${type} layout`, 'info');
  };

  return (
    <Panel position="bottom-left" className="!left-[14rem]">
      <div
        className="flex items-center gap-0.5 bg-white/85 backdrop-blur-md
                   border border-paper-100 rounded-xl shadow-[0_2px_12px_rgba(16,42,67,0.06)]
                   px-1 py-1 animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => handleLayout('tree')}>
              <Network />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Tree layout</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => handleLayout('grid')}>
              <Grid3x3 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Grid layout</TooltipContent>
        </Tooltip>
      </div>
    </Panel>
  );
}

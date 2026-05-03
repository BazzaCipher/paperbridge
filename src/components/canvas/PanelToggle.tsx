import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface PanelToggleProps {
  side: 'left' | 'right';
  isOpen: boolean;
  onClick: () => void;
  label: string;
}

export function PanelToggle({ side, isOpen, onClick, label }: PanelToggleProps) {
  const positionClass = side === 'left' ? 'top-4 left-2' : 'top-4 right-2';

  // Pointing direction: when closed, point toward the panel opens; when open, point toward close.
  const pointsRight = (side === 'left') !== isOpen;
  const Icon = pointsRight ? ChevronRight : ChevronLeft;

  const title = isOpen ? `Close ${label}` : `Open ${label}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`absolute ${positionClass} z-10 flex items-center justify-center
                      h-9 w-9 bg-white/80 backdrop-blur-md border border-paper-100 rounded-full
                      shadow-[0_2px_8px_rgba(16,42,67,0.06)]
                      text-bridge-500 hover:text-copper-500 hover:bg-white
                      hover:shadow-[0_4px_12px_rgba(16,42,67,0.08)]
                      active:scale-95
                      transition-all duration-150 ease-[var(--ease-spring)] touch-manipulation
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper-400`}
          aria-label={title}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side === 'left' ? 'right' : 'left'}>{title}</TooltipContent>
    </Tooltip>
  );
}

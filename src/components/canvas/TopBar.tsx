import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, Undo2, Redo2 } from 'lucide-react';
import { useCanvasStore } from '../../store/canvasStore';
import { useToast } from '../ui/Toast';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TopBarProps {
  focusName?: boolean;
  onFocusNameHandled?: () => void;
}

export function TopBar({ focusName, onFocusNameHandled }: TopBarProps) {
  const saveToFile = useCanvasStore((s) => s.saveToFile);
  const canvasName = useCanvasStore((s) => s.canvasName);
  const setCanvasName = useCanvasStore((s) => s.setCanvasName);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const canUndo = useCanvasStore((s) => s.canUndo);
  const canRedo = useCanvasStore((s) => s.canRedo);
  const { showToast } = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
      onFocusNameHandled?.();
    }
  }, [focusName, onFocusNameHandled]);

  const handleSave = async () => {
    const result = await saveToFile();
    if (!result.success) {
      showToast('Save failed: ' + result.warnings.join(', '), 'error');
    } else if (result.warnings.length > 0) {
      showToast('Saved with warnings: ' + result.warnings.join(', '), 'warning');
    } else {
      showToast('Canvas saved successfully', 'success');
    }
  };

  return (
    <div
      className="flex items-center gap-1 bg-white/85 backdrop-blur-md
                 border border-paper-100 rounded-xl shadow-[0_2px_12px_rgba(16,42,67,0.06)]
                 px-1.5 py-1 animate-in fade-in slide-in-from-top-2 duration-300"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon-sm">
            <Link to="/" aria-label="Back to home">
              <ArrowLeft />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Back to home</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" />

      <input
        ref={nameInputRef}
        type="text"
        value={canvasName}
        onChange={(e) => setCanvasName(e.target.value)}
        className="px-2 py-1 text-sm font-medium bg-transparent text-bridge-800 placeholder:text-bridge-400
                   rounded-md w-24 sm:w-40 focus:outline-none focus:bg-paper-50
                   focus:ring-1 focus:ring-copper-400 transition-colors"
        title="Canvas name"
        placeholder="Untitled canvas"
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={handleSave}>
            <Save />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Save (Ctrl+S)</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo()}>
            <Undo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo()}>
            <Redo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
      </Tooltip>
    </div>
  );
}

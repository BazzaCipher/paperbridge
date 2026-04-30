import { X, Plus, FolderOpen, Copy, Trash2 } from 'lucide-react';
import { useCanvasStore } from '../../store/canvasStore';
import { useToast } from '../ui/Toast';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface SessionProject {
  id: string;
  name: string;
  lastModified: number;
  nodeCount: number;
}

interface ProjectSidebarProps {
  open: boolean;
  onClose: () => void;
  projects: SessionProject[];
  activeProjectId: string;
  onSwitchProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onCloneProject: (id: string) => void;
  onCreateProject: () => void;
  onLoad: () => Promise<void>;
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ProjectSidebar({
  open,
  onClose,
  projects,
  activeProjectId,
  onSwitchProject,
  onDeleteProject,
  onCloneProject,
  onCreateProject,
  onLoad,
}: ProjectSidebarProps) {
  const { showToast } = useToast();
  const canvasName = useCanvasStore((state) => state.canvasName);

  return (
    <div
      className="h-full shrink-0 overflow-hidden transition-[max-width] duration-300 ease-[var(--ease-out-expo)]"
      style={{
        maxWidth: open ? '16rem' : '0',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div className="w-64 h-full bg-white border-r border-paper-100 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pl-4 pr-2 py-2.5 border-b border-paper-100">
          <h2 className="text-sm font-semibold text-bridge-800">Projects</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>

        {/* Create / Open buttons */}
        <div className="px-3 pt-3 pb-1 flex gap-2">
          <Button variant="outline" size="sm" onClick={onCreateProject} className="flex-1">
            <Plus />
            New
          </Button>
          <Button variant="outline" size="sm" onClick={() => onLoad()} className="flex-1">
            <FolderOpen />
            Open
          </Button>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto py-2">
          {projects.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-bridge-400">
              No projects open
            </div>
          )}
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <div
                key={project.id}
                className={`mx-2 mb-1 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-copper-400/10 border border-copper-400/60 shadow-[0_0_0_1px_rgba(52,211,153,0.1)]'
                    : 'hover:bg-paper-50 border border-transparent'
                }`}
              >
                <button
                  className="w-full text-left px-3 py-2.5 cursor-pointer"
                  onClick={() => !isActive && onSwitchProject(project.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-sm font-medium truncate ${
                        isActive ? 'text-copper-600' : 'text-bridge-800'
                      }`}
                    >
                      {isActive ? canvasName : project.name}
                    </span>
                    {isActive && (
                      <span className="shrink-0 text-[10px] font-medium text-copper-600 bg-copper-400/15 px-1.5 py-0.5 rounded">
                        active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-bridge-400">
                    <span>{project.nodeCount} nodes</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTime(project.lastModified)}</span>
                  </div>
                </button>

                {/* Actions */}
                <div className="flex items-center gap-0.5 px-2 pb-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloneProject(project.id);
                          showToast('Project cloned', 'success');
                        }}
                      >
                        <Copy />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Clone</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:!text-red-500 hover:!bg-red-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (projects.length <= 1 && isActive) {
                            showToast('Cannot delete the only project', 'warning');
                            return;
                          }
                          onDeleteProject(project.id);
                          showToast('Project removed', 'info');
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

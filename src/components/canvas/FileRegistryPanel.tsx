import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '../../store/canvasStore';
import { BlobRegistry, type FileMetadata, type VirtualFolder } from '../../store/canvasPersistence';
import { getFileTypeColor } from '../../utils/colors';
import { formatFileSize } from '../../utils/formatting';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function downloadFile(meta: FileMetadata) {
  const blob = BlobRegistry.getBlob(meta.fileId);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = meta.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function previewFile(meta: FileMetadata) {
  const blobUrl = BlobRegistry.getUrlFromId(meta.fileId);
  if (blobUrl) window.open(blobUrl, '_blank');
}

function startFileDrag(e: React.DragEvent, fileId: string) {
  e.dataTransfer.setData('application/x-lynk-file', fileId);
  e.dataTransfer.effectAllowed = 'copyMove';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Editable inline label (shared by folder names and file names)
// ═══════════════════════════════════════════════════════════════════════════════

function EditableLabel({
  value: initialValue,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (newValue: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) {
      onCommit(trimmed);
    } else {
      setValue(initialValue);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setValue(initialValue);
            setEditing(false);
          }
        }}
        className="text-xs font-medium text-bridge-700 bg-white border border-copper-400 rounded px-1 py-0 w-full outline-none"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className={className || 'text-xs font-medium text-bridge-700 truncate flex-1 cursor-text'}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="Double-click to rename"
    >
      {initialValue}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared thumbnail
// ═══════════════════════════════════════════════════════════════════════════════

function FileThumbnail({ meta, size = 'md' }: { meta: FileMetadata; size?: 'sm' | 'md' }) {
  const blobUrl = BlobRegistry.getUrlFromId(meta.fileId);
  const typeColor = getFileTypeColor(meta.mimeType);
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-10 h-10';
  const textSize = size === 'sm' ? 'text-[6px]' : 'text-xs';
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-5 w-5';

  if (!blobUrl) {
    return (
      <div
        className={`${dim} rounded flex items-center justify-center ${textSize} font-bold`}
        style={{ backgroundColor: typeColor.bg, color: typeColor.text }}
      >
        {typeColor.label}
      </div>
    );
  }

  if (meta.fileType === 'image') {
    return (
      <img
        src={blobUrl}
        alt={meta.fileName}
        className={`${dim} rounded object-cover`}
      />
    );
  }

  return (
    <div
      className={`${dim} rounded flex items-center justify-center`}
      style={{ backgroundColor: typeColor.bg }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className={iconSize} viewBox="0 0 20 20" fill={typeColor.text}>
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Flat view file row (full detail)
// ═══════════════════════════════════════════════════════════════════════════════

function FileEntryRow({
  meta,
  onJumpToNode,
  onReuse,
  onDelete,
  onRename,
}: {
  meta: FileMetadata;
  onJumpToNode: (nodeId: string) => void;
  onReuse: (meta: FileMetadata) => void;
  onDelete: (fileId: string) => void;
  onRename: (fileId: string, newName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeColor = getFileTypeColor(meta.mimeType);
  const nodeIds = Array.from(meta.nodeIds);
  const date = new Date(meta.registeredAt);

  return (
    <div
      className="p-2 border-b border-paper-100 hover:bg-copper-400/10"
      draggable
      onDragStart={(e) => startFileDrag(e, meta.fileId)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        previewFile(meta);
      }}
    >
      <div className="flex items-center gap-2">
        <FileThumbnail meta={meta} />
        <div className="flex-1 min-w-0">
          <EditableLabel
            value={meta.fileName}
            onCommit={(newName) => onRename(meta.fileId, newName)}
            className="text-xs font-medium text-bridge-900 truncate block cursor-text"
          />
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className="px-1 py-0.5 text-[8px] font-semibold rounded"
              style={{
                backgroundColor: typeColor.bg,
                color: typeColor.text,
                border: `1px solid ${typeColor.border}`,
              }}
            >
              {typeColor.label}
            </span>
            <span className="text-[10px] text-bridge-400">
              {formatFileSize(meta.size)}
            </span>
            <span className="text-[10px] text-bridge-400">
              {date.toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {/* Node references */}
      <div className="mt-1.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-bridge-500 hover:text-bridge-700"
        >
          Used by {nodeIds.length} node{nodeIds.length !== 1 ? 's' : ''}
          {nodeIds.length > 0 && (expanded ? ' \u25B2' : ' \u25BC')}
        </button>
        {expanded && nodeIds.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {nodeIds.map((nid) => (
              <button
                key={nid}
                onClick={() => onJumpToNode(nid)}
                className="block text-[10px] text-copper-500 hover:text-copper-700 hover:underline pl-2"
              >
                {nid}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1 mt-1.5">
        {nodeIds.length > 0 && (
          <button
            onClick={() => onJumpToNode(nodeIds[0])}
            className="px-1.5 py-0.5 text-[10px] bg-copper-400/10 text-copper-600 rounded hover:bg-copper-400/20 transition-colors"
            title="Jump to first node using this file"
          >
            Jump
          </button>
        )}
        <button
          onClick={() => onReuse(meta)}
          className="px-1.5 py-0.5 text-[10px] bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors"
          title="Create new node with this file"
        >
          Reuse
        </button>
        <button
          onClick={() => downloadFile(meta)}
          className="px-1.5 py-0.5 text-[10px] bg-paper-50 text-bridge-700 rounded hover:bg-paper-100 transition-colors"
          title="Download file"
        >
          Download
        </button>
        {nodeIds.length === 0 && (
          <button
            onClick={() => onDelete(meta.fileId)}
            className="px-1.5 py-0.5 text-[10px] bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors"
            title="Delete unreferenced file"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hierarchy view - compact file row (name + small thumbnail only)
// ═══════════════════════════════════════════════════════════════════════════════

function CompactFileRow({
  meta,
  depth,
  onJumpToNode,
  onReuse,
  onDelete,
  onRename,
}: {
  meta: FileMetadata;
  depth: number;
  onJumpToNode: (nodeId: string) => void;
  onReuse: (meta: FileMetadata) => void;
  onDelete: (fileId: string) => void;
  onRename: (fileId: string, newName: string) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const typeColor = getFileTypeColor(meta.mimeType);
  const nodeIds = Array.from(meta.nodeIds);

  return (
    <div
      className="flex items-center gap-1.5 py-1 px-2 hover:bg-copper-400/10 group"
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      draggable
      onDragStart={(e) => startFileDrag(e, meta.fileId)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        previewFile(meta);
      }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <FileThumbnail meta={meta} size="sm" />
      <EditableLabel
        value={meta.fileName}
        onCommit={(newName) => onRename(meta.fileId, newName)}
        className="text-xs text-bridge-800 truncate flex-1 cursor-text"
      />
      <span
        className="px-1 py-0.5 text-[7px] font-semibold rounded shrink-0"
        style={{
          backgroundColor: typeColor.bg,
          color: typeColor.text,
          border: `1px solid ${typeColor.border}`,
        }}
      >
        {typeColor.label}
      </span>
      {showActions && (
        <div className="flex gap-0.5 shrink-0">
          {nodeIds.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onJumpToNode(nodeIds[0]); }}
              className="px-1 py-0.5 text-[8px] bg-copper-400/10 text-copper-500 rounded hover:bg-copper-400/20"
              title="Jump"
            >
              J
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onReuse(meta); }}
            className="px-1 py-0.5 text-[8px] bg-green-50 text-green-600 rounded hover:bg-green-100"
            title="Reuse"
          >
            R
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); downloadFile(meta); }}
            className="px-1 py-0.5 text-[8px] bg-paper-50 text-bridge-600 rounded hover:bg-paper-100"
            title="Download"
          >
            DL
          </button>
          {nodeIds.length === 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(meta.fileId); }}
              className="px-1 py-0.5 text-[8px] bg-red-50 text-red-600 rounded hover:bg-red-100"
              title="Delete"
            >
              X
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Virtual folder tree node (with drop target support)
// ═══════════════════════════════════════════════════════════════════════════════

function VirtualFolderNode({
  folder,
  childFolders,
  allFolders,
  filesInFolder,
  allFiles,
  depth,
  onJumpToNode,
  onReuse,
  onDeleteFile,
  onRenameFile,
  onRenameFolder,
  onDeleteFolder,
  onCreateFolder,
  onMoveFileToFolder,
}: {
  folder: VirtualFolder;
  childFolders: VirtualFolder[];
  allFolders: VirtualFolder[];
  filesInFolder: FileMetadata[];
  allFiles: FileMetadata[];
  depth: number;
  onJumpToNode: (nodeId: string) => void;
  onReuse: (meta: FileMetadata) => void;
  onDeleteFile: (fileId: string) => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onCreateFolder: (name: string, parentId: string) => void;
  onMoveFileToFolder: (fileId: string, folderId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [isDragTarget, setIsDragTarget] = useState(false);

  const countFiles = useCallback((fId: string): number => {
    let count = allFiles.filter((f) => f.folderId === fId).length;
    for (const child of allFolders.filter((f) => f.parentId === fId)) {
      count += countFiles(child.id);
    }
    return count;
  }, [allFolders, allFiles]);

  const totalFiles = countFiles(folder.id);
  const sortedChildren = childFolders.sort((a, b) => a.name.localeCompare(b.name));

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-lynk-file')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setIsDragTarget(true);
    }
  };

  const handleDragLeave = () => setIsDragTarget(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragTarget(false);
    const fileId = e.dataTransfer.getData('application/x-lynk-file');
    if (fileId) onMoveFileToFolder(fileId, folder.id);
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 px-2 hover:bg-copper-400/10 group cursor-pointer transition-colors ${
          isDragTarget ? 'bg-copper-400/10 outline outline-1 outline-indigo-300' : ''
        }`}
        style={{ paddingLeft: `${4 + depth * 16}px` }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3 w-3 text-bridge-400 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 shrink-0 transition-colors ${isDragTarget ? 'text-copper-500' : expanded ? 'text-amber-400' : 'text-amber-500'}`}
          viewBox="0 0 24 24"
          fill={expanded ? 'none' : 'currentColor'}
          stroke={expanded ? 'currentColor' : 'none'}
          strokeWidth={expanded ? 1.5 : 0}
        >
          {expanded ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
          ) : (
            <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
          )}
        </svg>
        <EditableLabel
          value={folder.name}
          onCommit={(newName) => onRenameFolder(folder.id, newName)}
        />
        <span className="text-[10px] text-bridge-400 shrink-0">{totalFiles}</span>
        {showActions && (
          <div className="flex gap-0.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateFolder('New Folder', folder.id);
              }}
              className="px-1 py-0.5 text-[8px] bg-paper-100 text-bridge-600 rounded hover:bg-paper-200"
              title="New subfolder"
            >
              +
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder(folder.id);
              }}
              className="px-1 py-0.5 text-[8px] bg-red-50 text-red-600 rounded hover:bg-red-100"
              title="Delete folder"
            >
              x
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div>
          {sortedChildren.map((child) => (
            <VirtualFolderNode
              key={child.id}
              folder={child}
              childFolders={allFolders.filter((f) => f.parentId === child.id)}
              allFolders={allFolders}
              filesInFolder={allFiles.filter((f) => f.folderId === child.id)}
              allFiles={allFiles}
              depth={depth + 1}
              onJumpToNode={onJumpToNode}
              onReuse={onReuse}
              onDeleteFile={onDeleteFile}
              onRenameFile={onRenameFile}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onCreateFolder={onCreateFolder}
              onMoveFileToFolder={onMoveFileToFolder}
            />
          ))}
          {filesInFolder.map((meta) => (
            <CompactFileRow
              key={meta.fileId}
              meta={meta}
              depth={depth + 1}
              onJumpToNode={onJumpToNode}
              onReuse={onReuse}
              onDelete={onDeleteFile}
              onRename={onRenameFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hierarchy view
// ═══════════════════════════════════════════════════════════════════════════════

function FolderTreeView({
  files,
  folders,
  onJumpToNode,
  onReuse,
  onDeleteFile,
  onRenameFile,
  onRenameFolder,
  onDeleteFolder,
  onCreateFolder,
  onMoveFileToFolder,
}: {
  files: FileMetadata[];
  folders: VirtualFolder[];
  onJumpToNode: (nodeId: string) => void;
  onReuse: (meta: FileMetadata) => void;
  onDeleteFile: (fileId: string) => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onMoveFileToFolder: (fileId: string, folderId: string | null) => void;
}) {
  const rootFolders = useMemo(
    () => folders.filter((f) => f.parentId === null).sort((a, b) => a.name.localeCompare(b.name)),
    [folders]
  );
  const ungroupedFiles = useMemo(
    () => files.filter((f) => !f.folderId),
    [files]
  );

  const [isUngroupedDragTarget, setIsUngroupedDragTarget] = useState(false);

  const handleUngroupedDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-lynk-file')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setIsUngroupedDragTarget(true);
    }
  };

  const handleUngroupedDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsUngroupedDragTarget(false);
    const fileId = e.dataTransfer.getData('application/x-lynk-file');
    if (fileId) onMoveFileToFolder(fileId, null);
  };

  return (
    <div>
      {/* New folder button */}
      <button
        onClick={() => onCreateFolder('New Folder', null)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-bridge-500 hover:text-copper-500 hover:bg-paper-50"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        New folder
      </button>

      {/* Root-level folders */}
      {rootFolders.map((folder) => (
        <VirtualFolderNode
          key={folder.id}
          folder={folder}
          childFolders={folders.filter((f) => f.parentId === folder.id)}
          allFolders={folders}
          filesInFolder={files.filter((f) => f.folderId === folder.id)}
          allFiles={files}
          depth={0}
          onJumpToNode={onJumpToNode}
          onReuse={onReuse}
          onDeleteFile={onDeleteFile}
          onRenameFile={onRenameFile}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onCreateFolder={onCreateFolder}
          onMoveFileToFolder={onMoveFileToFolder}
        />
      ))}

      {/* Ungrouped files (also a drop target to unassign from folder) */}
      {(ungroupedFiles.length > 0 || rootFolders.length > 0) && (
        <div
          onDragOver={handleUngroupedDragOver}
          onDragLeave={() => setIsUngroupedDragTarget(false)}
          onDrop={handleUngroupedDrop}
          className={`transition-colors ${isUngroupedDragTarget ? 'bg-paper-100' : ''}`}
        >
          {rootFolders.length > 0 && (
            <div className="px-3 py-1 text-[10px] text-bridge-400 font-medium border-t border-paper-100 mt-1">
              Ungrouped
            </div>
          )}
          {ungroupedFiles.map((meta) => (
            <CompactFileRow
              key={meta.fileId}
              meta={meta}
              depth={0}
              onJumpToNode={onJumpToNode}
              onReuse={onReuse}
              onDelete={onDeleteFile}
              onRename={onRenameFile}
            />
          ))}
          {ungroupedFiles.length === 0 && rootFolders.length > 0 && (
            <div className="px-3 py-2 text-[10px] text-bridge-400 italic">
              Drop files here to ungroup
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main panel
// ═══════════════════════════════════════════════════════════════════════════════

export function FileRegistryPanel() {
  const fileRegistryOpen = useCanvasStore((s) => s.fileRegistryOpen);
  const toggleFileRegistry = useCanvasStore((s) => s.toggleFileRegistry);
  const fileRegistrySearch = useCanvasStore((s) => s.fileRegistrySearch);
  const setFileRegistrySearch = useCanvasStore((s) => s.setFileRegistrySearch);
  const fileRegistrySort = useCanvasStore((s) => s.fileRegistrySort);
  const setFileRegistrySort = useCanvasStore((s) => s.setFileRegistrySort);
  const fileRegistryViewMode = useCanvasStore((s) => s.fileRegistryViewMode);
  const setFileRegistryViewMode = useCanvasStore((s) => s.setFileRegistryViewMode);
  const getSortedFilteredFiles = useCanvasStore((s) => s.getSortedFilteredFiles);
  const getDuplicateGroups = useCanvasStore((s) => s.getDuplicateGroups);
  const refreshFileRegistry = useCanvasStore((s) => s.refreshFileRegistry);
  const addNode = useCanvasStore((s) => s.addNode);
  const virtualFolders = useCanvasStore((s) => s.virtualFolders);
  const createVirtualFolder = useCanvasStore((s) => s.createVirtualFolder);
  const renameVirtualFolder = useCanvasStore((s) => s.renameVirtualFolder);
  const deleteVirtualFolder = useCanvasStore((s) => s.deleteVirtualFolder);
  const moveFileToFolder = useCanvasStore((s) => s.moveFileToFolder);

  useCanvasStore((s) => s._fileRegistryVersion);

  const { fitView, screenToFlowPosition } = useReactFlow();

  const files = getSortedFilteredFiles();
  const duplicateGroups = getDuplicateGroups();
  const hasDuplicates = duplicateGroups.size > 0;

  const handleJumpToNode = useCallback(
    (nodeId: string) => {
      fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.5 });
    },
    [fitView]
  );

  const handleReuse = useCallback(
    (meta: FileMetadata) => {
      const blobUrl = BlobRegistry.getUrlFromId(meta.fileId);
      if (!blobUrl) return;

      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });

      const nodeId = addNode('extractor', center, {
        label: meta.fileName,
        fileId: meta.fileId,
        fileUrl: blobUrl,
        fileName: meta.fileName,
        fileType: meta.fileType,
        currentPage: 1,
        totalPages: 1,
        regions: [],
      });

      BlobRegistry.addNodeReference(meta.fileId, nodeId);
      refreshFileRegistry();
    },
    [addNode, screenToFlowPosition, refreshFileRegistry]
  );

  const handleDelete = useCallback(
    (fileId: string) => {
      const meta = BlobRegistry.getMetadata(fileId);
      if (meta && meta.nodeIds.size > 0) return;

      const blobUrl = BlobRegistry.getUrlFromId(fileId);
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        BlobRegistry.urlToId.delete(blobUrl);
      }
      BlobRegistry.idToUrl.delete(fileId);
      BlobRegistry.blobs.delete(fileId);
      BlobRegistry.metadata.delete(fileId);
      refreshFileRegistry();
    },
    [refreshFileRegistry]
  );

  const handleRename = useCallback(
    (fileId: string, newName: string) => {
      BlobRegistry.renameFile(fileId, newName);
      refreshFileRegistry();
    },
    [refreshFileRegistry]
  );

  const handleSortClick = useCallback(
    (field: 'name' | 'type' | 'size' | 'date') => {
      if (fileRegistrySort.field === field) {
        setFileRegistrySort(field, fileRegistrySort.direction === 'asc' ? 'desc' : 'asc');
      } else {
        setFileRegistrySort(field, 'asc');
      }
    },
    [fileRegistrySort, setFileRegistrySort]
  );

  const handleCreateFolder = useCallback(
    (name: string, parentId: string | null) => {
      createVirtualFolder(name, parentId);
    },
    [createVirtualFolder]
  );

  return (
    <div
      className="h-full shrink-0 overflow-hidden transition-[max-width] duration-300 ease-in-out"
      style={{
        maxWidth: fileRegistryOpen ? '18rem' : '0',
        pointerEvents: fileRegistryOpen ? 'auto' : 'none',
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="w-72 h-full bg-white border-l border-paper-200 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-paper-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-bridge-900">Files</h3>
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-paper-100 text-bridge-600 rounded-full">
            {files.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* View mode toggle */}
          <div className="flex bg-paper-100 rounded p-0.5">
            <button
              onClick={() => setFileRegistryViewMode('flat')}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                fileRegistryViewMode === 'flat'
                  ? 'bg-white shadow-sm text-bridge-700 font-medium'
                  : 'text-bridge-500 hover:text-bridge-700'
              }`}
              title="Flat list view"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={() => setFileRegistryViewMode('hierarchy')}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                fileRegistryViewMode === 'hierarchy'
                  ? 'bg-white shadow-sm text-bridge-700 font-medium'
                  : 'text-bridge-500 hover:text-bridge-700'
              }`}
              title="Folder hierarchy view"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
            </button>
          </div>
          <button
            onClick={toggleFileRegistry}
            className="p-1 hover:bg-paper-100 rounded transition-colors text-bridge-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-paper-100">
        <input
          type="text"
          value={fileRegistrySearch}
          onChange={(e) => setFileRegistrySearch(e.target.value)}
          placeholder="Search files..."
          className="w-full px-2 py-1 text-xs border border-paper-200 rounded focus:outline-none focus:ring-1 focus:ring-copper-400"
        />
      </div>

      {/* Sort controls */}
      <div className="px-2 py-1.5 border-b border-paper-100 flex gap-1">
        {(['name', 'type', 'size', 'date'] as const).map((field) => (
          <button
            key={field}
            onClick={() => handleSortClick(field)}
            className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
              fileRegistrySort.field === field
                ? 'bg-copper-400/20 text-copper-600 font-medium'
                : 'text-bridge-500 hover:bg-paper-100'
            }`}
          >
            {field.charAt(0).toUpperCase() + field.slice(1)}
            {fileRegistrySort.field === field && (
              <span className="ml-0.5">{fileRegistrySort.direction === 'asc' ? '\u2191' : '\u2193'}</span>
            )}
          </button>
        ))}
      </div>

      {/* Duplicate alert */}
      {hasDuplicates && (
        <div className="mx-2 mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-[10px] text-yellow-800">
          <strong>Duplicates detected:</strong> {duplicateGroups.size} file{duplicateGroups.size !== 1 ? 's have' : ' has'} identical copies.
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 && virtualFolders.length === 0 ? (
          <div className="p-4 text-center text-xs text-bridge-400">
            No files loaded
          </div>
        ) : fileRegistryViewMode === 'hierarchy' ? (
          <FolderTreeView
            files={files}
            folders={virtualFolders}
            onJumpToNode={handleJumpToNode}
            onReuse={handleReuse}
            onDeleteFile={handleDelete}
            onRenameFile={handleRename}
            onRenameFolder={renameVirtualFolder}
            onDeleteFolder={deleteVirtualFolder}
            onCreateFolder={handleCreateFolder}
            onMoveFileToFolder={moveFileToFolder}
          />
        ) : (
          files.map((meta) => (
            <FileEntryRow
              key={meta.fileId}
              meta={meta}
              onJumpToNode={handleJumpToNode}
              onReuse={handleReuse}
              onDelete={handleDelete}
              onRename={handleRename}
            />
          ))
        )}
      </div>
      </div>
    </div>
  );
}

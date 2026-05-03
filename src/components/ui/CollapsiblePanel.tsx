import { useState, type ReactNode } from 'react';

interface CollapsiblePanelProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  headerClassName?: string;
  badge?: number;
  side?: 'left' | 'right';
  orientation?: 'horizontal' | 'vertical';
}

export function CollapsiblePanel({
  title,
  children,
  defaultOpen = true,
  className = '',
  headerClassName = '',
  badge,
  side = 'right',
  orientation = 'horizontal',
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const isVertical = orientation === 'vertical';

  const horizontalRotation = isOpen
    ? side === 'right' ? 'rotate-0' : 'rotate-180'
    : side === 'right' ? 'rotate-180' : 'rotate-0';
  const verticalRotation = isOpen ? '-rotate-90' : 'rotate-180';

  return (
    <div
      className={`
        flex flex-col bg-white border-paper-200 transition-all duration-200
        ${isVertical ? '' : side === 'right' ? 'border-l' : 'border-r'}
        ${isVertical ? `w-full ${isOpen ? 'flex-1 min-h-0' : 'flex-none'}` : isOpen ? 'w-72' : 'w-10'}
        ${className}
      `}
    >
      {/* Header / Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 px-3 py-2 bg-paper-50 border-b border-paper-200
          hover:bg-paper-100 transition-colors text-left
          ${headerClassName}
        `}
      >
        {/* Collapse/Expand icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 text-bridge-500 transition-transform ${
            isVertical ? verticalRotation : horizontalRotation
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>

        {(isOpen || isVertical) && (
          <>
            <span className="flex-1 text-sm font-medium text-bridge-700">{title}</span>
            {badge !== undefined && badge > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-copper-400/20 text-copper-600 rounded-full">
                {badge}
              </span>
            )}
          </>
        )}
      </button>

      {/* Content */}
      {isOpen && (
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      )}

      {/* Collapsed indicator (horizontal only) */}
      {!isOpen && !isVertical && badge !== undefined && badge > 0 && (
        <div className="flex justify-center py-2">
          <span className="w-6 h-6 flex items-center justify-center text-xs bg-copper-400/20 text-copper-600 rounded-full">
            {badge}
          </span>
        </div>
      )}
    </div>
  );
}

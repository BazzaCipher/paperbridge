import { type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';

interface NodeEntryProps {
  id: string;
  handleType: 'source' | 'target';
  handlePosition: Position;
  children: ReactNode;
  className?: string;
  /** Allow multiple connections to this handle */
  allowMultiple?: boolean;
  /**
   * Handle color - use to indicate data type.
   * Pass the color directly (e.g., region.color from getColorForType()).
   * Defaults to gray (#9c8468) if not provided.
   */
  handleColor?: string;
  /** Handle visual shape. 'square' is used for TxnGroup handles to distinguish
   *  group outputs from individual field outputs at a glance. */
  handleShape?: 'circle' | 'square';
}

export function NodeEntry({
  id,
  handleType,
  handlePosition,
  children,
  className = '',
  allowMultiple = false,
  handleColor,
  handleShape = 'circle',
}: NodeEntryProps) {
  const isSquare = handleShape === 'square';
  return (
    <div className={`relative flex items-center min-h-8 px-2 ${className}`}>
      {children}
      <Handle
        type={handleType}
        position={handlePosition}
        id={id}
        style={{
          position: 'absolute',
          top: '50%',
          transform: isSquare
            ? 'translateY(-50%) rotate(45deg)'
            : 'translateY(-50%)',
          ...(handlePosition === Position.Left && { left: -8 }),
          ...(handlePosition === Position.Right && { right: -8 }),
          background: handleColor || '#9c8468',
          width: isSquare ? '13px' : '15px',
          height: isSquare ? '13px' : '15px',
          borderRadius: isSquare ? '2px' : '50%',
        }}
        className={`border-2 border-white ${
          allowMultiple ? 'ring-2 ring-offset-1 ring-copper-300' : ''
        }`}
      />
    </div>
  );
}

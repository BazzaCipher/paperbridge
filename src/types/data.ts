/**
 * Core Data Type System
 *
 * Defines the fundamental data types used throughout the application
 * for values, calculations, and type-safe operations.
 */

import type { DataSourceReference } from './geometry';

// ═══════════════════════════════════════════════════════════════════════════════
// DATA TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Core data types for simple values.
 * Used throughout the application for region data types and calculations.
 */
export type SimpleDataType = 'string' | 'number' | 'boolean' | 'date' | 'currency';

/**
 * Extended data types including complex/aggregate types.
 * Used by DataValue for nested structures.
 */
export type ExtendedDataType = SimpleDataType | 'array' | 'table' | 'txngroup';

/**
 * Legacy type alias - 'text' maps to 'string'.
 * @deprecated Use 'string' instead. Kept for backward compatibility with saved canvases.
 */
export type LegacyTextType = 'text';

/**
 * All data types including legacy aliases.
 * Use this for parsing/validation, then normalize to ExtendedDataType.
 */
export type AnyDataType = ExtendedDataType | LegacyTextType;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize legacy type names to current types.
 * Converts 'text' → 'string'.
 */
export function normalizeDataType(type: AnyDataType): ExtendedDataType {
  if (type === 'text') return 'string';
  return type;
}

/**
 * Type guard to check if a type is a simple (non-aggregate) data type.
 */
export function isSimpleDataType(type: AnyDataType): type is SimpleDataType {
  const normalized = normalizeDataType(type);
  return ['string', 'number', 'boolean', 'date', 'currency'].includes(normalized);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE-SAFE VALUE WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════════

export interface StringValue {
  type: 'string';
  value: string;
}

export interface NumberValue {
  type: 'number';
  value: number;
  precision?: number;
}

export interface BooleanValue {
  type: 'boolean';
  value: boolean;
}

export interface DateValue {
  type: 'date';
  value: string; // ISO date string
}

export interface CurrencyValue {
  type: 'currency';
  value: number;
  currency: string; // e.g., 'USD', 'EUR'
}

/** Union of all type-safe simple value wrappers */
export type SimpleValue = StringValue | NumberValue | BooleanValue | DateValue | CurrencyValue;

// ═══════════════════════════════════════════════════════════════════════════════
// CORE DATA VALUE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Core data value type with source tracking.
 *
 * Note: The 'type' field may contain legacy value 'text' which should be treated as 'string'.
 * Use normalizeDataType() when comparing types.
 */
export interface DataValue {
  type: ExtendedDataType | LegacyTextType;
  value: number | string | Date | DataValue[];
  source?: DataSourceReference;
}

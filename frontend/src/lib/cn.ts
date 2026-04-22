import { clsx, type ClassValue } from 'clsx';

/** Tiny class-name joiner used by all druz9 components. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

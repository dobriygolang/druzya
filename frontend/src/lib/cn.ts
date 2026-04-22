import { clsx, type ClassValue } from 'clsx';

/** Маленький джойнер class-name, используемый всеми компонентами druz9. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

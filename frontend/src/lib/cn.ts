import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Маленький джойнер class-name, используемый всеми компонентами druz9.
 * twMerge ОБЯЗАТЕЛЕН: без него `<Button className="bg-text-primary text-bg" />`
 * не overridит variant-классы `bg-accent text-text-primary` — оба класса
 * остаются в строке, и побеждает CSS-source order (а не последний в className).
 * Это давало баг white-on-white кнопок в Sanctum/KataStreak. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

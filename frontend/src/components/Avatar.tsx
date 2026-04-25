import * as React from 'react';
import { cn } from '../lib/cn';

/** Встроенные пресеты градиентов из двух стопов (выровнены по токенам). */
export type AvatarGradient =
  | 'violet-cyan'
  | 'pink-violet'
  | 'cyan-violet'
  | 'pink-red'
  | 'success-cyan'
  | 'gold';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
export type AvatarStatus = 'online' | 'offline' | 'in-match' | 'streaming';
export type AvatarTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master';

const SIZE_PX: Record<AvatarSize, number> = { sm: 24, md: 32, lg: 48, xl: 96 };

const SIZE_TEXT: Record<AvatarSize, string> = {
  sm: 'text-[10px]',
  md: 'text-xs',
  lg: 'text-sm',
  xl: 'text-2xl',
};

// Phase-1: avatar gradients collapsed to a monochrome ramp (varying ink
// opacities over black). Names retained so callsites don't break; visual
// differentiation comes from the index, not the hue.
const GRADIENT_CSS: Record<AvatarGradient, string> = {
  'violet-cyan':  'linear-gradient(135deg, #2A2A2A 0%, #595959 100%)',
  'pink-violet':  'linear-gradient(135deg, #1F1F1F 0%, #4A4A4A 100%)',
  'cyan-violet':  'linear-gradient(135deg, #333333 0%, #6B6B6B 100%)',
  'pink-red':     'linear-gradient(135deg, #2A2A2A 0%, #FF3B30 100%)',
  'success-cyan': 'linear-gradient(135deg, #262626 0%, #5C5C5C 100%)',
  gold:           'linear-gradient(135deg, #3A3A3A 0%, #7A7A7A 100%)',
};

// Phase-3: presence colors collapsed to ink+success+red. "in-match" reads
// as red (live signal, parallels the recording-pulse), "streaming" as plain
// ink-60 (no separate hue — streaming is uncommon enough that a unique
// color isn't worth the palette debt).
const STATUS_COLOR: Record<AvatarStatus, string> = {
  online: 'bg-success',
  offline: 'bg-text-muted',
  'in-match': 'bg-danger',
  streaming: 'bg-text-secondary',
};

// Tier rings — keep gold/silver/bronze metallic hex (they're heraldic, not
// brand colors), drop cyan/accent for platinum/master in favor of ink.
const TIER_RING: Record<AvatarTier, string> = {
  bronze: 'ring-[#CD7F32]',
  silver: 'ring-[#C0C0C0]',
  gold: 'ring-warn',
  platinum: 'ring-text-secondary',
  diamond: 'ring-[#B9F2FF]',
  master: 'ring-text-primary',
};

export interface AvatarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Пресет размера в пикселях: sm=24, md=32, lg=48, xl=96. */
  size?: AvatarSize;
  /** Пресет градиента для fallback-фона или кортеж `[from, to]` из hex-строк. */
  gradient?: AvatarGradient | [string, string];
  /** Точка-индикатор присутствия, снизу справа. */
  status?: AvatarStatus;
  /** Добавляет цветное кольцо вокруг аватара. */
  tier?: AvatarTier;
  /** Инициалы, показываемые при отсутствии `src`. */
  initials?: string;
  /** URL изображения; при ошибке или отсутствии — fallback на градиент + инициалы. */
  src?: string;
  /** Доступный label для изображения аватара. */
  alt?: string;
}

/**
 * druz9 Avatar — портрет пользователя с опциональным статусом, кольцом тира и
 * fallback-градиентом.
 *
 * @example
 * <Avatar size="lg" gradient="violet-cyan" initials="SD" status="online" tier="gold" />
 */
export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      size = 'md',
      gradient = 'violet-cyan',
      status,
      tier,
      initials,
      src,
      alt,
      className,
      style,
      ...props
    },
    ref,
  ) => {
    const [imgFailed, setImgFailed] = React.useState(false);
    const px = SIZE_PX[size];
    const showImage = src && !imgFailed;

    const bg = Array.isArray(gradient)
      ? `linear-gradient(135deg, ${gradient[0]} 0%, ${gradient[1]} 100%)`
      : GRADIENT_CSS[gradient];

    const fallbackInitial = (initials ?? alt ?? '?').trim().charAt(0).toUpperCase();

    return (
      <div
        ref={ref}
        className={cn('relative inline-flex shrink-0', className)}
        style={{ width: px, height: px, ...style }}
        {...props}
      >
        <div
          className={cn(
            'flex h-full w-full items-center justify-center overflow-hidden rounded-full font-display font-bold text-text-primary',
            SIZE_TEXT[size],
            // ring-2 ring-bg по умолчанию: визуально отделяет аватары
            // соседей в группах с -space-x (Friends online и т.п.).
            // tier добавляет цветное кольцо поверх через offset.
            !tier && 'ring-2 ring-bg',
            tier && `ring-2 ring-offset-2 ring-offset-bg ${TIER_RING[tier]}`,
          )}
          style={showImage ? undefined : { background: bg }}
          aria-label={alt}
          role={src ? undefined : 'img'}
        >
          {showImage ? (
            <img
              src={src}
              alt={alt ?? ''}
              className="h-full w-full object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span aria-hidden="true">{initials ?? fallbackInitial}</span>
          )}
        </div>
        {status && (
          <span
            className={cn(
              'absolute bottom-0 right-0 block rounded-full ring-2 ring-bg',
              STATUS_COLOR[status],
            )}
            style={{ width: Math.max(8, px * 0.25), height: Math.max(8, px * 0.25) }}
            aria-label={`status: ${status}`}
            role="status"
          />
        )}
      </div>
    );
  },
);
Avatar.displayName = 'Avatar';

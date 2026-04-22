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

const GRADIENT_CSS: Record<AvatarGradient, string> = {
  'violet-cyan': 'linear-gradient(135deg, #582CFF 0%, #22D3EE 100%)',
  'pink-violet': 'linear-gradient(135deg, #F472B6 0%, #582CFF 100%)',
  'cyan-violet': 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
  'pink-red': 'linear-gradient(135deg, #F472B6 0%, #EF4444 100%)',
  'success-cyan': 'linear-gradient(135deg, #10B981 0%, #22D3EE 100%)',
  gold: 'linear-gradient(135deg, #FBBF24 0%, #F472B6 100%)',
};

const STATUS_COLOR: Record<AvatarStatus, string> = {
  online: 'bg-success',
  offline: 'bg-text-muted',
  'in-match': 'bg-accent',
  streaming: 'bg-pink',
};

const TIER_RING: Record<AvatarTier, string> = {
  bronze: 'ring-[#CD7F32]',
  silver: 'ring-[#C0C0C0]',
  gold: 'ring-warn',
  platinum: 'ring-cyan',
  diamond: 'ring-[#B9F2FF]',
  master: 'ring-accent',
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

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../lib/cn';

// `min-w-0` is critical for flex-children: without it, long content with
// truncate/break-words pushes the card wider than its parent's width.
// `overflow-hidden` preserves border-radius when children overflow.
const card = cva(['relative flex min-w-0 flex-col overflow-hidden text-text-primary'], {
  variants: {
    variant: {
      default: 'bg-surface-1 border border-border rounded-xl',
      elevated: 'bg-surface-2 border border-border-strong rounded-xl',
      gradient: 'bg-surface-2 border border-border-strong rounded-xl',
      selected: 'bg-surface-2 border border-text-primary rounded-xl',
    },
    interactive: {
      true: 'transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:border-border-strong cursor-pointer',
      false: '',
    },
    padding: {
      none: 'p-0',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-6',
    },
  },
  defaultVariants: { variant: 'default', interactive: false, padding: 'md' },
});

type CardVariantProps = VariantProps<typeof card>;

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    CardVariantProps {
  /** Визуальный стиль поверхности карточки. */
  variant?: CardVariantProps['variant'];
  /** Добавляет hover-аффорданс (border + glow). */
  interactive?: boolean;
  /** Внутренний padding. Используйте `none`, чтобы управлять им внутри подкомпонентов. */
  padding?: CardVariantProps['padding'];
}

const CardRoot = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, interactive, padding, ...props }, ref) => {
    const reduced = useReducedMotion();
    // Framer-motion transitions don't accept CSS var strings, so mirror the
    // dur-small motion token (160ms) as a number here.
    const motionProps = interactive && !reduced
      ? { whileHover: { y: -2 }, transition: { duration: 0.16, ease: [0.2, 0.7, 0.2, 1] as const } }
      : {};
    return (
      <motion.div
        ref={ref}
        className={cn(card({ variant, interactive, padding }), className)}
        {...motionProps}
        {...(props as React.ComponentPropsWithoutRef<typeof motion.div>)}
      />
    );
  },
);
CardRoot.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-between gap-3 pb-3 border-b border-border',
        className,
      )}
      {...props}
    />
  ),
);
CardHeader.displayName = 'Card.Header';

const CardBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex-1 py-3', className)} {...props} />
  ),
);
CardBody.displayName = 'Card.Body';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-end gap-2 pt-3 border-t border-border', className)}
      {...props}
    />
  ),
);
CardFooter.displayName = 'Card.Footer';

/**
 * druz9 Card — слоистая поверхность для группировки контента.
 *
 * @example
 * <Card variant="elevated">
 *   <Card.Header>Match #421</Card.Header>
 *   <Card.Body>...</Card.Body>
 *   <Card.Footer><Button>Join</Button></Card.Footer>
 * </Card>
 */
export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
});

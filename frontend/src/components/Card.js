import { jsx as _jsx } from "react/jsx-runtime";
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../lib/cn';
const card = cva(['relative flex flex-col text-text-primary'], {
    variants: {
        variant: {
            default: 'bg-surface-1 border border-border rounded-xl shadow-card',
            elevated: 'bg-surface-2 border border-border-strong rounded-xl shadow-card',
            gradient: 'rounded-xl border border-border-strong bg-gradient-to-br from-surface-3 to-surface-1 shadow-card',
            selected: 'bg-surface-2 border border-accent rounded-xl shadow-glow ring-1 ring-accent/40',
        },
        interactive: {
            true: 'transition-all duration-150 hover:border-border-strong hover:shadow-glow cursor-pointer',
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
const CardRoot = React.forwardRef(({ className, variant, interactive, padding, ...props }, ref) => {
    const reduced = useReducedMotion();
    const motionProps = interactive && !reduced
        ? { whileHover: { y: -2 }, transition: { duration: 0.2 } }
        : {};
    return (_jsx(motion.div, { ref: ref, className: cn(card({ variant, interactive, padding }), className), ...motionProps, ...props }));
});
CardRoot.displayName = 'Card';
const CardHeader = React.forwardRef(({ className, ...props }, ref) => (_jsx("div", { ref: ref, className: cn('flex items-center justify-between gap-3 pb-3 border-b border-border', className), ...props })));
CardHeader.displayName = 'Card.Header';
const CardBody = React.forwardRef(({ className, ...props }, ref) => (_jsx("div", { ref: ref, className: cn('flex-1 py-3', className), ...props })));
CardBody.displayName = 'Card.Body';
const CardFooter = React.forwardRef(({ className, ...props }, ref) => (_jsx("div", { ref: ref, className: cn('flex items-center justify-end gap-2 pt-3 border-t border-border', className), ...props })));
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

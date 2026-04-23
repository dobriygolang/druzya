import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../lib/cn';
const button = cva([
    'inline-flex items-center justify-center gap-2',
    'font-sans font-semibold whitespace-nowrap select-none',
    'transition-colors transition-shadow duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:opacity-50 disabled:pointer-events-none',
], {
    variants: {
        variant: {
            primary: 'bg-accent text-text-primary hover:bg-accent-hover shadow-glow rounded-lg',
            ghost: 'bg-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary border border-border rounded-lg',
            danger: 'bg-danger text-text-primary hover:brightness-110 rounded-lg',
        },
        size: {
            sm: 'h-8 px-3 text-[13px]',
            md: 'h-10 px-4 text-[14px]',
            lg: 'h-12 px-6 text-[15px]',
        },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
});
const Spinner = () => (_jsxs("svg", { className: "h-4 w-4 animate-spin", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: [_jsx("circle", { cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeOpacity: "0.25", strokeWidth: "3" }), _jsx("path", { d: "M22 12a10 10 0 0 0-10-10", stroke: "currentColor", strokeWidth: "3", strokeLinecap: "round" })] }));
/**
 * druz9 Button — основной интерактивный элемент.
 *
 * @example
 * <Button variant="primary" size="md" icon={<PlayIcon />}>Start match</Button>
 */
export const Button = React.forwardRef(({ className, variant, size, loading = false, disabled, icon, iconRight, children, type, ...props }, ref) => {
    const reduced = useReducedMotion();
    const isDisabled = disabled || loading;
    const motionProps = reduced || isDisabled
        ? {}
        : { whileHover: { scale: 1.02 }, whileTap: { scale: 0.98 } };
    return (_jsxs(motion.button, { ref: ref, type: type ?? 'button', disabled: isDisabled, "aria-busy": loading || undefined, className: cn(button({ variant, size }), className), ...motionProps, ...props, children: [loading ? _jsx(Spinner, {}) : icon, children, !loading && iconRight] }));
});
Button.displayName = 'Button';

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from 'react';
import { cn } from '../lib/cn';
const SIZE_PX = { sm: 24, md: 32, lg: 48, xl: 96 };
const SIZE_TEXT = {
    sm: 'text-[10px]',
    md: 'text-xs',
    lg: 'text-sm',
    xl: 'text-2xl',
};
const GRADIENT_CSS = {
    'violet-cyan': 'linear-gradient(135deg, #582CFF 0%, #22D3EE 100%)',
    'pink-violet': 'linear-gradient(135deg, #F472B6 0%, #582CFF 100%)',
    'cyan-violet': 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
    'pink-red': 'linear-gradient(135deg, #F472B6 0%, #EF4444 100%)',
    'success-cyan': 'linear-gradient(135deg, #10B981 0%, #22D3EE 100%)',
    gold: 'linear-gradient(135deg, #FBBF24 0%, #F472B6 100%)',
};
const STATUS_COLOR = {
    online: 'bg-success',
    offline: 'bg-text-muted',
    'in-match': 'bg-accent',
    streaming: 'bg-pink',
};
const TIER_RING = {
    bronze: 'ring-[#CD7F32]',
    silver: 'ring-[#C0C0C0]',
    gold: 'ring-warn',
    platinum: 'ring-cyan',
    diamond: 'ring-[#B9F2FF]',
    master: 'ring-accent',
};
/**
 * druz9 Avatar — портрет пользователя с опциональным статусом, кольцом тира и
 * fallback-градиентом.
 *
 * @example
 * <Avatar size="lg" gradient="violet-cyan" initials="SD" status="online" tier="gold" />
 */
export const Avatar = React.forwardRef(({ size = 'md', gradient = 'violet-cyan', status, tier, initials, src, alt, className, style, ...props }, ref) => {
    const [imgFailed, setImgFailed] = React.useState(false);
    const px = SIZE_PX[size];
    const showImage = src && !imgFailed;
    const bg = Array.isArray(gradient)
        ? `linear-gradient(135deg, ${gradient[0]} 0%, ${gradient[1]} 100%)`
        : GRADIENT_CSS[gradient];
    const fallbackInitial = (initials ?? alt ?? '?').trim().charAt(0).toUpperCase();
    return (_jsxs("div", { ref: ref, className: cn('relative inline-flex shrink-0', className), style: { width: px, height: px, ...style }, ...props, children: [_jsx("div", { className: cn('flex h-full w-full items-center justify-center overflow-hidden rounded-full font-display font-bold text-text-primary', SIZE_TEXT[size], tier && `ring-2 ring-offset-2 ring-offset-bg ${TIER_RING[tier]}`), style: showImage ? undefined : { background: bg }, "aria-label": alt, role: src ? undefined : 'img', children: showImage ? (_jsx("img", { src: src, alt: alt ?? '', className: "h-full w-full object-cover", onError: () => setImgFailed(true) })) : (_jsx("span", { "aria-hidden": "true", children: initials ?? fallbackInitial })) }), status && (_jsx("span", { className: cn('absolute bottom-0 right-0 block rounded-full ring-2 ring-bg', STATUS_COLOR[status]), style: { width: Math.max(8, px * 0.25), height: Math.max(8, px * 0.25) }, "aria-label": `status: ${status}`, role: "status" }))] }));
});
Avatar.displayName = 'Avatar';

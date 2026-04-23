import { jsx as _jsx } from "react/jsx-runtime";
import * as React from 'react';
import { cn } from '../lib/cn';
const TabsContext = React.createContext(null);
const useTabs = () => {
    const ctx = React.useContext(TabsContext);
    if (!ctx)
        throw new Error('Tabs.* must be used inside <Tabs>');
    return ctx;
};
const TabsRoot = ({ variant = 'pills', value, onChange, className, children, ...props }) => {
    const tabIds = React.useRef([]);
    const registerTab = React.useCallback((id) => {
        if (!tabIds.current.includes(id))
            tabIds.current.push(id);
    }, []);
    const ctx = React.useMemo(() => ({ value, onChange, variant, registerTab, tabIds }), [value, onChange, variant, registerTab]);
    return (_jsx(TabsContext.Provider, { value: ctx, children: _jsx("div", { className: cn('flex flex-col gap-3', className), ...props, children: children }) }));
};
const LIST_CLASS = {
    pills: 'flex items-center gap-1',
    underline: 'flex items-center gap-4 border-b border-border',
    segmented: 'inline-flex items-center gap-1 rounded-lg bg-surface-1 p-1 border border-border',
};
const TabsList = ({ className, children, ...props }) => {
    const { variant, value, onChange, tabIds } = useTabs();
    const onKeyDown = (e) => {
        const ids = tabIds.current;
        if (ids.length === 0)
            return;
        const i = ids.indexOf(value);
        if (i < 0)
            return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(ids[(i + 1) % ids.length]);
        }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(ids[(i - 1 + ids.length) % ids.length]);
        }
        else if (e.key === 'Home') {
            e.preventDefault();
            onChange(ids[0]);
        }
        else if (e.key === 'End') {
            e.preventDefault();
            onChange(ids[ids.length - 1]);
        }
    };
    return (_jsx("div", { role: "tablist", onKeyDown: onKeyDown, className: cn(LIST_CLASS[variant], className), ...props, children: children }));
};
TabsList.displayName = 'Tabs.List';
const Tab = React.forwardRef(({ id, className, children, ...props }, ref) => {
    const { value, onChange, variant, registerTab } = useTabs();
    React.useEffect(() => registerTab(id), [id, registerTab]);
    const active = value === id;
    const styles = {
        pills: cn('px-3 h-9 rounded-md text-[13px] font-semibold transition-colors', active
            ? 'bg-accent text-text-primary shadow-glow'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'),
        underline: cn('relative h-10 px-1 text-[14px] font-semibold transition-colors', active
            ? 'text-text-primary after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:bg-accent'
            : 'text-text-muted hover:text-text-primary'),
        segmented: cn('px-3 h-8 rounded-md text-[13px] font-semibold transition-colors', active
            ? 'bg-surface-3 text-text-primary'
            : 'text-text-secondary hover:text-text-primary'),
    };
    return (_jsx("button", { ref: ref, role: "tab", type: "button", id: `tab-${id}`, "aria-selected": active, "aria-controls": `tabpanel-${id}`, tabIndex: active ? 0 : -1, onClick: () => onChange(id), className: cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md', styles[variant], className), ...props, children: children }));
});
Tab.displayName = 'Tabs.Tab';
/**
 * druz9 Tabs — контролируемая навигация по табам с полной поддержкой клавиатуры.
 *
 * @example
 * const [tab, setTab] = React.useState('overview');
 * <Tabs variant="pills" value={tab} onChange={setTab}>
 *   <Tabs.List>
 *     <Tabs.Tab id="overview">Overview</Tabs.Tab>
 *     <Tabs.Tab id="stats">Stats</Tabs.Tab>
 *   </Tabs.List>
 * </Tabs>
 */
export const Tabs = Object.assign(TabsRoot, {
    List: TabsList,
    Tab,
});

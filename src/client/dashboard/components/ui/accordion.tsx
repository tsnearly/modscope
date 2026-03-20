import React, { useState, createContext, useContext } from 'react';
import { Icon } from './icon';
import { cn } from '../../utils/cn';

interface AccordionContextType {
    variant?: 'default' | 'reverse';
    exclusive?: boolean;
    expandedItems: string[];
    toggleItem: (id: string) => void;
}

const AccordionContext = createContext<AccordionContextType | undefined>(undefined);

export interface AccordionRootProps {
    children: React.ReactNode;
    variant?: 'default' | 'reverse';
    exclusive?: boolean;
    transition?: boolean;
    className?: string;
    defaultExpanded?: string[];
}

export function AccordionRoot({
    children,
    variant = 'default',
    exclusive = false,
    className,
    defaultExpanded = []
}: AccordionRootProps) {
    const [expandedItems, setExpandedItems] = useState<string[]>(defaultExpanded);

    const handleToggle = (id: string) => {
        setExpandedItems(prev => {
            const isOpen = prev.includes(id);
            if (exclusive) {
                return isOpen ? [] : [id];
            }
            return isOpen ? prev.filter(item => item !== id) : [...prev, id];
        });
    };

    return (
        <AccordionContext.Provider value={{ variant, exclusive, expandedItems, toggleItem: handleToggle }}>
            <div className={cn("flex flex-col gap-2", className)}>
                {children}
            </div>
        </AccordionContext.Provider>
    );
}

export interface AccordionItemProps {
    id: string;
    heading: React.ReactNode;
    children: React.ReactNode;
    disabled?: boolean;
    className?: string;
}

export function AccordionItem({ id, heading, children, disabled, className }: AccordionItemProps) {
    const context = useContext(AccordionContext);
    if (!context) throw new Error("AccordionItem must be used within AccordionRoot");

    const isOpen = context.expandedItems.includes(id);
    const isReverse = context.variant === 'reverse';

    return (
        <div className={cn(
            "border border-border rounded-lg bg-background overflow-hidden",
            disabled && "opacity-50 pointer-events-none",
            className
        )}>
            <button
                data-accordion-trigger
                className={cn(
                    "w-full flex items-center justify-between px-6 py-4 text-sm font-bold text-[var(--color-text)] transition-all hover:bg-black/5",
                    isOpen && "bg-black/[0.02]"
                )}
                onClick={() => context.toggleItem(id)}
            >
                {isReverse ? (
                    <div className="flex items-center gap-3 w-full">
                        <Icon
                            name="lucide:chevron-down"
                            size={16}
                            className={cn("flex-shrink-0 transition-transform duration-200", isOpen ? "rotate-180 text-[var(--color-primary)]" : "text-muted-foreground")}
                        />
                        <span className="flex-1 text-left">{heading}</span>
                    </div>
                ) : (
                    <div className="flex items-center justify-between w-full">
                        <span className="flex-1 text-left">{heading}</span>
                        <Icon
                            name="lucide:chevron-down"
                            size={16}
                            className={cn("flex-shrink-0 transition-transform duration-200", isOpen ? "rotate-180 text-[var(--color-primary)]" : "text-muted-foreground")}
                        />
                    </div>
                )}
            </button>
            <div className={cn(
                "transition-all duration-300 ease-in-out overflow-hidden",
                isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
            )}>
                <div
                    data-accordion-content
                    className="px-6 pb-6 pt-4 border-t border-[var(--color-border)] text-[var(--color-text)] leading-relaxed"
                >
                    {children}
                </div>
            </div>
        </div>
    );
}

// Support legacy usage
export function Accordion({ title, children, defaultOpen = false }: { title: string, children: React.ReactNode, defaultOpen?: boolean }) {
    return (
        <AccordionRoot defaultExpanded={defaultOpen ? ["legacy"] : []} exclusive>
            <AccordionItem id="legacy" heading={title}>
                {children}
            </AccordionItem>
        </AccordionRoot>
    );
}

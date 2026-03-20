import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import { Icon } from './icon';
import { Card, CardContent } from './card';

export interface SectionProps extends React.HTMLAttributes<HTMLDivElement> {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    icon?: string;
    rightElement?: React.ReactNode;
    compact?: boolean;
    collapsible?: boolean;
    defaultIsOpen?: boolean;
    elevation?: 0 | 1 | 2 | 3;
    iconColor?: string;
}

export function Section({
    title,
    subtitle,
    icon,
    rightElement,
    compact = false,
    collapsible = false,
    defaultIsOpen = true,
    className,
    children,
    elevation = 0,
    iconColor = "var(--color-primary)",
    ...props
}: SectionProps) {
    const [isOpen, setIsOpen] = useState(defaultIsOpen);

    const handleToggle = () => {
        if (collapsible) {
            setIsOpen(!isOpen);
        }
    };

    return (
        <div
            className={cn(
                "flex flex-col w-full mb-4",
                compact ? "gap-2" : "gap-4",
                className
            )}
            {...props}
        >
            {/* Header */}
            <div
                className={cn(
                    "flex items-center justify-between w-full select-none",
                    collapsible ? "cursor-pointer hover:opacity-80 transition-opacity" : "",
                    compact ? "py-1" : "py-2"
                )}
                onClick={handleToggle}
            >
                <div className="flex items-center gap-2 overflow-hidden">
                    {/* Collapse Icon */}
                    {collapsible && (
                        <div className={cn(
                            "text-muted-foreground flex items-center justify-center transition-transform duration-200",
                            isOpen ? "rotate-0" : "-rotate-90"
                        )}>
                            <Icon name="lucide:chevron-down" size="sm" className="opacity-70" />
                        </div>
                    )}

                    {/* Main Icon */}
                    {icon && <Icon name={icon} size={compact ? "md" : "lg"} color={iconColor} className="flex-shrink-0" />}

                    {/* Title & Subtitle */}
                    <div className="flex flex-col overflow-hidden">
                        <h3 className={cn(
                            "font-semibold text-foreground truncate",
                            compact ? "text-sm" : "text-base"
                        )}>
                            {title}
                        </h3>
                        {subtitle && (
                            <span className={cn(
                                "text-muted-foreground truncate",
                                compact ? "text-xs" : "text-sm"
                            )}>
                                {subtitle}
                            </span>
                        )}
                    </div>
                </div>

                {/* Right Element */}
                {rightElement && (
                    <div className="flex-shrink-0 ml-4" onClick={(e) => e.stopPropagation()}>
                        {rightElement}
                    </div>
                )}
            </div>

            {/* Content */}
            {isOpen && (
                <div className={cn(
                    "flex flex-col w-full transition-all duration-200 ease-in-out",
                    // Indent content if collapsible to align with title (optional, but good for hierarchy)
                    // collapsible && !compact ? "pl-6" : "" 
                    // Actually, let's keep it flush for card usage
                )}>
                    {children}
                </div>
            )}
        </div>
    );
}

export interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
    compact?: boolean;
}

export function SectionCard({ className, compact, children, ...props }: SectionCardProps) {
    return (
        <Card className={cn("overflow-hidden bg-background", className)} {...props}>
            <div className={cn(
                compact ? "p-3" : "p-4"
            )}>
                {children}
            </div>
        </Card>
    );
}

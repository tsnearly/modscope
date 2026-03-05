import React from 'react';

interface ChartProps {
    title?: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    height?: number | string;
}

export function Chart({ title, icon, children, className = '', height = 250 }: ChartProps) {
    return (
        <div className={`bg-card p-3 rounded-lg border border-border shadow-sm flex flex-col w-full ${className}`} style={{ height: typeof height === 'number' ? `${height}px` : height }}>
            {(title || icon) && (
                <div className="flex flex-row items-center gap-2 mb-2 pb-2 border-b border-border px-1">
                    {icon && <span className="inline-flex flex-shrink-0 text-muted-foreground">{icon}</span>}
                    {title && <h3 className="text-sm font-bold text-card-foreground m-0">{title}</h3>}
                </div>
            )}
            <div className="px-1" style={{ width: '100%', flex: 1 }}>
                {children}
            </div>
        </div>
    );
}

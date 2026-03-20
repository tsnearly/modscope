import React from 'react';

export type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
export type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps {
    children: React.ReactNode;
    variant?: BadgeVariant;
    size?: BadgeSize;
    className?: string;
}

export function Badge({
    children,
    variant = 'default',
    size = 'md',
    className = ''
}: BadgeProps) {
    const baseStyles = 'inline-flex items-center font-medium rounded-full';

    const variantStyles = {
        default: 'bg-gray-100 text-gray-700',
        primary: 'text-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        success: 'bg-primary/10 text-primary',
        warning: 'bg-yellow-100 text-yellow-700',
        danger: 'bg-red-100 text-red-700'
    };

    const sizeStyles = {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-sm',
        lg: 'px-3 py-1.5 text-base'
    };

    return (
        <span className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}>
            {children}
        </span>
    );
}

import React from 'react';
import { Icon } from './icon';

interface EntityTitleProps {
    icon?: string;
    iconSize?: number;
    iconColor?: string;
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
    className?: string;
}

export function EntityTitle({
    icon,
    iconSize = 20,
    iconColor,
    title,
    subtitle,
    actions,
    className = ''
}: EntityTitleProps) {
    // True URL src paths contain '/' (e.g. '/assets/icon.png') or http
    // lucide:icon-name and plain name strings should use the name prop
    const isUrl = icon && (icon.startsWith('http') || icon.startsWith('/'));

    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                {icon && (
                    isUrl ? (
                        <Icon src={icon} size={iconSize} color={iconColor} style={{ flexShrink: 0, marginTop: '2px' }} />
                    ) : (
                        <Icon name={icon} size={iconSize} color={iconColor} style={{ flexShrink: 0, marginTop: '2px' }} />
                    )
                )}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827', margin: 0, lineHeight: 1.2 }}>{title}</h2>
                    {subtitle && (
                        <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '2px 0 0 0' }}>{subtitle}</p>
                    )}
                </div>
            </div>
            {actions && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {actions}
                </div>
            )}
        </div>
    );
}

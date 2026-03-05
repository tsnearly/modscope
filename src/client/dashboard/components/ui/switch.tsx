import React, { InputHTMLAttributes } from 'react';

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label?: string;
    labelPosition?: 'left' | 'right';
}

export function Switch({
    label,
    labelPosition = 'right',
    className = '',
    ...props
}: SwitchProps) {
    return (
        <label className={`inline-flex items-center gap-2 cursor-pointer ${className}`}>
            {label && labelPosition === 'left' && (
                <span className="text-sm text-gray-700">{label}</span>
            )}
            <div className="relative">
                <input
                    type="checkbox"
                    className="sr-only peer"
                    {...props}
                />
                <div className="w-9 h-5 bg-gray-200 peer-checked:bg-[var(--btn-primary-bg)] peer-focus:outline-none peer-focus:ring-2 rounded-full transition-colors relative">
                    <div className="absolute top-[2px] left-[2px] peer-checked:left-[calc(100%-18px)] bg-white border-gray-300 border rounded-full h-4 w-4 transition-all" />
                </div>
            </div>
            {label && labelPosition === 'right' && (
                <span className="text-sm text-gray-700">{label}</span>
            )}
        </label>
    );
}

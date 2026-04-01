import React from 'react';
import { Icon } from './icon';

interface NonIdealStateProps {
  title: string;
  message: string;
  icon?: string;
  className?: string;
}

export function NonIdealState({
  title,
  message,
  icon = 'mono-unavailable',
  className = '',
}: NonIdealStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center ${className}`}
    >
      <Icon name={icon} size={48} className="opacity-30 mb-6" />
      <h3 className="text-lg font-bold mb-2 text-gray-800">{title}</h3>
      <p className="text-gray-500 text-sm max-w-md">{message}</p>
    </div>
  );
}

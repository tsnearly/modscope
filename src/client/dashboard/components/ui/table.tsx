import React from 'react';

interface TableProps {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
}

export const Table = React.forwardRef<HTMLDivElement, TableProps>(
  (
    { children, className = '', containerClassName = '', containerStyle },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={`w-full overflow-x-auto relative rounded-md border border-gray-200 bg-white shadow-sm ${containerClassName}`}
        style={containerStyle}
      >
        <table className={`w-full text-sm text-left ${className}`}>
          {children}
        </table>
      </div>
    );
  },
);

Table.displayName = 'Table';

export function TableHeader({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={`bg-gray-100 border-b border-gray-200 ${className}`}
      {...props}
    >
      {children}
    </thead>
  );
}

export function TableRow({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors ${className}`}
      {...props}
    >
      {children}
    </tr>
  );
}

import { Icon } from './icon';

export interface TableHeadProps
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sortDirection?: 'asc' | 'desc' | null;
  onSort?: () => void;
}

export function TableHead({
  children,
  className = '',
  sortable,
  sortDirection,
  onSort,
  ...props
}: TableHeadProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (sortable && onSort && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSort();
    }
  };

  return (
    <th
      className={`px-3 py-2 text-xs font-bold text-gray-700 uppercase tracking-wider text-left transition-colors ${sortable ? 'cursor-pointer hover:bg-gray-200/50 select-none' : ''} ${className}`}
      onClick={sortable ? onSort : undefined}
      onKeyDown={handleKeyDown}
      tabIndex={sortable ? 0 : undefined}
      role={sortable ? 'button' : undefined}
      aria-sort={
        sortDirection === 'asc'
          ? 'ascending'
          : sortDirection === 'desc'
            ? 'descending'
            : 'none'
      }
      {...props}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortable && (
          <div className="flex flex-col opacity-50 ml-1">
            {sortDirection === 'asc' ? (
              <Icon
                name="lucide:chevron-up"
                size="xxs"
                className="opacity-100"
              />
            ) : sortDirection === 'desc' ? (
              <Icon
                name="lucide:chevron-down"
                size="xxs"
                className="opacity-100"
              />
            ) : (
              <div className="flex flex-col -space-y-1">
                <Icon name="lucide:chevron-up" size="xxs" />
                <Icon name="lucide:chevron-down" size="xxs" />
              </div>
            )}
          </div>
        )}
      </div>
    </th>
  );
}

export function TableBody({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={`[&_tr:nth-child(even)]:bg-gray-50/50 ${className}`}
      {...props}
    >
      {children}
    </tbody>
  );
}

export function TableCell({
  children,
  className = '',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={`px-3 py-2 text-xs text-gray-600 align-middle ${className}`}
      {...props}
    >
      {children}
    </td>
  );
}

export function TableCaption({
  children,
  className = '',
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      className={'text-muted-foreground mt-4 text-sm $(className)'}
      {...props}
    >
      {children}
    </caption>
  );
}

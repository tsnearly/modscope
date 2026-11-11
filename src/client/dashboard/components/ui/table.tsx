import React from 'react';

interface TableProps {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}

export const Table = React.forwardRef<HTMLDivElement, TableProps>(
  (
    { children, className = '', containerClassName = '', containerStyle, style },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={`w-full overflow-x-auto relative rounded-md border border-gray-200 bg-white shadow-sm ${containerClassName}`}
        style={containerStyle}
      >
        <table style={style} className={`w-full text-sm text-left ${className}`}>
          {children}
        </table>
      </div>
    );
  }
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

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sortDirection?: 'asc' | 'desc' | null;
  onSort?: () => void;
  resizable?: boolean;
  onResizeStart?: (e: React.MouseEvent) => void;
  onResizeDoubleClick?: (e: React.MouseEvent) => void;
}

export function TableHead({
  children,
  className = '',
  sortable,
  sortDirection,
  onSort,
  resizable,
  onResizeStart,
  onResizeDoubleClick,
  ...props
}: TableHeadProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (sortable && onSort && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSort();
    }
  };

  const isRightAligned = className.includes('text-right');
  const isCenterAligned = className.includes('text-center');

  return (
    <th
      className={`px-2 py-1 sm:px-3 sm:py-2 text-[10px] sm:text-xs font-bold text-gray-700 uppercase tracking-wider text-left transition-colors overflow-hidden ${
        resizable ? 'relative select-none' : ''
      } ${sortable ? 'cursor-pointer hover:bg-gray-200/50 select-none' : ''} ${className}`}
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
      <div
        className={`flex items-center gap-1 w-full min-w-0 ${
          isRightAligned
            ? 'justify-end'
            : isCenterAligned
              ? 'justify-center'
              : 'justify-start'
        }`}
      >
        <div
          className={`truncate min-w-0 ${
            isRightAligned
              ? 'text-right'
              : isCenterAligned
                ? 'text-center'
                : 'text-left'
          }`}
        >
          {children}
        </div>
        {sortable && (
          <div className="flex flex-col opacity-50 ml-1 flex-shrink-0">
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
      {resizable && (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={onResizeStart}
          onDoubleClick={onResizeDoubleClick}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize select-none touch-none z-20 flex justify-center items-center group/resizer hover:bg-primary/20 active:bg-primary/40"
        >
          <div className="w-[1.5px] h-3.5 bg-border group-hover/resizer:bg-primary group-active/resizer:bg-primary group-hover/resizer:h-full transition-all" />
        </div>
      )}
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
      className={`px-2 py-1 sm:px-3 sm:py-2 text-[11px] sm:text-xs text-gray-600 align-middle ${className}`}
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

import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';

import { cn } from '../../utils/cn';
import { Button } from './button';
import { Calendar } from './calendar';
import { Dialog, DialogContent, DialogTrigger } from './dialog';

export interface DatePickerProps {
  date?: Date;
  setDate: (date: Date | undefined) => void;
  className?: string;
  placeholder?: string;
}

export function DatePicker({
  date,
  setDate,
  className,
  placeholder = 'Pick a date',
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={'outline'}
          className={cn(
            'w-[240px] justify-start text-left font-normal',
            !date && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, 'PPP') : <span>{placeholder}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-auto p-0 border-0 bg-transparent shadow-none">
        <div className="bg-popover border rounded-md shadow-md p-0">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => {
              setDate(d);
              setOpen(false);
            }}
            initialFocus
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

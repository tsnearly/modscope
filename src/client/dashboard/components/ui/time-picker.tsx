import * as React from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Button } from './button';
import { Label } from './label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from './dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

export interface TimePickerProps {
  value?: string; // HH:mm format, 24h
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  name?: string;
}

export function TimePicker({
  value = '09:00',
  onChange,
  label,
  className,
  name,
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [tempTime, setTempTime] = React.useState(value);

  // Initial sync
  React.useEffect(() => {
    if (open) {
      setTempTime(value);
    }
  }, [open, value]);

  // Parse time
  const [hours, minutes] = tempTime.split(':').map(Number);
  const isPM = hours >= 12;
  const displayHours = hours % 12 || 12;

  const handleHourChange = (newHourStr: string) => {
    const newHour = parseInt(newHourStr);
    let finalHour = newHour;
    if (isPM && finalHour !== 12) {
      finalHour += 12;
    }
    if (!isPM && finalHour === 12) {
      finalHour = 0;
    }

    setTempTime(
      `${finalHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
    );
  };

  const handleMinuteChange = (newMinuteStr: string) => {
    setTempTime(`${hours.toString().padStart(2, '0')}:${newMinuteStr}`);
  };

  const handleAmPmChange = (ampm: 'AM' | 'PM') => {
    let newHour = hours;
    if (ampm === 'PM' && newHour < 12) {
      newHour += 12;
    }
    if (ampm === 'AM' && newHour >= 12) {
      newHour -= 12;
    }
    setTempTime(
      `${newHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
    );
  };

  const handleSave = () => {
    onChange(tempTime);
    setOpen(false);
  };

  // --- Analog Clock Logic ---
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = React.useState<'hour' | 'minute' | null>(
    null,
  );

  const radius = 90;
  const center = 100;
  const hourHandLength = 50;
  const minuteHandLength = 70;

  // Angles (degrees)
  const hourAngle = (displayHours % 12) * 30 + minutes / 2;
  const minuteAngle = minutes * 6;

  const getPointerAngle = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) {
      return 0;
    }
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - center; // Scale if needed, but viewBox 0 0 200 200 and explicit width should match
    // Need to account for potential scaling if CSS width != viewBox width.
    // Assuming SVG is square and rendered at natural aspect ratio.
    // Better:
    const xRel = e.clientX - (rect.left + rect.width / 2);
    const yRel = e.clientY - (rect.top + rect.height / 2);

    let angle = Math.atan2(yRel, xRel) * (180 / Math.PI) + 90;
    if (angle < 0) {
      angle += 360;
    }
    return angle;
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) {
      return;
    }
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    // Check distance to hand tips to determine what to drag
    // Scale factors
    const scaleX = 200 / rect.width;
    const scaleY = 200 / rect.height;

    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Calculate tip positions
    const hRad = (hourAngle - 90) * (Math.PI / 180);
    const mRad = (minuteAngle - 90) * (Math.PI / 180);

    const hTipX = center + Math.cos(hRad) * hourHandLength;
    const hTipY = center + Math.sin(hRad) * hourHandLength;

    const mTipX = center + Math.cos(mRad) * minuteHandLength;
    const mTipY = center + Math.sin(mRad) * minuteHandLength;

    const distToH = Math.hypot(clickX - hTipX, clickY - hTipY);
    const distToM = Math.hypot(clickX - mTipX, clickY - mTipY);

    // Threshold for grabbing
    const threshold = 20;

    if (distToH < threshold) {
      setIsDragging('hour');
      (e.target as Element).setPointerCapture(e.pointerId);
    } else if (distToM < threshold) {
      setIsDragging('minute');
      (e.target as Element).setPointerCapture(e.pointerId);
    } else {
      // Optional: Click anywhere to set quickest/closest?
      // For now, only drag hands interaction as requested "moveable hands"
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging) {
      return;
    }
    e.preventDefault();

    const angle = getPointerAngle(e);

    if (isDragging === 'hour') {
      // Snap to 12 positions (30 degrees)
      const snappedAngle = Math.round(angle / 30) * 30;
      // Convert angle back to hour (0-11)
      let h = Math.round(snappedAngle / 30);
      if (h === 0) {
        h = 12;
      }
      if (h > 12) {
        h -= 12;
      } // Normalize 360 -> 12

      // Handle 12 vs 0 logic for AM/PM preservation
      let newH24 = h;
      if (h === 12) {
        if (!isPM) {
          newH24 = 0;
        } else {
          newH24 = 12;
        }
      } else {
        if (isPM) {
          newH24 = h + 12;
        } else {
          newH24 = h;
        }
      }

      setTempTime(
        `${newH24.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
      );
    } else if (isDragging === 'minute') {
      // Snap to 60 positions (6 degrees)
      // Maybe 5 minute increments for easier dragging? Let's do 1 minute for "professional" feel
      const snappedAngle = Math.round(angle / 6) * 6;
      let m = Math.round(snappedAngle / 6);
      if (m >= 60) {
        m = 0;
      }

      setTempTime(
        `${hours.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setIsDragging(null);
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  // Visual Elements
  const renderMarkers = () => {
    const els = [];
    for (let i = 0; i < 60; i++) {
      const isHour = i % 5 === 0;
      const angle = i * 6 * (Math.PI / 180);
      const length = isHour ? 15 : 8;
      const width = isHour ? 2 : 1;
      const color = isHour ? 'text-slate-400' : 'text-slate-200';

      const x1 = center + Math.sin(angle) * (radius - length);
      const y1 = center - Math.cos(angle) * (radius - length);
      const x2 = center + Math.sin(angle) * (radius - 5); // padding from edge
      const y2 = center - Math.cos(angle) * (radius - 5);

      els.push(
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="currentColor"
          strokeWidth={width}
          className={color}
        />,
      );
    }
    return els;
  };

  return (
    <div className={cn('grid w-full max-w-sm items-center gap-1.5', className)}>
      {label && <Label>{label}</Label>}
      {name && <input type="hidden" name={name} value={value} />}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant={'outline'}
            className={cn(
              'w-full h-9 justify-start text-left font-normal pl-3 bg-background',
              !value && 'text-muted-foreground',
            )}
            onClick={() => setTempTime(value)}
          >
            <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
            {value ? (
              (() => {
                const [h, m] = value.split(':').map(Number);
                const suffix = h >= 12 ? 'PM' : 'AM';
                const displayH = h % 12 || 12;
                return `${displayH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${suffix}`;
              })()
            ) : (
              <span>Set Time</span>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[350px] flex flex-col items-center bg-[#1f2329] border-[#2a2e35] text-slate-100">
          <DialogHeader className="w-full">
            <DialogTitle className="text-center pb-4 border-b border-[#2a2e35] text-xl">
              Set Time
            </DialogTitle>
          </DialogHeader>

          {/* Analog Clock */}
          <div className="relative w-64 h-64 mt-6 mb-2">
            {/* Bezel / Face */}
            <div className="absolute inset-0 rounded-full border-[6px] border-[#2a2e35] bg-white shadow-2xl flex items-center justify-center overflow-hidden">
              {/* Inner shadow for depth */}
              <div className="absolute inset-0 rounded-full shadow-[inset_0_0_20px_rgba(0,0,0,0.1)] pointer-events-none" />

              <svg
                ref={svgRef}
                width="200"
                height="200"
                viewBox="0 0 200 200"
                className="text-slate-800 touch-none cursor-pointer"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                {/* Center branding/deco (optional) */}
                <text
                  x="100"
                  y="60"
                  textAnchor="middle"
                  className="text-[10px] fill-slate-300 font-bold tracking-widest"
                >
                  MODSCOPE
                </text>

                {/* Markers */}
                {renderMarkers()}

                {/* Numbers (Hours) - Optional, can get crowded, user image shows clean face with ticks */}

                {/* Hands */}
                {/* Hour Hand */}
                <g transform={`rotate(${hourAngle}, ${center}, ${center})`}>
                  {/* Shadow */}
                  <line
                    x1={center + 2}
                    y1={center + 2}
                    x2={center + 2}
                    y2={center - hourHandLength + 2}
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                  {/* Hand */}
                  <line
                    x1={center}
                    y1={center}
                    x2={center}
                    y2={center - hourHandLength}
                    stroke="currentColor"
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                </g>

                {/* Minute Hand */}
                <g transform={`rotate(${minuteAngle}, ${center}, ${center})`}>
                  {/* Shadow */}
                  <line
                    x1={center + 2}
                    y1={center + 2}
                    x2={center + 2}
                    y2={center - minuteHandLength + 2}
                    stroke="rgba(0,0,0,0.1)"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  {/* Hand */}
                  <line
                    x1={center}
                    y1={center}
                    x2={center}
                    y2={center - minuteHandLength}
                    stroke="#000000ff"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <circle
                    cx={center}
                    cy={center - minuteHandLength}
                    r="2"
                    fill="#000000ff"
                  />
                </g>

                {/* Center Cap */}
                <circle cx={center} cy={center} r="6" fill="currentColor" />
                <circle cx={center} cy={center} r="2" fill="#2d2d2dff" />

                {/* Drag Handles (Invisible larger targets for easier grabbing) */}
                <circle
                  cx={
                    center +
                    Math.sin((hourAngle * Math.PI) / 180) * hourHandLength
                  }
                  cy={
                    center -
                    Math.cos((hourAngle * Math.PI) / 180) * hourHandLength
                  }
                  r="15"
                  fill="transparent"
                  cursor="grab"
                />
                <circle
                  cx={
                    center +
                    Math.sin((minuteAngle * Math.PI) / 180) * minuteHandLength
                  }
                  cy={
                    center -
                    Math.cos((minuteAngle * Math.PI) / 180) * minuteHandLength
                  }
                  r="15"
                  fill="transparent"
                  cursor="grab"
                />
              </svg>
            </div>
          </div>

          {/* Digital Inputs */}
          {/* Contrast Fix: Wrapper is lightish, keeping it white/slate-100 */}
          <div className="flex items-center gap-2 mt-6 w-full justify-center bg-slate-100 p-4 rounded-xl border border-slate-200">
            {/* Hour */}
            <Select
              value={displayHours.toString()}
              onValueChange={handleHourChange}
            >
              {/* Explicit Light Text Colors for these inputs since they are on white bg */}
              <SelectTrigger className="w-[64px] px-2 bg-white border border-slate-200 shadow-sm font-mono text-sm font-bold text-center justify-center text-slate-900 focus:ring-slate-400">
                <SelectValue placeholder="HH" />
              </SelectTrigger>
              <SelectContent className="max-h-[200px] bg-white text-slate-900 border-slate-200">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <SelectItem
                    key={h}
                    value={h.toString()}
                    className="focus:bg-slate-100 focus:text-slate-900"
                  >
                    {h.toString().padStart(2, '0')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-xl font-bold text-slate-400">:</span>

            {/* Minute */}
            <Select
              value={minutes.toString().padStart(2, '0')}
              onValueChange={handleMinuteChange}
            >
              <SelectTrigger className="w-[64px] px-2 bg-white border border-slate-200 shadow-sm font-mono text-sm font-bold text-center justify-center text-slate-900 focus:ring-slate-400">
                <SelectValue placeholder="MM" />
              </SelectTrigger>
              <SelectContent className="max-h-[200px] bg-white text-slate-900 border-slate-200">
                {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                  <SelectItem
                    key={m}
                    value={m.toString().padStart(2, '0')}
                    className="focus:bg-slate-100 focus:text-slate-900"
                  >
                    {m.toString().padStart(2, '0')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="w-4"></div>

            {/* AM/PM */}
            <Select
              value={isPM ? 'PM' : 'AM'}
              onValueChange={(val) => handleAmPmChange(val as 'AM' | 'PM')}
            >
              <SelectTrigger className="w-[64px] px-2 bg-white border border-slate-200 shadow-sm font-mono text-sm font-bold text-center justify-center text-slate-900 focus:ring-slate-400">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white text-slate-900 border-slate-200">
                <SelectItem
                  value="AM"
                  className="focus:bg-slate-100 focus:text-slate-900"
                >
                  AM
                </SelectItem>
                <SelectItem
                  value="PM"
                  className="focus:bg-slate-100 focus:text-slate-900"
                >
                  PM
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="w-full mt-6">
            <div className="flex w-full gap-2 px-2">
              <DialogClose asChild>
                <Button variant="secondary" className="flex-1">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                onClick={handleSave}
                variant="default"
                className="flex-1 h-11 text-base font-semibold shadow-lg"
              >
                Set Time
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

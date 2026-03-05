import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "../../utils/cn"

export interface PopoverProps {
    content: React.ReactNode
    children: React.ReactNode
    side?: "top" | "right" | "bottom" | "left"
    align?: "start" | "center" | "end"
    sideOffset?: number
    className?: string
    showArrow?: boolean
}

export function Popover({
    content,
    children,
    side = "bottom",
    align = "center",
    sideOffset = 4,
    className,
    showArrow = true,
}: PopoverProps) {
    return (
        <PopoverPrimitive.Root>
            <PopoverPrimitive.Trigger asChild>
                <div className="inline-block cursor-pointer">
                    {children}
                </div>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                    side={side}
                    align={align}
                    sideOffset={sideOffset}
                    className={cn(
                        "z-[9999] w-72 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text)] shadow-lg outline-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
                        className
                    )}
                >
                    {content}
                    {showArrow && (
                        <PopoverPrimitive.Arrow className="fill-[var(--color-border)]" />
                    )}
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    )
}

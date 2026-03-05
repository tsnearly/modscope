import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check, Minus } from "lucide-react"

import { cn } from "../../utils/cn"

interface CheckboxProps extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
    label?: string
    description?: string
    invalid?: boolean
    indeterminate?: boolean
    icon?: React.ReactNode
    className?: string
}

const Checkbox = React.forwardRef<
    React.ElementRef<typeof CheckboxPrimitive.Root>,
    CheckboxProps
>(({ className, label, description, invalid, indeterminate, icon, ...props }, ref) => {
    const checkboxElement = (
        <CheckboxPrimitive.Root
            ref={ref}
            className={cn(
                "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
                "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
                invalid && "border-destructive",
                className
            )}
            data-flux-checkbox
            data-checked={props.checked ? "" : undefined}
            data-indeterminate={indeterminate ? "" : undefined}
            {...props}
        >
            <CheckboxPrimitive.Indicator
                className={cn("flex items-center justify-center text-current")}
            >
                {indeterminate ? (
                    <Minus className="h-3 w-3" />
                ) : icon ? (
                    icon
                ) : (
                    <Check className="h-3 w-3" />
                )}
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    )

    // If no label or description, return just the checkbox
    if (!label && !description) {
        return checkboxElement
    }

    // Return checkbox with label and optional description
    return (
        <div className="flex items-start gap-3">
            {checkboxElement}
            {(label || description) && (
                <div className="flex flex-col gap-1">
                    {label && (
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {label}
                        </label>
                    )}
                    {description && (
                        <p className="text-sm text-muted-foreground">
                            {description}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
})
Checkbox.displayName = CheckboxPrimitive.Root.displayName

interface CheckboxGroupProps {
    label?: string
    description?: string
    variant?: "default" | "cards" | "pills" | "buttons"
    disabled?: boolean
    invalid?: boolean
    className?: string
    children: React.ReactNode
}

const CheckboxGroup = React.forwardRef<HTMLDivElement, CheckboxGroupProps>(
    ({ label, description, variant = "default", disabled, invalid, className, children }, ref) => {
        return (
            <div ref={ref} className={cn("flex flex-col gap-3", className)}>
                {(label || description) && (
                    <div className="flex flex-col gap-1">
                        {label && (
                            <label className="text-sm font-medium leading-none">
                                {label}
                            </label>
                        )}
                        {description && (
                            <p className="text-sm text-muted-foreground">
                                {description}
                            </p>
                        )}
                    </div>
                )}
                <div
                    className={cn(
                        // default: vertical stack
                        variant === "default" && "flex flex-col gap-2",
                        // cards: full-width bordered card rows
                        variant === "cards" && "flex flex-col gap-2",
                        // pills: horizontal wrapping pill badges
                        variant === "pills" && "flex flex-row flex-wrap gap-2",
                        // buttons: horizontal attached button group
                        variant === "buttons" && "inline-flex flex-row rounded-md border border-input overflow-hidden divide-x divide-input"
                    )}
                    data-variant={variant}
                    data-disabled={disabled ? "" : undefined}
                    data-invalid={invalid ? "" : undefined}
                >
                    {children}
                </div>
            </div>
        )
    }
)
CheckboxGroup.displayName = "CheckboxGroup"

interface CheckboxCardProps extends CheckboxProps {
    icon?: React.ReactNode
    children?: React.ReactNode
}

const CheckboxCard = React.forwardRef<
    React.ElementRef<typeof CheckboxPrimitive.Root>,
    CheckboxCardProps
>(({ className, label, description, icon, children, ...props }, ref) => {
    return (
        <label
            className={cn(
                "flex items-start gap-3 rounded-lg border border-input bg-background p-4 cursor-pointer",
                "hover:bg-accent hover:border-accent-foreground/20 transition-colors",
                "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
                "has-[:checked]:border-primary has-[:checked]:bg-accent",
                className
            )}
        >
            <CheckboxPrimitive.Root
                ref={ref}
                className={cn(
                    "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background mt-0.5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                )}
                {...props}
            >
                <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
                    <Check className="h-3 w-3" />
                </CheckboxPrimitive.Indicator>
            </CheckboxPrimitive.Root>
            <div className="flex-1 flex items-start gap-3">
                {icon && <div className="text-muted-foreground">{icon}</div>}
                <div className="flex flex-col gap-1">
                    {label && (
                        <div className="text-sm font-medium leading-none">
                            {label}
                        </div>
                    )}
                    {description && (
                        <p className="text-sm text-muted-foreground">
                            {description}
                        </p>
                    )}
                    {children}
                </div>
            </div>
        </label>
    )
})
CheckboxCard.displayName = "CheckboxCard"

interface CheckboxPillProps extends CheckboxProps { }

const CheckboxPill = React.forwardRef<
    React.ElementRef<typeof CheckboxPrimitive.Root>,
    CheckboxPillProps
>(({ className, label, ...props }, ref) => {
    return (
        <label
            className={cn(
                "inline-flex items-center gap-2 rounded-full border border-input bg-background px-3 py-1.5 cursor-pointer",
                "hover:bg-accent hover:border-accent-foreground/20 transition-colors",
                "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
                "has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground",
                className
            )}
        >
            <CheckboxPrimitive.Root
                ref={ref}
                className="sr-only"
                {...props}
            >
                <CheckboxPrimitive.Indicator />
            </CheckboxPrimitive.Root>
            {label && (
                <span className="text-sm font-medium">
                    {label}
                </span>
            )}
        </label>
    )
})
CheckboxPill.displayName = "CheckboxPill"

export { Checkbox, CheckboxGroup, CheckboxCard, CheckboxPill }

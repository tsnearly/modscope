import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "../../utils/cn"

const headingVariants = cva(
    "font-medium text-foreground",
    {
        variants: {
            size: {
                default: "text-sm",
                lg: "text-base",
                xl: "text-2xl",
            },
        },
        defaultVariants: {
            size: "default",
        },
    }
)

export interface HeadingProps
    extends React.HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
    asChild?: boolean
}

const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
    ({ className, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "h3"
        return (
            <Comp
                className={cn(headingVariants({ size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Heading.displayName = "Heading"

export { Heading, headingVariants }

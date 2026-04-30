import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 ease-[var(--ease-spring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        ghost:
          'text-bridge-500 hover:text-copper-500 hover:bg-copper-400/10',
        outline:
          'border border-paper-200 bg-white hover:border-copper-400 hover:bg-copper-400/5 text-bridge-700',
        secondary:
          'bg-paper-100 text-bridge-800 hover:bg-paper-200',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        chip:
          'bg-paper-50 text-bridge-700 border border-paper-200 hover:border-copper-400 hover:text-copper-600 hover:-translate-y-px hover:shadow-sm',
      },
      size: {
        default: 'h-9 px-3 [&_svg]:size-4',
        sm: 'h-8 px-2.5 text-xs [&_svg]:size-3.5',
        lg: 'h-10 px-4 [&_svg]:size-4',
        icon: 'h-8 w-8 [&_svg]:size-4',
        'icon-sm': 'h-7 w-7 [&_svg]:size-3.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };

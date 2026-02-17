import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'default' | 'destructive' | 'outline';
    size?: 'default' | 'sm' | 'lg';
    asChild?: boolean;
}

export function Button({ className = '', variant = 'default', size = 'default', asChild, children, ...props }: ButtonProps) {
    const sizeClasses = {
        default: 'px-4 py-2 text-sm',
        sm: 'px-3 py-1.5 text-xs',
        lg: 'px-6 py-3 text-base',
    };

    const variantClasses = {
        default: 'bg-[#00e5cc] text-black hover:bg-[#00c4ad]',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        outline: 'border border-[#333] bg-transparent text-white hover:bg-[#333]',
    };

    const baseClasses = `inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`;

    if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            className: baseClasses,
        });
    }

    return (
        <button className={baseClasses} {...props}>
            {children}
        </button>
    );
}

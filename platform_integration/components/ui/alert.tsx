import React from 'react';

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'destructive';
}

export function Alert({ className = '', variant = 'default', children, ...props }: AlertProps) {
    const variantClasses = {
        default: 'border-[#333] bg-[#1a1a2e] text-white',
        destructive: 'border-red-600/50 bg-red-600/10 text-red-400',
    };

    return (
        <div className={`rounded-lg border p-4 ${variantClasses[variant]} ${className}`} {...props}>
            {children}
        </div>
    );
}

export function AlertDescription({ className = '', children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
    return (
        <p className={`text-sm ${className}`} {...props}>
            {children}
        </p>
    );
}

import React from 'react';

export function Label({ className = '', children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
    return (
        <label className={`text-sm font-medium text-[#ccc] ${className}`} {...props}>
            {children}
        </label>
    );
}

import React from 'react';

export function Card({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={`rounded-lg border border-[#333] bg-[#1a1a2e] ${className}`} {...props}>
            {children}
        </div>
    );
}

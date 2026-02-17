import React from 'react';

export function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={`flex h-10 w-full rounded-md border border-[#333] bg-[#0a0f1a] px-3 py-2 text-sm text-white placeholder:text-[#666] focus:outline-none focus:ring-1 focus:ring-[#00e5cc] disabled:opacity-50 ${className}`}
            {...props}
        />
    );
}

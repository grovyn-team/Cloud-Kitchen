import React from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'healthy' | 'at_risk' | 'critical' | 'info' | 'warning' | 'success' | 'neutral';

const variantClasses: Record<BadgeVariant, string> = {
  healthy: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  at_risk: 'bg-amber-100 text-amber-800 border-amber-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
  info: 'bg-sky-100 text-sky-800 border-sky-200',
  neutral: 'bg-gray-100 text-gray-700 border-gray-200',
};

interface StatusBadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function StatusBadge({ children, variant = 'neutral', className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export function severityToBadgeVariant(severity: string): BadgeVariant {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'info';
}

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface InsightCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function InsightCard({ title, children, className }: InsightCardProps) {
  return (
    <Card className={cn('rounded-[14px] shadow-card', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

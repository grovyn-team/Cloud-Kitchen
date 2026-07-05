function formatIndian(num: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num);
}

interface MonthProjection {
  month: number;
  revenue: number;
  cogs: number;
  commission: number;
  fixedCosts: number;
  netProfit: number;
  cumulative: number;
  rampMultiplier: number;
}

interface SetupCosts {
  equipment: number;
  renovation: number;
  deposit: number;
  inventory: number;
  total: number;
}

interface FinancialBreakdownProps {
  projections: MonthProjection[];
  setupCosts: SetupCosts;
  breakevenMonth: number | string;
}

export function FinancialBreakdown({ projections, setupCosts, breakevenMonth }: FinancialBreakdownProps) {
  const isNum = typeof breakevenMonth === 'number';
  const rowClass = (m: MonthProjection) => (isNum && m.month === breakevenMonth ? 'bg-[#22c55e]/10 font-semibold' : 'border-b border-border/60');
  const netClass = (n: number) => (n >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]');
  const cumClass = (n: number) => (n >= 0 ? 'text-[#22c55e]' : 'text-foreground');
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#3b82f6]/30 bg-[#3b82f6]/5 p-4">
        <h4 className="mb-3 font-semibold text-foreground">Initial investment required</h4>
        <div className="grid gap-4 text-sm sm:grid-cols-5">
          <div><div className="text-muted-foreground">Equipment</div><div className="font-semibold">₹{formatIndian(setupCosts.equipment)}</div></div>
          <div><div className="text-muted-foreground">Renovation</div><div className="font-semibold">₹{formatIndian(setupCosts.renovation)}</div></div>
          <div><div className="text-muted-foreground">Deposit</div><div className="font-semibold">₹{formatIndian(setupCosts.deposit)}</div></div>
          <div><div className="text-muted-foreground">Inventory</div><div className="font-semibold">₹{formatIndian(setupCosts.inventory)}</div></div>
          <div className="border-l-2 border-[#3b82f6]/30 pl-4"><div className="text-muted-foreground">Total per store</div><div className="font-bold text-[#3b82f6]">₹{formatIndian(setupCosts.total)}</div></div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium uppercase tracking-wide text-muted-foreground">Month</th>
              <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-muted-foreground">Revenue</th>
              <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-muted-foreground">COGS</th>
              <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-muted-foreground">Commission</th>
              <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-muted-foreground">Fixed</th>
              <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-muted-foreground">Net profit</th>
              <th className="px-4 py-2 text-right font-medium uppercase tracking-wide text-muted-foreground">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {projections.slice(0, 6).map((m) => (
              <tr key={m.month} className={rowClass(m)}>
                <td className="px-4 py-2">Month {m.month}{m.month <= 3 ? <span className="ml-2 text-xs text-muted-foreground">({Math.round(m.rampMultiplier * 100)}%)</span> : null}</td>
                <td className="px-4 py-2 text-right">₹{formatIndian(m.revenue)}</td>
                <td className="px-4 py-2 text-right text-[#ef4444]">₹{formatIndian(m.cogs)}</td>
                <td className="px-4 py-2 text-right text-[#ef4444]">₹{formatIndian(m.commission)}</td>
                <td className="px-4 py-2 text-right text-[#ef4444]">₹{formatIndian(m.fixedCosts)}</td>
                <td className={'px-4 py-2 text-right font-semibold ' + netClass(m.netProfit)}>₹{formatIndian(m.netProfit)}</td>
                <td className={'px-4 py-2 text-right font-semibold ' + cumClass(m.cumulative)}>₹{formatIndian(m.cumulative)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isNum && <div className="flex items-center text-sm text-muted-foreground"><div className="mr-2 h-3 w-3 rounded-full bg-[#22c55e]" /><span>Breakeven in Month <strong className="text-foreground">{breakevenMonth}</strong></span></div>}
      {!isNum && <div className="text-sm text-muted-foreground">Breakeven {String(breakevenMonth).toLowerCase()}</div>}
    </div>
  );
}

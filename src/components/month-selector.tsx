"use client";

import { ChangeEvent } from "react";
import { CalendarDays } from "lucide-react";

interface MonthSelectorProps {
  months: string[];
  value: string | null;
  onChange: (value: string | null) => void;
}

export function MonthSelector({ months, value, onChange }: MonthSelectorProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    onChange(newValue === "all" ? null : newValue);
  };

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-panel px-4 py-2 shadow-sm">
      <CalendarDays className="h-4 w-4 text-primary" />
      <select
        value={value ?? "all"}
        onChange={handleChange}
        className="bg-transparent text-sm font-medium text-muted focus:outline-none"
      >
        <option value="all">全期間表示</option>
        {months.map((month) => (
          <option key={month} value={month}>
            {month}
          </option>
        ))}
      </select>
    </div>
  );
}

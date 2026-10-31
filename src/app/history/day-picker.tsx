"use client";

import { useRouter } from "next/navigation";

/** Calendar to jump to any day up to today. */
export function DayPicker({ day, today, label }: { day: string; today: string; label: string }) {
  const router = useRouter();
  return (
    <input
      type="date"
      aria-label={label}
      value={day}
      max={today}
      onChange={(e) => e.target.value && e.target.value <= today && router.push(`/history?date=${e.target.value}`)}
      className="min-w-0 flex-1 rounded-control border-2 border-line-strong bg-surface px-3 py-3 text-center text-lg"
    />
  );
}

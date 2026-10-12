"use client";

import { useRouter } from "next/navigation";

/** Calendar to jump to any day up to today. */
export function DayPicker({ day, today }: { day: string; today: string }) {
  const router = useRouter();
  return (
    <input
      type="date"
      value={day}
      max={today}
      onChange={(e) => e.target.value && e.target.value <= today && router.push(`/history?date=${e.target.value}`)}
      className="min-w-0 flex-1 rounded-xl border-2 border-stone-300 bg-white px-3 py-3 text-center text-lg"
    />
  );
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type SubjectIdTheme = "technique" | "data-component" | "detection-strategy" | "analytic"

const subjectIdThemeClasses: Record<SubjectIdTheme, string> = {
  technique: "border-red-500/35 bg-red-500/12 text-red-300",
  "data-component": "border-cyan-500/35 bg-cyan-500/12 text-cyan-300",
  "detection-strategy": "border-sky-500/35 bg-sky-500/12 text-sky-300",
  analytic: "border-amber-500/35 bg-amber-500/14 text-amber-300",
}

export function subjectIdPillClass(subject: SubjectIdTheme) {
  return cn("font-mono", subjectIdThemeClasses[subject])
}

/**
 * Line icons drawn inline (24px grid, 2px stroke), so no icon library is
 * needed and they take the text colour. Decorative by default: give the
 * button around an icon its own label.
 */
const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  orders: "M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1ZM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 11h6M9 15h4",
  pending: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  stock: "M3 8l9-5 9 5v8l-9 5-9-5V8Zm0 0 9 5 9-5M12 13v8",
  truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  back: "M15 5l-7 7 7 7",
  chevron: "M9 5l7 7-7 7",
  down: "M6 9l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  checkCircle: "M8 12.5l2.5 2.5L16 9.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  alert: "M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  halfCircle: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18",
  circle: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  ban: "M5.6 5.6l12.8 12.8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4-4",
  close: "M6 6l12 12M18 6 6 18",
  menu: "M4 7h16M4 12h16M4 17h16",
  camera: "M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v2",
  keyboard: "M3 7h18v10H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",
  paperclip: "M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7L9.6 17.3a1.7 1.7 0 0 1-2.4-2.4L14.5 7.6",
  edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.5a6 6 0 0 1 3 5.5",
  tag: "M3 12V4h8l10 10-8 8L3 12Zm5-4h.01",
  inbox: "M4 13h4l1.5 3h5L16 13h4M4 13l2-8h12l2 8v6H4v-6Z",
  share: "M12 15V3M8 7l4-4 4 4M5 12v8h14v-8",
  phone: "M7 3h10v18H7zM11 18h2",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  note: "M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h7M9 16h5",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  box: "M3 8l9-5 9 5v8l-9 5-9-5V8Zm0 0 9 5 9-5M12 13v8",
  count: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3",
  download: "M12 3v12M8 11l4 4 4-4M5 21h14",
  building: "M5 21V5l7-2v18M12 8h7v13M8 8h.01M8 12h.01M8 16h.01M15 12h.01M15 16h.01M3 21h18",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  question: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  wifiOff: "M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.4-1.7M2 9.5a15 15 0 0 1 4.3-2.7M22 9.5A15 15 0 0 0 11 6M12 20h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className = "", strokeWidth = 2 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}

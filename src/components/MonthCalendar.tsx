"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import KaTeXSymbol from "./KaTeXSymbol";

type MonthCalendarProps = {
  timestamp: number;
  onDateSelect: (ts: number) => void;
  color: string;
  bgColor: string;
  fontFamily: string;
  fontSize: number;
  liveTimestampRef?: React.RefObject<number | null>;
  countUpActive: boolean;
};

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const DAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

function tsToDateParts(ts: number) {
  const d = new Date(ts * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function datePartsToTs(year: number, month: number, day: number) {
  return Math.floor(Date.UTC(year, month, day, 12, 0, 0) / 1000);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function firstDayOfWeek(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1)).getUTCDay();
}

export default function MonthCalendar({
  timestamp,
  onDateSelect,
  color,
  bgColor,
  fontFamily,
  fontSize,
  liveTimestampRef,
  countUpActive,
}: MonthCalendarProps) {
  const { year: initYear, month: initMonth, day: initDay } = tsToDateParts(timestamp);
  const [viewYear, setViewYear] = useState(initYear);
  const [viewMonth, setViewMonth] = useState(initMonth);
  const [selectedDay, setSelectedDay] = useState(initDay);
  const headerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const prevMonthRef = useRef({ year: initYear, month: initMonth });
  const colorRef = useRef(color);
  const bgColorRef = useRef(bgColor);

  // Keep color refs current for rAF reads
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { bgColorRef.current = bgColor; }, [bgColor]);

  // Sync when timestamp prop changes (not from count-up)
  useEffect(() => {
    if (!countUpActive) {
      const { year, month, day } = tsToDateParts(timestamp);
      setViewYear(year);
      setViewMonth(month);
      setSelectedDay(day);
    }
  }, [timestamp, countUpActive]);

  // rAF loop for count-up mode: read liveTimestampRef, update DOM directly
  useEffect(() => {
    if (!countUpActive || !liveTimestampRef) return;
    let rafId: number;
    let lastDay = -1;

    const applyHighlight = (day: number) => {
      const c = colorRef.current;
      const bg = bgColorRef.current;
      for (let i = 0; i < cellRefs.current.length; i++) {
        const btn = cellRefs.current[i];
        if (!btn) continue;
        if (i + 1 === day) {
          btn.style.backgroundColor = c;
          btn.style.color = bg;
        } else {
          btn.style.backgroundColor = "transparent";
          btn.style.color = c;
        }
      }
    };

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const ts = liveTimestampRef.current;
      if (ts == null) return;

      const { year, month, day } = tsToDateParts(ts);

      // Update header text directly
      if (headerRef.current) {
        headerRef.current.textContent = `${MONTH_NAMES[month]} ${year}`;
      }

      // If month changed, trigger React re-render to rebuild the grid
      if (year !== prevMonthRef.current.year || month !== prevMonthRef.current.month) {
        prevMonthRef.current = { year, month };
        lastDay = -1;
        setViewYear(year);
        setViewMonth(month);
        setSelectedDay(day);
      } else if (day !== lastDay) {
        lastDay = day;
        applyHighlight(day);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [countUpActive, liveTimestampRef]);

  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
    setSelectedDay(-1);
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
    setSelectedDay(-1);
  }, []);

  const handleDayClick = useCallback((day: number) => {
    setSelectedDay(day);
    const ts = datePartsToTs(viewYear, viewMonth, day);
    onDateSelect(ts);
  }, [viewYear, viewMonth, onDateSelect]);

  const dim = daysInMonth(viewYear, viewMonth);
  const firstDay = firstDayOfWeek(viewYear, viewMonth);

  // Build grid cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Reset cellRefs array for this render
  cellRefs.current = new Array(dim).fill(null);

  const cellSize = `${fontSize * 2}px`;
  const arrowSize = `${fontSize * 0.85}px`;

  // When count-up is active, don't apply React highlights — rAF owns the DOM styles
  const isActive = (day: number | null) => !countUpActive && day === selectedDay;

  return (
    <div style={{ color, fontFamily, userSelect: "none", fontSize: `${fontSize}px` }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="px-2 py-1 hover:opacity-70">
          <KaTeXSymbol tex="\leftarrow" style={{ fontSize: arrowSize }} />
        </button>
        <div ref={headerRef} className="tracking-wider font-light">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </div>
        <button onClick={nextMonth} className="px-2 py-1 hover:opacity-70">
          <KaTeXSymbol tex="\rightarrow" style={{ fontSize: arrowSize }} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0 text-center" style={{ fontSize: `${fontSize * 0.7}px`, opacity: 0.7 }}>
        {DAY_HEADERS.map((h, i) => (
          <div key={i} className="py-1" style={{ width: cellSize }}>{h}</div>
        ))}
      </div>

      {/* Day grid — key includes month/year so React fully remounts on month change */}
      <div className="grid grid-cols-7 gap-0 text-center">
        {cells.map((day, i) => (
          <button
            key={`${viewYear}-${viewMonth}-${i}`}
            ref={day ? (el) => { cellRefs.current[day - 1] = el; } : undefined}
            disabled={day === null}
            onClick={() => day && handleDayClick(day)}
            className="flex items-center justify-center hover:opacity-70 transition-colors"
            style={{
              backgroundColor: isActive(day) ? color : "transparent",
              color: isActive(day) ? bgColor : day ? color : "transparent",
              cursor: day ? "pointer" : "default",
              width: cellSize,
              height: cellSize,
              borderRadius: "50%",
            }}
          >
            {day ?? ""}
          </button>
        ))}
      </div>
    </div>
  );
}

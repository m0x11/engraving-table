"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import KaTeXSymbol from "./KaTeXSymbol";

type DateDialsProps = {
  timestamp: number;
  onDateSelect: (ts: number) => void;
  color: string;
  fontFamily: string;
  fontSize: number;
  liveTimestampRef?: React.RefObject<number | null>;
  countUpActive: boolean;
};

const MONTH_ABBRS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];
const VISIBLE_COUNT = 5;
const MID = Math.floor(VISIBLE_COUNT / 2);

function tsToDateParts(ts: number) {
  const d = new Date(ts * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function datePartsToTs(year: number, month: number, day: number) {
  // Clamp day to valid range
  const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, maxDay);
  return Math.floor(Date.UTC(year, month, clampedDay, 12, 0, 0) / 1000);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export default function DateDials({
  timestamp,
  onDateSelect,
  color,
  fontFamily,
  fontSize,
  liveTimestampRef,
  countUpActive,
}: DateDialsProps) {
  const { year: initYear, month: initMonth, day: initDay } = tsToDateParts(timestamp);
  const [month, setMonth] = useState(initMonth);
  const [day, setDay] = useState(initDay);
  const [year, setYear] = useState(initYear);

  const monthCellRefs = useRef<(HTMLDivElement | null)[]>(new Array(VISIBLE_COUNT).fill(null));
  const dayCellRefs = useRef<(HTMLDivElement | null)[]>(new Array(VISIBLE_COUNT).fill(null));
  const yearCellRefs = useRef<(HTMLDivElement | null)[]>(new Array(VISIBLE_COUNT).fill(null));

  // Sync when timestamp changes (not from count-up)
  useEffect(() => {
    if (!countUpActive) {
      const { year: y, month: m, day: d } = tsToDateParts(timestamp);
      setYear(y);
      setMonth(m);
      setDay(d);
    }
  }, [timestamp, countUpActive]);

  // rAF loop for count-up
  useEffect(() => {
    if (!countUpActive || !liveTimestampRef) return;
    let rafId: number;
    let prevParts = { year, month, day };

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const ts = liveTimestampRef.current;
      if (ts == null) return;

      const parts = tsToDateParts(ts);

      // Only update DOM if values actually changed
      if (parts.year !== prevParts.year || parts.month !== prevParts.month || parts.day !== prevParts.day) {
        prevParts = parts;

        // Update month drum via DOM
        for (let i = 0; i < VISIBLE_COUNT; i++) {
          const offset = i - MID;
          const mIdx = ((parts.month + offset) % 12 + 12) % 12;
          const cell = monthCellRefs.current[i];
          if (cell) {
            cell.textContent = MONTH_ABBRS[mIdx];
            cell.style.opacity = i === MID ? "1" : "0.3";
          }
        }

        // Update day drum via DOM
        const maxD = daysInMonth(parts.year, parts.month);
        for (let i = 0; i < VISIBLE_COUNT; i++) {
          const offset = i - MID;
          let dVal = parts.day + offset;
          if (dVal < 1) dVal += maxD;
          if (dVal > maxD) dVal -= maxD;
          const cell = dayCellRefs.current[i];
          if (cell) {
            cell.textContent = String(dVal).padStart(2, "0");
            cell.style.opacity = i === MID ? "1" : "0.3";
          }
        }

        // Update year drum via DOM
        for (let i = 0; i < VISIBLE_COUNT; i++) {
          const offset = i - MID;
          const cell = yearCellRefs.current[i];
          if (cell) {
            cell.textContent = String(parts.year + offset);
            cell.style.opacity = i === MID ? "1" : "0.3";
          }
        }
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [countUpActive, liveTimestampRef, year, month, day]);

  const emitDate = useCallback((m: number, d: number, y: number) => {
    const ts = datePartsToTs(y, m, d);
    onDateSelect(ts);
  }, [onDateSelect]);

  const incMonth = useCallback(() => {
    setMonth((m) => {
      const next = (m + 1) % 12;
      if (next === 0) setYear((y) => { const ny = y + 1; emitDate(next, day, ny); return ny; });
      else emitDate(next, day, year);
      return next;
    });
  }, [day, year, emitDate]);

  const decMonth = useCallback(() => {
    setMonth((m) => {
      const prev = (m - 1 + 12) % 12;
      if (prev === 11) setYear((y) => { const ny = y - 1; emitDate(prev, day, ny); return ny; });
      else emitDate(prev, day, year);
      return prev;
    });
  }, [day, year, emitDate]);

  const incDay = useCallback(() => {
    setDay((d) => {
      const max = daysInMonth(year, month);
      const next = d >= max ? 1 : d + 1;
      if (next === 1) {
        incMonth();
      } else {
        emitDate(month, next, year);
      }
      return next;
    });
  }, [year, month, emitDate, incMonth]);

  const decDay = useCallback(() => {
    setDay((d) => {
      if (d <= 1) {
        decMonth();
        const prevM = (month - 1 + 12) % 12;
        const prevY = prevM === 11 ? year - 1 : year;
        const maxPrev = daysInMonth(prevY, prevM);
        return maxPrev;
      }
      const prev = d - 1;
      emitDate(month, prev, year);
      return prev;
    });
  }, [year, month, emitDate, decMonth]);

  const incYear = useCallback(() => {
    setYear((y) => {
      const ny = y + 1;
      emitDate(month, day, ny);
      return ny;
    });
  }, [month, day, emitDate]);

  const decYear = useCallback(() => {
    setYear((y) => {
      const ny = y - 1;
      emitDate(month, day, ny);
      return ny;
    });
  }, [month, day, emitDate]);

  const maxDay = daysInMonth(year, month);
  const arrowSize = `${fontSize * 0.75}rem`;
  const activeSize = `${fontSize}px`;
  const inactiveSize = `${fontSize * 0.75}px`;

  const renderDrum = (
    values: string[],
    activeIdx: number,
    onUp: () => void,
    onDown: () => void,
    refs: React.RefObject<(HTMLDivElement | null)[]>,
    width: string,
  ) => (
    <div className="flex flex-col items-center" style={{ width }}>
      <button onClick={onUp} className="py-1 hover:opacity-70">
        <KaTeXSymbol tex="\uparrow" style={{ fontSize: arrowSize }} />
      </button>
      <div className="flex flex-col items-center">
        {values.map((v, i) => (
          <div
            key={i}
            ref={(el) => { refs.current![i] = el; }}
            className="py-0.5 text-center"
            style={{
              opacity: i === activeIdx ? 1 : 0.3,
              fontSize: i === activeIdx ? activeSize : inactiveSize,
              fontWeight: i === activeIdx ? 600 : 400,
              transition: "opacity 0.15s",
            }}
          >
            {v}
          </div>
        ))}
      </div>
      <button onClick={onDown} className="py-1 hover:opacity-70">
        <KaTeXSymbol tex="\downarrow" style={{ fontSize: arrowSize }} />
      </button>
    </div>
  );

  // Build visible values for each drum
  const monthValues = Array.from({ length: VISIBLE_COUNT }, (_, i) => {
    const offset = i - MID;
    const mIdx = ((month + offset) % 12 + 12) % 12;
    return MONTH_ABBRS[mIdx];
  });

  const dayValues = Array.from({ length: VISIBLE_COUNT }, (_, i) => {
    const offset = i - MID;
    let dVal = day + offset;
    if (dVal < 1) dVal += maxDay;
    if (dVal > maxDay) dVal -= maxDay;
    return String(dVal).padStart(2, "0");
  });

  const yearValues = Array.from({ length: VISIBLE_COUNT }, (_, i) => {
    const offset = i - MID;
    return String(year + offset);
  });

  return (
    <div className="flex gap-4 justify-center" style={{ color, fontFamily, userSelect: "none" }}>
      {renderDrum(monthValues, MID, decMonth, incMonth, monthCellRefs, "3.5rem")}
      {renderDrum(dayValues, MID, decDay, incDay, dayCellRefs, "2.5rem")}
      {renderDrum(yearValues, MID, decYear, incYear, yearCellRefs, "3.5rem")}
    </div>
  );
}

// Date and duration formatting with .NET-style format strings
// (Shared/Overlay/expression/README.md §6a). Pure functions: the time zone of
// "local" is the viewer's, names and separators follow the viewer's language.

export type DateMode = "local" | "utc" | "duration";
export type DateLocale = "de" | "en";

/** Largest timestamp a JS Date can hold (±8.64e15 ms), in seconds. */
export const MAX_TIMESTAMP_SECONDS = 8.64e12;

interface Culture {
  months: string[];
  monthsShort: string[];
  days: string[];
  daysShort: string[];
  am: string;
  pm: string;
  dateSeparator: string;
  standard: Record<string, string>;
}

const ISO = {
  s: "yyyy'-'MM'-'dd'T'HH':'mm':'ss",
  o: "yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fffffffK",
  u: "yyyy'-'MM'-'dd HH':'mm':'ss'Z'",
};

const CULTURES: Record<DateLocale, Culture> = {
  // Like .NET's invariant culture, which is also the canonical form.
  en: {
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    daysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    am: "AM",
    pm: "PM",
    dateSeparator: "/",
    standard: {
      d: "MM/dd/yyyy", D: "dddd, dd MMMM yyyy", t: "HH:mm", T: "HH:mm:ss",
      f: "dddd, dd MMMM yyyy HH:mm", F: "dddd, dd MMMM yyyy HH:mm:ss",
      g: "MM/dd/yyyy HH:mm", G: "MM/dd/yyyy HH:mm:ss", M: "MMMM dd", m: "MMMM dd", Y: "yyyy MMMM", y: "yyyy MMMM",
      ...ISO,
    },
  },
  de: {
    months: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    monthsShort: ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."],
    days: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
    daysShort: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
    am: "",
    pm: "",
    dateSeparator: ".",
    standard: {
      d: "dd.MM.yyyy", D: "dddd, d. MMMM yyyy", t: "HH:mm", T: "HH:mm:ss",
      f: "dddd, d. MMMM yyyy HH:mm", F: "dddd, d. MMMM yyyy HH:mm:ss",
      g: "dd.MM.yyyy HH:mm", G: "dd.MM.yyyy HH:mm:ss", M: "d. MMMM", m: "d. MMMM", Y: "MMMM yyyy", y: "MMMM yyyy",
      ...ISO,
    },
  },
};

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** Splits a format into tokens: runs of one letter, quoted/escaped literals and single characters. */
function tokenize(format: string): ({ literal: string } | { spec: string })[] {
  const out: ({ literal: string } | { spec: string })[] = [];
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c === "'" || c === '"') {
      const end = format.indexOf(c, i + 1);
      const stop = end < 0 ? format.length : end;
      out.push({ literal: format.slice(i + 1, stop) });
      i = stop + 1;
    } else if (c === "\\") {
      out.push({ literal: format[i + 1] ?? "" });
      i += 2;
    } else if (c === "%") {
      i++; // "%d" = the custom specifier d, not the standard format d.
    } else if (/[A-Za-z]/.test(c)) {
      let j = i + 1;
      while (format[j] === c) j++;
      out.push({ spec: format.slice(i, j) });
      i = j;
    } else {
      out.push({ spec: c });
      i++;
    }
  }
  return out;
}

/** Fraction digits: f… always, F… without trailing zeros (and nothing when zero). */
function fraction(ms: number, spec: string): string {
  const digits = (pad(ms, 3) + "0000").slice(0, spec.length);
  return spec[0] === "F" ? digits.replace(/0+$/, "") : digits;
}

function offsetText(minutes: number, spec: string): string {
  const sign = minutes < 0 ? "-" : "+";
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60);
  if (spec === "z") return `${sign}${h}`;
  if (spec === "zz") return `${sign}${pad(h, 2)}`;
  return `${sign}${pad(h, 2)}:${pad(a % 60, 2)}`;
}

/**
 * Formats a Unix timestamp in seconds like .NET DateTime.ToString(format).
 * Custom specifiers: d…dddd, M…MMMM, y…yyyyy, h/hh, H/HH, m/mm, s/ss,
 * f…fffffff, F…FFFFFFF, t/tt, z/zz/zzz, K, ":" and "/" (date separator),
 * 'literal', "literal", \x. A single letter is a standard format (d, D, t, T,
 * f, F, g, G, M, Y, s, o, u).
 */
export function formatTimestamp(seconds: number, format: string, mode: "local" | "utc", locale: DateLocale): string {
  const culture = CULTURES[locale];
  let utc = mode === "utc";
  if (format.length === 1 && format in culture.standard) {
    if (format === "u") utc = true;
    format = culture.standard[format];
  }
  const totalMs = Math.round(seconds * 1000);
  const date = new Date(totalMs);
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = utc ? date.getUTCMonth() : date.getMonth();
  const day = utc ? date.getUTCDate() : date.getDate();
  const weekday = utc ? date.getUTCDay() : date.getDay();
  const hour = utc ? date.getUTCHours() : date.getHours();
  const minute = utc ? date.getUTCMinutes() : date.getMinutes();
  const second = utc ? date.getUTCSeconds() : date.getSeconds();
  const ms = utc ? date.getUTCMilliseconds() : date.getMilliseconds();
  const offset = utc ? 0 : -date.getTimezoneOffset();
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  return tokenize(format).map((t) => {
    if ("literal" in t) return t.literal;
    const s = t.spec;
    switch (s[0]) {
      case "d":
        if (s.length === 1) return String(day);
        if (s.length === 2) return pad(day, 2);
        return s.length === 3 ? culture.daysShort[weekday] : culture.days[weekday];
      case "M":
        if (s.length === 1) return String(month + 1);
        if (s.length === 2) return pad(month + 1, 2);
        return s.length === 3 ? culture.monthsShort[month] : culture.months[month];
      case "y":
        if (s.length === 1) return String(year % 100);
        if (s.length === 2) return pad(year % 100, 2);
        return pad(year, s.length);
      case "h": return s.length === 1 ? String(hour12) : pad(hour12, 2);
      case "H": return s.length === 1 ? String(hour) : pad(hour, 2);
      case "m": return s.length === 1 ? String(minute) : pad(minute, 2);
      case "s": return s.length === 1 ? String(second) : pad(second, 2);
      case "f": case "F": return fraction(ms, s.slice(0, 7));
      case "t": {
        const marker = hour < 12 ? culture.am : culture.pm;
        return s.length === 1 ? marker.slice(0, 1) : marker;
      }
      case "z": return offsetText(offset, s.slice(0, 3));
      case "K": return utc ? "Z" : offsetText(offset, "zzz");
      case "/": return culture.dateSeparator;
      default: return s;
    }
  }).join("");
}

/**
 * Formats a duration in seconds like .NET TimeSpan.ToString(format).
 * Custom specifiers: d…dddddddd (days), h/hh, m/mm, s/ss (parts below the
 * next unit), f…fffffff, F…FFFFFFF, 'literal', \x. Other characters are kept
 * (so "hh:mm:ss" works without escaping). Standard formats: c, g, G.
 * Negative durations get a leading "-".
 */
export function formatDuration(seconds: number, format: string): string {
  const sign = seconds < 0 ? "-" : "";
  let totalMs = Math.round(Math.abs(seconds) * 1000);
  const ms = totalMs % 1000;
  totalMs = (totalMs - ms) / 1000;
  const second = totalMs % 60;
  const minute = Math.floor(totalMs / 60) % 60;
  const hour = Math.floor(totalMs / 3600) % 24;
  const day = Math.floor(totalMs / 86400);

  switch (format) {
    case "c":
      return `${sign}${day ? `${day}.` : ""}${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}${ms ? `.${fraction(ms, "fffffff")}` : ""}`;
    case "g": {
      const f = fraction(ms, "FFFFFFF");
      return `${sign}${day ? `${day}:` : ""}${hour}:${pad(minute, 2)}:${pad(second, 2)}${f ? `.${f}` : ""}`;
    }
    case "G":
      return `${sign}${day}:${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${fraction(ms, "fffffff")}`;
  }

  return sign + tokenize(format).map((t) => {
    if ("literal" in t) return t.literal;
    const s = t.spec;
    switch (s[0]) {
      case "d": return pad(day, Math.min(s.length, 8));
      case "h": return pad(hour, Math.min(s.length, 2));
      case "m": return pad(minute, Math.min(s.length, 2));
      case "s": return pad(second, Math.min(s.length, 2));
      case "f": case "F": return fraction(ms, s.slice(0, 7));
      default: return s;
    }
  }).join("");
}

/** Formats a date segment for the given language. */
export function formatDateSegment(value: number, format: string, mode: DateMode, locale: DateLocale): string {
  return mode === "duration" ? formatDuration(value, format) : formatTimestamp(value, format, mode, locale);
}

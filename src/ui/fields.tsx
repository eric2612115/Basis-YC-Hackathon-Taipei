import { useEffect, useState } from 'react';

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  /** The value is a fraction (0.25) shown and typed as a percent (25). */
  percent?: boolean;
  integer?: boolean;
  /** Bounds in the value's own units (fractions for percent fields). Out-of-range input is not applied. */
  min?: number;
  max?: number;
  big?: boolean;
}

/** A number input that lets people type freely and applies the value only when it is a valid number in range. */
export function NumberField({ label, value, onChange, prefix, suffix, percent, integer, min, max, big }: NumberFieldProps) {
  const shown = percent ? Number((value * 100).toFixed(4)) : value;
  const [text, setText] = useState(String(shown));

  useEffect(() => {
    setText((t) => (Number(t.replace(/,/g, '')) === shown ? t : String(shown)));
  }, [shown]);

  return (
    <label className={big ? 'field big-field' : 'field'}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        {prefix && <em>{prefix}</em>}
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            const n = Number(t.replace(/,/g, ''));
            if (t.trim() === '' || !Number.isFinite(n)) return;
            let v = percent ? n / 100 : n;
            if (integer) v = Math.round(v);
            if (min !== undefined && v < min) return;
            if (max !== undefined && v > max) return;
            onChange(v);
          }}
          onBlur={() => setText(String(shown))}
        />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

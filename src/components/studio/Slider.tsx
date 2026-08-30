interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}

export function EditSlider({ label, value, onChange, min = -100, max = 100, suffix = "" }: Props) {
  return (
    <label className="block">
      <span className="flex justify-between font-mono text-[10px] uppercase tracking-wider">
        <span>{label}</span>
        <span className="text-rust">
          {value > 0 ? "+" : ""}
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink/15 accent-rust"
      />
    </label>
  );
}

export function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const sign = v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function moneySigned(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (v > 0.0001) return `+$${abs}`;
  if (v < -0.0001) return `−$${abs}`;
  return `$${abs}`;
}

export function isProfit(n: number) {
  return (Number.isFinite(n) ? n : 0) > 0.0001;
}

export function isLoss(n: number) {
  return (Number.isFinite(n) ? n : 0) < -0.0001;
}

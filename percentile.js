export function percentileLabel(digit, place) {
  return place === "tens" ? String(digit % 10 * 10).padStart(2, "0") : String(digit % 10);
}

export function percentileTerms(total) {
  const value = Math.abs(total) % 100;
  return `${percentileLabel(Math.floor(value / 10), "tens")} + ${percentileLabel(value, "ones")}`;
}

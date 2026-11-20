import { percentileTerms } from "./percentile.js";

export function appendCalculation(result, breakdown, notation) {
  if (!breakdown?.length) {
    result.append(`${notation} = `);
    return;
  }

  for (const [index, encoded] of breakdown.entries()) {
    const dropped = typeof encoded === "string" && encoded.startsWith("~");
    const term = dropped ? encoded.slice(1) : encoded;
    const percentile = typeof term === "string" && term.startsWith("p");
    const value = Number(percentile ? term.slice(1) : term);
    if (index) result.append(value < 0 ? " − " : " + ");
    else if (value < 0) result.append("−");
    let digits = String(Math.abs(value));
    if (percentile) {
      digits = percentileTerms(value);
      if (Math.abs(value) === 100 && breakdown.length > 1) digits = `${digits} → 100`;
      if (value < 0 || (Math.abs(value) === 100 && breakdown.length > 1)) digits = `(${digits})`;
    }
    if (dropped) {
      const die = document.createElement("s");
      die.title = "Dropped";
      die.textContent = digits;
      result.append(die);
    } else {
      result.append(digits);
    }
  }
  result.append(" = ");
}

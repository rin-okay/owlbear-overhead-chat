export function appendCalculation(result, breakdown, notation) {
  if (!breakdown?.length) {
    result.append(`${notation} = `);
    return;
  }

  for (const [index, encoded] of breakdown.entries()) {
    const dropped = typeof encoded === "string";
    const value = dropped ? Number(encoded.slice(1)) : encoded;
    if (index) result.append(value < 0 ? " − " : " + ");
    else if (value < 0) result.append("−");
    const digits = String(Math.abs(value));
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

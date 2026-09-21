const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = value => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// Hold on the table, lift clear of it, then approach. Zero velocity at both
// ends keeps slow scrolling and reversing the scroll just as continuous.
export function consoleFlightProgress(progress, reducedMotion = false) {
  if (reducedMotion) return { lift: 0, turn: 1, approach: 1, button: 1, shadow: 0 };
  const lift = smooth((progress - .12) / .24);
  const approach = smooth((progress - .28) / .56);
  return {
    lift,
    // Keep the back parallel to the tabletop until it has lifted clear.
    turn: smooth((progress - .28) / .40),
    approach,
    button: smooth((progress - .72) / .16),
    shadow: (1 - lift * .72) * (1 - approach),
  };
}

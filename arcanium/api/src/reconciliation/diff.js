// reconciliation/diff.js — Prompt 20.
//
// `desired` is a full desired_state row (uses .desired_value); `observed` is
// an observe.js result (uses .value / .status). UNKNOWN is a first-class,
// terminal outcome — it is checked first and never falls through to a
// COMPLIANT/DRIFTED guess (input/03 §8, input/32).

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function compare(desired, observed) {
  if (observed.status === "UNKNOWN") {
    return { status: "UNKNOWN", detail: observed.detail };
  }
  if (deepEqual(desired.desired_value, observed.value)) {
    return { status: "COMPLIANT" };
  }
  return {
    status: "DRIFTED",
    desired: desired.desired_value,
    observed: observed.value,
  };
}

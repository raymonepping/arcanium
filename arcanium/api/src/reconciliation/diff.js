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

const APPROACHING_EXPIRY_DAYS = 14;
const MS_PER_DAY = 86400000;
// Absorbs the natural lag between a rotation period's own boundary and
// Vault's next internal rotation check — a key isn't "overdue" the
// instant it crosses its configured period, only once it's meaningfully
// past it.
const ROTATION_GRACE_DAYS = 1;

// Prompt 38 — rotation_period previously used the generic compare()
// above, which only ever checked whether the CONFIGURED period matched
// the desired one — never whether the key has actually been rotating.
// Vault's own auto-rotation is real and server-side (no hand-rolled
// scheduler here to fail), but nothing was watching for it silently
// stopping, or the configured value somehow not actually being in
// effect despite reading back correctly. observeRotationPeriod() now
// also reports the current version's real creation_time; this
// comparator uses it to catch a key whose config is correct but whose
// current version is provably older than that config allows.
export function compareRotationPeriod(desired, observed) {
  if (observed.status === "UNKNOWN") {
    return { status: "UNKNOWN", detail: observed.detail };
  }
  const desiredDays = desired.desired_value?.days;
  if (!Number.isFinite(desiredDays)) {
    return { status: "UNKNOWN", detail: "desired_value.days is missing" };
  }
  // A destroyed key (observeRotationPeriod's own 404 handling) has no
  // rotation obligation left to violate — same reasoning
  // compareExpiryDate() already applies to an inactive key, rather than
  // leaving this in permanent UNKNOWN limbo.
  if (observed.value?.active === false) {
    return { status: "COMPLIANT" };
  }
  const observedDays = observed.value?.days;
  if (observedDays !== desiredDays) {
    return {
      status: "DRIFTED",
      desired: desired.desired_value,
      observed: { days: observedDays },
    };
  }
  const creationTime = observed.value?.latest_version_creation_time;
  if (creationTime) {
    const ageDays =
      (Date.now() - new Date(creationTime).getTime()) / MS_PER_DAY;
    if (ageDays > desiredDays + ROTATION_GRACE_DAYS) {
      return {
        status: "DRIFTED",
        desired: desired.desired_value,
        observed: { days: observedDays },
        detail: `configured correctly at ${desiredDays}d, but the current key version is ${Math.floor(ageDays)}d old — overdue for rotation`,
      };
    }
  }
  return { status: "COMPLIANT" };
}

// Prompt 28, Deliverable 5 — `expiry_date` needs a different comparator
// than the generic deep-equal `compare()` above: "must not be active after
// this date" is a date-ordering question, not an equality check, and it
// carries an extra `approaching_expiry` signal `compare()` has no concept
// of (used to trigger Deliverable 3's `key.expiry_approaching` webhook
// event — a COMPLIANT key can still be worth flagging before it drifts).
export function compareExpiryDate(desired, observed) {
  if (observed.status === "UNKNOWN") {
    return { status: "UNKNOWN", detail: observed.detail };
  }
  const notAfter = desired.desired_value?.not_after;
  if (!notAfter) {
    return { status: "UNKNOWN", detail: "desired_value.not_after is missing" };
  }
  // A destroyed/inactive key can never violate "must not be active after
  // this date" regardless of what the date says — the requirement's own
  // intent is already satisfied.
  if (observed.value?.active === false) {
    return { status: "COMPLIANT" };
  }
  const today = new Date(observed.value?.observed_date ?? Date.now());
  const deadline = new Date(`${notAfter}T00:00:00Z`);
  if (today.getTime() > deadline.getTime()) {
    return {
      status: "DRIFTED",
      desired: desired.desired_value,
      observed: observed.value,
    };
  }
  const daysRemaining = Math.floor(
    (deadline.getTime() - today.getTime()) / MS_PER_DAY,
  );
  return {
    status: "COMPLIANT",
    approaching_expiry: daysRemaining <= APPROACHING_EXPIRY_DAYS,
  };
}

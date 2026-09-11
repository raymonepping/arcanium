// reconciliation/desiredState.js — Prompt 20.
//
// The one write path for desired_state.desired_value. Every write bumps
// `version` and inserts the PRIOR value into desired_state_history in the
// same transaction — this is not an optional audit nicety, it's how "who
// changed the intent from 30 to 90 days, when, why, and under what
// authorization?" (input/36) gets answered at all: desired_state itself
// always holds the current value + who/why set it; desired_state_history
// holds every value it held before that, each with its own who/why/groups.

import { query } from "../db.js";

/**
 * Create-or-update a desired_state row for (application_id, key_name, requirement).
 * No-ops (returns the existing row unchanged, no version bump, no history
 * row) if desiredValue is identical to what's already stored — re-running
 * provisioning with the same rotation_days must not manufacture fake intent
 * history.
 */
export async function upsertDesiredState({
  applicationId,
  keyName,
  requirement,
  desiredValue,
  source,
  changedBy,
  changedGroups = [],
  changedReason = null,
}) {
  await query("BEGIN");
  try {
    const { rows: existing } = await query(
      `SELECT * FROM desired_state
        WHERE application_id = $1 AND key_name = $2 AND requirement = $3
        FOR UPDATE`,
      [applicationId, keyName, requirement],
    );

    let result;
    if (!existing.length) {
      const { rows } = await query(
        `INSERT INTO desired_state
           (application_id, key_name, requirement, desired_value, source, version, changed_by, changed_groups, changed_reason)
         VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)
         RETURNING *`,
        [
          applicationId,
          keyName,
          requirement,
          JSON.stringify(desiredValue),
          source,
          changedBy,
          changedGroups,
          changedReason,
        ],
      );
      result = rows[0];
    } else {
      const prior = existing[0];
      const unchanged =
        JSON.stringify(prior.desired_value) === JSON.stringify(desiredValue);
      if (unchanged) {
        await query("COMMIT");
        return prior;
      }
      await query(
        `INSERT INTO desired_state_history
           (desired_state_id, version, desired_value, changed_by, changed_groups, changed_reason)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          prior.id,
          prior.version,
          JSON.stringify(prior.desired_value),
          prior.changed_by,
          prior.changed_groups ?? [],
          prior.changed_reason,
        ],
      );
      const { rows } = await query(
        `UPDATE desired_state
           SET desired_value = $2, version = version + 1, changed_by = $3,
               changed_groups = $4, changed_reason = $5, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          prior.id,
          JSON.stringify(desiredValue),
          changedBy,
          changedGroups,
          changedReason,
        ],
      );
      result = rows[0];
    }

    await query("COMMIT");
    return result;
  } catch (err) {
    await query("ROLLBACK").catch(() => {});
    throw err;
  }
}

export async function getDesiredState(id) {
  const { rows } = await query("SELECT * FROM desired_state WHERE id = $1", [
    id,
  ]);
  return rows[0] ?? null;
}

/** Full intent history for a desired_state row: the current value (from
 * desired_state itself) plus every prior value (from desired_state_history),
 * newest first — answers "who changed the intent, when, why" end to end. */
export async function getDesiredStateHistory(current) {
  const { rows } = await query(
    `SELECT version, desired_value, changed_by, changed_groups, changed_reason, changed_at
       FROM desired_state_history WHERE desired_state_id = $1 ORDER BY version DESC`,
    [current.id],
  );
  return [
    {
      version: current.version,
      desired_value: current.desired_value,
      changed_by: current.changed_by,
      changed_groups: current.changed_groups ?? [],
      changed_reason: current.changed_reason,
      changed_at: current.updated_at,
      current: true,
    },
    ...rows.map((r) => ({ ...r, current: false })),
  ];
}

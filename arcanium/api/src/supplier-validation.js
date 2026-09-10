export function supplierFields(body, partial = false) {
  const fields = {};
  const valid = {
    name: (v) => typeof v === "string" && /^[a-z0-9_-]{1,128}$/i.test(v),
    vault_namespace: (v) =>
      typeof v === "string" &&
      v.length <= 256 &&
      /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(v),
    sla_tier: (v) => ["standard", "premium"].includes(v),
  };
  for (const [field, check] of Object.entries(valid)) {
    const value =
      body?.[field] ??
      (!partial && field === "sla_tier" ? "standard" : undefined);
    if (partial && value === undefined) continue;
    if (!check(value)) {
      const error = new Error(`invalid ${field}`);
      error.status = 400;
      throw error;
    }
    fields[field] = value;
  }
  if (!Object.keys(fields).length) {
    const error = new Error("no supplier fields supplied");
    error.status = 400;
    throw error;
  }
  return fields;
}

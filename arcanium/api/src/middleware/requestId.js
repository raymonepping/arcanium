// middleware/requestId.js — Prompt 24, Deliverable 2.
//
// Every inbound request gets a request_id: honored if the client already
// supplied one (X-Request-Id), generated otherwise. Threaded through:
//
//   request_id -> job_id (provisioning.js) -> tenant_id -> application_id
//              -> approval_id (approvals.js) -> evidence_id (evidence.js)
//
// so a single failing onboarding flow can be grepped end-to-end across
// UI -> API -> DB -> Vault -> evidence (input/32's exact ask). Mounted
// before requestLogger and every router — req.requestId is available to
// all of them. A caller-supplied header is trusted only as an opaque
// correlation token, never parsed or used as an identifier into anything
// privileged; it is logged and echoed back, nothing more.
import { randomUUID } from "node:crypto";

const HEADER = "x-request-id";

export function requestId(req, res, next) {
  const supplied = req.headers[HEADER];
  req.requestId =
    typeof supplied === "string" &&
    supplied.length > 0 &&
    supplied.length <= 128
      ? supplied
      : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

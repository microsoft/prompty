package com.microsoft.prompty.harness;

import com.microsoft.prompty.model.PermissionDecision;
import com.microsoft.prompty.model.PermissionRequest;

/** Builds the decision a resolver hands back, echoing the request it answers. */
final class Decisions {

  private Decisions() {}

  static PermissionDecision of(PermissionRequest request, boolean approved, String reason) {
    PermissionDecision decision = new PermissionDecision();
    decision.requestId = request.requestId;
    decision.toolCallId = request.toolCallId;
    // Echoing the permission back matters: a decision that names no permission cannot be audited
    // against the request that produced it.
    decision.permission = request.permission;
    decision.approved = approved;
    decision.reason = reason;
    return decision;
  }
}

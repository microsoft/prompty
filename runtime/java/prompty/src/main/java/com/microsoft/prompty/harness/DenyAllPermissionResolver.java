package com.microsoft.prompty.harness;

import com.microsoft.prompty.model.PermissionDecision;
import com.microsoft.prompty.model.PermissionRequest;
import com.microsoft.prompty.model.PermissionResolver;

/**
 * Resolves every permission request as denied.
 *
 * <p>Useful for proving that a turn survives refusal — the denial becomes a tool result the model
 * can react to, not an error that ends the turn.
 */
public final class DenyAllPermissionResolver implements PermissionResolver {

  @Override
  public PermissionDecision request(PermissionRequest request) {
    return Decisions.of(request, false, "deny_all");
  }
}

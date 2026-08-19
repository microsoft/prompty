package com.microsoft.prompty.harness;

import com.microsoft.prompty.model.PermissionDecision;
import com.microsoft.prompty.model.PermissionRequest;
import com.microsoft.prompty.model.PermissionResolver;

/**
 * Resolves every permission request as approved.
 *
 * <p>The right resolver for a batch job or a sandbox, and the wrong one for anything touching a
 * user's machine. It records {@code allow_all} as the reason so a journal shows that nothing
 * actually adjudicated the request.
 */
public final class AllowAllPermissionResolver implements PermissionResolver {

  @Override
  public PermissionDecision request(PermissionRequest request) {
    return Decisions.of(request, true, "allow_all");
  }
}

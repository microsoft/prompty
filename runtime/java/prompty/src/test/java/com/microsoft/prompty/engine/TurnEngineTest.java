package com.microsoft.prompty.engine;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.CancellationToken;
import com.microsoft.prompty.Messages;
import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.EngineEvent;
import com.microsoft.prompty.model.EngineEventKind;
import com.microsoft.prompty.model.EnginePermissionDecision;
import com.microsoft.prompty.model.EngineTurnStatus;
import com.microsoft.prompty.model.FinalOutputPolicyRequest;
import com.microsoft.prompty.model.FinalOutputPolicyResult;
import com.microsoft.prompty.model.HostPolicyRequest;
import com.microsoft.prompty.model.HostPolicyResult;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.InvocationContextState;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationContextSnapshot;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelToolOutcome;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.ModelToolResult;
import com.microsoft.prompty.model.TurnCommit;
import com.microsoft.prompty.model.TurnEngineResult;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Turn engine behaviour the shared vectors do not reach.
 *
 * <p>The vectors grade five happy-ish paths end to end. What they cannot express is what the engine
 * does when an effect's outcome is genuinely unknown, when a port itself fails, or when a run is
 * resumed from a checkpoint — the paths that decide whether a durable turn is actually safe to
 * retry. Those are covered here, mirroring the dedicated tests in the Rust reference.
 */
@DisplayName("turn engine")
final class TurnEngineTest {

  @Nested
  @DisplayName("indeterminate effects")
  final class IndeterminateEffects {

    @Test
    @DisplayName("an unknown tool outcome halts the turn for reconciliation instead of guessing")
    void anUnknownToolOutcomeHaltsTheTurnForReconciliation() {
      ScriptedModel model = new ScriptedModel(responses(toolCall("call-unknown", "external-write")));
      Recorder recorder = new Recorder();
      TurnEngine engine =
          TurnEngine.of(
              baseEffects(model, recorder).withTools(new IndeterminateTools()));

      TurnEngineResult result =
          engine.run(
              TurnEngineRequest.of(
                  "session-indeterminate",
                  "turn-indeterminate",
                  List.of(Messages.user("write externally"))),
              CancellationToken.none());

      assertEquals(EngineTurnStatus.RECONCILIATION_REQUIRED, result.commit.status);
      assertEquals(ModelToolOutcome.INDETERMINATE, result.toolResults.get(0).outcome);
      assertEquals(1, model.requests.size(), "the model must not be re-invoked");
      assertTrue(recorder.postCommitIds.isEmpty(), "an unreconciled turn must not run post-commit");
      assertEquals("effect_outcome_unknown", errorKind(result.commit));

      EngineCheckpoint checkpoint = recorder.lastCheckpoint();
      assertTrue(checkpoint.reconciliationRequired, "checkpoint must record the blocked effect");
      assertEquals(
          ModelToolOutcome.INDETERMINATE, checkpoint.completedToolResults.get(0).outcome);
    }

    @Test
    @DisplayName("resuming without resolving the effect stops again without calling the model")
    void resumingWithoutResolvingTheEffectStopsAgain() {
      EngineCheckpoint checkpoint = blockedCheckpoint();

      ScriptedModel model = new ScriptedModel(new ArrayDeque<>());
      Recorder recorder = new Recorder();
      TurnEngineResult resumed =
          TurnEngine.of(baseEffects(model, recorder).withTools(new IndeterminateTools()))
              .run(
                  TurnEngineRequest.resumeFrom(checkpoint, 3, 20),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.RECONCILIATION_REQUIRED, resumed.commit.status);
      assertTrue(model.requests.isEmpty(), "an unresolved effect must not reach the model");
    }

    @Test
    @DisplayName("a resolved effect resumes into the next iteration and is visible to the model")
    void aResolvedEffectResumesIntoTheNextIteration() {
      EngineCheckpoint checkpoint = blockedCheckpoint();

      ModelToolResult resolved = new ModelToolResult();
      resolved.requestId = "call-unknown";
      resolved.name = "external-write";
      resolved.outcome = ModelToolOutcome.SUCCESS;
      resolved.output = "confirmed complete";

      ScriptedModel model = new ScriptedModel(responses(finalOutput("reconciled")));
      Recorder recorder = new Recorder();
      TurnEngineResult result =
          TurnEngine.of(baseEffects(model, recorder).withTools(new IndeterminateTools()))
              .run(
                  TurnEngineRequest.resumeAfterReconciliation(checkpoint, 2, 20, resolved),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.SUCCESS, result.commit.status);
      assertEquals(
          ModelToolOutcome.SUCCESS,
          recorder.checkpoints.get(0).completedToolResults.get(0).outcome,
          "the resolved result must replace the indeterminate one");
      assertTrue(
          recorder.kinds().contains(EngineEventKind.TOOL_RESULT_RECONCILED.value),
          "resolution must be journalled");

      ModelInvocationContextSnapshot context = model.requests.get(0).context;
      assertTrue(
          context.messages.stream()
              .anyMatch(message -> "confirmed complete".equals(Messages.text(message))),
          "the model must read the resolved output, not the 'outcome unknown' placeholder");

      // The heart of the resume contract: the checkpoint's only outstanding item was the effect
      // just resolved, so its iteration is finished. Resuming in place would re-run a tool round
      // the host has already paid for.
      assertEquals(1, context.iteration, "a resolved effect advances the iteration");
    }

    @Test
    @DisplayName("a tool-blocked checkpoint rejects a model-reconciliation resolution")
    void aToolBlockedCheckpointRejectsAModelResolution() {
      EngineCheckpoint checkpoint = blockedCheckpoint();
      ModelInvocationResponse wrongShape = finalOutput("wrong resolution type");

      assertThrows(
          TurnEngineException.InvalidRequest.class,
          () ->
              TurnEngineRequest.resumeAfterModelReconciliation(
                  checkpoint, 3, checkpoint.lastSequence, wrongShape));
    }

    /** Runs a turn to its blocked checkpoint so resume paths have a real one to start from. */
    private EngineCheckpoint blockedCheckpoint() {
      Recorder recorder = new Recorder();
      TurnEngine.of(
              baseEffects(
                      new ScriptedModel(responses(toolCall("call-unknown", "external-write"))),
                      recorder)
                  .withTools(new IndeterminateTools()))
          .run(
              TurnEngineRequest.of(
                  "session-indeterminate",
                  "turn-indeterminate",
                  List.of(Messages.user("write externally"))),
              CancellationToken.none());
      return recorder.lastCheckpoint();
    }
  }

  @Nested
  @DisplayName("port failures")
  final class PortFailures {

    @Test
    @DisplayName("a failing permission port commits a failed turn rather than proceeding")
    void aFailingPermissionPortCommitsAFailedTurn() {
      Recorder recorder = new Recorder();
      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(
                          new ScriptedModel(responses(toolCall("call-permission", "restricted"))),
                          recorder)
                      .withPermission(
                          (request, cancellation) -> {
                            throw PortException.of("permission port unavailable");
                          }))
              .run(
                  TurnEngineRequest.of(
                      "session-permission-error",
                      "turn-permission-error",
                      List.of(Messages.user("authorize"))),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.FAILED, result.commit.status);
      assertEquals("permission_error", errorKind(result.commit));
      assertEquals(
          EngineEventKind.TURN_FAILED.value,
          recorder.kinds().get(recorder.kinds().size() - 1),
          "the journal must end on the failure");
    }

    @Test
    @DisplayName("an unknown tool is a terminal configuration failure, not a retryable one")
    void anUnknownToolIsATerminalConfigurationFailure() {
      Recorder recorder = new Recorder();
      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(
                          new ScriptedModel(responses(toolCall("call-missing", "missing"))),
                          recorder)
                      .withTools(
                          (request, cancellation) -> {
                            throw PortException.configuration("unknown tool '" + request.name + "'");
                          }))
              .run(
                  TurnEngineRequest.of(
                      "session-unknown-tool",
                      "turn-unknown-tool",
                      List.of(Messages.user("call missing"))),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.FAILED, result.commit.status);
      assertEquals("tool_configuration_error", errorKind(result.commit));
      assertTrue(result.toolResults.isEmpty(), "a misconfigured tool produces no result");
    }
  }

  @Nested
  @DisplayName("cancellation")
  final class Cancellation {

    @Test
    @DisplayName("cancelling during authorization prevents the tool from running")
    void cancellingDuringAuthorizationPreventsTheToolFromRunning() {
      Recorder recorder = new Recorder();
      RecordingTools tools = new RecordingTools();
      CancellationToken cancellation = CancellationToken.create();

      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(
                          new ScriptedModel(responses(toolCall("call-cancelled", "write"))),
                          recorder)
                      .withTools(tools)
                      .withPermission(
                          (request, token) -> {
                            cancellation.cancel();
                            EnginePermissionDecision decision = new EnginePermissionDecision();
                            decision.approved = true;
                            return decision;
                          }))
              .run(
                  TurnEngineRequest.of(
                      "session-cancel-permission",
                      "turn-cancel-permission",
                      List.of(Messages.user("write"))),
                  cancellation);

      assertEquals(EngineTurnStatus.CANCELLED, result.commit.status);
      assertTrue(tools.calls.isEmpty(), "an approved but cancelled tool must not execute");
    }
  }

  @Nested
  @DisplayName("host policy")
  final class HostPolicy {

    @Test
    @DisplayName("a policy rewrite is checkpointed so a resumed run does not apply it twice")
    void aPolicyRewriteIsCheckpointed() {
      Recorder recorder = new Recorder();
      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(new ScriptedModel(responses(finalOutput("done"))), recorder)
                      .withPolicy(
                          new Ports.HostPolicyPort() {
                            @Override
                            public HostPolicyResult beforeModel(
                                HostPolicyRequest request, CancellationToken cancellation) {
                              HostPolicyResult policyResult = new HostPolicyResult();
                              policyResult.messages =
                                  new ArrayList<>(
                                      List.of(
                                          Messages.system("redacted"), Messages.user("sanitised")));
                              policyResult.stablePrefixMessages = 1;
                              return policyResult;
                            }

                            @Override
                            public FinalOutputPolicyResult beforeCommit(
                                FinalOutputPolicyRequest request, CancellationToken cancellation) {
                              FinalOutputPolicyResult policyResult = new FinalOutputPolicyResult();
                              policyResult.output = request.output;
                              return policyResult;
                            }
                          }))
              .run(
                  TurnEngineRequest.of(
                      "session-policy", "turn-policy", List.of(Messages.user("raw"))),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.SUCCESS, result.commit.status);
      assertTrue(
          recorder.kinds().contains(EngineEventKind.POLICY_APPLIED.value),
          "a rewrite must be journalled");

      EngineCheckpoint policyCheckpoint = recorder.checkpoints.get(0);
      assertTrue(
          policyCheckpoint.policyAppliedForIteration,
          "the checkpoint must record that the policy already ran");
      assertTrue(
          policyCheckpoint.resumeSameIteration,
          "the rewrite belongs to the iteration that has not yet invoked the model");

      // The rewrite must reach the model, not just the journal.
      assertEquals(
          List.of("redacted", "sanitised"),
          result.snapshots.get(0).messages.stream().map(Messages::text).toList());
      recorder.assertGaplessSequences();
    }

    @Test
    @DisplayName("a policy that leaves the conversation alone writes no checkpoint")
    void aPolicyThatChangesNothingWritesNoCheckpoint() {
      Recorder recorder = new Recorder();
      TurnEngine.of(baseEffects(new ScriptedModel(responses(finalOutput("done"))), recorder))
          .run(
              TurnEngineRequest.of(
                  "session-noop-policy", "turn-noop-policy", List.of(Messages.user("raw"))),
              CancellationToken.none());

      assertFalse(
          recorder.kinds().contains(EngineEventKind.POLICY_APPLIED.value),
          "an unchanged conversation must not cost a checkpoint");
    }

    @Test
    @DisplayName("a policy claiming a longer prefix than it returned fails the turn")
    void aPolicyClaimingAnOverlongPrefixFailsTheTurn() {
      Recorder recorder = new Recorder();
      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(new ScriptedModel(responses(finalOutput("done"))), recorder)
                      .withPolicy(
                          new Ports.HostPolicyPort() {
                            @Override
                            public HostPolicyResult beforeModel(
                                HostPolicyRequest request, CancellationToken cancellation) {
                              HostPolicyResult policyResult = new HostPolicyResult();
                              policyResult.messages = new ArrayList<>(List.of(Messages.user("a")));
                              policyResult.stablePrefixMessages = 9;
                              return policyResult;
                            }

                            @Override
                            public FinalOutputPolicyResult beforeCommit(
                                FinalOutputPolicyRequest request, CancellationToken cancellation) {
                              return new FinalOutputPolicyResult();
                            }
                          }))
              .run(
                  TurnEngineRequest.of(
                      "session-bad-policy", "turn-bad-policy", List.of(Messages.user("raw"))),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.FAILED, result.commit.status);
      assertEquals("policy_error", errorKind(result.commit));
    }
  }

  @Nested
  @DisplayName("model failures")
  final class ModelFailures {

    @Test
    @DisplayName("a retryable failure is journalled and the next attempt succeeds")
    void aRetryableFailureIsJournalledAndRetried() {
      Recorder recorder = new Recorder();
      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(new FlakyModel(1, finalOutput("recovered")), recorder))
              .run(
                  TurnEngineRequest.of(
                      "session-retry", "turn-retry", List.of(Messages.user("hi"))),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.SUCCESS, result.commit.status);
      assertEquals("recovered", result.commit.output);
      assertEquals(
          2,
          recorder.countOf(EngineEventKind.MODEL_INVOCATION_STARTED),
          "each attempt must be journalled");
      assertEquals(1, recorder.countOf(EngineEventKind.MODEL_INVOCATION_FAILED));
      assertEquals(
          1,
          result.snapshots.size(),
          "a retry reuses the prepared context rather than re-preparing it");
      recorder.assertGaplessSequences();
    }

    @Test
    @DisplayName("exhausting the attempt budget fails the turn")
    void exhaustingTheAttemptBudgetFailsTheTurn() {
      Recorder recorder = new Recorder();
      TurnEngineRequest request =
          TurnEngineRequest.of("session-exhaust", "turn-exhaust", List.of(Messages.user("hi")));
      request.maxModelAttempts = 2;

      TurnEngineResult result =
          TurnEngine.of(baseEffects(new FlakyModel(5, finalOutput("never")), recorder))
              .run(request, CancellationToken.none());

      assertEquals(EngineTurnStatus.FAILED, result.commit.status);
      assertEquals("model_error", errorKind(result.commit));
      assertEquals(2, recorder.countOf(EngineEventKind.MODEL_INVOCATION_STARTED));
      recorder.assertGaplessSequences();
    }

    @Test
    @DisplayName("an unknown invocation outcome halts for reconciliation without retrying")
    void anUnknownInvocationOutcomeHaltsForReconciliation() {
      Recorder recorder = new Recorder();
      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(
                      (request, cancellation, stream) -> {
                        throw PortException.indeterminate(
                            "request sent but no response read", new LinkedHashMap<>());
                      },
                      recorder))
              .run(
                  TurnEngineRequest.of(
                      "session-model-unknown",
                      "turn-model-unknown",
                      List.of(Messages.user("hi"))),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.RECONCILIATION_REQUIRED, result.commit.status);
      assertEquals("model_outcome_unknown", errorKind(result.commit));
      assertEquals(
          1,
          recorder.countOf(EngineEventKind.MODEL_INVOCATION_STARTED),
          "an unknown outcome must not be retried");
      assertTrue(
          recorder.kinds().contains(EngineEventKind.MODEL_RECONCILIATION_REQUIRED.value));
      assertTrue(recorder.postCommitIds.isEmpty());

      EngineCheckpoint checkpoint = recorder.lastCheckpoint();
      assertTrue(checkpoint.reconciliationRequired);
      assertNotNull(checkpoint.modelReconciliation, "the host needs the invocation identity");
      recorder.assertGaplessSequences();
    }

    @Test
    @DisplayName("resolving an unknown invocation resumes without re-invoking the model")
    void resolvingAnUnknownInvocationResumesWithoutReinvoking() {
      Recorder blocked = new Recorder();
      TurnEngine.of(
              baseEffects(
                  (request, cancellation, stream) -> {
                    throw PortException.indeterminate(
                        "request sent but no response read", new LinkedHashMap<>());
                  },
                  blocked))
          .run(
              TurnEngineRequest.of(
                  "session-model-unknown", "turn-model-unknown", List.of(Messages.user("hi"))),
              CancellationToken.none());
      EngineCheckpoint checkpoint = blocked.lastCheckpoint();

      ScriptedModel unused = new ScriptedModel(new ArrayDeque<>());
      Recorder recorder = new Recorder();
      TurnEngineResult result =
          TurnEngine.of(baseEffects(unused, recorder))
              .run(
                  TurnEngineRequest.fromResumeAfterModelReconciliation(
                      resumeContext(checkpoint), finalOutput("resolved")),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.SUCCESS, result.commit.status);
      assertEquals("resolved", result.commit.output);
      assertTrue(
          unused.requests.isEmpty(),
          "the host supplied the outcome, so the model must not be called again");
      assertTrue(
          recorder.kinds().contains(EngineEventKind.MODEL_INVOCATION_RECONCILED.value),
          "the resolution must be journalled");
      recorder.assertGaplessSequences();
    }

    private com.microsoft.prompty.model.ResumeContext resumeContext(EngineCheckpoint checkpoint) {
      com.microsoft.prompty.model.ResumeContext resume =
          new com.microsoft.prompty.model.ResumeContext();
      resume.checkpoint = checkpoint;
      resume.maxIterations = 10;
      resume.maxModelAttempts = 3;
      resume.lastJournalSequence = checkpoint.lastSequence;
      return resume;
    }
  }

  @Nested
  @DisplayName("commit")
  final class Commit {

    @Test
    @DisplayName("a failing post-commit effect is reported without un-committing the turn")
    void aFailingPostCommitEffectIsReportedWithoutUncommittingTheTurn() {
      Recorder recorder = new Recorder();
      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(new ScriptedModel(responses(finalOutput("done"))), recorder)
                      .withPostCommit(
                          (effectId, commit, cancellation) -> {
                            throw PortException.of("notification webhook is down");
                          }))
              .run(
                  TurnEngineRequest.of(
                      "session-post-commit", "turn-post-commit", List.of(Messages.user("hi"))),
                  CancellationToken.none());

      assertEquals(
          EngineTurnStatus.SUCCESS,
          result.commit.status,
          "the turn is already durable; a post-commit effect cannot undo it");
      assertNotNull(result.postCommitError, "the failure must still be surfaced to the caller");
      assertTrue(recorder.kinds().contains(EngineEventKind.POST_COMMIT_FAILED.value));
    }

    @Test
    @DisplayName("running out of iterations fails the turn")
    void runningOutOfIterationsFailsTheTurn() {
      Recorder recorder = new Recorder();
      TurnEngineRequest request =
          TurnEngineRequest.of("session-budget", "turn-budget", List.of(Messages.user("hi")));
      request.maxIterations = 1;

      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(
                          new ScriptedModel(
                              responses(
                                  toolCall("call-1", "echo"), toolCall("call-2", "echo"))),
                          recorder)
                      .withTools(new RecordingTools()))
              .run(request, CancellationToken.none());

      assertEquals(EngineTurnStatus.FAILED, result.commit.status);
      assertEquals("max_iterations", errorKind(result.commit));
    }

    @Test
    @DisplayName("an engine-assigned run id is not written back onto the caller's request")
    void anEngineAssignedRunIdIsNotWrittenBackOntoTheRequest() {
      // Rust consumes the request by value, so this can never happen there. Java passes by
      // reference, and a request whose run id had been filled in would make a second run
      // silently inherit the first run's identity.
      TurnEngineRequest request =
          TurnEngineRequest.of("session-ids", "turn-ids", List.of(Messages.user("hi")));

      Recorder recorder = new Recorder();
      TurnEngine.of(baseEffects(new ScriptedModel(responses(finalOutput("done"))), recorder))
          .run(request, CancellationToken.none());

      assertEquals("", request.runId, "the caller's request must be left untouched");
      assertFalse(
          recorder.events.get(0).runId.isEmpty(), "the run itself still gets an identity");
    }
  }

  @Nested
  @DisplayName("provider state")
  final class ProviderState {

    @Test
    @DisplayName("a portable response cannot carry delegated provider state")
    void aPortableResponseCannotCarryDelegatedState() {
      ModelInvocationResponse response = finalOutput("done");
      response.nextContextState = new InvocationContextState();
      response.nextContextState.portability = InvocationContextPortability.PORTABLE;
      response.nextContextState.delegatedState =
          new ArrayList<>(List.of(new com.microsoft.prompty.model.DelegatedStateReference()));

      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(new ScriptedModel(responses(response)), new Recorder()))
              .run(
                  TurnEngineRequest.of(
                      "session-provider", "turn-provider", List.of(Messages.user("hi"))),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.FAILED, result.commit.status);
      assertEquals("provider_state_error", errorKind(result.commit));
    }

    @Test
    @DisplayName("a delegated response must name the state it delegates to")
    void aDelegatedResponseMustNameItsState() {
      ModelInvocationResponse response = finalOutput("done");
      response.nextContextState = new InvocationContextState();
      response.nextContextState.portability = InvocationContextPortability.DELEGATED;
      response.nextContextState.delegatedState = new ArrayList<>();

      TurnEngineResult result =
          TurnEngine.of(
                  baseEffects(new ScriptedModel(responses(response)), new Recorder()))
              .run(
                  TurnEngineRequest.of(
                      "session-provider", "turn-provider", List.of(Messages.user("hi"))),
                  CancellationToken.none());

      assertEquals(EngineTurnStatus.FAILED, result.commit.status);
      assertEquals("provider_state_error", errorKind(result.commit));
    }
  }

  @Nested
  @DisplayName("durability failures")
  final class DurabilityFailures {

    @Test
    @DisplayName("a failed checkpoint write surfaces the state the host must recover")
    void aFailedCheckpointWriteSurfacesRecoveryState() {
      TurnEngineException.RecoveryRequired failure =
          assertThrows(
              TurnEngineException.RecoveryRequired.class,
              () ->
                  TurnEngine.of(
                          TurnEngineEffects.of(new ScriptedModel(responses(finalOutput("done"))))
                              .withClock(() -> "1970-01-01T00:00:00Z")
                              .withDurability(
                                  new Ports.DurabilityPort() {
                                    @Override
                                    public void append(EngineEvent event) {}

                                    @Override
                                    public void appendWithCheckpoint(
                                        List<EngineEvent> events, EngineCheckpoint checkpoint) {
                                      throw PortException.of("journal is unavailable");
                                    }
                                  }))
                      .run(
                          TurnEngineRequest.of(
                              "session-durability",
                              "turn-durability",
                              List.of(Messages.user("hi"))),
                          CancellationToken.none()));

      assertNotNull(
          failure.checkpoint(), "the host cannot resume without the checkpoint that failed");
      assertNotNull(failure.requestId());
    }
  }

  @Nested
  @DisplayName("resume arithmetic")
  final class ResumeArithmetic {

    @Test
    @DisplayName("a checkpoint with nothing outstanding advances to the next iteration")
    void aCheckpointWithNothingOutstandingAdvances() {
      EngineCheckpoint checkpoint = checkpoint(2);
      assertEquals(3, TurnEngineRequest.resumeFrom(checkpoint, 10, 0).startIteration);
    }

    @Test
    @DisplayName("a checkpoint with outstanding tools resumes in place")
    void aCheckpointWithOutstandingToolsResumesInPlace() {
      EngineCheckpoint checkpoint = checkpoint(2);
      checkpoint.pendingToolRequests = List.of(request("call-1", "echo"));
      assertEquals(2, TurnEngineRequest.resumeFrom(checkpoint, 10, 0).startIteration);
    }

    @Test
    @DisplayName("an unresolved reconciliation keeps the run in its recorded iteration")
    void anUnresolvedReconciliationKeepsTheRunInPlace() {
      EngineCheckpoint checkpoint = checkpoint(2);
      checkpoint.reconciliationRequired = true;
      assertEquals(2, TurnEngineRequest.resumeFrom(checkpoint, 10, 0).startIteration);
    }

    @Test
    @DisplayName("an explicit resume-in-place request overrides the advance")
    void anExplicitResumeInPlaceRequestOverridesTheAdvance() {
      EngineCheckpoint checkpoint = checkpoint(2);
      checkpoint.resumeSameIteration = true;
      assertEquals(2, TurnEngineRequest.resumeFrom(checkpoint, 10, 0).startIteration);
    }

    @Test
    @DisplayName("resolving the last outstanding effect finishes its iteration")
    void resolvingTheLastOutstandingEffectFinishesItsIteration() {
      // The checkpoint shape written before the conversation batch became explicit state: the
      // tool message is already in the conversation, the queue is drained, and the only thing
      // holding the turn open is the unresolved effect. Once that effect is resolved the
      // iteration is genuinely finished, so the run must advance rather than repeat a tool
      // round the host has already paid for.
      EngineCheckpoint checkpoint = new EngineCheckpoint();
      checkpoint.sessionId = "session-legacy";
      checkpoint.turnId = "turn-legacy";
      checkpoint.iteration = 2;
      checkpoint.lastSequence = 9L;
      checkpoint.reconciliationRequired = true;
      checkpoint.pendingToolRequests = new ArrayList<>();
      checkpoint.pendingModelResponse = null;
      checkpoint.finalOutputReady = false;
      checkpoint.messages =
          new ArrayList<>(
              List.of(Messages.user("write"), Messages.toolResult("call-1", "outcome unknown")));
      checkpoint.stablePrefixMessages = 1;

      ModelToolResult indeterminate = new ModelToolResult();
      indeterminate.requestId = "call-1";
      indeterminate.name = "external-write";
      indeterminate.outcome = ModelToolOutcome.INDETERMINATE;
      checkpoint.completedToolResults = new ArrayList<>(List.of(indeterminate));

      ModelToolResult resolved = new ModelToolResult();
      resolved.requestId = "call-1";
      resolved.name = "external-write";
      resolved.outcome = ModelToolOutcome.SUCCESS;
      resolved.output = "confirmed";

      TurnEngineRequest request =
          TurnEngineRequest.resumeAfterReconciliation(checkpoint, 10, 9, resolved);

      assertEquals(3, request.startIteration, "a resolved effect finishes its iteration");
      assertFalse(request.reconciliationRequired);
      assertEquals(
          "confirmed",
          Messages.text(request.messages.get(1)),
          "the model must not keep reading the 'outcome unknown' placeholder");
    }

    @Test
    @DisplayName("an effect still outstanding alongside it keeps the run in place")
    void anEffectStillOutstandingKeepsTheRunInPlace() {
      EngineCheckpoint checkpoint = checkpoint(2);
      checkpoint.reconciliationRequired = true;
      checkpoint.pendingToolRequests = new ArrayList<>(List.of(request("call-2", "echo")));
      checkpoint.messages =
          new ArrayList<>(
              List.of(Messages.user("write"), Messages.toolResult("call-1", "outcome unknown")));

      ModelToolResult indeterminate = new ModelToolResult();
      indeterminate.requestId = "call-1";
      indeterminate.name = "external-write";
      indeterminate.outcome = ModelToolOutcome.INDETERMINATE;
      checkpoint.completedToolResults = new ArrayList<>(List.of(indeterminate));

      ModelToolResult resolved = new ModelToolResult();
      resolved.requestId = "call-1";
      resolved.name = "external-write";
      resolved.outcome = ModelToolOutcome.SUCCESS;
      resolved.output = "confirmed";

      assertEquals(
          2,
          TurnEngineRequest.resumeAfterReconciliation(checkpoint, 10, 0, resolved).startIteration,
          "a queued tool still has to run inside the recorded iteration");
    }

    @Test
    @DisplayName("model reconciliation always resumes the recorded iteration")
    void modelReconciliationAlwaysResumesTheRecordedIteration() {      EngineCheckpoint checkpoint = checkpoint(2);
      checkpoint.reconciliationRequired = true;
      checkpoint.activeInvocationId = "invocation-1";
      checkpoint.modelReconciliation = new com.microsoft.prompty.model.ModelReconciliationState();
      checkpoint.modelReconciliation.invocationId = "invocation-1";

      TurnEngineRequest request =
          TurnEngineRequest.resumeAfterModelReconciliation(
              checkpoint, 10, 0, finalOutput("resolved"));

      assertEquals(2, request.startIteration, "the interrupted invocation is re-run in place");
      assertFalse(request.reconciliationRequired);
    }

    @Test
    @DisplayName("resuming continues from the journal tail when it extends past the checkpoint")
    void resumingContinuesFromTheJournalTail() {
      EngineCheckpoint checkpoint = checkpoint(1);
      checkpoint.lastSequence = 7L;
      assertEquals(12, TurnEngineRequest.resumeFrom(checkpoint, 10, 12).initialSequence);
      assertEquals(7, TurnEngineRequest.resumeFrom(checkpoint, 10, 3).initialSequence);
    }

    private EngineCheckpoint checkpoint(int iteration) {
      EngineCheckpoint checkpoint = new EngineCheckpoint();
      checkpoint.sessionId = "session-resume";
      checkpoint.turnId = "turn-resume";
      checkpoint.iteration = iteration;
      checkpoint.lastSequence = 5L;
      checkpoint.messages = List.of(Messages.user("hello"));
      checkpoint.stablePrefixMessages = 1;
      return checkpoint;
    }
  }

  @Nested
  @DisplayName("request validation")
  final class RequestValidation {

    @Test
    @DisplayName("a portable turn cannot begin holding delegated provider state")
    void aPortableTurnCannotBeginHoldingDelegatedState() {
      TurnEngineRequest request =
          TurnEngineRequest.of("session", "turn", List.of(Messages.user("hi")));
      request.delegatedState = List.of(new com.microsoft.prompty.model.DelegatedStateReference());

      assertThrows(
          TurnEngineException.InvalidRequest.class,
          () -> TurnEngine.of(TurnEngineEffects.of(new ScriptedModel(new ArrayDeque<>())))
              .run(request, CancellationToken.none()));
    }

    @Test
    @DisplayName("a stable prefix cannot claim more messages than the conversation holds")
    void aStablePrefixCannotExceedTheConversation() {
      TurnEngineRequest request =
          TurnEngineRequest.of("session", "turn", List.of(Messages.user("hi")));
      request.stablePrefixMessages = 5;

      assertThrows(
          TurnEngineException.InvalidRequest.class,
          () -> TurnEngine.of(TurnEngineEffects.of(new ScriptedModel(new ArrayDeque<>())))
              .run(request, CancellationToken.none()));
    }

    @Test
    @DisplayName("a turn must be allowed at least one model attempt")
    void aTurnMustBeAllowedAtLeastOneModelAttempt() {
      TurnEngineRequest request =
          TurnEngineRequest.of("session", "turn", List.of(Messages.user("hi")));
      request.maxModelAttempts = 0;

      assertThrows(
          TurnEngineException.InvalidRequest.class,
          () -> TurnEngine.of(TurnEngineEffects.of(new ScriptedModel(new ArrayDeque<>())))
              .run(request, CancellationToken.none()));
    }
  }

  @Nested
  @DisplayName("snapshot validation")
  final class SnapshotValidation {

    @Test
    @DisplayName("a snapshot cannot claim a stable prefix longer than its own messages")
    void aSnapshotCannotClaimAnOverlongStablePrefix() {
      ModelInvocationContextSnapshot snapshot = snapshot();
      snapshot.stablePrefixMessages = 4;
      assertThrows(ContextException.class, () -> Snapshots.validate(snapshot));
    }

    @Test
    @DisplayName("a portable snapshot cannot carry delegated provider state")
    void aPortableSnapshotCannotCarryDelegatedState() {
      ModelInvocationContextSnapshot snapshot = snapshot();
      snapshot.contextState.delegatedState =
          List.of(new com.microsoft.prompty.model.DelegatedStateReference());
      assertThrows(ContextException.class, () -> Snapshots.validate(snapshot));
    }

    @Test
    @DisplayName("a delegated snapshot must name the state it delegates to")
    void aDelegatedSnapshotMustNameItsState() {
      ModelInvocationContextSnapshot snapshot = snapshot();
      snapshot.contextState.portability = InvocationContextPortability.DELEGATED;
      assertThrows(ContextException.class, () -> Snapshots.validate(snapshot));
    }

    @Test
    @DisplayName("a well-formed snapshot validates")
    void aWellFormedSnapshotValidates() {
      Snapshots.validate(snapshot());
    }

    private ModelInvocationContextSnapshot snapshot() {
      ModelInvocationContextSnapshot snapshot = new ModelInvocationContextSnapshot();
      snapshot.id = "context:invocation-1";
      snapshot.messages = new ArrayList<>(List.of(Messages.user("hello")));
      snapshot.stablePrefixMessages = 1;
      snapshot.iteration = 0;
      snapshot.contextState = new InvocationContextState();
      snapshot.contextState.portability = InvocationContextPortability.PORTABLE;
      snapshot.contextState.delegatedState = new ArrayList<>();
      return snapshot;
    }
  }

  // ---------------------------------------------------------------- shared fixtures

  private static TurnEngineEffects baseEffects(Ports.ModelPort model, Recorder recorder) {
    return TurnEngineEffects.of(model)
        .withDurability(recorder)
        .withPostCommit(recorder)
        .withClock(() -> "1970-01-01T00:00:00Z")
        .withTools(new RecordingTools());
  }

  private static Deque<ModelInvocationResponse> responses(ModelInvocationResponse... responses) {
    return new ArrayDeque<>(List.of(responses));
  }

  private static ModelInvocationResponse toolCall(String id, String name) {
    ModelInvocationResponse response = new ModelInvocationResponse();
    response.assistantMessages = new ArrayList<>();
    response.toolRequests = new ArrayList<>(List.of(request(id, name)));
    return response;
  }

  private static ModelToolRequest request(String id, String name) {
    ModelToolRequest request = new ModelToolRequest();
    request.id = id;
    request.name = name;
    return request;
  }

  private static ModelInvocationResponse finalOutput(String output) {
    ModelInvocationResponse response = new ModelInvocationResponse();
    response.output = output;
    response.assistantMessages = new ArrayList<>();
    response.toolRequests = new ArrayList<>();
    return response;
  }

  @SuppressWarnings("unchecked")
  private static String errorKind(TurnCommit commit) {
    assertNotNull(commit.output, "a non-success commit must explain itself");
    return (String) ((Map<String, Object>) commit.output).get("errorKind");
  }

  /** A model whose responses are scripted up front, recording what it was asked. */
  private static final class ScriptedModel implements Ports.ModelPort {
    private final Deque<ModelInvocationResponse> responses;
    private final List<ModelInvocationRequest> requests = new ArrayList<>();

    ScriptedModel(Deque<ModelInvocationResponse> responses) {
      this.responses = responses;
    }

    @Override
    public ModelInvocationResponse invoke(
        ModelInvocationRequest request,
        CancellationToken cancellation,
        Ports.ModelStreamPort stream) {
      requests.add(request);
      ModelInvocationResponse response = responses.poll();
      if (response == null) {
        throw PortException.of("scripted model response exhausted");
      }
      return response;
    }
  }

  /** A tool port whose effect always lands in an unknown state. */
  private static final class IndeterminateTools implements Ports.ToolPort {
    @Override
    public ModelToolResult execute(ModelToolRequest request, CancellationToken cancellation) {
      throw PortException.indeterminate(
          "external write acknowledged but not confirmed", new LinkedHashMap<>());
    }
  }

  /** A tool port that echoes its arguments and records the order it was called in. */
  private static final class RecordingTools implements Ports.ToolPort {
    private final List<String> calls = new ArrayList<>();

    @Override
    public ModelToolResult execute(ModelToolRequest request, CancellationToken cancellation) {
      calls.add(request.id);
      ModelToolResult result = new ModelToolResult();
      result.requestId = request.id;
      result.name = request.name;
      result.outcome = ModelToolOutcome.SUCCESS;
      result.output = "ok";
      return result;
    }
  }

  /** A model that fails a fixed number of times before returning its scripted response. */
  private static final class FlakyModel implements Ports.ModelPort {
    private final ModelInvocationResponse response;
    private int failuresRemaining;

    FlakyModel(int failuresRemaining, ModelInvocationResponse response) {
      this.failuresRemaining = failuresRemaining;
      this.response = response;
    }

    @Override
    public ModelInvocationResponse invoke(
        ModelInvocationRequest request,
        CancellationToken cancellation,
        Ports.ModelStreamPort stream) {
      if (failuresRemaining > 0) {
        failuresRemaining--;
        throw PortException.of("transient upstream failure");
      }
      return response;
    }
  }

  /** Captures the journal, checkpoints, and post-commit effects of a run. */
  private static final class Recorder implements Ports.DurabilityPort, Ports.PostCommitPort {
    private final List<EngineEvent> events = new ArrayList<>();
    private final List<EngineCheckpoint> checkpoints = new ArrayList<>();
    private final List<String> postCommitIds = new ArrayList<>();

    @Override
    public void append(EngineEvent event) {
      events.add(event);
    }

    @Override
    public void appendWithCheckpoint(List<EngineEvent> batch, EngineCheckpoint checkpoint) {
      events.addAll(batch);
      checkpoints.add(checkpoint);
    }

    @Override
    public void afterCommit(String effectId, TurnCommit commit, CancellationToken cancellation) {
      postCommitIds.add(effectId);
    }

    List<String> kinds() {
      List<String> kinds = new ArrayList<>();
      for (EngineEvent event : events) {
        kinds.add(event.kind.value);
      }
      return kinds;
    }

    EngineCheckpoint lastCheckpoint() {
      assertFalse(checkpoints.isEmpty(), "the run wrote no checkpoint");
      return checkpoints.get(checkpoints.size() - 1);
    }

    int countOf(EngineEventKind kind) {
      int count = 0;
      for (EngineEvent event : events) {
        if (event.kind == kind) {
          count++;
        }
      }
      return count;
    }

    /**
     * A hole in the journal means an effect was recorded that a resumed run would never replay,
     * so gaplessness is the invariant every durable path has to hold.
     */
    void assertGaplessSequences() {
      for (int i = 1; i < events.size(); i++) {
        assertEquals(
            events.get(i - 1).sequence + 1,
            events.get(i).sequence,
            "event sequence continuity at index " + i);
      }
    }
  }
}

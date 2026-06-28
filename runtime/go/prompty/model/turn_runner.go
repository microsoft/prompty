package prompty

import (
	"fmt"
	"time"
)

type TurnModelRequest struct {
	SessionId   string
	TurnId      string
	Iteration   int
	Inputs      map[string]interface{}
	Options     TurnOptions
	ToolResults []HostToolResult
}

type TurnModelResponse struct {
	Output          interface{}
	ToolRequests    []HostToolRequest
	CheckpointState map[string]interface{}
}

type TurnModelCallback func(request TurnModelRequest) (TurnModelResponse, error)

type ReferenceTurnRunner struct {
	EventSink          EventSink
	Journal            EventJournalWriter
	CheckpointStore    CheckpointStore
	PermissionResolver PermissionResolver
	HostToolExecutor   HostToolExecutor
	InvokeModel        TurnModelCallback
	Now                func() string
	NextId             func(prefix string) string
	sequence           int
}

type RunTurnRequest struct {
	SessionId string
	TurnId    string
	Inputs    map[string]interface{}
	Options   TurnOptions
}

type RunTurnResult struct {
	SessionId   string
	TurnId      string
	Status      string
	Output      interface{}
	Iterations  int
	ToolResults []HostToolResult
	Checkpoints []Checkpoint
}

func (r *ReferenceTurnRunner) Run(request RunTurnRequest) (RunTurnResult, error) {
	inputs := request.Inputs
	if inputs == nil {
		inputs = map[string]interface{}{}
	}
	maxIterations := int32(10)
	if request.Options.MaxIterations != nil {
		maxIterations = *request.Options.MaxIterations
	}
	checkpoints := []Checkpoint{}
	allToolResults := []HostToolResult{}
	pendingToolResults := []HostToolResult{}
	var output interface{}
	status := "success"
	iterations := 0

	if err := r.recordSession(SessionEventTypeSessionStart, request.SessionId, request.TurnId, map[string]interface{}{
		"sessionId":     request.SessionId,
		"schemaVersion": "1",
	}); err != nil {
		return RunTurnResult{}, err
	}
	if err := r.recordTurn(TurnEventTypeTurnStart, request.TurnId, 0, map[string]interface{}{
		"inputs":        inputs,
		"maxIterations": maxIterations,
	}); err != nil {
		return RunTurnResult{}, err
	}

	for iteration := 0; iteration < int(maxIterations); iteration++ {
		iterations = iteration + 1
		if err := r.recordTurn(TurnEventTypeLlmStart, request.TurnId, iteration, map[string]interface{}{"attempt": 0}); err != nil {
			return RunTurnResult{}, err
		}
		modelResponse, err := r.InvokeModel(TurnModelRequest{
			SessionId:   request.SessionId,
			TurnId:      request.TurnId,
			Iteration:   iteration,
			Inputs:      inputs,
			Options:     request.Options,
			ToolResults: pendingToolResults,
		})
		if err != nil {
			return RunTurnResult{}, err
		}
		if err := r.recordTurn(TurnEventTypeLlmComplete, request.TurnId, iteration, map[string]interface{}{}); err != nil {
			return RunTurnResult{}, err
		}
		checkpoint, err := r.saveCheckpoint(request.SessionId, request.TurnId, iteration, modelResponse)
		if err != nil {
			return RunTurnResult{}, err
		}
		checkpoints = append(checkpoints, checkpoint)

		if len(modelResponse.ToolRequests) == 0 {
			output = modelResponse.Output
			break
		}
		pendingToolResults = []HostToolResult{}
		for _, toolRequest := range modelResponse.ToolRequests {
			toolResult, err := r.resolveAndExecuteTool(request.TurnId, iteration, toolRequest)
			if err != nil {
				return RunTurnResult{}, err
			}
			pendingToolResults = append(pendingToolResults, toolResult)
			allToolResults = append(allToolResults, toolResult)
		}
		serializedResults := []map[string]interface{}{}
		for _, result := range pendingToolResults {
			serializedResults = append(serializedResults, result.Save(NewSaveContext()))
		}
		if err := r.recordTurn(TurnEventTypeMessagesUpdated, request.TurnId, iteration, map[string]interface{}{"toolResults": serializedResults}); err != nil {
			return RunTurnResult{}, err
		}
	}

	if output == nil && len(pendingToolResults) > 0 {
		status = "error"
		output = map[string]interface{}{"message": "Maximum turn iterations reached"}
		if err := r.recordTurn(TurnEventTypeError, request.TurnId, iterations, map[string]interface{}{
			"errorKind": "max_iterations",
			"message":   "Maximum turn iterations reached",
		}); err != nil {
			return RunTurnResult{}, err
		}
	}

	if err := r.recordTurn(TurnEventTypeTurnEnd, request.TurnId, iterations, map[string]interface{}{
		"iterations": iterations,
		"status":     status,
		"response":   output,
	}); err != nil {
		return RunTurnResult{}, err
	}
	if err := r.recordSession(SessionEventTypeSessionEnd, request.SessionId, request.TurnId, map[string]interface{}{
		"sessionId": request.SessionId,
		"status":    status,
		"reason":    "turn_complete",
	}); err != nil {
		return RunTurnResult{}, err
	}
	summaryStatus := SessionSummaryStatus(status)
	turns := int32(1)
	checkpointCount := int32(len(checkpoints))
	if _, err := r.Journal.Close(&SessionSummary{
		SessionId:   request.SessionId,
		Status:      &summaryStatus,
		Turns:       &turns,
		Checkpoints: &checkpointCount,
	}); err != nil {
		return RunTurnResult{}, err
	}

	return RunTurnResult{
		SessionId:   request.SessionId,
		TurnId:      request.TurnId,
		Status:      status,
		Output:      output,
		Iterations:  iterations,
		ToolResults: allToolResults,
		Checkpoints: checkpoints,
	}, nil
}

func (r *ReferenceTurnRunner) saveCheckpoint(sessionId string, turnId string, iteration int, response TurnModelResponse) (Checkpoint, error) {
	checkpointId := fmt.Sprintf("%s-checkpoint-%d", turnId, iteration)
	checkpointNumber := int32(iteration + 1)
	state := map[string]interface{}{
		"iteration":    iteration,
		"output":       response.Output,
		"toolRequests": saveToolRequests(response.ToolRequests),
	}
	for key, value := range response.CheckpointState {
		state[key] = value
	}
	checkpoint := Checkpoint{
		Id:               &checkpointId,
		SessionId:        &sessionId,
		TurnId:           &turnId,
		CheckpointNumber: &checkpointNumber,
		Title:            fmt.Sprintf("Turn %s iteration %d", turnId, iteration),
		State:            state,
		CreatedAt:        stringPtr(r.timestamp()),
	}
	saved, err := r.CheckpointStore.Save(checkpoint)
	if err != nil {
		return Checkpoint{}, err
	}
	if err := r.recordSession(SessionEventTypeCheckpointCreated, sessionId, turnId, map[string]interface{}{
		"checkpointId":     saved.Id,
		"checkpointNumber": saved.CheckpointNumber,
	}); err != nil {
		return Checkpoint{}, err
	}
	return saved, nil
}

func (r *ReferenceTurnRunner) resolveAndExecuteTool(turnId string, iteration int, toolRequest HostToolRequest) (HostToolResult, error) {
	permissionRequestId := r.id("permission")
	if toolRequest.RequestId != nil {
		permissionRequestId = *toolRequest.RequestId + "-permission"
	}
	permission := PermissionRequest{
		RequestId:  &permissionRequestId,
		ToolCallId: toolRequest.ToolCallId,
		Permission: "tool.execute",
		Target:     &toolRequest.ToolName,
		Details:    toolRequest.Save(NewSaveContext()),
	}
	if err := r.recordTurn(TurnEventTypePermissionRequested, turnId, iteration, permission.Save(NewSaveContext())); err != nil {
		return HostToolResult{}, err
	}
	decision, err := r.PermissionResolver.Request(permission)
	if err != nil {
		return HostToolResult{}, err
	}
	if err := r.recordTurn(TurnEventTypePermissionCompleted, turnId, iteration, decision.Save(NewSaveContext())); err != nil {
		return HostToolResult{}, err
	}
	if !decision.Approved {
		errorKind := "permission_denied"
		message := "Permission denied"
		if decision.Reason != nil {
			message = *decision.Reason
		}
		result := interface{}(map[string]interface{}{"message": message})
		return HostToolResult{
			RequestId:  toolRequest.RequestId,
			ToolCallId: toolRequest.ToolCallId,
			ToolName:   toolRequest.ToolName,
			Success:    false,
			ErrorKind:  &errorKind,
			Result:     &result,
		}, nil
	}
	if err := r.recordTurn(TurnEventTypeToolExecutionStart, turnId, iteration, toolRequest.Save(NewSaveContext())); err != nil {
		return HostToolResult{}, err
	}
	result, err := r.HostToolExecutor.Execute(toolRequest)
	if err != nil {
		return HostToolResult{}, err
	}
	if err := r.recordTurn(TurnEventTypeToolExecutionComplete, turnId, iteration, result.Save(NewSaveContext())); err != nil {
		return HostToolResult{}, err
	}
	if err := r.recordTurn(TurnEventTypeToolResult, turnId, iteration, result.Save(NewSaveContext())); err != nil {
		return HostToolResult{}, err
	}
	return result, nil
}

func (r *ReferenceTurnRunner) recordTurn(eventType TurnEventType, turnId string, iteration int, payload map[string]interface{}) error {
	event := TurnEvent{
		Id:        r.id("turn-event"),
		Type:      eventType,
		Timestamp: r.timestamp(),
		TurnId:    &turnId,
		Iteration: int32Ptr(int32(iteration)),
		Payload:   payload,
	}
	if _, err := r.EventSink.EmitTurn(event); err != nil {
		return err
	}
	_, err := r.Journal.AppendTurn(event)
	return err
}

func (r *ReferenceTurnRunner) recordSession(eventType SessionEventType, sessionId string, turnId string, payload map[string]interface{}) error {
	event := SessionEvent{
		Id:        r.id("session-event"),
		Type:      eventType,
		Timestamp: r.timestamp(),
		SessionId: &sessionId,
		TurnId:    &turnId,
		Payload:   payload,
	}
	if _, err := r.EventSink.EmitSession(event); err != nil {
		return err
	}
	_, err := r.Journal.AppendSession(event)
	return err
}

func (r *ReferenceTurnRunner) timestamp() string {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now().UTC().Format(time.RFC3339)
}

func (r *ReferenceTurnRunner) id(prefix string) string {
	if r.NextId != nil {
		return r.NextId(prefix)
	}
	r.sequence++
	return fmt.Sprintf("%s-%d", prefix, r.sequence)
}

func saveToolRequests(requests []HostToolRequest) []map[string]interface{} {
	result := []map[string]interface{}{}
	for _, request := range requests {
		result = append(result, request.Save(NewSaveContext()))
	}
	return result
}

func int32Ptr(value int32) *int32 {
	return &value
}

func stringPtr(value string) *string {
	return &value
}

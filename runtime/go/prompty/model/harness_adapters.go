package prompty

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// CollectingEventSink captures emitted turn and session events in memory.
type CollectingEventSink struct {
	mu            sync.Mutex
	TurnEvents    []TurnEvent
	SessionEvents []SessionEvent
}

func (s *CollectingEventSink) EmitTurn(turnEvent TurnEvent) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.TurnEvents = append(s.TurnEvents, turnEvent)
	return true, nil
}

func (s *CollectingEventSink) EmitSession(sessionEvent SessionEvent) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.SessionEvents = append(s.SessionEvents, sessionEvent)
	return true, nil
}

// JsonlTraceWriter appends replayable trace records as newline-delimited JSON.
type JsonlTraceWriter struct {
	mu     sync.Mutex
	Path   string
	closed bool
}

func NewJsonlTraceWriter(path string) (*JsonlTraceWriter, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	return &JsonlTraceWriter{Path: path}, nil
}

func (w *JsonlTraceWriter) AppendTurn(turnEvent TurnEvent) (bool, error) {
	return w.write(map[string]interface{}{"kind": "turn", "event": turnEvent.Save(NewSaveContext())})
}

func (w *JsonlTraceWriter) AppendSession(sessionEvent SessionEvent) (bool, error) {
	return w.write(map[string]interface{}{"kind": "session", "event": sessionEvent.Save(NewSaveContext())})
}

func (w *JsonlTraceWriter) Close(summary *SessionSummary) (bool, error) {
	if summary != nil {
		if ok, err := w.write(map[string]interface{}{"kind": "summary", "summary": summary.Save(NewSaveContext())}); !ok || err != nil {
			return ok, err
		}
	}
	w.mu.Lock()
	w.closed = true
	w.mu.Unlock()
	return true, nil
}

func (w *JsonlTraceWriter) write(record map[string]interface{}) (bool, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return false, fmt.Errorf("trace writer is closed")
	}
	file, err := os.OpenFile(w.Path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return false, err
	}
	defer file.Close()
	bytes, err := json.Marshal(record)
	if err != nil {
		return false, err
	}
	if _, err := file.Write(append(bytes, '\n')); err != nil {
		return false, err
	}
	return true, nil
}

// InMemoryCheckpointStore stores checkpoints by session and checkpoint identifier.
type InMemoryCheckpointStore struct {
	mu          sync.Mutex
	checkpoints map[string]Checkpoint
}

func NewInMemoryCheckpointStore() *InMemoryCheckpointStore {
	return &InMemoryCheckpointStore{checkpoints: map[string]Checkpoint{}}
}

func (s *InMemoryCheckpointStore) Save(checkpoint Checkpoint) (Checkpoint, error) {
	key, err := requireCheckpointKey(checkpoint)
	if err != nil {
		return Checkpoint{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoints[key] = checkpoint
	return checkpoint, nil
}

func (s *InMemoryCheckpointStore) Load(sessionId string, checkpointId string) (*Checkpoint, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	checkpoint, ok := s.checkpoints[checkpointKey(sessionId, checkpointId)]
	if !ok {
		return nil, nil
	}
	return &checkpoint, nil
}

func (s *InMemoryCheckpointStore) ListCheckpoints(sessionId string) ([]Checkpoint, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	checkpoints := []Checkpoint{}
	for _, checkpoint := range s.checkpoints {
		if checkpoint.SessionId != nil && *checkpoint.SessionId == sessionId {
			checkpoints = append(checkpoints, checkpoint)
		}
	}
	sort.Slice(checkpoints, func(i int, j int) bool {
		left := ""
		right := ""
		if checkpoints[i].Id != nil {
			left = *checkpoints[i].Id
		}
		if checkpoints[j].Id != nil {
			right = *checkpoints[j].Id
		}
		return left < right
	})
	return checkpoints, nil
}

func checkpointKey(sessionId string, checkpointId string) string {
	return sessionId + "\x00" + checkpointId
}

func requireCheckpointKey(checkpoint Checkpoint) (string, error) {
	if checkpoint.SessionId == nil || *checkpoint.SessionId == "" {
		return "", fmt.Errorf("checkpoint sessionId is required")
	}
	if checkpoint.Id == nil || *checkpoint.Id == "" {
		return "", fmt.Errorf("checkpoint id is required")
	}
	return checkpointKey(*checkpoint.SessionId, *checkpoint.Id), nil
}

// AllowAllPermissionResolver resolves every permission request as approved.
type AllowAllPermissionResolver struct{}

func (r AllowAllPermissionResolver) Request(request PermissionRequest) (PermissionDecision, error) {
	reason := "allow_all"
	return PermissionDecision{
		RequestId:  request.RequestId,
		ToolCallId: request.ToolCallId,
		Permission: request.Permission,
		Approved:   true,
		Reason:     &reason,
	}, nil
}

// DenyAllPermissionResolver resolves every permission request as denied.
type DenyAllPermissionResolver struct{}

func (r DenyAllPermissionResolver) Request(request PermissionRequest) (PermissionDecision, error) {
	reason := "deny_all"
	return PermissionDecision{
		RequestId:  request.RequestId,
		ToolCallId: request.ToolCallId,
		Permission: request.Permission,
		Approved:   false,
		Reason:     &reason,
	}, nil
}

type HostToolHandler func(arguments map[string]interface{}, request HostToolRequest) (interface{}, error)

// FunctionHostToolExecutor dispatches host tool requests to registered functions.
type FunctionHostToolExecutor struct {
	Handlers map[string]HostToolHandler
}

func (e FunctionHostToolExecutor) Execute(request HostToolRequest) (HostToolResult, error) {
	started := time.Now()
	handler, ok := e.Handlers[request.ToolName]
	if !ok {
		errorKind := "not_found"
		result := interface{}(map[string]interface{}{"message": fmt.Sprintf("No host tool registered for '%s'", request.ToolName)})
		durationMs := float64(time.Since(started).Microseconds()) / 1000
		return HostToolResult{
			RequestId:  request.RequestId,
			ToolCallId: request.ToolCallId,
			ToolName:   request.ToolName,
			Success:    false,
			Result:     &result,
			DurationMs: &durationMs,
			ErrorKind:  &errorKind,
		}, nil
	}

	arguments := request.Arguments
	if arguments == nil {
		arguments = map[string]interface{}{}
	}
	result, err := handler(arguments, request)
	durationMs := float64(time.Since(started).Microseconds()) / 1000
	if err != nil {
		errorKind := "exception"
		errorResult := interface{}(map[string]interface{}{"message": err.Error()})
		return HostToolResult{
			RequestId:  request.RequestId,
			ToolCallId: request.ToolCallId,
			ToolName:   request.ToolName,
			Success:    false,
			Result:     &errorResult,
			DurationMs: &durationMs,
			ErrorKind:  &errorKind,
		}, nil
	}

	resultValue := interface{}(result)
	return HostToolResult{
		RequestId:  request.RequestId,
		ToolCallId: request.ToolCallId,
		ToolName:   request.ToolName,
		Success:    true,
		Result:     &resultValue,
		DurationMs: &durationMs,
	}, nil
}

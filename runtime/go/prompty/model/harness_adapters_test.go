package prompty

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testTurnEvent() TurnEvent {
	return TurnEvent{
		Id:        "turn-event",
		Type:      TurnEventTypeTurnStart,
		Timestamp: "2026-06-10T00:00:00Z",
		Payload:   map[string]interface{}{"phase": "start"},
	}
}

func testSessionEvent() SessionEvent {
	sessionId := "session-1"
	return SessionEvent{
		Id:        "session-event",
		Type:      SessionEventTypeSessionStart,
		Timestamp: "2026-06-10T00:00:00Z",
		SessionId: &sessionId,
		Payload:   map[string]interface{}{"phase": "start"},
	}
}

func TestCollectingEventSink(t *testing.T) {
	sink := &CollectingEventSink{}

	if ok, err := sink.EmitTurn(testTurnEvent()); !ok || err != nil {
		t.Fatalf("EmitTurn failed: %v", err)
	}
	if ok, err := sink.EmitSession(testSessionEvent()); !ok || err != nil {
		t.Fatalf("EmitSession failed: %v", err)
	}
	if sink.TurnEvents[0].Id != "turn-event" {
		t.Fatalf("unexpected turn event: %#v", sink.TurnEvents[0])
	}
	if sink.SessionEvents[0].Id != "session-event" {
		t.Fatalf("unexpected session event: %#v", sink.SessionEvents[0])
	}
}

func TestJsonlTraceWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trace.jsonl")
	writer, err := NewJsonlTraceWriter(path)
	if err != nil {
		t.Fatal(err)
	}

	if ok, err := writer.AppendTurn(testTurnEvent()); !ok || err != nil {
		t.Fatalf("AppendTurn failed: %v", err)
	}
	if ok, err := writer.AppendSession(testSessionEvent()); !ok || err != nil {
		t.Fatalf("AppendSession failed: %v", err)
	}
	if ok, err := writer.Close(&SessionSummary{SessionId: "session-1"}); !ok || err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := splitLines(string(content))
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(lines))
	}
	var records []map[string]interface{}
	for _, line := range lines {
		var record map[string]interface{}
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatal(err)
		}
		records = append(records, record)
	}
	if records[0]["kind"] != "turn" || records[1]["kind"] != "session" || records[2]["kind"] != "summary" {
		t.Fatalf("unexpected record kinds: %#v", records)
	}
}

func TestJsonlTraceWriterAfterClose(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trace.jsonl")
	writer, err := NewJsonlTraceWriter(path)
	if err != nil {
		t.Fatal(err)
	}

	if ok, err := writer.Close(nil); !ok || err != nil {
		t.Fatalf("Close failed: %v", err)
	}
	if ok, err := writer.AppendTurn(testTurnEvent()); ok || err == nil {
		t.Fatalf("expected closed writer failure, ok=%v err=%v", ok, err)
	}
}

func TestInMemoryCheckpointStore(t *testing.T) {
	store := NewInMemoryCheckpointStore()
	sessionId := "session-1"
	checkpointId := "checkpoint-1"
	checkpoint := Checkpoint{Id: &checkpointId, SessionId: &sessionId, Title: "First"}

	saved, err := store.Save(checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Title != "First" {
		t.Fatalf("unexpected checkpoint: %#v", saved)
	}
	loaded, err := store.Load("session-1", "checkpoint-1")
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.Title != "First" {
		t.Fatalf("unexpected loaded checkpoint: %#v", loaded)
	}
	missing, err := store.Load("session-1", "missing")
	if err != nil {
		t.Fatal(err)
	}
	if missing != nil {
		t.Fatalf("expected nil missing checkpoint, got %#v", missing)
	}
	listed, err := store.ListCheckpoints("session-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 {
		t.Fatalf("expected one checkpoint, got %d", len(listed))
	}
}

func TestInMemoryCheckpointStoreRequiresKeys(t *testing.T) {
	store := NewInMemoryCheckpointStore()
	checkpointId := "checkpoint-1"
	sessionId := "session-1"

	if _, err := store.Save(Checkpoint{Id: &checkpointId}); err == nil {
		t.Fatal("expected missing sessionId error")
	}
	if _, err := store.Save(Checkpoint{SessionId: &sessionId}); err == nil {
		t.Fatal("expected missing id error")
	}
}

func TestPermissionResolvers(t *testing.T) {
	requestId := "permission-1"
	toolCallId := "tool-call-1"
	request := PermissionRequest{RequestId: &requestId, ToolCallId: &toolCallId, Permission: "tool.execute"}

	allow, err := AllowAllPermissionResolver{}.Request(request)
	if err != nil {
		t.Fatal(err)
	}
	deny, err := DenyAllPermissionResolver{}.Request(request)
	if err != nil {
		t.Fatal(err)
	}
	if !allow.Approved || *allow.Reason != "allow_all" || *allow.RequestId != "permission-1" {
		t.Fatalf("unexpected allow decision: %#v", allow)
	}
	if deny.Approved || *deny.Reason != "deny_all" {
		t.Fatalf("unexpected deny decision: %#v", deny)
	}
}

func TestFunctionHostToolExecutor(t *testing.T) {
	requestId := "exec-1"
	executor := FunctionHostToolExecutor{Handlers: map[string]HostToolHandler{
		"add": func(arguments map[string]interface{}, request HostToolRequest) (interface{}, error) {
			return int(arguments["a"].(int)) + int(arguments["b"].(int)), nil
		},
	}}

	result, err := executor.Execute(HostToolRequest{
		RequestId: &requestId,
		ToolName:  "add",
		Arguments: map[string]interface{}{"a": 2, "b": 3},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || *result.Result != 5 {
		t.Fatalf("unexpected success result: %#v", result)
	}
}

func TestFunctionHostToolExecutorEmptyArguments(t *testing.T) {
	executor := FunctionHostToolExecutor{Handlers: map[string]HostToolHandler{
		"count": func(arguments map[string]interface{}, request HostToolRequest) (interface{}, error) {
			return len(arguments), nil
		},
	}}

	result, err := executor.Execute(HostToolRequest{ToolName: "count"})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || *result.Result != 0 {
		t.Fatalf("unexpected success result: %#v", result)
	}
}

func TestFunctionHostToolExecutorFailures(t *testing.T) {
	executor := FunctionHostToolExecutor{Handlers: map[string]HostToolHandler{
		"fail": func(arguments map[string]interface{}, request HostToolRequest) (interface{}, error) {
			return nil, fmt.Errorf("boom")
		},
	}}

	missing, err := executor.Execute(HostToolRequest{ToolName: "missing"})
	if err != nil {
		t.Fatal(err)
	}
	thrown, err := executor.Execute(HostToolRequest{ToolName: "fail"})
	if err != nil {
		t.Fatal(err)
	}
	if missing.Success || *missing.ErrorKind != "not_found" {
		t.Fatalf("unexpected missing result: %#v", missing)
	}
	if thrown.Success || *thrown.ErrorKind != "exception" {
		t.Fatalf("unexpected thrown result: %#v", thrown)
	}
}

func splitLines(content string) []string {
	var lines []string
	for _, line := range strings.Split(content, "\n") {
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

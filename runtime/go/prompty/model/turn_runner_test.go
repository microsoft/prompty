package prompty

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixedIds() func(prefix string) string {
	index := 0
	return func(prefix string) string {
		index++
		return fmt.Sprintf("%s-%d", prefix, index)
	}
}

func readJournalRecords(t *testing.T, path string) []map[string]interface{} {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	records := []map[string]interface{}{}
	for _, line := range splitLines(string(content)) {
		var record map[string]interface{}
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatal(err)
		}
		records = append(records, record)
	}
	return records
}

func TestReferenceTurnRunnerEmitsJournalsAndCheckpoints(t *testing.T) {
	journalPath := filepath.Join(t.TempDir(), "trace.jsonl")
	journal, err := NewJsonlEventJournalWriter(journalPath)
	if err != nil {
		t.Fatal(err)
	}
	sink := &CollectingEventSink{}
	checkpointStore := NewInMemoryCheckpointStore()
	maxIterations := int32(3)
	runner := ReferenceTurnRunner{
		EventSink:          sink,
		Journal:            journal,
		CheckpointStore:    checkpointStore,
		PermissionResolver: AllowAllPermissionResolver{},
		HostToolExecutor:   FunctionHostToolExecutor{},
		InvokeModel: func(request TurnModelRequest) (TurnModelResponse, error) {
			return TurnModelResponse{
				Output:          map[string]interface{}{"text": "hello " + request.Inputs["name"].(string)},
				CheckpointState: map[string]interface{}{"stable": true},
			}, nil
		},
		Now:    func() string { return "2026-06-28T00:00:00Z" },
		NextId: fixedIds(),
	}

	result, err := runner.Run(RunTurnRequest{
		SessionId: "session-1",
		TurnId:    "turn-1",
		Inputs:    map[string]interface{}{"name": "Ada"},
		Options:   TurnOptions{MaxIterations: &maxIterations},
	})
	if err != nil {
		t.Fatal(err)
	}

	if result.Status != "success" || result.Iterations != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Output.(map[string]interface{})["text"] != "hello Ada" {
		t.Fatalf("unexpected output: %#v", result.Output)
	}
	assertEventTypes(t, turnTypes(sink.TurnEvents), []string{"turn_start", "llm_start", "llm_complete", "turn_end"})
	assertEventTypes(t, sessionTypes(sink.SessionEvents), []string{"session_start", "checkpoint_created", "session_end"})
	checkpoint, err := checkpointStore.Load("session-1", "turn-1-checkpoint-0")
	if err != nil {
		t.Fatal(err)
	}
	if checkpoint == nil || checkpoint.State["stable"] != true {
		t.Fatalf("unexpected checkpoint: %#v", checkpoint)
	}
	records := readJournalRecords(t, journalPath)
	assertEventTypes(t, recordKinds(records), []string{"session", "turn", "turn", "turn", "session", "turn", "session", "summary"})
}

func TestReferenceTurnRunnerExecutesHostTools(t *testing.T) {
	journal, err := NewJsonlEventJournalWriter(filepath.Join(t.TempDir(), "trace.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	sink := &CollectingEventSink{}
	runner := ReferenceTurnRunner{
		EventSink:          sink,
		Journal:            journal,
		CheckpointStore:    NewInMemoryCheckpointStore(),
		PermissionResolver: AllowAllPermissionResolver{},
		HostToolExecutor: FunctionHostToolExecutor{Handlers: map[string]HostToolHandler{
			"add": func(arguments map[string]interface{}, request HostToolRequest) (interface{}, error) {
				return arguments["a"].(int) + arguments["b"].(int), nil
			},
		}},
		InvokeModel: func(request TurnModelRequest) (TurnModelResponse, error) {
			if request.Iteration == 0 {
				requestId := "exec-1"
				toolCallId := "call-1"
				return TurnModelResponse{ToolRequests: []HostToolRequest{{
					RequestId:  &requestId,
					ToolCallId: &toolCallId,
					ToolName:   "add",
					Arguments:  map[string]interface{}{"a": 2, "b": 3},
				}}}, nil
			}
			return TurnModelResponse{Output: map[string]interface{}{"toolResult": *request.ToolResults[0].Result}}, nil
		},
		Now:    func() string { return "2026-06-28T00:00:00Z" },
		NextId: fixedIds(),
	}

	result, err := runner.Run(RunTurnRequest{SessionId: "session-1", TurnId: "turn-1"})
	if err != nil {
		t.Fatal(err)
	}

	if result.Output.(map[string]interface{})["toolResult"] != 5 {
		t.Fatalf("unexpected output: %#v", result.Output)
	}
	if !result.ToolResults[0].Success || *result.ToolResults[0].Result != 5 {
		t.Fatalf("unexpected tool result: %#v", result.ToolResults[0])
	}
	assertEventTypes(t, turnTypes(sink.TurnEvents), []string{
		"turn_start", "llm_start", "llm_complete", "permission_requested", "permission_completed",
		"tool_execution_start", "tool_execution_complete", "tool_result", "messages_updated",
		"llm_start", "llm_complete", "turn_end",
	})
}

func TestReferenceTurnRunnerDeniedPermissionSkipsExecution(t *testing.T) {
	journal, err := NewJsonlEventJournalWriter(filepath.Join(t.TempDir(), "trace.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	sink := &CollectingEventSink{}
	runner := ReferenceTurnRunner{
		EventSink:          sink,
		Journal:            journal,
		CheckpointStore:    NewInMemoryCheckpointStore(),
		PermissionResolver: DenyAllPermissionResolver{},
		HostToolExecutor: FunctionHostToolExecutor{Handlers: map[string]HostToolHandler{
			"shell": func(arguments map[string]interface{}, request HostToolRequest) (interface{}, error) {
				t.Fatal("should not execute")
				return nil, nil
			},
		}},
		InvokeModel: func(request TurnModelRequest) (TurnModelResponse, error) {
			if request.Iteration == 0 {
				requestId := "exec-1"
				return TurnModelResponse{ToolRequests: []HostToolRequest{{RequestId: &requestId, ToolName: "shell"}}}, nil
			}
			return TurnModelResponse{Output: map[string]interface{}{"denied": *request.ToolResults[0].ErrorKind}}, nil
		},
		Now:    func() string { return "2026-06-28T00:00:00Z" },
		NextId: fixedIds(),
	}

	result, err := runner.Run(RunTurnRequest{SessionId: "session-1", TurnId: "turn-1"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Output.(map[string]interface{})["denied"] != "permission_denied" {
		t.Fatalf("unexpected output: %#v", result.Output)
	}
	for _, event := range sink.TurnEvents {
		if event.Type == TurnEventTypeToolExecutionStart {
			t.Fatalf("unexpected tool execution event: %#v", event)
		}
	}
}

func TestReferenceTurnRunnerHostToolFailure(t *testing.T) {
	journal, err := NewJsonlEventJournalWriter(filepath.Join(t.TempDir(), "trace.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	runner := ReferenceTurnRunner{
		EventSink:          &CollectingEventSink{},
		Journal:            journal,
		CheckpointStore:    NewInMemoryCheckpointStore(),
		PermissionResolver: AllowAllPermissionResolver{},
		HostToolExecutor: FunctionHostToolExecutor{Handlers: map[string]HostToolHandler{
			"fail": func(arguments map[string]interface{}, request HostToolRequest) (interface{}, error) {
				return nil, fmt.Errorf("boom")
			},
		}},
		InvokeModel: func(request TurnModelRequest) (TurnModelResponse, error) {
			if request.Iteration == 0 {
				requestId := "exec-1"
				return TurnModelResponse{ToolRequests: []HostToolRequest{{RequestId: &requestId, ToolName: "fail"}}}, nil
			}
			return TurnModelResponse{Output: request.ToolResults[0].Save(NewSaveContext())}, nil
		},
		Now:    func() string { return "2026-06-28T00:00:00Z" },
		NextId: fixedIds(),
	}

	result, err := runner.Run(RunTurnRequest{SessionId: "session-1", TurnId: "turn-1"})
	if err != nil {
		t.Fatal(err)
	}
	output := result.Output.(map[string]interface{})
	if output["success"] != false || output["errorKind"] != "exception" {
		t.Fatalf("unexpected output: %#v", output)
	}
}

func TestReferenceTurnRunnerDeterministicJournal(t *testing.T) {
	runOnce := func(path string) []map[string]interface{} {
		journal, err := NewJsonlEventJournalWriter(path)
		if err != nil {
			t.Fatal(err)
		}
		runner := ReferenceTurnRunner{
			EventSink:          &CollectingEventSink{},
			Journal:            journal,
			CheckpointStore:    NewInMemoryCheckpointStore(),
			PermissionResolver: AllowAllPermissionResolver{},
			HostToolExecutor:   FunctionHostToolExecutor{},
			InvokeModel: func(request TurnModelRequest) (TurnModelResponse, error) {
				return TurnModelResponse{Output: "done"}, nil
			},
			Now:    func() string { return "2026-06-28T00:00:00Z" },
			NextId: fixedIds(),
		}
		if _, err := runner.Run(RunTurnRequest{SessionId: "session-1", TurnId: "turn-1"}); err != nil {
			t.Fatal(err)
		}
		return readJournalRecords(t, path)
	}

	first := runOnce(filepath.Join(t.TempDir(), "first.jsonl"))
	second := runOnce(filepath.Join(t.TempDir(), "second.jsonl"))
	firstJSON, _ := json.Marshal(first)
	secondJSON, _ := json.Marshal(second)
	if string(firstJSON) != string(secondJSON) {
		t.Fatalf("journals differ:\n%s\n%s", firstJSON, secondJSON)
	}
}

func turnTypes(events []TurnEvent) []string {
	result := []string{}
	for _, event := range events {
		result = append(result, string(event.Type))
	}
	return result
}

func sessionTypes(events []SessionEvent) []string {
	result := []string{}
	for _, event := range events {
		result = append(result, string(event.Type))
	}
	return result
}

func recordKinds(records []map[string]interface{}) []string {
	result := []string{}
	for _, record := range records {
		result = append(result, record["kind"].(string))
	}
	return result
}

func assertEventTypes(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if strings.Join(actual, ",") != strings.Join(expected, ",") {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}

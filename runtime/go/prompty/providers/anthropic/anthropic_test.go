package anthropic

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	prompty "prompty/model"
	"prompty/providers"
)

func loadAgent(t *testing.T, data map[string]interface{}) prompty.Agent {
	t.Helper()
	agent, err := prompty.LoadAgent(data, prompty.NewLoadContext())
	if err != nil {
		t.Fatalf("LoadAgent failed: %v", err)
	}
	return agent
}

func keyAgent(t *testing.T, endpoint string) prompty.Agent {
	return loadAgent(t, map[string]interface{}{
		"name": "t",
		"model": map[string]interface{}{
			"id": "claude-sonnet-4",
			"connection": map[string]interface{}{
				"kind":     "key",
				"endpoint": endpoint,
				"apiKey":   "ant-test",
			},
		},
	})
}

func TestExecuteMessages(t *testing.T) {
	var gotPath, gotKey, gotVersion string
	var gotBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotKey = r.Header.Get("x-api-key")
		gotVersion = r.Header.Get("anthropic-version")
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"hi"}]}`))
	}))
	defer srv.Close()

	messages := []prompty.Message{
		{Role: prompty.Role("system"), Parts: []interface{}{prompty.TextPart{Kind: "text", Value: "be nice"}}},
		{Role: prompty.Role("user"), Parts: []interface{}{prompty.TextPart{Kind: "text", Value: "hello"}}},
	}
	if _, err := (Executor{}).Execute(keyAgent(t, srv.URL), messages); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotPath != "/v1/messages" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotKey != "ant-test" {
		t.Fatalf("x-api-key = %q", gotKey)
	}
	if gotVersion != APIVersion {
		t.Fatalf("anthropic-version = %q", gotVersion)
	}
	if gotBody["system"] != "be nice" {
		t.Fatalf("expected system extracted, body = %v", gotBody)
	}
}

func TestReferenceConnectionUnsupported(t *testing.T) {
	agent := loadAgent(t, map[string]interface{}{
		"name": "t",
		"model": map[string]interface{}{
			"id":         "claude",
			"connection": map[string]interface{}{"kind": "reference", "name": "my-conn"},
		},
	})
	if _, err := (Executor{}).Execute(agent, nil); err == nil {
		t.Fatal("expected error for reference connection")
	}
}

func TestProcess(t *testing.T) {
	agent := keyAgent(t, "https://example.com")
	resp := map[string]interface{}{"content": []interface{}{map[string]interface{}{"type": "text", "text": "answer"}}}
	out, err := Processor{}.Process(agent, resp)
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if out != "answer" {
		t.Fatalf("process result = %v", out)
	}
}

func TestFormatToolMessages(t *testing.T) {
	text := "let me check"
	calls := []prompty.ToolCall{{Id: "tu1", Name: "get_weather", Arguments: `{"city":"NYC"}`}}
	msgs, err := Executor{}.FormatToolMessages(nil, calls, []string{"72F"}, &text)
	if err != nil {
		t.Fatalf("FormatToolMessages: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	content, ok := msgs[0].Metadata["content"].([]interface{})
	if !ok || len(content) != 2 {
		t.Fatalf("assistant content blocks = %v", msgs[0].Metadata["content"])
	}
	toolUse := content[1].(map[string]interface{})
	if toolUse["type"] != "tool_use" || toolUse["id"] != "tu1" {
		t.Fatalf("tool_use block = %v", toolUse)
	}
	input, ok := toolUse["input"].(map[string]interface{})
	if !ok || input["city"] != "NYC" {
		t.Fatalf("tool_use input = %v", toolUse["input"])
	}
	results, ok := msgs[1].Metadata["tool_results"].([]interface{})
	if !ok || len(results) != 1 {
		t.Fatalf("tool_results = %v", msgs[1].Metadata["tool_results"])
	}
	block := results[0].(map[string]interface{})
	if block["type"] != "tool_result" || block["tool_use_id"] != "tu1" || block["content"] != "72F" {
		t.Fatalf("tool_result block = %v", block)
	}
}

func TestStreamingUnsupported(t *testing.T) {
	if _, err := (Executor{}).ExecuteStream(keyAgent(t, "https://x"), nil); err != providers.ErrStreamingUnsupported {
		t.Fatalf("ExecuteStream err = %v", err)
	}
	if _, err := (Processor{}).ProcessStream(keyAgent(t, "https://x"), nil); err != providers.ErrStreamingUnsupported {
		t.Fatalf("ProcessStream err = %v", err)
	}
}

func TestRegister(t *testing.T) {
	Register()
	if _, ok := providers.GetExecutor("anthropic"); !ok {
		t.Fatal("anthropic executor not registered")
	}
	if _, ok := providers.GetProcessor("anthropic"); !ok {
		t.Fatal("anthropic processor not registered")
	}
}

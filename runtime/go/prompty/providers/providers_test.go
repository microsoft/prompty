package providers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	prompty "prompty/model"
)

func loadAgent(t *testing.T, data map[string]interface{}) prompty.Agent {
	t.Helper()
	agent, err := prompty.LoadAgent(data, prompty.NewLoadContext())
	if err != nil {
		t.Fatalf("LoadAgent failed: %v", err)
	}
	return agent
}

func textMessage(role, text string) prompty.Message {
	return prompty.Message{
		Role:  prompty.Role(role),
		Parts: []interface{}{prompty.TextPart{Kind: "text", Value: text}},
	}
}

func TestRegistryRoundTrip(t *testing.T) {
	// Isolate from any global registration by using unique keys.
	RegisterExecutor("test-exec", nil)
	if _, ok := GetExecutor("test-exec"); !ok {
		t.Fatal("expected registered executor key to be present")
	}
	if _, ok := GetExecutor("missing-key"); ok {
		t.Fatal("expected missing key to be absent")
	}
	RegisterProcessor("test-proc", nil)
	if _, ok := GetProcessor("test-proc"); !ok {
		t.Fatal("expected registered processor key to be present")
	}
}

func TestBuildInputChat(t *testing.T) {
	agent := loadAgent(t, map[string]interface{}{
		"name": "t",
		"model": map[string]interface{}{
			"id":      "gpt-4",
			"options": map[string]interface{}{"temperature": 0.5},
		},
		"tools": []interface{}{
			map[string]interface{}{
				"name":        "get_weather",
				"kind":        "function",
				"description": "Get weather",
				"parameters": []interface{}{
					map[string]interface{}{"name": "location", "kind": "string", "required": true},
				},
			},
		},
		"outputs": []interface{}{
			map[string]interface{}{"name": "answer", "kind": "string", "required": true},
		},
	})

	input := BuildInput(agent, []prompty.Message{textMessage("user", "hi")}, "openai")
	if input["provider"] != "openai" {
		t.Fatalf("provider = %v", input["provider"])
	}
	if input["model_id"] != "gpt-4" {
		t.Fatalf("model_id = %v", input["model_id"])
	}

	body, err := prompty.BuildWireRequest(input)
	if err != nil {
		t.Fatalf("BuildWireRequest: %v", err)
	}
	if body["model"] != "gpt-4" {
		t.Fatalf("body model = %v", body["model"])
	}
	if _, ok := body["tools"]; !ok {
		t.Fatal("expected tools in wire body")
	}
	if _, ok := body["response_format"]; !ok {
		t.Fatal("expected response_format in wire body")
	}
	msgs, ok := body["messages"].([]interface{})
	if !ok || len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %v", body["messages"])
	}
}

func TestMessagesToWireMediaAndMetadata(t *testing.T) {
	mt := "image/png"
	messages := []prompty.Message{
		{
			Role: prompty.Role("user"),
			Parts: []interface{}{
				prompty.TextPart{Kind: "text", Value: "describe"},
				prompty.ImagePart{Kind: "image", Source: "b64data", MediaType: &mt},
			},
			Metadata: map[string]interface{}{"k": "v"},
		},
	}
	wire := messagesToWire(messages)
	m := wire[0].(map[string]interface{})
	if m["metadata"] == nil {
		t.Fatal("expected metadata preserved")
	}
	content := m["content"].([]interface{})
	img := content[1].(map[string]interface{})
	if img["kind"] != "image" || img["value"] != "b64data" || img["mediaType"] != "image/png" {
		t.Fatalf("image part mapped incorrectly: %v", img)
	}
}

func TestResolveConnectionApiKey(t *testing.T) {
	agent := loadAgent(t, map[string]interface{}{
		"name": "t",
		"model": map[string]interface{}{
			"id": "gpt-4",
			"connection": map[string]interface{}{
				"kind":     "key",
				"endpoint": "https://example.com",
				"apiKey":   "sk-abc",
			},
		},
	})
	conn := ResolveConnection(agent)
	if conn.Kind != "key" || conn.Endpoint != "https://example.com" || conn.APIKey != "sk-abc" {
		t.Fatalf("resolved connection = %+v", conn)
	}
}

func TestResolveConnectionEmpty(t *testing.T) {
	agent := loadAgent(t, map[string]interface{}{"name": "t", "model": map[string]interface{}{"id": "gpt-4"}})
	conn := ResolveConnection(agent)
	if conn.Endpoint != "" || conn.APIKey != "" {
		t.Fatalf("expected empty connection, got %+v", conn)
	}
}

func TestFormatChatToolMessages(t *testing.T) {
	text := "thinking"
	calls := []prompty.ToolCall{{Id: "c1", Name: "get_weather", Arguments: `{"location":"NYC"}`}}
	msgs := FormatChatToolMessages(calls, []string{"72F"}, &text)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	if string(msgs[0].Role) != "assistant" {
		t.Fatalf("first message role = %s", msgs[0].Role)
	}
	if _, ok := msgs[0].Metadata["tool_calls"]; !ok {
		t.Fatal("assistant message missing tool_calls metadata")
	}
	if string(msgs[1].Role) != "tool" {
		t.Fatalf("second message role = %s", msgs[1].Role)
	}
	if msgs[1].Metadata["tool_call_id"] != "c1" || msgs[1].Metadata["name"] != "get_weather" {
		t.Fatalf("tool message metadata = %v", msgs[1].Metadata)
	}
}

func TestPostJSON(t *testing.T) {
	var gotBody map[string]interface{}
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	resp, err := PostJSON(srv.URL, map[string]string{"Authorization": "Bearer x"}, map[string]interface{}{"a": 1})
	if err != nil {
		t.Fatalf("PostJSON: %v", err)
	}
	if resp["ok"] != true {
		t.Fatalf("response = %v", resp)
	}
	if gotAuth != "Bearer x" {
		t.Fatalf("auth header = %q", gotAuth)
	}
	if gotBody["a"] != float64(1) {
		t.Fatalf("request body = %v", gotBody)
	}
}

func TestPostJSONErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"bad"}`))
	}))
	defer srv.Close()

	_, err := PostJSON(srv.URL, nil, map[string]interface{}{})
	if err == nil {
		t.Fatal("expected error on non-2xx status")
	}
}

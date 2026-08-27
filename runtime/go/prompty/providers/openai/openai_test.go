package openai

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
			"id": "gpt-4",
			"connection": map[string]interface{}{
				"kind":     "key",
				"endpoint": endpoint,
				"apiKey":   "sk-test",
			},
		},
	})
}

func userMsg(text string) []prompty.Message {
	return []prompty.Message{{Role: prompty.Role("user"), Parts: []interface{}{prompty.TextPart{Kind: "text", Value: text}}}}
}

func TestExecuteChat(t *testing.T) {
	var gotPath, gotAuth string
	var gotBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hello"}}]}`))
	}))
	defer srv.Close()

	resp, err := Executor{}.Execute(keyAgent(t, srv.URL), userMsg("hi"))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotPath != "/chat/completions" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "Bearer sk-test" {
		t.Fatalf("auth = %q", gotAuth)
	}
	if gotBody["model"] != "gpt-4" {
		t.Fatalf("body model = %v", gotBody["model"])
	}
	if _, ok := resp.(map[string]interface{}); !ok {
		t.Fatalf("expected map response, got %T", resp)
	}
}

func TestExecuteMissingKey(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")
	agent := loadAgent(t, map[string]interface{}{"name": "t", "model": map[string]interface{}{"id": "gpt-4"}})
	if _, err := (Executor{}).Execute(agent, userMsg("hi")); err == nil {
		t.Fatal("expected error when no API key present")
	}
}

func TestExecuteEnvKeyFallback(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-env")
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer srv.Close()

	agent := loadAgent(t, map[string]interface{}{
		"name": "t",
		"model": map[string]interface{}{
			"id":         "gpt-4",
			"connection": map[string]interface{}{"kind": "anonymous", "endpoint": srv.URL},
		},
	})
	if _, err := (Executor{}).Execute(agent, userMsg("hi")); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotAuth != "Bearer sk-env" {
		t.Fatalf("auth = %q", gotAuth)
	}
}

func TestProcessChat(t *testing.T) {
	agent := keyAgent(t, "https://example.com")
	resp := map[string]interface{}{
		"choices": []interface{}{
			map[string]interface{}{"message": map[string]interface{}{"content": "hi there"}},
		},
	}
	out, err := Processor{}.Process(agent, resp)
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if out != "hi there" {
		t.Fatalf("process result = %v", out)
	}
}

func TestFormatToolMessages(t *testing.T) {
	calls := []prompty.ToolCall{{Id: "c1", Name: "f", Arguments: "{}"}}
	msgs, err := Executor{}.FormatToolMessages(nil, calls, []string{"r1"}, nil)
	if err != nil {
		t.Fatalf("FormatToolMessages: %v", err)
	}
	if len(msgs) != 2 || string(msgs[0].Role) != "assistant" || string(msgs[1].Role) != "tool" {
		t.Fatalf("unexpected messages: %+v", msgs)
	}
}

func TestStreamingUnsupported(t *testing.T) {
	agent := keyAgent(t, "https://example.com")
	if _, err := (Executor{}).ExecuteStream(agent, userMsg("hi")); err != providers.ErrStreamingUnsupported {
		t.Fatalf("ExecuteStream err = %v", err)
	}
	if _, err := (Processor{}).ProcessStream(agent, nil); err != providers.ErrStreamingUnsupported {
		t.Fatalf("ProcessStream err = %v", err)
	}
}

func TestRegister(t *testing.T) {
	Register()
	if _, ok := providers.GetExecutor("openai"); !ok {
		t.Fatal("openai executor not registered")
	}
	if _, ok := providers.GetProcessor("openai"); !ok {
		t.Fatal("openai processor not registered")
	}
}

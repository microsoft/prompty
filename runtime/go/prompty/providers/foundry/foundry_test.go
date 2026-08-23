package foundry

import (
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

func userMsg(text string) []prompty.Message {
	return []prompty.Message{{Role: prompty.Role("user"), Parts: []interface{}{prompty.TextPart{Kind: "text", Value: text}}}}
}

func TestExecuteApiKey(t *testing.T) {
	var gotPath, gotQuery, gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotKey = r.Header.Get("api-key")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer srv.Close()

	agent := loadAgent(t, map[string]interface{}{
		"name": "t",
		"model": map[string]interface{}{
			"id": "my-deployment",
			"connection": map[string]interface{}{
				"kind":     "key",
				"endpoint": srv.URL,
				"apiKey":   "azure-key",
			},
		},
	})
	if _, err := (Executor{}).Execute(agent, userMsg("hi")); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotPath != "/openai/deployments/my-deployment/chat/completions" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotQuery != "api-version="+DefaultAPIVersion {
		t.Fatalf("query = %q", gotQuery)
	}
	if gotKey != "azure-key" {
		t.Fatalf("api-key = %q", gotKey)
	}
}

func TestExecuteAccessToken(t *testing.T) {
	t.Setenv("AZURE_OPENAI_API_KEY", "")
	t.Setenv("AZURE_OPENAI_ACCESS_TOKEN", "tok-123")
	var gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer srv.Close()

	agent := loadAgent(t, map[string]interface{}{
		"name": "t",
		"model": map[string]interface{}{
			"id":         "dep",
			"connection": map[string]interface{}{"kind": "foundry", "endpoint": srv.URL},
		},
	})
	if _, err := (Executor{}).Execute(agent, userMsg("hi")); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotPath != "/openai/v1/chat/completions" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "Bearer tok-123" {
		t.Fatalf("auth = %q", gotAuth)
	}
}

func TestExecuteMissingEndpoint(t *testing.T) {
	t.Setenv("AZURE_OPENAI_ENDPOINT", "")
	agent := loadAgent(t, map[string]interface{}{"name": "t", "model": map[string]interface{}{"id": "dep"}})
	if _, err := (Executor{}).Execute(agent, userMsg("hi")); err == nil {
		t.Fatal("expected error when endpoint missing")
	}
}

func TestExecuteMissingCreds(t *testing.T) {
	t.Setenv("AZURE_OPENAI_API_KEY", "")
	t.Setenv("AZURE_OPENAI_ACCESS_TOKEN", "")
	agent := loadAgent(t, map[string]interface{}{
		"name": "t",
		"model": map[string]interface{}{
			"id":         "dep",
			"connection": map[string]interface{}{"kind": "foundry", "endpoint": "https://example.com"},
		},
	})
	if _, err := (Executor{}).Execute(agent, userMsg("hi")); err == nil {
		t.Fatal("expected error when no credentials present")
	}
}

func TestProcess(t *testing.T) {
	agent := loadAgent(t, map[string]interface{}{"name": "t", "model": map[string]interface{}{"id": "dep"}})
	resp := map[string]interface{}{
		"choices": []interface{}{map[string]interface{}{"message": map[string]interface{}{"content": "ok"}}},
	}
	out, err := Processor{}.Process(agent, resp)
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if out != "ok" {
		t.Fatalf("process result = %v", out)
	}
}

func TestStreamingUnsupported(t *testing.T) {
	agent := loadAgent(t, map[string]interface{}{"name": "t", "model": map[string]interface{}{"id": "dep"}})
	if _, err := (Executor{}).ExecuteStream(agent, nil); err != providers.ErrStreamingUnsupported {
		t.Fatalf("ExecuteStream err = %v", err)
	}
	if _, err := (Processor{}).ProcessStream(nil); err != providers.ErrStreamingUnsupported {
		t.Fatalf("ProcessStream err = %v", err)
	}
}

func TestRegister(t *testing.T) {
	Register()
	if _, ok := providers.GetExecutor("foundry"); !ok {
		t.Fatal("foundry executor not registered")
	}
	if _, ok := providers.GetProcessor("foundry"); !ok {
		t.Fatal("foundry processor not registered")
	}
}

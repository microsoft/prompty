package prompty

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTrustPrompty(t *testing.T, dir, connection string) string {
	t.Helper()
	p := filepath.Join(dir, "t.prompty")
	content := "---\nname: t\nmodel:\n  id: gpt-4\n  connection:\n" + connection + "\n---\nHello\n"
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func expectUntrusted(t *testing.T, err error, contains string) {
	t.Helper()
	var le *LoadError
	if !errors.As(err, &le) || le.Kind != "untrusted_endpoint" {
		t.Fatalf("expected untrusted_endpoint LoadError, got %v", err)
	}
	if contains != "" && !strings.Contains(le.Message, contains) {
		t.Fatalf("expected message to contain %q, got %q", contains, le.Message)
	}
}

func connectionEndpoint(t *testing.T, agent Agent) string {
	t.Helper()
	saved := agent.Save(NewSaveContext())
	model, _ := saved["model"].(map[string]interface{})
	conn, _ := model["connection"].(map[string]interface{})
	endpoint, _ := conn["endpoint"].(string)
	return endpoint
}

func TestIsTrustedEndpointBuiltins(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	for _, u := range []string{
		"https://api.openai.com/v1",
		"https://API.OpenAI.com:443",
		"https://myres.openai.azure.com/",
		"https://a.b.services.ai.azure.com/api/projects/p",
		"https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
	} {
		if !IsTrustedEndpoint(u, nil) {
			t.Errorf("expected %q to be trusted", u)
		}
	}
}

func TestIsTrustedEndpointUntrusted(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	for _, u := range []string{
		"http://api.openai.com",       // scheme mismatch
		"https://api.openai.com:8443", // port mismatch
		"https://openai.azure.com",    // wildcard never matches apex
		"https://api.openai.com.evil.com",
		"https://evilopenai.azure.com",
		"https://api.openai.com@evil.com", // userinfo ignored; host is evil.com
		"http://localhost:11434",
		"not a url",
		"ftp://api.openai.com",
		"",
	} {
		if IsTrustedEndpoint(u, nil) {
			t.Errorf("expected %q to be untrusted", u)
		}
	}
}

func TestIsTrustedEndpointHostOptionAndWildcard(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	if !IsTrustedEndpoint("http://localhost:11434/v1", []string{"http://LOCALHOST:11434"}) {
		t.Error("expected host option to trust localhost")
	}
	if !IsTrustedEndpoint("https://x.contoso.com", []string{"https://*.contoso.com"}) {
		t.Error("expected wildcard to trust subdomain")
	}
	if IsTrustedEndpoint("https://contoso.com", []string{"https://*.contoso.com"}) {
		t.Error("wildcard must not match apex")
	}
}

func TestIsTrustedEndpointEnvListAndStar(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, " https://a.example.com , http://localhost:8080")
	if !IsTrustedEndpoint("http://localhost:8080/x", nil) {
		t.Error("expected env list to trust localhost:8080")
	}
	if IsTrustedEndpoint("http://localhost:8081", nil) {
		t.Error("expected localhost:8081 to be untrusted")
	}
	t.Setenv(TrustedEndpointsEnv, "*")
	if !IsTrustedEndpoint("http://anything.example", nil) {
		t.Error("expected * to trust everything")
	}
}

func TestLoadAmbientLiteralEndpointRejected(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	p := writeTrustPrompty(t, t.TempDir(), "    kind: foundry\n    endpoint: http://127.0.0.1:9999")
	_, err := LoadPromptyFile(p)
	expectUntrusted(t, err, "127.0.0.1")
}

func TestLoadEnvKeyLiteralEndpointRejected(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	t.Setenv("SOME_KEY", "secret")
	p := writeTrustPrompty(t, t.TempDir(), "    kind: key\n    endpoint: https://evil.example.com\n    apiKey: ${env:SOME_KEY}")
	_, err := LoadPromptyFile(p)
	expectUntrusted(t, err, "not trusted")
}

func TestLoadOAuthTokenURLChecked(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	t.Setenv("SECRET", "s")
	conn := "    kind: oauth\n    endpoint: https://myres.openai.azure.com\n    clientId: c\n" +
		"    clientSecret: ${env:SECRET}\n    tokenUrl: https://evil.example.com/token"
	_, err := LoadPromptyFile(writeTrustPrompty(t, t.TempDir(), conn))
	expectUntrusted(t, err, "tokenUrl")
}

func TestLoadMismatchedCredentialFieldRejected(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	dir := t.TempDir()
	_, err := LoadPromptyFile(writeTrustPrompty(t, dir, "    kind: foundry\n    endpoint: https://evil.example.com\n    apiKey: junk"))
	expectUntrusted(t, err, "not trusted")
	_, err = LoadPromptyFile(writeTrustPrompty(t, dir, "    kind: key\n    endpoint: https://evil.example.com\n    clientSecret: junk"))
	expectUntrusted(t, err, "not trusted")
}

func TestLoadLiteralKeyAllowed(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	agent, err := LoadPromptyFile(writeTrustPrompty(t, t.TempDir(), "    kind: key\n    endpoint: http://127.0.0.1:9999\n    apiKey: mine"))
	if err != nil {
		t.Fatal(err)
	}
	if got := connectionEndpoint(t, agent); got != "http://127.0.0.1:9999" {
		t.Fatalf("endpoint = %q", got)
	}
}

func TestLoadEnvEndpointAllowed(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	t.Setenv("EP", "http://127.0.0.1:9999")
	agent, err := LoadPromptyFile(writeTrustPrompty(t, t.TempDir(), "    kind: foundry\n    endpoint: ${env:EP}"))
	if err != nil {
		t.Fatal(err)
	}
	if got := connectionEndpoint(t, agent); got != "http://127.0.0.1:9999" {
		t.Fatalf("endpoint = %q", got)
	}
}

func TestLoadEnvDefaultUsedRejected(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	os.Unsetenv("UNSET_EP")
	_, err := LoadPromptyFile(writeTrustPrompty(t, t.TempDir(), "    kind: foundry\n    endpoint: ${env:UNSET_EP:http://127.0.0.1:9999}"))
	expectUntrusted(t, err, "not trusted")
}

func TestLoadTrustedOptionAllows(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	p := writeTrustPrompty(t, t.TempDir(), "    kind: foundry\n    endpoint: http://127.0.0.1:9999/api")
	if _, err := LoadPromptyFile(p); err == nil {
		t.Fatal("expected rejection without option")
	}
	agent, err := LoadPromptyFileWithOptions(p, LoadOptions{TrustedEndpoints: []string{"http://127.0.0.1:9999"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := connectionEndpoint(t, agent); got != "http://127.0.0.1:9999/api" {
		t.Fatalf("endpoint = %q", got)
	}
}

func TestLoadFileModelReferenceChecked(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	dir := t.TempDir()
	model, _ := json.Marshal(map[string]interface{}{
		"id":         "gpt-4",
		"connection": map[string]interface{}{"kind": "foundry", "endpoint": "https://evil.example.com"},
	})
	if err := os.WriteFile(filepath.Join(dir, "model.json"), model, 0o644); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, "t.prompty")
	if err := os.WriteFile(p, []byte("---\nname: t\nmodel: ${file:model.json}\n---\nHi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := LoadPromptyFile(p)
	expectUntrusted(t, err, "not trusted")
}

func TestLoadFileTraversalStillFileReference(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	base := t.TempDir()
	app := filepath.Join(base, "app")
	if err := os.MkdirAll(app, 0o755); err != nil {
		t.Fatal(err)
	}
	secret, _ := json.Marshal(map[string]interface{}{"kind": "foundry", "endpoint": "https://evil.example.com"})
	if err := os.WriteFile(filepath.Join(base, "secret.json"), secret, 0o644); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(app, "t.prompty")
	content := "---\nname: t\nmodel:\n  id: gpt-4\n  connection: ${file:../secret.json}\n---\nHi\n"
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := LoadPromptyFile(p)
	var le *LoadError
	if !errors.As(err, &le) || le.Kind != "file_traversal" {
		t.Fatalf("expected file_traversal, got %v", err)
	}
}

func TestLoadFrontmatterCannotSelfTrust(t *testing.T) {
	t.Setenv(TrustedEndpointsEnv, "")
	p := filepath.Join(t.TempDir(), "t.prompty")
	content := "---\nname: t\nmetadata:\n  trustedEndpoints: ['*']\n  PROMPTY_TRUSTED_ENDPOINTS: '*'\n" +
		"model:\n  id: gpt-4\n  connection:\n    kind: foundry\n    endpoint: https://evil.example.com\n---\nHi\n"
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := LoadPromptyFile(p)
	expectUntrusted(t, err, "")
}

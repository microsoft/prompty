package prompty

// Endpoint trust — keep ambient credentials on host-approved destinations
// (spec §2.5.1).
//
// A .prompty file is untrusted input. When its connection carries no
// file-supplied credential, executors fall back to ambient credentials
// (DefaultAzureCredential, *_API_KEY env vars). This file decides whether the
// file-chosen destination may receive them.

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// TrustedEndpointsEnv names the env var holding extra comma-separated trusted origins.
const TrustedEndpointsEnv = "PROMPTY_TRUSTED_ENDPOINTS"

// BuiltinTrustedEndpoints are first-party provider origins trusted without host configuration.
var BuiltinTrustedEndpoints = []string{
	"https://api.openai.com",
	"https://api.anthropic.com",
	"https://*.openai.azure.com",
	"https://*.services.ai.azure.com",
	"https://*.cognitiveservices.azure.com",
	"https://login.microsoftonline.com",
}

var defaultPorts = map[string]int{"http": 80, "https": 443}

// credentialKeys maps a connection kind to the credential field it consumes.
var credentialKeys = map[string]string{"key": "apiKey"}

var destinationKeys = []string{"endpoint", "tokenUrl"}

type origin struct {
	scheme string
	host   string
	port   int
}

// parseOrigin returns the (scheme, host, port) of an absolute http(s) URL.
func parseOrigin(raw string) (origin, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return origin{}, false
	}
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	def, ok := defaultPorts[scheme]
	if !ok || host == "" {
		return origin{}, false
	}
	port := def
	if p := u.Port(); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || n > 65535 {
			return origin{}, false
		}
		port = n
	}
	return origin{scheme: scheme, host: host, port: port}, true
}

func trustedEntries(trustedEndpoints []string) []string {
	entries := make([]string, 0, len(BuiltinTrustedEndpoints)+len(trustedEndpoints))
	entries = append(entries, BuiltinTrustedEndpoints...)
	entries = append(entries, trustedEndpoints...)
	entries = append(entries, strings.Split(os.Getenv(TrustedEndpointsEnv), ",")...)
	out := entries[:0]
	for _, e := range entries {
		if t := strings.TrimSpace(e); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// IsTrustedEndpoint reports whether rawURL's origin matches a built-in, host
// option, or PROMPTY_TRUSTED_ENDPOINTS origin.
func IsTrustedEndpoint(rawURL string, trustedEndpoints []string) bool {
	entries := trustedEntries(trustedEndpoints)
	for _, e := range entries {
		if e == "*" {
			return true
		}
	}
	target, ok := parseOrigin(rawURL)
	if !ok {
		return false
	}
	for _, entry := range entries {
		allowed, ok := parseOrigin(entry)
		if !ok || allowed.scheme != target.scheme || allowed.port != target.port {
			continue
		}
		if strings.HasPrefix(allowed.host, "*.") {
			if strings.HasSuffix(target.host, allowed.host[1:]) {
				return true
			}
		} else if allowed.host == target.host {
			return true
		}
	}
	return false
}

func isReference(value string) bool {
	return strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}")
}

func fileSuppliedCredential(connection map[string]interface{}) bool {
	// Only the credential field the declared kind actually consumes counts; any other kind is ambient.
	kind, _ := connection["kind"].(string)
	key, ok := credentialKeys[kind]
	if !ok {
		return false
	}
	value, ok := connection[key].(string)
	// Blank keys count as absent: executors that trim fall back to ambient credentials.
	return ok && strings.TrimSpace(value) != "" && !isReference(value)
}

// fileControlledDestination returns the effective destination if the file chose it.
func fileControlledDestination(value interface{}) (string, bool) {
	if value == nil {
		return "", false
	}
	str, ok := value.(string)
	if !ok {
		return fmt.Sprintf("%v", value), true
	}
	if isReference(str) {
		protocol, rest, _ := strings.Cut(str[2:len(str)-1], ":")
		if strings.ToLower(protocol) == "env" {
			varName, def, _ := strings.Cut(rest, ":")
			if _, set := os.LookupEnv(varName); set {
				return "", false
			}
			return def, def != ""
		}
	}
	return str, true
}

// CheckConnectionTrust returns an untrusted_endpoint *LoadError if ambient
// credentials could reach a file-chosen, untrusted destination. connection is
// the RAW (unresolved) model.connection value.
func CheckConnectionTrust(connection interface{}, trustedEndpoints []string) error {
	conn, ok := connection.(map[string]interface{})
	if !ok || conn["kind"] == "reference" {
		return nil
	}
	if fileSuppliedCredential(conn) {
		return nil
	}
	for _, key := range destinationKeys {
		destination, controlled := fileControlledDestination(conn[key])
		if controlled && !IsTrustedEndpoint(destination, trustedEndpoints) {
			return &LoadError{
				Kind: "untrusted_endpoint",
				Message: fmt.Sprintf(
					"Connection %s '%s' is not trusted to receive ambient credentials. "+
						"Set the %s via ${env:VAR}, add its origin to TrustedEndpoints or %s, "+
						"or use 'kind: reference'.",
					key, destination, key, TrustedEndpointsEnv),
			}
		}
	}
	return nil
}

// CheckEndpointTrust applies spec §2.5.1 to RAW (unresolved) frontmatter. It
// follows whole-value ${file:} references for `model` and `model.connection`
// with the same containment as reference resolution, so it must run before
// ResolveReferences.
func CheckEndpointTrust(data map[string]interface{}, parentDir string, allowedRoots, trustedEndpoints []string) error {
	conn, err := rawConnection(data, parentDir, allowedRoots)
	if err != nil {
		return err
	}
	return CheckConnectionTrust(conn, trustedEndpoints)
}

func rawConnection(data map[string]interface{}, parentDir string, allowedRoots []string) (interface{}, error) {
	follow := func(value interface{}) (interface{}, error) {
		str, ok := value.(string)
		if !ok || !isReference(str) {
			return value, nil
		}
		protocol, ref, _ := strings.Cut(str[2:len(str)-1], ":")
		if strings.ToLower(protocol) != "file" {
			return value, nil
		}
		full := ref
		if !filepath.IsAbs(full) {
			full = filepath.Join(parentDir, ref)
		}
		// A missing file is reported by reference resolution, not here.
		if _, err := os.Stat(full); err != nil {
			return nil, nil
		}
		return resolveFile(ref, parentDir, allowedRoots)
	}
	model, err := follow(data["model"])
	if err != nil {
		return nil, err
	}
	modelMap, ok := model.(map[string]interface{})
	if !ok {
		return nil, nil
	}
	return follow(modelMap["connection"])
}

package tools

import "testing"

func TestToolRegistryDefaults(t *testing.T) {
	registry := NewToolRegistry(DefaultTools())
	tools := registry.List()

	if len(tools) != 3 {
		t.Fatalf("expected 3 tools, got %d", len(tools))
	}
	if tools[0].ID != "shell" || tools[1].ID != "browser" {
		t.Fatalf("unexpected tool ordering: %+v", tools)
	}

	tools[0].Enabled = false
	if registry.List()[0].Enabled != true {
		t.Fatalf("List should return copies and keep registry immutable")
	}
}

func TestToolRegistrySetEnabled(t *testing.T) {
	registry := NewToolRegistry(DefaultTools())

	updated, err := registry.SetEnabled("browser", false)
	if err != nil {
		t.Fatalf("SetEnabled returned error: %v", err)
	}
	if updated.Enabled {
		t.Fatalf("expected browser to be disabled")
	}
	if registry.List()[1].Enabled {
		t.Fatalf("registry state did not persist enabled flag")
	}

	if _, err := registry.SetEnabled("missing", true); err == nil {
		t.Fatalf("expected error for unknown tool id")
	}
}

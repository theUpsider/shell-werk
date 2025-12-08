package main

import "testing"

func TestToolRegistryDefaults(t *testing.T) {
	registry := NewToolRegistry(defaultTools())
	tools := registry.List()

	if len(tools) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(tools))
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
	registry := NewToolRegistry(defaultTools())

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

func TestAppToolAPIs(t *testing.T) {
	app := NewApp()

	tools := app.GetTools()
	if len(tools) == 0 {
		t.Fatalf("expected default tools to be seeded")
	}

	if _, err := app.SetToolEnabled(SetToolEnabledRequest{ID: "shell", Enabled: false}); err != nil {
		t.Fatalf("SetToolEnabled returned error: %v", err)
	}

	for _, tool := range app.GetTools() {
		if tool.ID == "shell" && tool.Enabled {
			t.Fatalf("expected shell to be disabled after SetToolEnabled")
		}
	}
}

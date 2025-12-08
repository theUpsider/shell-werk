package main

import "testing"

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

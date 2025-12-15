package shell

import (
	"runtime"
	"testing"
)

func TestValidateBlocksDangerousCommands(t *testing.T) {
	exec := NewExecutor()

	if err := exec.Validate("rm", []string{"-rf", "/"}); err == nil {
		t.Fatalf("expected dangerous command to be blocked")
	}
}

func TestValidateBlocksWindowsSystemPaths(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-specific validation")
	}

	exec := NewExecutor()
	if err := exec.Validate("Remove-Item", []string{"C:\\Windows"}); err == nil {
		t.Fatalf("expected system directory command to be blocked on Windows")
	}
}

func TestValidateAllowsSafeCommands(t *testing.T) {
	exec := NewExecutor()
	if err := exec.Validate("echo", []string{"ok"}); err != nil {
		t.Fatalf("expected safe command to pass validation: %v", err)
	}
}

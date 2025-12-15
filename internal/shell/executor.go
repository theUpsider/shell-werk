package shell

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// Executor handles safe shell command execution.
type Executor struct{}

// NewExecutor creates a new Executor.
func NewExecutor() *Executor {
	return &Executor{}
}

// Validate checks if the command is safe to execute.
func (e *Executor) Validate(command string, args []string) error {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return errors.New("command cannot be empty")
	}

	// Reconstruct full command for pattern matching (heuristic)
	fullCmd := trimmed
	if len(args) > 0 {
		fullCmd += " " + strings.Join(args, " ")
	}

	// Basic blacklist for dangerous commands
	dangerousPatterns := []string{
		"rm -rf /",
		"rm -rf C:\\",
		"mkfs",
		"dd if=",
		":(){ :|:& };:", // fork bomb
	}

	for _, pattern := range dangerousPatterns {
		if strings.Contains(fullCmd, pattern) {
			return fmt.Errorf("command contains dangerous pattern: %s", pattern)
		}
	}

	// Check for root/system directory targeting (very basic check)
	if runtime.GOOS == "windows" {
		if strings.Contains(fullCmd, "C:\\Windows") || strings.Contains(fullCmd, "C:\\Program Files") {
			return errors.New("command targets protected system directory")
		}
	} else {
		if fullCmd == "rm -rf /" || strings.HasPrefix(fullCmd, "rm -rf /") {
			return errors.New("command targets root directory")
		}
	}

	return nil
}

// Execute runs the command and returns the output.
func (e *Executor) Execute(ctx context.Context, command string, args []string) (string, error) {
	if err := e.Validate(command, args); err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		psArgs := append([]string{"-Command", command}, args...)
		cmd = exec.CommandContext(ctx, "powershell", psArgs...)
	} else {
		cmd = exec.CommandContext(ctx, command, args...)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		output := strings.TrimSpace(stdout.String())
		if stderr.Len() > 0 {
			if output != "" {
				output += "\n"
			}
			output += "Stderr: " + strings.TrimSpace(stderr.String())
		}
		if output == "" {
			output = "(command failed with no output)"
		}
		return output, fmt.Errorf("command failed: %v", err)
	}

	output := stdout.String()
	if stderr.Len() > 0 {
		output += "\nStderr: " + stderr.String()
	}

	return output, nil
}

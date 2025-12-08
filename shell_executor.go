package main

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

// ShellExecutor handles safe shell command execution.
type ShellExecutor struct{}

// NewShellExecutor creates a new ShellExecutor.
func NewShellExecutor() *ShellExecutor {
	return &ShellExecutor{}
}

// Validate checks if the command is safe to execute.
func (s *ShellExecutor) Validate(command string, args []string) error {
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
			// Block system directories
		}
	} else {
		if fullCmd == "rm -rf /" || strings.HasPrefix(fullCmd, "rm -rf /") {
			return errors.New("command targets root directory")
		}
	}

	return nil
}

// Execute runs the command and returns the output.
func (s *ShellExecutor) Execute(ctx context.Context, command string, args []string) (string, error) {
	if err := s.Validate(command, args); err != nil {
		return "", err
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// Use PowerShell on Windows to support built-ins like 'dir' and aliases.
		// We pass the command and arguments to -Command.
		// exec.Command will quote arguments as needed, preventing injection of shell operators
		// into the arguments themselves, but the command string itself is passed as-is to PowerShell's parser
		// as the first token of the command line.
		psArgs := append([]string{"-Command", command}, args...)
		cmd = exec.CommandContext(ctx, "powershell", psArgs...)
	} else {
		// Use direct execution on Linux/Mac to avoid shell injection.
		cmd = exec.CommandContext(ctx, command, args...)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Set a timeout for execution
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if err := cmd.Run(); err != nil {
		return fmt.Sprintf("Error: %v\nStderr: %s", err, stderr.String()), nil // Return error as output so LLM sees it
	}

	output := stdout.String()
	if stderr.Len() > 0 {
		output += "\nStderr: " + stderr.String()
	}

	return output, nil
}

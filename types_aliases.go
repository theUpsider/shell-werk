package main

import (
	"shell-werk/internal/llm"
	"shell-werk/internal/shell"
	"shell-werk/internal/tools"
)

type ToolMetadata = tools.ToolMetadata
type ToolFunctionDef = tools.ToolFunctionDef
type ToolDefinition = tools.ToolDefinition
type SetToolEnabledRequest = tools.SetToolEnabledRequest

type ToolCall = llm.ToolCall
type ToolCallFunction = llm.ToolCallFunction
type ChatMessage = llm.ChatMessage
type ChatRequest = llm.ChatRequest
type ChatResponse = llm.ChatResponse
type ModelsRequest = llm.ModelsRequest
type ModelsResponse = llm.ModelsResponse
type DialogueTrace = llm.DialogueTrace
type ContinuationDecisionRequest = llm.ContinuationDecisionRequest

type ShellExecutor = shell.Executor

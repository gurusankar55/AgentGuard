# AgentGuard

> A GenLayer policy gateway that verifies AI agent actions against user rules and live evidence before execution.

AgentGuard adds a verifiable safety layer between AI agents and sensitive actions.

Users provide:
- A policy describing the rules the agent must follow
- A proposed agent action
- An HTTPS evidence source

The AgentGuard Intelligent Contract retrieves the external evidence, evaluates the action against the policy, reaches a GenLayer consensus decision, and records the verification result on-chain.

## How It Works

```text
User
  ↓
AgentGuard Web App
  ↓
Policy + Agent Action + Evidence URL
  ↓
GenLayer Intelligent Contract
  ↓
Contract-side HTTPS Evidence Retrieval
  ↓
Policy + Evidence Evaluation
  ↓
GenLayer Consensus
  ↓
ALLOW / BLOCK
  ↓
On-chain Verification Record
E0F

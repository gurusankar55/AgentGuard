# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json


class AgentGuard(gl.Contract):
    last_decision: str
    last_reason: str
    last_evidence: str
    last_action: str
    last_policy: str
    last_source_url: str

    def __init__(self):
        self.last_decision = ""
        self.last_reason = ""
        self.last_evidence = ""
        self.last_action = ""
        self.last_policy = ""
        self.last_source_url = ""

    @gl.public.write
    def verify_action(
        self,
        policy: str,
        action: str,
        source_url: str,
    ) -> str:

        if not source_url.startswith("https://"):
            raise gl.UserError("Source URL must use HTTPS")

        def leader_fn():
            response = gl.nondet.web.get(source_url)

            evidence = response.body.decode("utf-8")

            prompt = f"""
You are AgentGuard, a policy enforcement gateway for AI agents.

USER POLICY:
{policy}

PROPOSED AGENT ACTION:
{action}

LIVE EXTERNAL EVIDENCE:
{evidence}

Evaluate whether the proposed action complies with the user policy
using the live external evidence.

Return ONLY valid JSON with exactly these fields:

{{
  "decision": "ALLOW" or "BLOCK",
  "reason": "short explanation",
  "evidence_summary": "short summary of the relevant evidence"
}}

Rules:
- ALLOW only when the action clearly satisfies the policy.
- BLOCK when the action violates the policy or the evidence is insufficient.
- Do not invent facts that are not present in the evidence.
- If the evidence does not support the required condition, BLOCK.
"""

            llm_response = gl.nondet.exec_prompt(prompt)

            result = json.loads(llm_response)

            decision = result.get("decision")
            reason = result.get("reason")
            evidence_summary = result.get("evidence_summary")

            if decision not in ("ALLOW", "BLOCK"):
                raise gl.UserError("Invalid decision")

            if not isinstance(reason, str):
                raise gl.UserError("Invalid reason")

            if not isinstance(evidence_summary, str):
                raise gl.UserError("Invalid evidence summary")

            return json.dumps(
                {
                    "decision": decision,
                    "reason": reason,
                    "evidence_summary": evidence_summary,
                },
                sort_keys=True,
            )

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False

            validator_output = leader_fn()

            leader_data = json.loads(leader_result.calldata)
            validator_data = json.loads(validator_output)

            # Validators independently fetch the evidence and
            # independently evaluate the action.
            # The security-critical decision must agree.
            return leader_data["decision"] == validator_data["decision"]

        result = gl.vm.run_nondet_unsafe(
            leader_fn,
            validator_fn,
        )

        result_data = json.loads(result)

        # Storage changes happen only after consensus.
        self.last_decision = result_data["decision"]
        self.last_reason = result_data["reason"]
        self.last_evidence = result_data["evidence_summary"]
        self.last_action = action
        self.last_policy = policy
        self.last_source_url = source_url

        return result_data["decision"]

    @gl.public.view
    def get_last_verification(self) -> str:
        return json.dumps(
            {
                "decision": self.last_decision,
                "reason": self.last_reason,
                "evidence_summary": self.last_evidence,
                "action": self.last_action,
                "policy": self.last_policy,
                "source_url": self.last_source_url,
            },
            sort_keys=True,
        )
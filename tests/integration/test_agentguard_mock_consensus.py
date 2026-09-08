import json

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionHashVariant, TransactionStatus
from gltest.validators import get_validator_factory


def test_agentguard_mock_consensus():
    policy = "BLOCK the action unless the external evidence shows completed is true."
    action = "Proceed with the action only if the external condition is completed."
    source_url = "https://jsonplaceholder.typicode.com/todos/1"

    llm_result = {
        "decision": "BLOCK",
        "reason": "The external evidence shows completed is false, which violates the user policy requiring completed to be true",
        "evidence_summary": "The evidence indicates completed: false for the task.",
    }

    web_body = json.dumps(
        {
            "userId": 1,
            "id": 1,
            "title": "delectus aut autem",
            "completed": False,
        }
    )

    validator_factory = get_validator_factory()

    validators = validator_factory.batch_create_mock_validators(
        count=5,
        mock_llm_response={
            "nondet_exec_prompt": {
                "You are AgentGuard": json.dumps(llm_result),
            },
            "eq_principle_prompt_comparative": {},
            "eq_principle_prompt_non_comparative": {},
        },
        mock_web_response={
            "nondet_web_request": {
                source_url: {
                    "method": "GET",
                    "status": 200,
                    "body": web_body,
                }
            }
        },
    )

    transaction_context = {
        "validators": [validator.to_dict() for validator in validators],
        "genvm_datetime": "2026-09-08T00:00:00Z",
    }

    factory = get_contract_factory(
        contract_file_path="AgentGuard.py"
    )

    contract = factory.deploy(
        wait_transaction_status=TransactionStatus.FINALIZED,
        wait_interval=3000,
        wait_retries=60,
        transaction_context=transaction_context,
    )

    tx_receipt = contract.verify_action(
        args=[policy, action, source_url]
    ).transact(
        wait_transaction_status=TransactionStatus.FINALIZED,
        wait_interval=3000,
        wait_retries=60,
        transaction_context=transaction_context,
    )

    assert tx_execution_succeeded(tx_receipt)

    result = contract.get_last_verification().call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL,
        transaction_context=transaction_context,
    )

    stored = json.loads(result)

    assert stored["decision"] == "BLOCK"
    assert stored["action"] == action
    assert stored["policy"] == policy
    assert stored["source_url"] == source_url
    assert stored["reason"] == llm_result["reason"]
    assert stored["evidence_summary"] == llm_result["evidence_summary"]

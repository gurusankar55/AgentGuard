from gltest import get_contract_factory


def test_agentguard_deploy_and_view():
    factory = get_contract_factory(
        contract_file_path="AgentGuard.py"
    )

    contract = factory.deploy()

    result = contract.get_last_verification().call()

    assert '"decision": ""' in result
    assert '"action": ""' in result
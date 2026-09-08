"use client";

import { useEffect, useState } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
export default function Home() {
  const [policy, setPolicy] = useState(
    "BLOCK unless the required external condition is confirmed."
  );
  const [action, setAction] = useState(
    "Proceed only when the external condition is completed."
  );
  const [sourceUrl, setSourceUrl] = useState(
    "https://jsonplaceholder.typicode.com/todos/1"
  );
  const [status, setStatus] = useState("Ready to verify this agent action");
  const [txId, setTxId] = useState("");
  const [verification, setVerification] = useState<any>(null);
  const [wallets, setWallets] = useState<any[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    const discoveredWallets = new Map<string, any>();

    const handleProvider = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      if (
  detail?.info?.uuid &&
  detail?.provider &&
  detail?.info?.rdns !== "app.keplr"
) {
        discoveredWallets.set(detail.info.uuid, {
          info: detail.info,
          provider: detail.provider,
        });
        setWallets(Array.from(discoveredWallets.values()));
      }
    };

    window.addEventListener("eip6963:announceProvider", handleProvider);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => {
      window.removeEventListener("eip6963:announceProvider", handleProvider);
    };
  }, []);

  useEffect(() => {
    const loadLatestVerification = async () => {
      try {
        const contractAddress =
          process.env.NEXT_PUBLIC_AGENTGUARD_CONTRACT_ADDRESS;

        if (!contractAddress) return;

        const client = createClient({
          chain: studionet,
        });

        const result = await client.readContract({
          address: contractAddress as `0x${string}`,
          functionName: "get_last_verification",
          args: [],
        });

        const data = JSON.parse(result as string);

        console.log("AGENTGUARD_INITIAL_READ", data);

        if (data.decision === "ALLOW" || data.decision === "BLOCK") {
          setVerification(data);
          setStatus("Latest verification loaded successfully.");
        }
      } catch (error) {
        console.error("AGENTGUARD_INITIAL_READ_ERROR", error);
      }
    };

    loadLatestVerification();
  }, []);

  const getSelectedWalletProvider = async () => {
    if (!selectedWalletId) return undefined;

    return await new Promise<any>((resolve) => {
      let selectedProvider: any;

      const handleProvider = (event: Event) => {
        const detail = (event as CustomEvent).detail;

        if (detail?.info?.uuid === selectedWalletId && detail?.provider) {
          selectedProvider = detail.provider;
        }
      };

      window.addEventListener("eip6963:announceProvider", handleProvider);
      window.dispatchEvent(new Event("eip6963:requestProvider"));

      setTimeout(() => {
        window.removeEventListener("eip6963:announceProvider", handleProvider);
        resolve(selectedProvider);
      }, 500);
    });
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      type WalletProvider = {
        request: (args: {
          method: string;
          params?: unknown[];
        }) => Promise<any>;
      };

      let ethereum: WalletProvider | undefined;

      if (!selectedWalletId) {
        alert("Please select a wallet.");
        return;
      }

      ethereum = await getSelectedWalletProvider();

      if (!ethereum) {
        alert("Selected wallet is not available. Please refresh the page and try again.");
        return;
      }

      const accounts = await ethereum.request({
        method: "eth_requestAccounts",
      });

      const walletAddress = accounts[0];

      if (!walletAddress) {
        alert("No wallet account connected.");
        return;
      }

      const contractAddress =
        process.env.NEXT_PUBLIC_AGENTGUARD_CONTRACT_ADDRESS;

      if (!contractAddress) {
        alert("AgentGuard contract address is missing.");
        return;
      }

      const client = createClient({
        chain: studionet,
        account: walletAddress as `0x${string}`,
        provider: ethereum,
      });

      const chainIdHex = `0x${studionet.id.toString(16)}`;
      const currentChainId = await ethereum.request({ method: "eth_chainId" });
      if (currentChainId !== chainIdHex) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: chainIdHex,
            chainName: studionet.name,
            rpcUrls: studionet.rpcUrls.default.http,
            nativeCurrency: studionet.nativeCurrency,
            blockExplorerUrls: [studionet.blockExplorers?.default.url],
          }],
        });
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      }

      setStatus("Estimating verification fees...");

      const write = {
        address: contractAddress as `0x${string}`,
        functionName: "verify_action",
        args: [policy, action, sourceUrl],
      };


      setStatus("Waiting for wallet confirmation...");

      const txId = await client.writeContract({
        ...write,
        value: BigInt(0),
      });

      setTxId(txId);
      setStatus("Verification submitted. Waiting for GenLayer consensus...");

      const transaction = await client.waitForTransactionReceipt({
        hash: txId,
        status: "ACCEPTED" as any,
      });
      console.log("AGENTGUARD_TX_RESULT", transaction);

      const statusName =
        (transaction as any).statusName ??
        (transaction as any).status_name;

      console.log("AGENTGUARD_TX_STATUS", {
        statusName,
        transaction,
      });

      if (statusName !== "ACCEPTED" && statusName !== "FINALIZED") {
        console.error("AGENTGUARD_TX_FAILURE", {
          statusName,
          transaction,
        });
        setStatus("Verification failed.");
        alert("GenLayer verification failed.");
        return;
      }

      setStatus("Reading the verified result from GenLayer...");

      let verificationData: any = null;

      for (let attempt = 1; attempt <= 12; attempt++) {
        const verification = await client.readContract({
          address: contractAddress as `0x${string}`,
          functionName: "get_last_verification",
          args: [],
        });

        verificationData = JSON.parse(verification as string);

        console.log("AGENTGUARD_READBACK", {
          attempt,
          verification: verificationData,
        });

        if (verificationData.decision === "ALLOW" || verificationData.decision === "BLOCK") {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      if (!verificationData || (verificationData.decision !== "ALLOW" && verificationData.decision !== "BLOCK")) {
        console.error("AGENTGUARD_READBACK_TIMEOUT", verificationData);
        setStatus("Verification result is still being materialized.");
        alert("GenLayer accepted the transaction, but the verification result is still being materialized. Please wait and try reading the result again.");
        return;
      }

      setVerification(verificationData);
      setStatus("Verification completed successfully.");
    } catch (error) {
      console.error(error);

      const errorText = JSON.stringify(error, Object.getOwnPropertyNames(error as any));
      const errorCode = (error as any)?.code ?? (error as any)?.cause?.code;
      const isUserRejected =
        errorCode === 4001 ||
        errorText.includes("UserRejectedRequestError") ||
        errorText.includes("User rejected the request") ||
        errorText.includes("User rejected");

      if (isUserRejected) {
        setStatus("Verification cancelled.");
        alert("Verification cancelled. Wallet request was cancelled.");
      } else {
        setStatus("Verification failed.");
        alert("Verification failed. Check the browser console for details.");
      }
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <main className="page">
      <div className="shell">
        <header className="header">
          <div>
            <div className="brand">
              <span className="shield">◈</span>
              <span>AgentGuard</span>
            </div>
            <p className="subtitle">
              AI Policy Gateway · GenLayer Verification
            </p>
          </div>

          <div className="network">
            <span className="dot" />
            Studionet
          </div>
        </header>

        <section className="hero">
          <div>
            <span className="eyebrow">VERIFIABLE AI SAFETY</span>
            <h1>Verify before an AI agent acts.</h1>
            <p>
              Define your policy, provide the proposed agent action, and verify
              it against live external evidence through a GenLayer Intelligent
              Contract.
            </p>
          </div>

          <div className="status-card">
            <span className="status-label">GATEWAY STATUS</span>
            <strong>READY</strong>
            <small>Awaiting verification request</small>
          </div>
        </section>

        <section className="grid">
          <div className="card">
            <div className="card-title">
              <span className="number">01</span>
              <div>
                <h2>Create a policy</h2>
                <p>Rules the AI agent must follow.</p>
              </div>
            </div>

            <label>USER POLICY</label>
            <textarea
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
              rows={6}
            />

            <div className="rule">
              <span>Policy enforcement</span>
              <b>ACTIVE</b>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <span className="number">02</span>
              <div>
                <h2>Propose an action</h2>
                <p>What the AI agent wants to execute.</p>
              </div>
            </div>

            <label>PROPOSED AGENT ACTION</label>
            <textarea
              value={action}
              onChange={(e) => setAction(e.target.value)}
              rows={6}
            />

            <div className="rule">
              <span>Decision mode</span>
              <b>ALLOW / BLOCK</b>
            </div>
          </div>
        </section>

        <section className="card evidence">
          <div className="card-title">
            <span className="number">03</span>
            <div>
              <h2>External evidence</h2>
              <p>
                AgentGuard retrieves evidence from an HTTPS source before the
                contract evaluates the action.
              </p>
            </div>
          </div>

          <label>EVIDENCE SOURCE URL</label>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://..."
          />

          <div className="evidence-info">
            <span>● HTTPS source required</span>
            <span>● Contract-side retrieval</span>
            <span>● Consensus verification</span>
          </div>
        </section>

        <section className="verify-panel">
          <div>
            <span className="eyebrow">GENLAYER INTELLIGENT CONTRACT</span>
            <h2>Ready to verify this agent action</h2>
            <p>
              The contract will evaluate the policy and external evidence,
              reach consensus, and record the verification result on-chain.
            </p>
          </div>

          <div className="wallet-selector">
            <label>CONNECT WALLET</label>
            <select
              value={selectedWalletId}
              onChange={(e) => setSelectedWalletId(e.target.value)}
            >
              <option value="">Select wallet</option>
              {wallets.map((wallet) => (
                <option key={wallet.info.uuid} value={wallet.info.uuid}>
                  {wallet.info.name}
                </option>
              ))}
            </select>
          </div>

          <button
  className="verify-button"
  onClick={handleVerify}
>
  Verify Action →
</button>
        </section>

        <section className="result-card">
          <div className="result-header">
            <div>
              <span className="eyebrow">LATEST VERIFICATION</span>
              <h2>{verification ? `${verification.decision} — Agent Action` : "No verification yet"}</h2>
            </div>
            <span className={verification ? "pending" : "pending"}>
              {verification ? "RECORDED" : "PENDING"}
            </span>
          </div>

          <div className="result-grid">
            <div>
              <span>DECISION</span>
              <strong>{verification?.decision ?? "—"}</strong>
            </div>
            <div>
              <span>EVIDENCE</span>
              <strong>{verification?.evidence_summary ?? "Waiting"}</strong>
            </div>
            <div>
              <span>CONSENSUS</span>
              <strong>{verification ? "Accepted" : "Waiting"}</strong>
            </div>
            <div>
              <span>ON-CHAIN</span>
              <strong>{verification ? "Recorded" : "Not recorded"}</strong>
            </div>
          </div>

          {verification && (
            <div style={{ marginTop: "20px" }}>
              <p><strong>Reason:</strong> {verification.reason}</p>
              <p><strong>Action:</strong> {verification.action}</p>
              <p><strong>Source:</strong> {verification.source_url}</p>
              {txId && <p><strong>Transaction:</strong> {txId}</p>}
            </div>
          )}
        </section>

        <footer>
          <span>AgentGuard</span>
          <span>Policy → Evidence → Consensus → Decision</span>
        </footer>
      </div>


    </main>
  );
}

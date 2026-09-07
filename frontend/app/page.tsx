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

      <style jsx>{`
        * {
          box-sizing: border-box;
        }

        .page {
          min-height: 100vh;
          background: #070b14;
          color: #e8f0ff;
          font-family: Arial, Helvetica, sans-serif;
          padding: 32px 20px 60px;
        }

        .shell {
          max-width: 1180px;
          margin: auto;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0 34px;
          border-bottom: 1px solid #182236;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 25px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .shield {
          width: 34px;
          height: 34px;
          display: grid;
          place-items: center;
          border: 1px solid #2e9cff;
          border-radius: 10px;
          color: #45b7ff;
          background: #0c1b31;
        }

        .subtitle {
          margin: 7px 0 0 44px;
          color: #71809b;
          font-size: 13px;
        }

        .network {
          border: 1px solid #20304a;
          background: #0d1422;
          padding: 9px 14px;
          border-radius: 999px;
          color: #a9b9d2;
          font-size: 13px;
        }

        .dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          background: #39e58c;
          border-radius: 50%;
          margin-right: 7px;
        }

        .hero {
          display: grid;
          grid-template-columns: 1fr 260px;
          gap: 30px;
          align-items: center;
          padding: 70px 0 48px;
        }

        .eyebrow {
          color: #42b6ff;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 1.8px;
        }

        h1 {
          font-size: clamp(38px, 6vw, 68px);
          line-height: 1;
          letter-spacing: -3px;
          margin: 14px 0 20px;
          max-width: 780px;
        }

        .hero p {
          color: #8b99b2;
          font-size: 16px;
          line-height: 1.7;
          max-width: 720px;
        }

        .status-card {
          border: 1px solid #20304a;
          background: linear-gradient(145deg, #0e1727, #09101c);
          border-radius: 18px;
          padding: 24px;
        }

        .status-label {
          display: block;
          color: #71809b;
          font-size: 10px;
          letter-spacing: 1.5px;
          margin-bottom: 12px;
        }

        .status-card strong {
          display: block;
          color: #45e69a;
          font-size: 25px;
          margin-bottom: 8px;
        }

        .status-card small {
          color: #71809b;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
        }

        .card,
        .result-card {
          background: #0c1320;
          border: 1px solid #1b293e;
          border-radius: 18px;
          padding: 26px;
        }

        .card-title {
          display: flex;
          gap: 15px;
          margin-bottom: 25px;
        }

        .number {
          color: #43b5ff;
          font-size: 12px;
          font-weight: 800;
          padding-top: 5px;
        }

        h2 {
          margin: 0;
          font-size: 20px;
        }

        .card-title p {
          color: #687892;
          margin: 6px 0 0;
          font-size: 13px;
        }

        label {
          display: block;
          color: #72819a;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1.3px;
          margin-bottom: 9px;
        }

        textarea,
        input {
          width: 100%;
          border: 1px solid #24334a;
          background: #080e18;
          color: #dce8fb;
          border-radius: 10px;
          padding: 14px;
          font: inherit;
          font-size: 13px;
          line-height: 1.6;
          outline: none;
        }

        textarea:focus,
        input:focus {
          border-color: #318fce;
        }

        .rule {
          display: flex;
          justify-content: space-between;
          border-top: 1px solid #182438;
          margin-top: 18px;
          padding-top: 15px;
          color: #71809a;
          font-size: 12px;
        }

        .rule b {
          color: #45e69a;
          font-size: 10px;
        }

        .evidence {
          margin-top: 18px;
        }

        .evidence-info {
          display: flex;
          gap: 22px;
          flex-wrap: wrap;
          margin-top: 15px;
          color: #71809a;
          font-size: 11px;
        }

        .verify-panel {
          margin-top: 18px;
          padding: 30px;
          border-radius: 18px;
          border: 1px solid #21466b;
          background: linear-gradient(120deg, #0d1b2d, #0b111d);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 25px;
        }

        .verify-panel p {
          color: #7d8ca5;
          line-height: 1.6;
          max-width: 720px;
          font-size: 13px;
        }

        .verify-button {
          white-space: nowrap;
          border: 0;
          border-radius: 10px;
          padding: 15px 22px;
          background: #168fe0;
          color: white;
          font-weight: 800;
          cursor: pointer;
        }

        .verify-button:hover {
          background: #28a4f4;
        }

        .verify-button:disabled {
          opacity: 0.65;
          cursor: wait;
        }

        .result-card {
          margin-top: 18px;
        }

        .result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .result-header h2 {
          margin-top: 8px;
        }

        .pending {
          color: #d7a94c;
          border: 1px solid #594b2b;
          background: #17150e;
          border-radius: 999px;
          padding: 7px 12px;
          font-size: 10px;
          font-weight: 800;
        }

        .result-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-top: 25px;
        }

        .result-grid div {
          background: #080e18;
          border: 1px solid #182438;
          border-radius: 10px;
          padding: 17px;
        }

        .result-grid span {
          display: block;
          color: #64738c;
          font-size: 9px;
          letter-spacing: 1px;
          margin-bottom: 8px;
        }

        .result-grid strong {
          color: #aab8cd;
          font-size: 13px;
        }

        footer {
          display: flex;
          justify-content: space-between;
          color: #526078;
          font-size: 11px;
          padding-top: 35px;
        }

        @media (max-width: 800px) {
          .hero,
          .grid {
            grid-template-columns: 1fr;
          }

          .verify-panel {
            flex-direction: column;
            align-items: flex-start;
          }

          .result-grid {
            grid-template-columns: 1fr 1fr;
          }

          footer {
            flex-direction: column;
            gap: 10px;
          }
        }
      `}</style>
    </main>
  );
}

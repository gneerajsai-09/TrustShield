function $(id) {
  return document.getElementById(id);
}

const TRUSTSHIELD_ABI = [
  "function isReported(address) view returns (bool)"
];

const TRUSTSHIELD_WRITE_ABI = [
  "function reportAddress(address)"
];

function txUrl(hash) {
  return `${NETWORKS[ACTIVE_NETWORK].explorer}/tx/${hash}`;
}

function isNewRecipient(address) {
  const key = "trustshield_recipients";
  let list = JSON.parse(localStorage.getItem(key) || "[]");
  const addr = address.toLowerCase();
  const isNew = !list.includes(addr);

  if (isNew) {
    list.push(addr);
    localStorage.setItem(key, JSON.stringify(list));
  }

  return isNew;
}

function showSection(name) {
  document.querySelectorAll(".app-section").forEach(s =>
    s.classList.add("hidden")
  );

  const section = $(name);
  if (section) section.classList.remove("hidden");

  document.querySelectorAll(".app-nav button").forEach(btn => {
    btn.classList.remove("active");
    if (btn.getAttribute("onclick")?.includes(`'${name}'`)) {
      btn.classList.add("active");
    }
  });

  window.scrollTo(0, 0);
}

async function analyzePayment() {
  const recipient = $("fraud-recipient").value.trim();
  const amount = Number($("fraud-amount").value);
  const result = $("fraud-result");

  result.className = "ts-result";
  result.textContent = "🔍 Checking AI risk signals + blockchain registry…";

  try {
    if (!window.ethereum)
      throw new Error("Please open this page with MetaMask installed.");

    if (!ethers.isAddress(recipient))
      throw new Error("Please enter a valid recipient wallet address.");

    if (!amount || amount <= 0)
      throw new Error("Please enter a valid payment amount.");

    const provider = new ethers.BrowserProvider(window.ethereum);

    const trustShield = new ethers.Contract(
      TRUSTSHIELD_ADDRESS,
      TRUSTSHIELD_ABI,
      provider
    );

    const reported = await trustShield.isReported(recipient);
    const newRecipient = isNewRecipient(recipient);

    const hour = new Date().getHours();
    const unusualTime = hour < 6 || hour >= 23;

    const response = await fetch(`${BACKEND_URL}/fraud/check`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        amount,
        new_recipient: newRecipient,
        reported_address: reported,
        unusual_time: unusualTime
      })
    });

    const data = await response.json();

    if (!response.ok)
      throw new Error(data.error || "Fraud check failed");

    data.blockchain_reported = reported;
    showPaymentGate(data, recipient);
    const payBtn = $("proceed-to-pay-btn");

if (payBtn) {
  if (data.decision === "LOW RISK" || data.decision === "REVIEW") {
    payBtn.classList.remove("hidden");
    payBtn.style.display = "block";
  } else {
    payBtn.classList.add("hidden");
    payBtn.style.display = "none";
  }
}

    const btn = $("proceed-anyway-btn");

    if (btn) {
      if (data.decision === "BLOCK") {
        btn.classList.remove("hidden");
        btn.style.display = "block";
        btn.onclick = proceedAnyway;
      } else {
        btn.classList.add("hidden");
        btn.style.display = "none";
      }
    }

  } catch (error) {
    result.className = "ts-result risk-block";
    result.textContent = `Error: ${error.message}`;
  }
}

function showPaymentGate(data, recipient) {
  const result = $("fraud-result");

  let cls = "risk-low";
  let icon = "🟢";
  let title = "Payment appears safe";

  if (data.decision === "REVIEW") {
    cls = "risk-review";
    icon = "🟡";
    title = "Payment requires review";
  }

  if (data.decision === "BLOCK") {
    cls = "risk-block";
    icon = "🔴";
    title = "Payment blocked";
  }

  const reasons = data.reasons?.length
    ? `<div class="fraud-reasons"><strong>Risk signals:</strong><ul>${
        data.reasons.map(r => `<li>${r}</li>`).join("")
      }</ul></div>`
    : "";

  result.className = `ts-result ${cls}`;

  result.innerHTML = `
    <div class="fraud-decision">
      <div class="fraud-icon">${icon}</div>
      <div>
        <div class="fraud-title">${title}</div>
        <div class="fraud-score">Risk Score:
          <strong>${data.risk_score}/100</strong>
        </div>
      </div>
    </div>

    <div class="fraud-registry">
      ${data.blockchain_reported
        ? "🚨 Address is reported on-chain"
        : "✓ Address is not reported in the blockchain registry"}
    </div>

    ${reasons}

    <div class="payment-gate-status">
      Recipient: <strong>${recipient}</strong>
    </div>
  `;
}

function proceedAnyway() {
  if (confirm(
    "⚠️ HIGH RISK PAYMENT\n\n" +
    "TrustShield has blocked this payment because it appears risky.\n\n" +
    "Are you sure you want to proceed?"
  )) {
    alert(
      "⚠️ Risk override accepted.\n\n" +
      "In the full payment flow, the transaction would now continue."
    );
  }
}

async function reportScamAddress() {
  const recipient = $("fraud-recipient").value.trim();
  const status = $("report-status");

  try {
    if (!ethers.isAddress(recipient))
      throw new Error("Enter a valid wallet address first.");

    if (!window.ethereum)
      throw new Error("Please connect MetaMask first.");

    status.textContent = "🔐 Opening MetaMask…";

    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    const trustShield = new ethers.Contract(
      TRUSTSHIELD_ADDRESS,
      TRUSTSHIELD_WRITE_ABI,
      signer
    );

    const tx = await trustShield.reportAddress(recipient);

    status.innerHTML =
      `⏳ Reporting address on-chain…<br>
       <a href="${txUrl(tx.hash)}" target="_blank">
       View transaction ↗</a>`;

    await tx.wait();

    status.innerHTML =
      `✅ <strong>Address reported on-chain!</strong><br>
       <a href="${txUrl(tx.hash)}" target="_blank">
       View confirmed transaction on Sepolia ↗</a>`;

    setTimeout(() => {
      showSection("pay");
      analyzePayment();
    }, 500);

  } catch (error) {
    status.textContent =
      `Error: ${error.reason || error.shortMessage || error.message}`;
  }
}

function init() {
  if ($("network-badge")) {
    $("network-badge").textContent =
      NETWORKS[ACTIVE_NETWORK].name;
  }

  if ($("fraud-check-btn"))
    $("fraud-check-btn").onclick = analyzePayment;

  if ($("report-scam-btn"))
    $("report-scam-btn").onclick = reportScamAddress;

  if (window.ethereum) {
    window.ethereum.on("chainChanged", () => location.reload());
    window.ethereum.on("accountsChanged", () => location.reload());
  }

  showSection("home");
}
function proceedToPay() {

  alert(
    "✅ Payment approved by TrustShield.\n\n" +
    "In the full payment flow, you would now confirm the transaction."
  );

}
init();
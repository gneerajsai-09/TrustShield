"""
INNOBLOCK 2.0 starter backend.

Routes
  GET  /health      Is the server up, and can it reach the chain?
  POST /ai/decide   Ask an AI model for a decision (returns a demo answer if API_KEY is empty)
  POST /records     Hash a text, store the hash on-chain, save the full text in the database
  GET  /records     List saved records, so the frontend can verify each one on-chain

Run locally:  python app.py
On Render:    gunicorn app:app --timeout 120
"""
import hashlib
import json
import os
import sqlite3

import psycopg
import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from psycopg.rows import dict_row
from web3 import Web3
from werkzeug.exceptions import HTTPException

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))  # reads backend/.env into environment variables

# ---------------------------------------------------------------- settings
REQUIRED = ["RPC_URL", "PRIVATE_KEY", "CONTRACT_ADDRESS"]
missing = [name for name in REQUIRED if not os.getenv(name)]
if missing:
    raise SystemExit(f"Missing in backend/.env: {', '.join(missing)}. "
                     "Copy .env.example to .env and fill it in.")

RPC_URL = os.getenv("RPC_URL")
PRIVATE_KEY = os.getenv("PRIVATE_KEY")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS")
EXPLORER_URL = os.getenv("EXPLORER_URL", "https://sepolia.etherscan.io").rstrip("/")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")
DATABASE_URL = os.getenv("DATABASE_URL", "")  # empty = local SQLite file

AI_API_KEY = os.getenv("API_KEY", "")
AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
AI_MODEL = os.getenv("AI_MODEL", "")
AI_SYSTEM_PROMPT = os.getenv(
    "AI_SYSTEM_PROMPT",
    "You are a decision engine. Reply with one short decision and a one-line reason.",
)

# ---------------------------------------------------------------- app + chain
app = Flask(__name__)
CORS(app, origins=[FRONTEND_ORIGIN])  # lets the frontend (another domain) call this API

w3 = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key(PRIVATE_KEY)  # the backend's own burner wallet

with open(os.path.join(HERE, "abi.json")) as f:
    contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=json.load(f))

# The full text of each record lives in a database. Locally that's a SQLite file.
# When you deploy, set DATABASE_URL to a Postgres connection string (Neon / Supabase):
# Render's free disk is wiped whenever the service restarts, so SQLite would lose records.
SQLITE_PATH = os.path.join(HERE, "records.db")


def query(sql, params=()):
    """Run one SQL statement on Postgres (if DATABASE_URL is set) or SQLite.
    Write SQL with ? placeholders; returns the rows as a list of dicts."""
    if DATABASE_URL:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            cursor = conn.execute(sql.replace("?", "%s"), params)
            return cursor.fetchall() if cursor.description else []
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:  # commits on success
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


query("CREATE TABLE IF NOT EXISTS records (id BIGINT PRIMARY KEY, text TEXT, hash TEXT, tx_hash TEXT)")


def sha256_hex(text):
    """Fingerprint of the text. The frontend computes the same value with ethers.sha256."""
    return "0x" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def tx_url(tx_hash):
    """Explorer link for a transaction."""
    return f"{EXPLORER_URL}/tx/{tx_hash}"


def store_hash_on_chain(hash_hex):
    """Sign store(hash) with the backend wallet, send it, and wait until it is mined.
    Returns (record id, transaction hash)."""
    tx = contract.functions.store(hash_hex).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address, "pending"),
    })
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    if receipt.status != 1:
        raise RuntimeError(f"Transaction failed on-chain: {tx_url(w3.to_hex(tx_hash))}")
    event = contract.events.RecordStored().process_receipt(receipt)[0]
    return event["args"]["id"], w3.to_hex(tx_hash)


def calculate_fraud_risk(
    amount,
    new_recipient=False,
    reported_address=False,
    unusual_time=False
):
    score = 10
    reasons = []

    if new_recipient:
        score += 30
        reasons.append("New recipient")

    if reported_address:
        score += 60
        reasons.append("Recipient address has been reported by the community")

    if amount >= 10000:
        score += 25
        reasons.append("Unusually large payment")

    if unusual_time:
        score += 10
        reasons.append("Payment made at an unusual time")

    score = min(score, 100)

    if score >= 70:
        decision = "BLOCK"
    elif score >= 40:
        decision = "REVIEW"
    else:
        decision = "LOW RISK"

    return {
        "risk_score": score,
        "decision": decision,
        "reasons": reasons,
    }

# ---------------------------------------------------------------- routes
@app.get("/health")
def health():
    """UptimeRobot pings this to keep the server awake. It also proves the RPC works."""
    return {
        "ok": True,
        "chainId": w3.eth.chain_id,
        "block": w3.eth.block_number,
        "wallet": account.address,
        "contract": contract.address,
    }


@app.post("/ai/decide")
def ai_decide():
    """Send the prompt to any OpenAI-compatible chat API and return its answer."""
    prompt = (request.get_json(silent=True) or {}).get("prompt", "").strip()
    if not prompt:
        return jsonify(error="prompt is required"), 400

    if not AI_API_KEY:  # demo mode: the rest of the flow still works without a key
        return {"decision": f"DEMO DECISION (no API_KEY set): approve \"{prompt[:80]}\"", "demo": True}

    response = requests.post(
        f"{AI_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {AI_API_KEY}"},
        json={"model": AI_MODEL, "messages": [
            {"role": "system", "content": AI_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]},
        timeout=60,
    )
    if not response.ok:
        return jsonify(error=f"AI provider returned {response.status_code}: {response.text[:300]}"), 502
    decision = response.json()["choices"][0]["message"]["content"].strip()
    return {"decision": decision, "demo": False}


@app.post("/records")
def create_record():
    """Hash the text, store the hash on-chain, then save the full text with its id."""
    text = (request.get_json(silent=True) or {}).get("text", "").strip()
    if not text:
        return jsonify(error="text is required"), 400

    record_hash = sha256_hex(text)
    record_id, tx_hash = store_hash_on_chain(record_hash)

    query("INSERT INTO records (id, text, hash, tx_hash) VALUES (?, ?, ?, ?) "
          "ON CONFLICT (id) DO UPDATE SET text = excluded.text, hash = excluded.hash, "
          "tx_hash = excluded.tx_hash",
          (record_id, text, record_hash, tx_hash))
    return {"id": record_id, "text": text, "hash": record_hash,
            "txHash": tx_hash, "explorerUrl": tx_url(tx_hash)}, 201


@app.get("/records")
def list_records():
    """All saved records, newest first."""
    rows = query("SELECT id, text, hash, tx_hash FROM records ORDER BY id DESC")
    return {"records": [{"id": r["id"], "text": r["text"], "hash": r["hash"],
                         "txHash": r["tx_hash"], "explorerUrl": tx_url(r["tx_hash"])} for r in rows]}


@app.errorhandler(Exception)
def handle_error(e):
    """Always answer with JSON and a readable message, never an HTML crash page."""
    if isinstance(e, HTTPException):
        return jsonify(error=e.description), e.code
    message = str(e)
    if "insufficient funds" in message.lower():
        message = f"The backend wallet {account.address} has no test tokens. Fund it from a faucet."
    app.logger.exception(e)
    return jsonify(error=message), 500

@app.route("/fraud/check", methods=["POST"])
def fraud_check():
    data = request.get_json(silent=True) or {}

    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify(error="Invalid payment amount"), 400

    if amount <= 0:
        return jsonify(error="Payment amount must be greater than zero"), 400

    new_recipient = bool(data.get("new_recipient", False))
    reported_address = bool(data.get("reported_address", False))
    unusual_time = bool(data.get("unusual_time", False))

    return jsonify(
        calculate_fraud_risk(
            amount=amount,
            new_recipient=new_recipient,
            reported_address=reported_address,
            unusual_time=unusual_time
        )
    )

if __name__ == "__main__":
    app.run(port=int(os.getenv("PORT", "5000")), debug=True)

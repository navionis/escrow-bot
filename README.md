# BTC Escrow Telegram Bot

A minimal escrow bot for Telegram that accepts BTC to a generated deposit address and releases to the seller when the buyer issues a release command.

## Features

- Generates a unique P2WPKH deposit address per escrow (BIP84)
- Tracks confirmed deposits via Esplora (mempool.space by default)
- Buyer-only release command sweeps all confirmed UTXOs to the seller
- Testnet by default; supports mainnet with `NETWORK=mainnet`

## Setup

1. Create a bot via BotFather and copy the token.
2. Copy the environment variables to a local `.env` file and fill in values:

```bash
# .env
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
NETWORK=testnet
# ESPLORA_URL=https://mempool.space/testnet/api
# FEE_RATE_SATVBYTE=10
MIN_CONFIRMATIONS=1
MONITOR_INTERVAL_MS=30000
# SEED_MNEMONIC="... 24 words ..."
```

3. Install dependencies and start the bot:

```bash
npm install
npm start
```

On first start the bot creates a BIP39 mnemonic and stores it under `data/` using `node-persist`. To migrate to another machine, copy the `data/` folder or set `SEED_MNEMONIC` in `.env`.

## Usage

- `/newescrow <seller_btc_address>`: Creates a new escrow and returns the deposit address.
- `/status <escrow_id>`: Shows status and confirmed funded amount (sats).
- `/release <escrow_id>`: Buyer releases funds to seller. Broadcasts a sweep transaction.

## Notes

- Confirmations: Esplora `confirmed` implies ≥ 1 confirmation. You can adjust polling via `MONITOR_INTERVAL_MS`.
- Fees: Uses Esplora recommended fees, or override with `FEE_RATE_SATVBYTE`.
- Network: Test with `NETWORK=testnet`. For mainnet, set `NETWORK=mainnet`.
- Security: This is a minimal demo. For production, add authentication, admin controls, multi-sig, dispute flow, and robust error handling.

## License

MIT

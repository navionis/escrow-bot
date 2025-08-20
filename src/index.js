import "dotenv/config";
import { Telegraf } from "telegraf";
import { nanoid } from "nanoid";
import { initStorage, getItem, setItem, upsertById } from "./storage.js";
import {
  generateEscrowAddress,
  getTotalConfirmedBalance,
  buildAndSignSweep,
} from "./bitcoin.js";
import { getFees, broadcastTx, getUtxos } from "./esplora.js";

const ESCROWS_KEY = "escrows";

function ensureEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

function nowIso() {
  return new Date().toISOString();
}

async function createEscrow({ buyerId, sellerAddress }) {
  const { address, path } = await generateEscrowAddress();
  const escrow = {
    id: nanoid(10),
    buyerId,
    sellerAddress,
    depositAddress: address,
    derivationPath: path,
    status: "AWAITING_DEPOSIT",
    createdAt: nowIso(),
    fundedAmount: 0,
    lastCheckedAt: null,
    releaseTxId: null,
  };
  await upsertById(ESCROWS_KEY, escrow.id, () => escrow);
  return escrow;
}

async function listEscrows() {
  return (await getItem(ESCROWS_KEY)) || [];
}

async function updateEscrow(id, fields) {
  return upsertById(ESCROWS_KEY, id, (e) => ({ ...e, ...fields }));
}

async function checkFunding(escrow) {
  const utxos = await getUtxos(escrow.depositAddress);
  const confirmed = utxos.filter((u) => u.status && u.status.confirmed);
  const total = confirmed.reduce((s, u) => s + u.value, 0);
  const minConf = Number(process.env.MIN_CONFIRMATIONS || "1");
  const isFunded = total > 0 && confirmed.length > 0; // Esplora confirmed implies >=1 conf
  if (isFunded && escrow.status !== "RELEASED") {
    await updateEscrow(escrow.id, {
      status: "FUNDED",
      fundedAmount: total,
      lastCheckedAt: nowIso(),
    });
  } else {
    await updateEscrow(escrow.id, { lastCheckedAt: nowIso() });
  }
}

async function monitorLoop() {
  const escrows = await listEscrows();
  for (const e of escrows) {
    if (e.status === "AWAITING_DEPOSIT") {
      try {
        await checkFunding(e);
      } catch (err) {
        /* ignore */
      }
    }
  }
}

function formatEscrow(e) {
  return [
    `ID: ${e.id}`,
    `Status: ${e.status}`,
    `Deposit: ${e.depositAddress}`,
    `Seller: ${e.sellerAddress}`,
    `Funded (confirmed): ${e.fundedAmount} sats`,
    e.releaseTxId ? `Release txid: ${e.releaseTxId}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  await initStorage();

  const token = ensureEnv("TELEGRAM_BOT_TOKEN");
  const bot = new Telegraf(token);

  bot.start((ctx) => {
    ctx.reply(
      [
        "Welcome to BTC Escrow Bot!",
        "",
        "Commands:",
        "/newescrow <seller_btc_address> - create a new escrow and get a deposit address",
        "/status <escrow_id> - view escrow status",
        "/release <escrow_id> - release all confirmed funds to the seller",
      ].join("\n")
    );
  });

  bot.command("newescrow", async (ctx) => {
    try {
      const parts = ctx.message.text.trim().split(/\s+/);
      const sellerAddress = parts[1];
      if (!sellerAddress) {
        return ctx.reply("Usage: /newescrow <seller_btc_address>");
      }
      const escrow = await createEscrow({
        buyerId: ctx.from.id,
        sellerAddress,
      });
      ctx.reply(
        [
          "Escrow created.",
          formatEscrow(escrow),
          "",
          "Send BTC to the deposit address. Funds will be considered after 1 confirmation.",
        ].join("\n")
      );
    } catch (e) {
      ctx.reply(`Failed to create escrow: ${e.message}`);
    }
  });

  bot.command("status", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const id = parts[1];
    if (!id) return ctx.reply("Usage: /status <escrow_id>");
    const escrows = await listEscrows();
    const e = escrows.find((x) => x.id === id);
    if (!e) return ctx.reply("Escrow not found");
    try {
      if (e.status !== "RELEASED") await checkFunding(e);
    } catch {}
    const fresh = (await listEscrows()).find((x) => x.id === id) || e;
    ctx.reply(formatEscrow(fresh));
  });

  bot.command("release", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const id = parts[1];
    if (!id) return ctx.reply("Usage: /release <escrow_id>");
    const escrows = await listEscrows();
    const e = escrows.find((x) => x.id === id);
    if (!e) return ctx.reply("Escrow not found");
    if (e.buyerId !== ctx.from.id)
      return ctx.reply(
        "Only the buyer who created the escrow can release funds."
      );
    if (e.status === "RELEASED") return ctx.reply("Already released.");
    if (e.fundedAmount <= 0)
      return ctx.reply("Escrow not funded yet (confirmed).");

    try {
      const fees = await getFees();
      const feeRate = Number(
        process.env.FEE_RATE_SATVBYTE || fees.halfHourFee || 10
      );
      const { hex, vbytes, feePaid } = await buildAndSignSweep({
        address: e.depositAddress,
        path: e.derivationPath,
        toAddress: e.sellerAddress,
        feeRate,
      });
      const txid = await broadcastTx(hex);
      await updateEscrow(e.id, { status: "RELEASED", releaseTxId: txid });
      ctx.reply(
        `Released. txid: ${txid}\nFee: ${feePaid} sats (~${vbytes} vB @ ${feeRate} sat/vB)`
      );
    } catch (err) {
      ctx.reply(`Release failed: ${err.message}`);
    }
  });

  bot.launch();
  console.log("Bot started. Press Ctrl+C to stop.");

  // Monitor deposits periodically
  setInterval(() => {
    monitorLoop().catch(() => {});
  }, Number(process.env.MONITOR_INTERVAL_MS || "30000"));

  // Graceful shutdown
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

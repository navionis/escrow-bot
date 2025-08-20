import * as bip39 from "bip39";
import BIP32Factory from "bip32";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import ECPairFactory from "ecpair";
import { getItem, setItem } from "./storage.js";
import { getUtxos } from "./esplora.js";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

function getNetwork() {
  const net = (process.env.NETWORK || "testnet").toLowerCase();
  return net === "mainnet"
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;
}

function getCoinType() {
  // SLIP-0044: 0 for mainnet BTC, 1 for testnets
  return (process.env.NETWORK || "testnet").toLowerCase() === "mainnet" ? 0 : 1;
}

export async function getOrCreateMnemonic() {
  const fromEnv = (process.env.SEED_MNEMONIC || "").trim();
  if (fromEnv) return fromEnv;
  let mnemonic = await getItem("mnemonic");
  if (!mnemonic) {
    mnemonic = bip39.generateMnemonic(256);
    await setItem("mnemonic", mnemonic);
  }
  return mnemonic;
}

export async function getRootNode() {
  const mnemonic = await getOrCreateMnemonic();
  const seed = await bip39.mnemonicToSeed(mnemonic);
  return bip32.fromSeed(seed, getNetwork());
}

export function getAccountNode(root) {
  const coinType = getCoinType();
  // BIP84: m/84'/coin_type'/0'
  return root.derivePath(`m/84'/${coinType}'/0'`);
}

export async function getNextReceiveNode() {
  const root = await getRootNode();
  const account = getAccountNode(root);
  let index = (await getItem("derivationIndex")) ?? 0;
  const child = account.derive(0).derive(index); // external chain 0, index
  await setItem("derivationIndex", index + 1);
  return { node: child, path: `m/84'/${getCoinType()}'/0'/0/${index}` };
}

export function nodeToP2WPKH(node) {
  const network = getNetwork();
  const { address, output } = bitcoin.payments.p2wpkh({
    pubkey: node.publicKey,
    network,
  });
  return { address, outputScript: output };
}

export async function generateEscrowAddress() {
  const { node, path } = await getNextReceiveNode();
  const { address } = nodeToP2WPKH(node);
  return { address, path };
}

export function getKeyPairFromPath(path) {
  // path like m/84'/1'/0'/0/0
  const rootPromise = getRootNode();
  return rootPromise.then((root) => {
    const node = root.derivePath(path);
    return ECPair.fromPrivateKey(node.privateKey, { network: getNetwork() });
  });
}

export async function getTotalConfirmedBalance(address) {
  const utxos = await getUtxos(address);
  return utxos
    .filter((u) => u.status && u.status.confirmed)
    .reduce((sum, u) => sum + u.value, 0);
}

function estimateVBytes(numInputs, numOutputs) {
  // Rough estimates for native segwit (P2WPKH)
  const INPUT_VBYTES = 68; // typical
  const OUTPUT_VBYTES = 31; // typical
  const OVERHEAD = 10;
  return OVERHEAD + numInputs * INPUT_VBYTES + numOutputs * OUTPUT_VBYTES;
}

export async function buildAndSignSweep({ address, path, toAddress, feeRate }) {
  const network = getNetwork();
  const utxos = (await getUtxos(address)).filter(
    (u) => u.status && u.status.confirmed
  );
  if (!utxos.length) {
    throw new Error("No confirmed funds to sweep");
  }

  const keyPair = await getKeyPairFromPath(path);
  const p2wpkh = bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network,
  });

  const totalInput = utxos.reduce((s, u) => s + u.value, 0);
  const vbytes = estimateVBytes(utxos.length, 1);
  const fee = Math.ceil(vbytes * feeRate);
  const outputAmount = totalInput - fee;
  if (outputAmount <= 0) {
    throw new Error("Insufficient funds after fee");
  }

  const psbt = new bitcoin.Psbt({ network });
  for (const u of utxos) {
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: {
        script: Buffer.from(u.scriptpubkey, "hex"),
        value: u.value,
      },
      tapInternalKey: undefined,
    });
  }

  psbt.addOutput({ address: toAddress, value: outputAmount });
  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  return {
    hex: tx.toHex(),
    vbytes: tx.virtualSize(),
    feePaid: totalInput - outputAmount,
  };
}

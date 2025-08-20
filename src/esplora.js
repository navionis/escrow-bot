import axios from "axios";

function getBaseUrl() {
  const custom = process.env.ESPLORA_URL && process.env.ESPLORA_URL.trim();
  if (custom) return custom.replace(/\/$/, "");
  const isTestnet =
    (process.env.NETWORK || "testnet").toLowerCase() !== "mainnet";
  return isTestnet
    ? "https://mempool.space/testnet/api"
    : "https://mempool.space/api";
}

export async function getUtxos(address) {
  const url = `${getBaseUrl()}/address/${address}/utxo`;
  const { data } = await axios.get(url, { timeout: 10000 });
  return data;
}

export async function getAddressInfo(address) {
  const url = `${getBaseUrl()}/address/${address}`;
  const { data } = await axios.get(url, { timeout: 10000 });
  return data;
}

export async function getFees() {
  const url = `${getBaseUrl()}/v1/fees/recommended`;
  try {
    const { data } = await axios.get(url, { timeout: 10000 });
    return data; // { fastestFee, halfHourFee, hourFee, economyFee, minimumFee }
  } catch (e) {
    return {
      fastestFee: 15,
      halfHourFee: 10,
      hourFee: 5,
      economyFee: 3,
      minimumFee: 1,
    };
  }
}

export async function broadcastTx(rawHex) {
  const url = `${getBaseUrl()}/tx`;
  const { data } = await axios.post(url, rawHex, {
    headers: { "Content-Type": "text/plain" },
    timeout: 15000,
  });
  return data; // txid string
}

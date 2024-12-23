require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');
const winston = require('winston');
const { Telegraf } = require('telegraf');

// Logging dengan winston
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Notifikasi Telegram
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function sendTelegramMessage(message) {
  try {
    await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
  } catch (error) {
    logger.error("Error mengirim pesan Telegram:", error);
  }
}

// Konfigurasi Web3 dan kontrak ERC-20
const ALCHEMY_WSS_URL = process.env.ALCHEMY_WSS_URL;
const provider = new ethers.WebSocketProvider(ALCHEMY_WSS_URL);
const TOKEN_ABI = [
  "function balanceOf(address account) public view returns (uint256)",
  "function transfer(address recipient, uint256 amount) public returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

// Validasi alamat Ethereum
const isAddressValid = (address) => {
  try {
    ethers.utils.getAddress(address);
    return true;
  } catch {
    return false;
  }
};

// Mengakses variabel lingkungan dari .env
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS;
const TOKEN_ADDRESSES = (process.env.TOKEN_ADDRESSES || "")
  .split(',')
  .filter(isAddressValid);

if (!PRIVATE_KEY || !VAULT_WALLET_ADDRESS || TOKEN_ADDRESSES.length === 0) {
  throw new Error("Konfigurasi lingkungan tidak valid. Pastikan semua variabel di .env terisi dengan benar.");
}

// Wallet
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Fungsi untuk memeriksa saldo token dan transfer
async function transferAllTokens(tokenContract) {
  try {
    const balance = await tokenContract.balanceOf(wallet.address);
    logger.info(`Saldo token saat ini: ${ethers.utils.formatUnits(balance, 18)} token`);

    if (balance.isZero()) {
      logger.info("Tidak ada token untuk ditransfer.");
      return;
    }

    const tx = await tokenContract.transfer(VAULT_WALLET_ADDRESS, balance);
    logger.info(`Transaksi dikirim: ${tx.hash}`);

    const receipt = await tx.wait();
    logger.info(`Transaksi berhasil! Block number: ${receipt.blockNumber}`);
    await sendTelegramMessage(`Token berhasil dikirim ke Vault! Transaksi Hash: ${tx.hash}`);
  } catch (error) {
    logger.error(`Error dalam transferAllTokens: ${error.message}`);
  }
}

// Fungsi untuk memantau beberapa kontrak token
async function monitorTokens() {
  try {
    for (const tokenAddress of TOKEN_ADDRESSES) {
      const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, wallet);
      tokenContract.on('Transfer', async (from, to, value) => {
        try {
          if (to.toLowerCase() === VAULT_WALLET_ADDRESS.toLowerCase()) {
            logger.info(`Token diterima di Vault: ${ethers.utils.formatUnits(value, 18)} token`);
            await transferAllTokens(tokenContract);
          }
        } catch (error) {
          logger.error(`Kesalahan di Transfer event handler: ${error.message}`);
        }
      });
    }
  } catch (error) {
    logger.error(`Error dalam monitorTokens: ${error.message}`);
  }
}

// Fungsi utama untuk memulai pemantauan dan transfer
async function startMonitoring() {
  try {
    logger.info("Memulai pemantauan transfer token...");
    await monitorTokens();
    logger.info("Pemantauan transfer token dimulai.");
  } catch (error) {
    logger.error(`Error utama: ${error.message}`);
  }
}

// Menjalankan skrip untuk memantau transfer token
startMonitoring();

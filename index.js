require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');
const winston = require('winston');
const { Telegraf } = require('telegraf');

// Logging dengan winston
const logger = winston.createLogger({
  level: 'info',
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
    logger.info('Pesan Telegram berhasil dikirim.');
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

// Mengakses variabel lingkungan dari .env
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS;
const TOKEN_ADDRESSES = process.env.TOKEN_ADDRESSES.split(',');

// Fungsi untuk memeriksa saldo token dan transfer
async function transferAllTokens(tokenContract, wallet) {
  const balance = await tokenContract.balanceOf(wallet.address);
  logger.info(`Saldo token saat ini: ${ethers.utils.formatUnits(balance, 18)} token`);

  if (balance.isZero()) {
    logger.info("Tidak ada token untuk ditransfer.");
    return;
  }

  // Mengambil estimasi biaya gas dan transfer
  const gasEstimate = await tokenContract.estimateGas.transfer(VAULT_WALLET_ADDRESS, balance);
  const gasPrice = await provider.getGasPrice();

  // Hitung gas dengan skenario 2x
  const gasCostDouble = gasEstimate.mul(gasPrice.mul(2));
  const gasCostNormal = gasEstimate.mul(gasPrice);

  if (balance.gt(gasCostDouble)) {
    logger.info("Menggunakan gas 2x untuk mempercepat transaksi.");
    const tx = await tokenContract.transfer(VAULT_WALLET_ADDRESS, balance, {
      gasPrice: gasPrice.mul(2) // Menggunakan gas 2x
    });
    logger.info(`Transaksi dikirim dengan gas 2x: ${tx.hash}`);
  } else if (balance.gt(gasCostNormal)) {
    logger.info("Menggunakan gas normal karena saldo tidak cukup untuk gas 2x.");
    const tx = await tokenContract.transfer(VAULT_WALLET_ADDRESS, balance, {
      gasPrice: gasPrice // Menggunakan gas normal
    });
    logger.info(`Transaksi dikirim dengan gas normal: ${tx.hash}`);
  } else {
    logger.info("Saldo tidak cukup untuk biaya gas.");
    await sendTelegramMessage("Saldo tidak cukup untuk melakukan transfer.");
    return;
  }

  const startTime = Date.now();
  const receipt = await tx.wait();
  const endTime = Date.now();
  const transactionTime = (endTime - startTime) / 1000; // Waktu dalam detik

  logger.info(`Transaksi berhasil! Block number: ${receipt.blockNumber}`);
  logger.info(`Waktu transaksi: ${transactionTime} detik`);
  await sendTelegramMessage(`Token berhasil dikirim ke Vault! Transaksi Hash: ${tx.hash}`);
}

// Fungsi untuk memantau beberapa kontrak token
async function monitorTokens() {
  logger.info("Memulai pemantauan transfer token...");
  for (const tokenAddress of TOKEN_ADDRESSES) {
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
    tokenContract.on('Transfer', async (from, to, value) => {
      if (to.toLowerCase() === VAULT_WALLET_ADDRESS.toLowerCase()) {
        logger.info(`Token diterima di Vault: ${ethers.utils.formatUnits(value, 18)} token`);
        try {
          await transferAllTokens(tokenContract, new ethers.Wallet(PRIVATE_KEY, provider));
        } catch (error) {
          logger.error(`Error saat transfer token: ${error.message}`);
          await sendTelegramMessage(`Terjadi kesalahan saat transfer token: ${error.message}`);
        }
      }
    });
  }
}

// Fungsi utama untuk memulai pemantauan dan transfer
async function startMonitoring() {
  try {
    await monitorTokens();  // Memantau beberapa token dan transfer otomatis
  } catch (error) {
    logger.error(`Error utama: ${error.message}`);
    await sendTelegramMessage(`Error utama: ${error.message}`);
  }
}

// Menjalankan skrip untuk memantau transfer token
startMonitoring();
logger.info("Pemantauan transfer token dimulai.");

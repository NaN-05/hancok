require('dotenv').config();
const { ethers } = require('ethers');
const winston = require('winston');

// Logger untuk mencatat aktivitas
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Validasi variabel lingkungan
if (!process.env.WSS_URL || !process.env.PRIVATE_KEY || !process.env.VAULT_WALLET_ADDRESS || !process.env.TOKEN_ADDRESSES) {
  logger.error('Pastikan semua variabel lingkungan telah diatur dengan benar.');
  throw new Error('Pastikan semua variabel lingkungan telah diatur dengan benar.');
}

// Konfigurasi jaringan
const WSS_URL = process.env.WSS_URL;

// Dukungan untuk ethers.js v5 dan v6
let provider;
if (ethers.providers && ethers.providers.WebSocketProvider) {
  // Untuk ethers.js v5
  provider = new ethers.providers.WebSocketProvider(WSS_URL);
  logger.info('Menggunakan ethers.js v5.');
} else if (ethers.WebSocketProvider) {
  // Untuk ethers.js v6
  provider = new ethers.WebSocketProvider(WSS_URL);
  logger.info('Menggunakan ethers.js v6.');
} else {
  logger.error('Library ethers.js tidak mendukung WebSocketProvider.');
  throw new Error('Library ethers.js tidak mendukung WebSocketProvider.');
}

const TOKEN_ABI = [
  "function balanceOf(address account) public view returns (uint256)",
  "function transfer(address recipient, uint256 amount) public returns (bool)",
  "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS;
const TOKEN_ADDRESSES = process.env.TOKEN_ADDRESSES.split(',');

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Tentukan saldo minimum untuk biaya gas (misalnya 0.01 ETH)
const MIN_GAS_BALANCE = ethers.utils.parseEther("0.0001"); // Minimum 0.01 ETH untuk biaya gas

// Fungsi untuk mendapatkan harga gas
async function getGasPrice(isHighPriority) {
  const gasPrice = await provider.getGasPrice();
  return isHighPriority ? gasPrice.mul(2) : gasPrice;
}

// Transfer token
async function transferTokens(tokenContract, wallet) {
  const balance = await tokenContract.balanceOf(wallet.address);
  if (balance.isZero()) {
    logger.info('Tidak ada token untuk ditransfer.');
    return;
  }

  const gasPrice = await getGasPrice(true);
  const gasEstimate = await tokenContract.estimateGas.transfer(VAULT_WALLET_ADDRESS, balance);
  const gasCost = gasEstimate.mul(gasPrice);
  const nativeBalance = await provider.getBalance(wallet.address);

  // Periksa apakah saldo native cukup untuk biaya gas dan lebih besar dari saldo minimum
  if (nativeBalance.lt(gasCost) || nativeBalance.lt(MIN_GAS_BALANCE)) {
    logger.warn('Saldo tidak cukup untuk melakukan transfer atau di bawah saldo minimum yang dibutuhkan.');
    return;
  }

  try {
    // Kirim token ke vault wallet jika saldo cukup
    logger.info('Mengirim transaksi token...');
    const tx = await tokenContract.transfer(VAULT_WALLET_ADDRESS, balance, { gasPrice });
    logger.info(`Transaksi dikirim: ${tx.hash}`);
    const receipt = await tx.wait();
    logger.info(`Transaksi berhasil: ${receipt.transactionHash}`);
  } catch (error) {
    logger.error('Transaksi gagal:', error.message);
    logger.error('Stack Trace:', error.stack); // Menambahkan stack trace untuk membantu debugging
  }
}

// Fungsi untuk memantau token
async function monitorTokens() {
  logger.info('Memulai pemantauan transfer token...');

  for (const tokenAddress of TOKEN_ADDRESSES) {
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
    const decimals = await tokenContract.decimals();

    tokenContract.on('Transfer', async (from, to, value) => {
      if (to.toLowerCase() === wallet.address.toLowerCase()) {
        logger.info(`Token diterima: ${ethers.utils.formatUnits(value, decimals)} token`);
        await transferTokens(tokenContract, wallet);
      }
    });
  }

  provider._websocket.on('close', () => {
    logger.warn('WebSocket terputus. Mencoba untuk menyambungkan ulang...');
    setTimeout(() => provider._websocket.connect(), 5000);
  });
}

// Inisialisasi dan jalankan pemantauan
async function startMonitoring() {
  try {
    logger.info('Memulai monitoring jaringan...');
    await monitorTokens();
  } catch (error) {
    logger.error('Error utama:', error.message);
    logger.error('Stack Trace:', error.stack); // Menambahkan stack trace untuk melihat di mana kesalahan terjadi
  }
}

startMonitoring();
logger.info('Pemantauan token dimulai.');

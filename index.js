require('dotenv').config();
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
const winston = require('winston');

// Logging menggunakan winston
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Validasi environment variables
if (!process.env.ALCHEMY_WSS_URL || !process.env.PRIVATE_KEY || !process.env.VAULT_WALLET_ADDRESS || !process.env.TOKEN_ADDRESSES) {
  throw new Error('Pastikan semua variabel lingkungan telah diatur dengan benar.');
}

// Konfigurasi jaringan dan Flashbots
const ALCHEMY_WSS_URL = process.env.ALCHEMY_WSS_URL;
const provider = new ethers.providers.WebSocketProvider(ALCHEMY_WSS_URL);
const TOKEN_ABI = [
  "function balanceOf(address account) public view returns (uint256)",
  "function transfer(address recipient, uint256 amount) public returns (bool)",
  "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];
const FLASHBOTS_URL = process.env.FLASHBOTS_URL || 'https://relay.flashbots.net';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS;
const TOKEN_ADDRESSES = process.env.TOKEN_ADDRESSES.split(',');

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
let flashbotsProvider;

// Inisialisasi Flashbots
async function initializeFlashbots() {
  const authSigner = ethers.Wallet.createRandom();
  flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, FLASHBOTS_URL);
  logger.info('Flashbots Provider berhasil diinisialisasi.');
}

// Penanganan harga gas dinamis
async function getGasPrice(isHighPriority) {
  const gasPrice = await provider.getGasPrice();
  return isHighPriority ? gasPrice.mul(2) : gasPrice;
}

// Fungsi untuk memantau saldo native token
async function checkNativeBalance() {
  const balance = await provider.getBalance(wallet.address);
  logger.info(`Saldo native token: ${ethers.utils.formatEther(balance)} ETH`);
  if (balance.lt(ethers.utils.parseEther("0.01"))) {
    logger.warn('Saldo native token rendah! Harap isi saldo untuk mencegah kegagalan transaksi.');
  }
}

// Penjadwalan untuk memantau saldo secara berkala
function startBalanceMonitoring(intervalMs = 60000) {
  setInterval(async () => {
    await checkNativeBalance();
  }, intervalMs);
}

// Transfer token dengan Flashbots atau fallback
async function transferTokens(tokenContract, wallet) {
  const balance = await tokenContract.balanceOf(wallet.address);
  const decimals = await tokenContract.decimals();
  logger.info(`Saldo token: ${ethers.utils.formatUnits(balance, decimals)} token`);

  if (balance.isZero()) {
    logger.info('Tidak ada token untuk ditransfer.');
    return;
  }

  const gasPrice = await getGasPrice(true);
  const gasEstimate = await tokenContract.estimateGas.transfer(VAULT_WALLET_ADDRESS, balance);
  const gasCost = gasEstimate.mul(gasPrice);
  const nativeBalance = await provider.getBalance(wallet.address);

  if (nativeBalance.lt(gasCost.add(ethers.utils.parseEther("0.001")))) {
    logger.info('Saldo tidak cukup untuk biaya gas tinggi, menggunakan gas standar.');
    const fallbackGasPrice = await getGasPrice(false);
    return sendTransaction(tokenContract, balance, wallet, fallbackGasPrice, decimals);
  }

  try {
    logger.info('Menggunakan Flashbots untuk transaksi...');
    const txBundle = [
      {
        signer: wallet,
        transaction: {
          to: tokenContract.address,
          data: tokenContract.interface.encodeFunctionData('transfer', [VAULT_WALLET_ADDRESS, balance]),
          gasPrice: gasPrice,
          gasLimit: gasEstimate,
        },
      },
    ];
    const result = await flashbotsProvider.sendBundle(txBundle, await provider.getBlockNumber() + 1);
    if ('error' in result) throw new Error(result.error.message);

    const receipt = await result.wait();
    logger.info(`Transaksi berhasil melalui Flashbots: ${receipt.transactionHash}`);
  } catch (error) {
    logger.error('Flashbots gagal, mencoba melalui mempool publik:', error.message);
    await sendTransaction(tokenContract, balance, wallet, gasPrice, decimals);
  }
}

// Fallback transaksi mempool publik
async function sendTransaction(tokenContract, balance, wallet, gasPrice, decimals) {
  try {
    const tx = await tokenContract.transfer(VAULT_WALLET_ADDRESS, balance, { gasPrice });
    logger.info(`Transaksi dikirim: ${tx.hash}`);
    const receipt = await tx.wait();
    logger.info(`Transaksi berhasil! Hash: ${receipt.transactionHash}`);
  } catch (error) {
    logger.error('Transaksi gagal:', error.message);
  }
}

// Memantau token transfer
async function monitorTokens() {
  logger.info('Memulai pemantauan transfer token...');
  let reconnectAttempts = 0;

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
    reconnectAttempts += 1;
    const timeout = Math.min(1000 * reconnectAttempts, 30000); // Backoff hingga maksimum 30 detik
    logger.warn(`Koneksi WebSocket terputus, mencoba untuk reconnect dalam ${timeout / 1000} detik...`);
    setTimeout(() => {
      provider._websocket.connect();
      monitorTokens();
    }, timeout);
  });
}

// Inisialisasi dan jalankan pemantauan
async function startMonitoring() {
  try {
    await initializeFlashbots();
    await checkNativeBalance(); // Periksa saldo awal
    startBalanceMonitoring(); // Jalankan pemantauan saldo berkala
    await monitorTokens();
  } catch (error) {
    logger.error('Error utama:', error.message);
  }
}

startMonitoring();
logger.info('Pemantauan token dimulai.');

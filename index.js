require('dotenv').config();  // Memuat variabel dari file .env
const fs = require('fs');
const puppeteer = require('puppeteer-core'); // Menggunakan puppeteer-core
const { ethers } = require('ethers');
const winston = require('winston'); // Untuk logging

// Logger untuk mencatat proses
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
  ),
  transports: [new winston.transports.Console()],
});

// Validasi variabel lingkungan
const ALCHEMY_WSS_URL = process.env.ALCHEMY_WSS_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const CLAIM_INTERVAL = parseInt(process.env.CLAIM_INTERVAL) || 10; // Default 10 detik
const TRANSFER_AMOUNT = parseFloat(process.env.TRANSFER_AMOUNT) || 10; // Default transfer 10 token
const CLAIM_URL = process.env.CLAIM_URL;
const LOGIN_BUTTON_SELECTOR = process.env.LOGIN_BUTTON_SELECTOR;
const CLAIM_BUTTON_SELECTOR = process.env.CLAIM_BUTTON_SELECTOR;

if (!ALCHEMY_WSS_URL || !PRIVATE_KEY || !VAULT_WALLET_ADDRESS || !TOKEN_ADDRESS || !CLAIM_URL || !LOGIN_BUTTON_SELECTOR || !CLAIM_BUTTON_SELECTOR) {
  throw new Error("Harap pastikan semua variabel lingkungan di file .env telah diatur dengan benar.");
}

// ABI untuk token ERC-20 (standar)
const TOKEN_ABI = [
  "function totalSupply() public view returns (uint256)",
  "function balanceOf(address account) public view returns (uint256)",
  "function transfer(address recipient, uint256 amount) public returns (bool)",
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function allowance(address owner, address spender) public view returns (uint256)"
];

// Fungsi untuk mendeteksi path Chromium berdasarkan platform (Termux atau VPS)
const getChromiumPath = () => {
  if (process.platform === 'android') {
    return '/data/data/com.termux/files/usr/bin/chromium'; // Path di Termux
  } else {
    return '/usr/bin/chromium-browser'; // Path di VPS
  }
};

// Validasi apakah Chromium tersedia
const chromiumPath = getChromiumPath();
if (!fs.existsSync(chromiumPath)) {
  throw new Error(`Chromium tidak ditemukan di path: ${chromiumPath}`);
}

// Fungsi untuk login dan klaim token
async function autoClaim() {
  logger.info('Memulai proses klaim token...');
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true
  });

  const page = await browser.newPage();

  try {
    // Buka halaman klaim token
    await page.goto(CLAIM_URL);
    logger.info('Berhasil membuka halaman klaim.');

    // Tunggu dan klik tombol login
    await page.waitForSelector(LOGIN_BUTTON_SELECTOR, { timeout: 10000 });
    await page.click(LOGIN_BUTTON_SELECTOR);
    logger.info('Login menggunakan wallet berhasil.');

    // Tunggu popup wallet terbuka
    await page.waitForTimeout(5000);

    // Tunggu dan klik tombol klaim
    await page.waitForSelector(CLAIM_BUTTON_SELECTOR, { timeout: 10000 });
    await page.click(CLAIM_BUTTON_SELECTOR);
    logger.info('Token berhasil diklaim.');

    // Tunggu beberapa detik untuk memastikan proses selesai
    await page.waitForTimeout(5000);
  } catch (error) {
    logger.error(`Terjadi kesalahan saat klaim: ${error.message}`);
  } finally {
    await browser.close();
  }
}

// Fungsi untuk transfer token ke wallet vault
async function transferToken(amount) {
  logger.info('Memulai proses transfer token...');
  const provider = new ethers.WebSocketProvider(ALCHEMY_WSS_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);

  const tokenAmount = ethers.parseUnits(amount.toString(), 18);

  try {
    const tx = await tokenContract.transfer(VAULT_WALLET_ADDRESS, tokenAmount);
    logger.info(`Transaksi dikirim: ${tx.hash}`);

    const receipt = await tx.wait();
    logger.info(`Transaksi berhasil! Block number: ${receipt.blockNumber}`);
  } catch (error) {
    logger.error(`Kesalahan saat transfer token: ${error.message}`);
  }
}

// Fungsi utama untuk klaim dan transfer token
async function autoClaimAndTransfer() {
  try {
    await autoClaim();  // Klaim token
    await transferToken(TRANSFER_AMOUNT);  // Transfer token ke vault
  } catch (error) {
    logger.error(`Terjadi kesalahan pada proses utama: ${error.message}`);
  }
}

// Menjalankan klaim dan transfer secara real-time pada interval tertentu
setInterval(() => {
  logger.info('Menjalankan proses klaim dan transfer token...');
  autoClaimAndTransfer();
}, CLAIM_INTERVAL * 1000);

logger.info(`Skrip dijalankan dalam mode real-time, klaim dan transfer setiap ${CLAIM_INTERVAL} detik.`);

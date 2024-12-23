require('dotenv').config();  // Memuat variabel dari file .env

const puppeteer = require('puppeteer-core'); // Menggunakan puppeteer-core
const { ethers } = require('ethers'); // Pastikan ethers diimpor dengan benar
const axios = require('axios');  // Import axios untuk melakukan request API

// Mengakses variabel lingkungan dari .env
const USER_ID = process.env.USER_ID;
const ALCHEMY_WSS_URL = process.env.ALCHEMY_WSS_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const CLAIM_INTERVAL = parseInt(process.env.CLAIM_INTERVAL) || 10; // Default 10 detik
const CLAIM_URL = process.env.CLAIM_URL;  // URL klaim dari .env

// ABI untuk token ERC-20 (standar)
const TOKEN_ABI = [
  "function balanceOf(address account) public view returns (uint256)",
  "function transfer(address recipient, uint256 amount) public returns (bool)"
];

// Fungsi untuk mendeteksi path Chromium berdasarkan platform
const getChromiumPath = () => {
  if (process.platform === 'android') {
    const chromiumPath = '/data/data/com.termux/files/usr/bin/chromium';
    const fs = require('fs');
    if (!fs.existsSync(chromiumPath)) {
      console.error('Chromium tidak ditemukan di Termux. Pastikan Anda sudah menginstal Chromium.');
      process.exit(1);
    }
    return chromiumPath;
  } else {
    return '/usr/bin/chromium-browser';
  }
};

// Fungsi untuk mencari tombol berdasarkan teks menggunakan evaluate
async function findButtonByText(page, buttonText) {
  const button = await page.evaluate((buttonText) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(button => button.textContent.includes(buttonText));
  }, buttonText);

  if (button) {
    console.log(`Tombol "${buttonText}" ditemukan.`);
    return button;
  } else {
    throw new Error(`Tombol "${buttonText}" tidak ditemukan.`);
  }
}

// Fungsi login dan klaim token
async function autoClaim() {
  const browser = await puppeteer.launch({
    executablePath: getChromiumPath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto(CLAIM_URL);

  try {
    const loginButton = await findButtonByText(page, "Login");
    await loginButton.click();
    console.log("Berhasil login.");

    await page.waitForTimeout(5000);
    const claimButton = await findButtonByText(page, "Claim");
    await claimButton.click();
    console.log("Token berhasil diklaim!");

    await page.waitForTimeout(5000);
  } catch (error) {
    console.error(`Error saat login/klaim: ${error.message}`);
  } finally {
    await browser.close();
  }
}

// Fungsi untuk mentransfer semua token
async function transferAllTokens() {
  const provider = new ethers.WebSocketProvider(ALCHEMY_WSS_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);

  try {
    const balance = await tokenContract.balanceOf(wallet.address);
    console.log(`Saldo token saat ini: ${ethers.utils.formatUnits(balance, 18)} token`);

    if (balance.isZero()) {
      console.log("Tidak ada token untuk ditransfer.");
      return;
    }

    const tx = await tokenContract.transfer(VAULT_WALLET_ADDRESS, balance);
    console.log(`Transaksi dikirim: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`Transaksi berhasil! Block number: ${receipt.blockNumber}`);
  } catch (error) {
    console.error(`Error saat transfer token: ${error.message}`);
  }
}

// Fungsi untuk memeriksa status klaim dengan menggunakan API dan USER_ID
async function checkClaimingStatus() {
  try {
    const response = await axios.post('https://asia-east2-kip-genesis-nft-4c1d8.cloudfunctions.net/getClaimingStatus', {
      userId: USER_ID
    });

    console.log('Status klaim:', response.data);
  } catch (error) {
    console.error('Error saat memeriksa status klaim:', error.message);
  }
}

// Fungsi utama untuk klaim dan transfer
async function autoClaimAndTransfer() {
  try {
    await checkClaimingStatus();  // Memeriksa status klaim
    await autoClaim();
    await transferAllTokens();
  } catch (error) {
    console.error(`Error utama: ${error.message}`);
  }
}

// Jalankan skrip setiap interval tertentu
setInterval(() => {
  console.log("Menjalankan klaim dan transfer token...");
  autoClaimAndTransfer();
}, CLAIM_INTERVAL * 1000);

console.log(`Skrip berjalan setiap ${CLAIM_INTERVAL} detik.`);

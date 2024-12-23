require('dotenv').config();  // Memuat variabel dari file .env

const puppeteer = require('puppeteer-core'); // Menggunakan puppeteer-core
const { ethers } = require('ethers');

// Mengakses variabel lingkungan dari .env
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
  // Deteksi platform (Termux atau VPS)
  if (process.platform === 'android') {
    // Pastikan Chromium terinstal di Termux
    const chromiumPath = '/data/data/com.termux/files/usr/bin/chromium';
    
    // Cek apakah Chromium terinstal di Termux
    const fs = require('fs');
    if (!fs.existsSync(chromiumPath)) {
      console.error('Chromium tidak ditemukan di Termux. Pastikan Anda sudah menginstal Chromium dengan perintah "pkg install chromium".');
      process.exit(1); // Keluar dari skrip jika Chromium tidak ditemukan
    }

    return chromiumPath; // Jika Chromium ditemukan, kembalikan path
  } else {
    // Path untuk sistem VPS/Ubuntu/Debian
    return '/usr/bin/chromium-browser';
  }
};

// Fungsi untuk mencari tombol berdasarkan teks
async function findButtonByText(page, buttonText) {
  const [button] = await page.$x(`//button[contains(text(), '${buttonText}')]`);
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
    executablePath: getChromiumPath(),  // Menentukan path ke Chromium
    headless: true  // Menjalankan dalam mode headless
  });

  const page = await browser.newPage();
  
  // Menambahkan log untuk memastikan URL yang digunakan benar
  console.log(`Navigating to: ${CLAIM_URL}`);
  
  try {
    await page.goto(CLAIM_URL, { waitUntil: 'domcontentloaded' });  // Menunggu halaman dimuat sepenuhnya
    console.log("Halaman dimuat dengan sukses.");

    // Login menggunakan teks tombol
    const loginButton = await findButtonByText(page, "Login");
    await loginButton.click();
    console.log("Berhasil login.");

    // Tunggu hingga tombol klaim muncul dan klik
    await page.waitForTimeout(5000); // Tunggu 5 detik
    const claimButton = await findButtonByText(page, "Claim");
    await claimButton.click();
    console.log("Token berhasil diklaim!");

    await page.waitForTimeout(5000); // Tunggu 5 detik
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
    // Ambil saldo token dari wallet
    const balance = await tokenContract.balanceOf(wallet.address);
    console.log(`Saldo token saat ini: ${ethers.formatUnits(balance, 18)} token`);

    if (balance.isZero()) {
      console.log("Tidak ada token untuk ditransfer.");
      return;
    }

    // Transfer seluruh saldo ke wallet vault
    const tx = await tokenContract.transfer(VAULT_WALLET_ADDRESS, balance);
    console.log(`Transaksi dikirim: ${tx.hash}`);

    // Tunggu konfirmasi transaksi
    const receipt = await tx.wait();
    console.log(`Transaksi berhasil! Block number: ${receipt.blockNumber}`);
  } catch (error) {
    console.error(`Error saat transfer token: ${error.message}`);
  }
}

// Fungsi utama untuk klaim dan transfer
async function autoClaimAndTransfer() {
  try {
    await autoClaim();
    await transferAllTokens();  // Transfer semua token
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

require('dotenv').config();  // Memuat variabel dari file .env

const puppeteer = require('puppeteer');
const { ethers } = require('ethers');

// Mengakses variabel lingkungan dari .env
const ALCHEMY_WSS_URL = process.env.ALCHEMY_WSS_URL;  // Alchemy WSS URL
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const CLAIM_INTERVAL = parseInt(process.env.CLAIM_INTERVAL) || 10; // Default 10 detik
const CLAIM_URL = process.env.CLAIM_URL;  // URL klaim dari .env
const LOGIN_BUTTON_SELECTOR = process.env.LOGIN_BUTTON_SELECTOR;  // Selector login dari .env
const CLAIM_BUTTON_SELECTOR = process.env.CLAIM_BUTTON_SELECTOR;  // Selector klaim dari .env

// ABI untuk token ERC-20 (standar)
const TOKEN_ABI = [
  "function totalSupply() public view returns (uint256)",
  "function balanceOf(address account) public view returns (uint256)",
  "function transfer(address recipient, uint256 amount) public returns (bool)",
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function allowance(address owner, address spender) public view returns (uint256)"
];

// Fungsi untuk login dan klaim token
async function autoClaim() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Arahkan ke halaman klaim token menggunakan URL dari .env
  await page.goto(CLAIM_URL);
  
  // Tunggu hingga elemen wallet untuk login muncul (menggunakan selector dari .env)
  await page.waitForSelector(LOGIN_BUTTON_SELECTOR);  // Menggunakan selector login dari .env

  // Klik tombol login dengan wallet
  await page.click(LOGIN_BUTTON_SELECTOR);  // Menggunakan selector login dari .env
  
  console.log("Login menggunakan wallet berhasil!");

  // Tunggu hingga popup wallet terbuka (misalnya Metamask)
  await page.waitForTimeout(5000);  // Tunggu 5 detik

  // Klik tombol klaim token setelah login berhasil (menggunakan selector klaim dari .env)
  await page.waitForSelector(CLAIM_BUTTON_SELECTOR);  // Menggunakan selector klaim dari .env
  await page.click(CLAIM_BUTTON_SELECTOR);  // Klik tombol klaim
  
  console.log("Token claimed successfully!");

  // Tunggu beberapa waktu untuk memastikan proses klaim selesai
  await page.waitForTimeout(5000);  // Tunggu 5 detik
  
  // Menutup browser
  await browser.close();
}

// Fungsi untuk transfer token ke wallet vault
async function transferToken(amount) {
  const provider = new ethers.WebSocketProvider(ALCHEMY_WSS_URL);  // Menggunakan Alchemy WebSocket
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);

  const tokenAmount = ethers.parseUnits(amount.toString(), 18); // Sesuaikan dengan jumlah token yang ingin ditransfer
  
  try {
    // Transfer token
    const tx = await tokenContract.transfer(VAULT_WALLET_ADDRESS, tokenAmount);
    console.log(`Transaksi dikirim: ${tx.hash}`);

    // Tunggu konfirmasi transaksi
    const receipt = await tx.wait();
    console.log(`Transaksi berhasil! Block number: ${receipt.blockNumber}`);
  } catch (error) {
    console.error(`Error saat mengirim token: ${error.message}`);
  }
}

// Fungsi utama untuk klaim dan transfer token
async function autoClaimAndTransfer() {
  try {
    await autoClaim();  // Klaim token
    await transferToken(10);  // Transfer 10 token ke vault (sesuaikan jumlah token)
  } catch (error) {
    console.error(`Terjadi kesalahan: ${error.message}`);
  }
}

// Menjalankan klaim dan transfer secara real-time pada interval yang diambil dari .env
setInterval(() => {
  console.log('Menjalankan klaim dan transfer token...');
  autoClaimAndTransfer();
}, CLAIM_INTERVAL * 1000);  // Konversi detik ke milidetik

console.log(`Skrip dijalankan dalam mode real-time, akan dijalankan setiap ${CLAIM_INTERVAL} detik.`);

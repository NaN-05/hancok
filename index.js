require('dotenv').config();  // Memuat variabel dari file .env

const axios = require('axios'); // Menggunakan axios untuk HTTP request
const { ethers } = require('ethers'); // Pastikan ethers diimpor dengan benar

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

// Fungsi untuk klaim token melalui API
async function claimToken() {
  try {
    // Siapkan data yang diperlukan untuk klaim
    const walletAddress = process.env.WALLET_ADDRESS; // Pastikan alamat wallet sudah ada di .env

    // Kirim permintaan POST ke API untuk klaim
    const response = await axios.post('https://asia-east2-kip-genesis-nft-4c1d8.cloudfunctions.net/getBatchClaimParam', {
      walletAddress: walletAddress
    });

    // Periksa apakah klaim berhasil
    if (response.status === 200 && response.data.success) {
      console.log("Token berhasil diklaim!");
    } else {
      console.log('Klaim gagal:', response.data.message || 'Tidak ada pesan error.');
    }
  } catch (error) {
    console.error('Error saat klaim token:', error.message);
  }
}

// Fungsi utama untuk klaim dan transfer
async function autoClaimAndTransfer() {
  try {
    await claimToken();  // Klaim token melalui API
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

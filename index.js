require('dotenv').config();  // Memuat variabel dari file .env

const { ethers } = require('ethers');  // Import ethers.js
const axios = require('axios');  // Import axios untuk request API

// Mengakses variabel lingkungan dari .env
const ALCHEMY_WSS_URL = process.env.ALCHEMY_WSS_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_WALLET_ADDRESS = process.env.VAULT_WALLET_ADDRESS;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const CLAIM_INTERVAL = parseInt(process.env.CLAIM_INTERVAL) || 10; // Default 10 detik

// ABI untuk event Transfer ERC-20
const TOKEN_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address account) public view returns (uint256)",
  "function transfer(address recipient, uint256 amount) public returns (bool)"
];

// Fungsi untuk mendengarkan transaksi masuk dan mengirim token ke Vault
async function monitorIncomingTransactions() {
  const provider = new ethers.WebSocketProvider(ALCHEMY_WSS_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, provider);

  tokenContract.on('Transfer', async (from, to, value) => {
    // Periksa jika token diterima di alamat kontrak
    if (to.toLowerCase() === wallet.address.toLowerCase()) {
      console.log(`Token masuk ke alamat kontrak: ${ethers.utils.formatUnits(value, 18)} token`);

      // Jika ada token masuk, transfer semua token ke wallet Vault
      await transferAllTokens(wallet, tokenContract);
    }
  });

  console.log("Memantau transaksi masuk...");
}

// Fungsi untuk mentransfer semua token ke wallet Vault
async function transferAllTokens(wallet, tokenContract) {
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

// Fungsi utama untuk menjalankan pemantauan transaksi
async function main() {
  try {
    await monitorIncomingTransactions();
  } catch (error) {
    console.error(`Error utama: ${error.message}`);
  }
}

main();

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());

// --- KONFIGURASI ---
const SPREADSHEET_ID = '1dQO5u7zH7y6IQ87SH7EVyWxAYRLOwpcE83fJf_nl5po';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, '').trim()
    : undefined,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);

const _getStartRow = (pekan) => (parseInt(pekan) - 1) * 36 + 6;

// 1. Ambil Data Awal
app.get('/api/initial-data', async (req, res) => {
  try {
    await doc.loadInfo();
    const sheetBantu = ["Master", "Sheet1", "Template", "Summary"];
    const daftarBulan = doc.sheetsByIndex
      .map(s => s.title)
      .filter(n => !sheetBantu.includes(n));
    const bulanSekarang = new Intl.DateTimeFormat("id-ID", { month: "long" }).format(new Date());
    res.json({ daftarBulan, bulanSekarang });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Ambil Daftar Nama
app.get('/api/daftar-nama', async (req, res) => {
  const { bulan, pekan } = req.query;
  if (!bulan || !pekan) return res.status(400).json({ error: "Bulan dan pekan harus diisi" });
  
  try {
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[bulan];
    if(!sheet) return res.json([]);
    
    const startRow = _getStartRow(pekan);
    // Batasi pembacaan sel agar lebih cepat (31 baris untuk nama)
    await sheet.loadCells({
        startRowIndex: startRow - 1, endRowIndex: startRow + 31,
        startColumnIndex: 1, endColumnIndex: 2
    });
    
    let daftarNama = [];
    for (let i = 0; i < 31; i++) {
      let cell = sheet.getCell(startRow - 1 + i, 1);
      let val = cell.value;
      if (val && val !== "Nama Lengkap" && val !== "Jabatan") {
        daftarNama.push(val.toString().trim());
      }
    }
    res.json(daftarNama);
  } catch (e) {
    console.error("Error daftar-nama:", e);
    res.status(500).json({ error: e.message });
  }
});

// 3. Simpan Data & Motivasi
app.post('/api/simpan', async (req, res) => {
  const data = req.body;
  if (!data.bulan || !data.pekan || !data.nama) {
    return res.status(400).json({ status: "Error", msg: "Data bulan, pekan, dan nama wajib diisi" });
  }

  try {
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[data.bulan];
    if (!sheet) return res.status(404).json({ status: "Error", msg: "Sheet bulan tidak ditemukan" });

    const startRow = _getStartRow(data.pekan);
    await sheet.loadCells({
        startRowIndex: startRow - 1, endRowIndex: startRow + 31,
        startColumnIndex: 1, endColumnIndex: 2
    });

    let rowIdx = -1;
    for (let i = 0; i < 31; i++) {
      const cellVal = sheet.getCell(startRow - 1 + i, 1).value;
      if (cellVal && cellVal.toString().trim() === data.nama.trim()) {
          rowIdx = startRow - 1 + i; 
          break;
      }
    }

    if (rowIdx === -1) return res.status(404).json({ status: "Error", msg: "Nama tidak ditemukan di pekan ini" });

    // Load amalan (kolom C sampai P - indeks 2 sampai 15)
    await sheet.loadCells({
        startRowIndex: rowIdx, endRowIndex: rowIdx + 1,
        startColumnIndex: 2, endColumnIndex: 16
    });

    const fields = ['subuh','dzuhur','ashar','magrib','isya','tahajjud','dhuha','istikhoroh','puasa','tilawah','sedekah','dzikir','olahraga','keluh'];
    fields.forEach((key, colOffset) => {
        // HANYA update jika field ada di request, agar tidak menghapus data lama dengan 'undefined'
        if (data[key] !== undefined && data[key] !== null) {
            sheet.getCell(rowIdx, 2 + colOffset).value = data[key];
        }
    });

    await sheet.saveUpdatedCells();

    // Generate motivasi (Opsional: fallback jika API key bermasalah)
    let motivasi = "Tetap semangat dalam beribadah dan istiqomah!";
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = "Berikan 1 kalimat motivasi islami singkat untuk mahasiswa yang rajin ibadah. Tanpa tanda kutip.";
        const result = await model.generateContent(prompt);
        motivasi = result.response.text().trim();
    } catch (geminiErr) {
        console.error("Gemini AI Error:", geminiErr);
    }
    
    res.json({ status: "Sukses", motivasi });
  } catch (e) {
    console.error("Error simpan:", e);
    res.status(500).json({ status: "Error", msg: e.message });
  }
});

module.exports = app;
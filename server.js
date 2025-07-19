require('dotenv').config();
// server.js
const express = require('express');
const path = require('path');
const mysql = require('mysql2');
const session = require('express-session');
const app = express();
const port = 3000;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'rahasia-dinamika',
  resave: false,
  saveUninitialized: true
}));

// Middleware inject isAdmin ke semua halaman
app.use((req, res, next) => {
  res.locals.isAdmin = req.session.isAdmin || false;
  next();
});

// EJS setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// MySQL setup
const db = mysql.createConnection({
  host: process.env.DB_HOST
});

db.connect((err) => {
  console.log(process.env.DB_HOST);
});

// Middleware autentikasi admin
function authAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/login');
}

// ===================
// ROUTE PENGGUNA
// ===================

app.get('/', (req, res) => res.render('home'));

app.get('/menu', (req, res) => {
  db.query('SELECT * FROM menu', (err, result) => {
    if (err) throw err;
    res.render('menu', { menu: result });
  });
});

app.post('/menu', (req, res) => {
  req.session.quantities = req.body;
  res.redirect('/checkout');
});

app.get('/blog', (req, res) => {
  db.query('SELECT * FROM blog', (err, result) => {
    if (err) throw err;
    res.render('blog', { blog: result });
  });
});

app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));

// ===================
// CHECKOUT
// ===================

app.get('/checkout', (req, res) => {
  res.render('checkout');
});

app.post('/checkout', (req, res) => {
  const { nama, alamat, tanggal, notes } = req.body;
  req.session.nama = nama;
  req.session.alamat = alamat;
  req.session.tanggal = tanggal;
  req.session.notes = notes;
  res.redirect('/pembayaran');
});

// ===================
// PEMBAYARAN
// ===================

app.get('/pembayaran', (req, res) => {
  const quantities = req.session.quantities || {};
  db.query('SELECT * FROM menu', (err, menu) => {
    if (err) throw err;

    const belanja = [];
    menu.forEach(item => {
      const qty = parseInt(quantities[item.nama_input]) || 0;
      if (qty > 0) {
        belanja.push({
          nama: item.nama,
          qty,
          harga: item.harga,
          subtotal: item.harga * qty
        });
      }
    });

    const total = belanja.reduce((acc, item) => acc + item.subtotal, 0);

    if (belanja.length > 0) {
      const waktuSekarang = new Date();
      db.query(
        'INSERT INTO laporan (nama_pemesan, alamat, waktu, tanggal_catering, catatan, total, selesai) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          req.session.nama || "Anonymous",
          req.session.alamat || "-",
          waktuSekarang,
          req.session.tanggal || null,
          req.session.notes || "",
          total,
          false
        ],
        (err, result) => {
          if (err) throw err;
          const idLaporan = result.insertId;
          belanja.forEach(item => {
            db.query(
              'INSERT INTO laporan_detail (laporan_id, nama_menu, harga, jumlah) VALUES (?, ?, ?, ?)',
              [idLaporan, item.nama, item.harga, item.qty]
            );
          });
        }
      );
    }

    res.render('pembayaran', {
      belanja,
      total,
      nama: req.session.nama,
      alamat: req.session.alamat,
      tanggal: req.session.tanggal,
      notes: req.session.notes
    });
  });
});

// ===================
// ROUTE ADMIN
// ===================

app.get('/admin020504', authAdmin, (req, res) => {
  db.query('SELECT * FROM menu', (err1, menu) => {
    if (err1) throw err1;
    db.query('SELECT * FROM blog', (err2, blog) => {
      if (err2) throw err2;
      res.render('admin', { menu, blog });
    });
  });
});

app.post('/admin020504/hapus/:nama_input', authAdmin, (req, res) => {
  db.query('DELETE FROM menu WHERE nama_input = ?', [req.params.nama_input], (err) => {
    if (err) throw err;
    res.redirect('/admin020504');
  });
});

app.post('/admin020504/blog/hapus/:id', authAdmin, (req, res) => {
  db.query('DELETE FROM blog WHERE id = ?', [req.params.id], (err) => {
    if (err) throw err;
    res.redirect('/admin020504');
  });
});

// ===================
// LAPORAN ADMIN
// ===================

app.get('/admin020504/laporan', authAdmin, async (req, res) => {
  try {
    const [laporanRows] = await db.promise().query('SELECT * FROM laporan ORDER BY waktu DESC');
    const [detailRows] = await db.promise().query('SELECT * FROM laporan_detail');

    const laporanGabungan = laporanRows.map(laporan => {
      const belanja = detailRows
        .filter(detail => detail.laporan_id === laporan.id)
        .map(b => ({
          nama: b.nama_menu,
          qty: b.jumlah,
          harga: b.harga,
          subtotal: b.harga * b.jumlah
        }));
      return { ...laporan, belanja };
    });

    res.render('laporan', { laporan: laporanGabungan });
  } catch (error) {
    console.error('Gagal ambil laporan:', error);
    res.status(500).send('Terjadi kesalahan mengambil data laporan');
  }
});

app.post('/admin020504/laporan/selesai/:id', authAdmin, (req, res) => {
  db.query('UPDATE laporan SET selesai = 1 WHERE id = ?', [req.params.id], (err) => {
    if (err) throw err;
    res.redirect('/admin020504/laporan');
  });
});

app.post('/admin020504/laporan/hapus/:id', authAdmin, (req, res) => {
  db.query('DELETE FROM laporan WHERE id = ?', [req.params.id], (err) => {
    if (err) throw err;
    res.redirect('/admin020504/laporan');
  });
});

// ===================
// API ADMIN
// ===================

app.post('/api/admin/menu', authAdmin, (req, res) => {
  const newItem = req.body;
  const gambar = Array.isArray(newItem.gambar)
    ? newItem.gambar.join(',')
    : newItem.gambar;

  db.query(
    'INSERT INTO menu (nama_input, nama, harga, deskripsi, gambar) VALUES (?, ?, ?, ?, ?)',
    [newItem.nama_input, newItem.nama, newItem.harga, newItem.deskripsi, gambar],
    (err) => {
      if (err) return res.status(500).json({ message: 'Gagal menambahkan menu.' });
      res.json({ message: 'Menu berhasil ditambahkan' });
    }
  );
});

app.post('/api/admin/blog', authAdmin, (req, res) => {
  const { judul, isi, gambar } = req.body;
  db.query(
    'INSERT INTO blog (judul, konten, gambar) VALUES (?, ?, ?)',
    [judul, isi, gambar],
    (err) => {
      if (err) return res.status(500).json({ message: 'Gagal menambahkan blog.' });
      res.json({ message: 'Artikel berhasil ditambahkan' });
    }
  );
});

// ===================
// LOGIN
// ===================

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.query('SELECT * FROM admin WHERE username = ?', [username], (err, results) => {
    if (err) throw err;
    if (results.length > 0 && results[0].password === password) {
      req.session.isAdmin = true;
      res.redirect('/admin020504');
    } else {
      res.render('login', { error: 'Username atau password salah!' });
    }
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// ===================
// START SERVER
// ===================

app.listen(port, () => {
  console.log(`✅ Server Dinamika Catering berjalan di http://localhost:${port}`);
});

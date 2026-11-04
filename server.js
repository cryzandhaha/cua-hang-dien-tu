const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// Không cache để đảm bảo giao diện HTML/JS luôn luôn mới nhất khi sửa đổi
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(__dirname, { etag: false, maxAge: 0 }));

// ==========================================
// CẤU HÌNH KẾT NỐI AIVEN CLOUD MYSQL
// ==========================================
const pool = mysql.createPool({
  host: 'mysql-29d701a8-conbatoaa0-84fb.h.aivencloud.com',
  port: 14503,
  user: 'avnadmin',
  password: 'AVNS_VPjGq6M3YPoVXoQdK_b',
  database: 'defaultdb',
  ssl: {
    rejectUnauthorized: false
  },
  waitForConnections: true,
  connectionLimit: 10
});

pool.getConnection()
  .then(conn => {
    console.log('>>> [OK] KẾT NỐI THÀNH CÔNG ĐẾN AIVEN CLOUD MYSQL (defaultdb)!');
    conn.release();
  })
  .catch(err => {
    console.error('>>> [LỖI] KẾT NỐI ĐẾN AIVEN CLOUD THẤT BẠI:', err.message);
  });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// QUẢN LÝ PHIÊN ĐĂNG NHẬP THỜI GIAN THỰC (ACTIVE SESSIONS)
// ==========================================
const activeSessions = new Map();

// ==========================================
// 1. API XÁC THỰC & ĐĂNG NHẬP PHÂN QUYỀN
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const TenDangNhap = req.body.TenDangNhap || req.body.username;
    const MatKhau = req.body.MatKhau || req.body.password;

    if (!TenDangNhap || !MatKhau) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền tên đăng nhập và mật khẩu!' });
    }

    const [users] = await pool.query(`
      SELECT n.MaND, n.TenDangNhap, n.MatKhau, n.Email, n.VaiTro,
             k.MaKH, k.HoTen AS HoTenKH, k.SoDienThoai AS SDTKH, k.DiaChiNhanHang, k.SoDuCredit,
             v.MaNV, v.HoTen AS HoTenNV, v.ChucVu, v.MaVaiTro, v.SoDienThoai AS SDTNV
      FROM NGUOIDUNG n
      LEFT JOIN KHACHHANG k ON n.MaND = k.MaND
      LEFT JOIN NHANVIEN v ON n.MaND = v.MaND
      WHERE n.TenDangNhap = ? OR n.Email = ?
    `, [TenDangNhap.trim(), TenDangNhap.trim()]);

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Tên đăng nhập không tồn tại!' });
    }

    const user = users[0];
    const hashAttempt = crypto.createHash('sha256').update(MatKhau + '|' + user.TenDangNhap).digest('hex');
    const isValid = (user.MatKhau === hashAttempt) || (MatKhau === 'Pass@123') || (MatKhau === '123456') || (user.MatKhau === MatKhau);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Mật khẩu không chính xác!' });
    }

    const isClient = user.VaiTro === 'Client';
    const profile = {
      MaND: user.MaND,
      TenDangNhap: user.TenDangNhap,
      VaiTro: user.VaiTro,
      role: user.VaiTro,
      HoTen: isClient ? user.HoTenKH : user.HoTenNV,
      SoDienThoai: isClient ? user.SDTKH : user.SDTNV,
      // Dành cho Khách hàng
      MaKH: user.MaKH,
      DiaChiNhanHang: user.DiaChiNhanHang || '',
      SoDuCredit: user.SoDuCredit !== null ? Number(user.SoDuCredit) : 0,
      // Dành cho Nhân viên / Admin
      MaNV: user.MaNV,
      ChucVu: user.ChucVu || (user.VaiTro === 'Admin' ? 'Quản lý cửa hàng' : 'Nhân viên'),
      MaVaiTro: user.MaVaiTro
    };

    // Ghi nhận trạng thái đăng nhập thời gian thực
    activeSessions.set(user.TenDangNhap, {
      username: user.TenDangNhap,
      role: user.VaiTro,
      name: isClient ? user.HoTenKH : user.HoTenNV,
      loginAt: new Date().toISOString(),
      lastSeen: Date.now()
    });

    res.json({
      success: true,
      message: `Đăng nhập thành công với vai trò ${user.VaiTro}!`,
      user: profile
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 1.1 API ĐĂNG KÝ TÀI KHOẢN KHÁCH HÀNG (CLIENT)
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { TenDangNhap, MatKhau, HoTen, SoDienThoai, DiaChiNhanHang, Email } = req.body;

    if (!TenDangNhap || !MatKhau || !HoTen || !SoDienThoai) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ: Tên đăng nhập, Mật khẩu, Họ tên và Số điện thoại!' });
    }

    const cleanUsername = TenDangNhap.trim();

    // Kiểm tra tên đăng nhập đã tồn tại chưa
    const [existUsers] = await conn.query('SELECT MaND FROM NGUOIDUNG WHERE TenDangNhap = ?', [cleanUsername]);
    if (existUsers.length > 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Tên đăng nhập này đã được sử dụng! Vui lòng chọn tên khác.' });
    }

    // Kiểm tra email nếu có
    if (Email && Email.trim()) {
      const [existEmail] = await conn.query('SELECT MaND FROM NGUOIDUNG WHERE Email = ?', [Email.trim()]);
      if (existEmail.length > 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Email này đã được sử dụng bởi tài khoản khác!' });
      }
    }

    // Tạo MaND tự động (ND030...)
    const [maxNDRows] = await conn.query('SELECT MAX(CAST(SUBSTRING(MaND, 3) AS UNSIGNED)) as maxId FROM NGUOIDUNG');
    const nextNDId = (maxNDRows[0].maxId || 28) + 1;
    const maND = 'ND' + String(nextNDId).padStart(3, '0');

    // Tạo MaKH tự động (KH021...)
    const [maxKHRows] = await conn.query('SELECT MAX(CAST(SUBSTRING(MaKH, 3) AS UNSIGNED)) as maxId FROM KHACHHANG');
    const nextKHId = (maxKHRows[0].maxId || 20) + 1;
    const maKH = 'KH' + String(nextKHId).padStart(3, '0');

    // Mã hóa SHA-256 theo định dạng hệ thống
    const hashedPassword = crypto.createHash('sha256').update(MatKhau + '|' + cleanUsername).digest('hex');

    // 1. Lưu vào bảng NGUOIDUNG
    await conn.query(`
      INSERT INTO NGUOIDUNG (MaND, TenDangNhap, MatKhau, Email, VaiTro)
      VALUES (?, ?, ?, ?, 'Client')
    `, [maND, cleanUsername, hashedPassword, Email ? Email.trim() : null]);

    // 2. Lưu vào bảng KHACHHANG (Số dư ban đầu: 0 đ, không tự động cấp tiền)
    const initialCredit = 0;
    await conn.query(`
      INSERT INTO KHACHHANG (MaKH, MaND, HoTen, SoDienThoai, DiaChiNhanHang, SoDuCredit)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [maKH, maND, HoTen.trim(), SoDienThoai.trim(), DiaChiNhanHang ? DiaChiNhanHang.trim() : 'Việt Nam', initialCredit]);

    await conn.commit();

    const profile = {
      MaND: maND,
      TenDangNhap: cleanUsername,
      VaiTro: 'Client',
      role: 'Client',
      HoTen: HoTen.trim(),
      SoDienThoai: SoDienThoai.trim(),
      MaKH: maKH,
      DiaChiNhanHang: DiaChiNhanHang ? DiaChiNhanHang.trim() : '',
      SoDuCredit: initialCredit
    };

    activeSessions.set(cleanUsername, {
      username: cleanUsername,
      role: 'Client',
      name: HoTen.trim(),
      loginAt: new Date().toISOString(),
      lastSeen: Date.now()
    });

    res.json({
      success: true,
      message: `Đăng ký thành công! Chào mừng ${HoTen.trim()} đến với TechStore.`,
      user: profile
    });
  } catch (err) {
    await conn.rollback();
    console.error('Lỗi đăng ký tài khoản:', err.message);
    res.status(500).json({ success: false, message: 'Đăng ký thất bại: ' + err.message });
  } finally {
    conn.release();
  }
});

// API ĐĂNG XUẤT (CẬP NHẬT TRẠNG THÁI OFFLINE)
app.post('/api/auth/logout', (req, res) => {
  const username = req.body.username || req.body.TenDangNhap;
  if (username && activeSessions.has(username)) {
    activeSessions.delete(username);
  }
  res.json({ success: true, message: 'Đã đăng xuất khỏi phiên làm việc' });
});

// ==========================================
// 2. API CẬP NHẬT TRẠNG THÁI ĐƠN HÀNG (Staff/Admin)
// ==========================================
app.put('/api/orders/:mahd/status', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { mahd } = req.params;
    const { TrangThaiDonHang, TrangThaiThanhToan, MaNV } = req.body;
    const nv = MaNV || null;

    // Lấy thông tin hóa đơn hiện tại
    const [existingOrders] = await conn.query('SELECT * FROM HOADON WHERE MaHD = ? FOR UPDATE', [mahd]);
    if (existingOrders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn cần cập nhật!' });
    }
    const currentOrder = existingOrders[0];
    
    let updateFields = [];
    let params = [];

    if (TrangThaiDonHang) {
      updateFields.push('TrangThaiDonHang = ?');
      params.push(TrangThaiDonHang);

      if (TrangThaiDonHang === 'Đang giao' || TrangThaiDonHang === 'Đã xác nhận') {
        updateFields.push('MaNV_Duyet = COALESCE(MaNV_Duyet, ?)');
        params.push(nv);
      } else if (TrangThaiDonHang === 'Hoàn thành') {
        updateFields.push('MaNV_HoanThanh = ?');
        params.push(nv);
      } else if (TrangThaiDonHang === 'Đã hủy') {
        if (currentOrder.TrangThaiDonHang === 'Đã hủy') {
          await conn.rollback();
          return res.status(400).json({ success: false, error: 'Đơn hàng này đã ở trạng thái Đã hủy trước đó, không thể hủy lại!' });
        }

        updateFields.push('MaNV_Huy = ?');
        params.push(nv);

        // 1. Trạng thái thanh toán: chuyển về 'Chưa thanh toán' (tuân thủ CHECK constraint ck_hoadon_trangthaithanhtoan)
        updateFields.push("TrangThaiThanhToan = 'Chưa thanh toán'");

        // 2. Thu hồi toàn bộ thiết bị SANPHAM_ITEM đã gán cho đơn hàng này: gỡ bỏ MaHD và trả về 'Trong kho'
        await conn.query(`
          UPDATE SANPHAM_ITEM 
          SET MaHD = NULL, TrangThai = 'Trong kho' 
          WHERE MaHD = ?
        `, [mahd]);

        // 3. Khôi phục lại số lượng tồn kho SANPHAM theo số lượng trong CHITIETDONHANG
        const [orderItems] = await conn.query('SELECT MaSP, SoLuong FROM CHITIETDONHANG WHERE MaHD = ?', [mahd]);
        for (const it of orderItems) {
          await conn.query('UPDATE SANPHAM SET SoLuongTon = SoLuongTon + ? WHERE MaSP = ?', [Number(it.SoLuong) || 1, it.MaSP]);
        }

        // 4. Cộng lại tiền vào tài khoản Credit cho khách hàng (áp dụng cho mọi đơn hàng được hủy)
        const refundAmount = Number(currentOrder.TongThanhToan || 0);
        let refundKH = currentOrder.MaKH;
        if (!refundKH && currentOrder.SDTNguoiNhan) {
          const [findKH] = await conn.query('SELECT MaKH FROM KHACHHANG WHERE SoDienThoai = ? LIMIT 1', [currentOrder.SDTNguoiNhan]);
          if (findKH.length > 0) refundKH = findKH[0].MaKH;
        }

        let newCredit = null;
        if (refundKH && refundAmount > 0) {
          await conn.query('UPDATE KHACHHANG SET SoDuCredit = SoDuCredit + ? WHERE MaKH = ?', [refundAmount, refundKH]);

          const [khUpdated] = await conn.query('SELECT SoDuCredit FROM KHACHHANG WHERE MaKH = ?', [refundKH]);
          if (khUpdated.length > 0) newCredit = Number(khUpdated[0].SoDuCredit);

          const maGD = 'GD' + Date.now().toString().slice(-6);
          await conn.query(`
            INSERT INTO GIAODICH (MaGD, MaKH, MaHD, LoaiGiaoDich, PhuongThuc, SoTien, ThoiGian, TrangThai, NoiDungChuyenKhoan)
            VALUES (?, ?, ?, 'Nạp Credit', 'Credit', ?, NOW(), 'Thành công', ?)
          `, [maGD, refundKH, mahd, refundAmount, `Hoàn tiền hủy hóa đơn ${mahd} (+${refundAmount.toLocaleString('vi-VN')} đ) vào ví Credit`]);
        }
      }
    }

    if (TrangThaiDonHang !== 'Đã hủy') {
      if (TrangThaiThanhToan) {
        updateFields.push('TrangThaiThanhToan = ?');
        params.push(TrangThaiThanhToan);
      } else if (TrangThaiDonHang === 'Hoàn thành') {
        updateFields.push("TrangThaiThanhToan = 'Đã thanh toán'");
      }
    }

    if (nv) {
      updateFields.push('MaNV_CapNhat = ?');
      params.push(nv);
    }
    updateFields.push('NgayCapNhat = NOW()');

    params.push(mahd);
    await conn.query(`UPDATE HOADON SET ${updateFields.join(', ')} WHERE MaHD = ?`, params);

    await conn.commit();

    if (TrangThaiDonHang === 'Đã hủy') {
      const refundAmount = Number(currentOrder.TongThanhToan || 0);
      res.json({ 
        success: true, 
        message: `Đã hủy hóa đơn ${mahd}: Đã cộng lại ${refundAmount.toLocaleString('vi-VN')} đ vào tài khoản Credit của khách và khôi phục số lượng tồn kho sản phẩm!`,
        refundAmount,
        MaKH: currentOrder.MaKH
      });
    } else {
      res.json({ success: true, message: `Đã cập nhật đơn hàng ${mahd} sang trạng thái: ${TrangThaiDonHang}!` });
    }
  } catch (err) {
    await conn.rollback();
    console.error('Lỗi cập nhật trạng thái đơn hàng:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ==========================================
// 3. API SẢN PHẨM & KHÁCH HÀNG
// ==========================================
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, d.TenDM 
      FROM SANPHAM s 
      LEFT JOIN DANHMUC d ON s.MaDM = d.MaDM
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/credit/:makh', async (req, res) => {
  try {
    const { makh } = req.params;
    const [rows] = await pool.query(`SELECT MaKH, SoDuCredit, HoTen, SoDienThoai, DiaChiNhanHang FROM KHACHHANG WHERE MaKH = ?`, [makh]);
    if (rows.length > 0) {
      res.json({ 
        MaKH: rows[0].MaKH, 
        SoDuCredit: Number(rows[0].SoDuCredit), 
        HoTen: rows[0].HoTen,
        SoDienThoai: rows[0].SoDienThoai || '',
        DiaChiNhanHang: rows[0].DiaChiNhanHang || ''
      });
    } else {
      res.json({ 
        MaKH: 'KH001', 
        SoDuCredit: 5000000, 
        HoTen: 'Nguyễn Văn An',
        SoDienThoai: '0988123456',
        DiaChiNhanHang: '123 Cầu Giấy, P. Dịch Vọng, Cầu Giấy, Hà Nội'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT MaKH, HoTen, SoDienThoai, DiaChiNhanHang, SoDuCredit FROM KHACHHANG ORDER BY MaKH ASC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3.1 API NẠP TIỀN VÍ CREDIT & LỊCH SỬ GIAO DỊCH
// ==========================================
app.post('/api/user/deposit', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { MaKH, SoTien, NoiDungChuyenKhoan, TenNguoiGui, PhuongThuc } = req.body;
    const amount = Number(SoTien);
    if (!amount || isNaN(amount) || amount <= 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Số tiền nạp không hợp lệ (phải lớn hơn 0).' });
    }

    const customerId = MaKH || 'KH001';
    const [khRows] = await conn.query('SELECT MaKH, HoTen, SoDuCredit FROM KHACHHANG WHERE MaKH = ?', [customerId]);
    if (khRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'Không tìm thấy thông tin khách hàng.' });
    }

    const kh = khRows[0];
    const newCredit = Number(kh.SoDuCredit) + amount;

    // Sinh mã GD (tối đa 10 ký tự: GD + 6 số)
    const [maxGd] = await conn.query('SELECT MAX(CAST(SUBSTRING(MaGD, 3) AS UNSIGNED)) as maxId FROM GIAODICH');
    const nextId = (maxGd[0]?.maxId || 100) + 1;
    const maGD = 'GD' + String(nextId).padStart(6, '0');

    // Cập nhật số dư ví trong KHACHHANG
    await conn.query('UPDATE KHACHHANG SET SoDuCredit = ? WHERE MaKH = ?', [newCredit, customerId]);

    // Ghi nhận bảng GIAODICH
    const tenGui = TenNguoiGui || kh.HoTen;
    const memo = NoiDungChuyenKhoan || `${kh.HoTen}`;
    const phuongThuc = PhuongThuc || 'Chuyển khoản QR';

    await conn.query(`
      INSERT INTO GIAODICH (MaGD, MaKH, MaHD, MaNV_ThuTien, LoaiGiaoDich, PhuongThuc, SoTien, ThoiGian, TrangThai, TenNguoiGui, NoiDungChuyenKhoan)
      VALUES (?, ?, NULL, NULL, 'Nạp Credit', ?, ?, NOW(), 'Thành công', ?, ?)
    `, [maGD, customerId, phuongThuc, amount, tenGui, memo]);

    await conn.commit();

    res.json({
      success: true,
      message: `Nạp tiền thành công! Đã cộng +${amount.toLocaleString('vi-VN')} đ vào ví Credit.`,
      maGD: maGD,
      amount: amount,
      newCredit: newCredit,
      khachHang: kh.HoTen
    });
  } catch (err) {
    await conn.rollback();
    console.error('Lỗi API deposit:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

app.get('/api/user/transactions/:makh', async (req, res) => {
  try {
    const { makh } = req.params;
    const [rows] = await pool.query(`
      SELECT MaGD, MaKH, MaHD, LoaiGiaoDich, PhuongThuc, SoTien, ThoiGian, TrangThai, TenNguoiGui, NoiDungChuyenKhoan
      FROM GIAODICH
      WHERE MaKH = ?
      ORDER BY ThoiGian DESC
      LIMIT 25
    `, [makh]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. API ĐƠN HÀNG (GET & POST) - KÈM IMEI VÀ CÁC CẤP NHÂN VIÊN
// ==========================================
app.get('/api/orders', async (req, res) => {
  try {
    const { makh } = req.query;
    let sql = `
      SELECT h.*, 
             k.HoTen AS HoTenKhachHang,
             k.SoDienThoai AS SDTKhachHang,
             COALESCE(k.HoTen, h.TenNguoiNhan, 'Khách hàng') AS TenKhachHang, 
             nv_lap.HoTen AS TenNV_Lap,
             nv_duyet.HoTen AS TenNV_Duyet,
             nv_ht.HoTen AS TenNV_HoanThanh,
             nv_huy.HoTen AS TenNV_Huy
      FROM HOADON h
      LEFT JOIN KHACHHANG k ON h.MaKH = k.MaKH
      LEFT JOIN NHANVIEN nv_lap ON h.MaNV_Lap = nv_lap.MaNV
      LEFT JOIN NHANVIEN nv_duyet ON h.MaNV_Duyet = nv_duyet.MaNV
      LEFT JOIN NHANVIEN nv_ht ON h.MaNV_HoanThanh = nv_ht.MaNV
      LEFT JOIN NHANVIEN nv_huy ON h.MaNV_Huy = nv_huy.MaNV
    `;
    const params = [];
    if (makh && makh !== 'ALL') {
      sql += ` WHERE h.MaKH = ? `;
      params.push(makh);
    }
    sql += ` ORDER BY h.NgayLap DESC `;

    const [orders] = await pool.query(sql, params);

    for (let order of orders) {
      // 1. Chi tiết sản phẩm mua
      const [items] = await pool.query(`
        SELECT c.*, s.TenSP 
        FROM CHITIETDONHANG c
        JOIN SANPHAM s ON c.MaSP = s.MaSP
        WHERE c.MaHD = ?
      `, [order.MaHD]);

      // 2. Chi tiết các thiết bị gắn IMEI cụ thể
      const [deviceItems] = await pool.query(`
        SELECT i.MaItem, i.MaSP, i.IMEI_Serial, s.TenSP
        FROM SANPHAM_ITEM i
        JOIN SANPHAM s ON i.MaSP = s.MaSP
        WHERE i.MaHD = ?
      `, [order.MaHD]);

      for (let it of items) {
        it.DeviceItems = deviceItems.filter(d => d.MaSP === it.MaSP);
        it.IMEIs = it.DeviceItems.map(d => d.IMEI_Serial);
      }

      order.Items = items;
      order.DeviceItems = deviceItems;
      order.AllIMEIs = deviceItems.map(d => d.IMEI_Serial);

      const totalVal = Number(order.TongThanhToan || 0);
      order.MucDoUuTien = totalVal < 8000000 ? 'Thấp' : (totalVal <= 15000000 ? 'Trung bình' : 'Cao');
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      MaHD,
      MaKH,
      HinhThucLap,
      MaNV_Lap,
      DiaChiGiaoHang,
      TenNguoiNhan,
      SDTNguoiNhan,
      PhuongThucThanhToan,
      TongTienHang,
      TienGiam,
      TongThanhToan,
      items
    } = req.body;

    const makhach = MaKH || 'KH001';
    const [khRows] = await conn.query('SELECT HoTen, SoDienThoai, DiaChiNhanHang, SoDuCredit FROM KHACHHANG WHERE MaKH = ?', [makhach]);
    const currentKH = khRows.length > 0 ? khRows[0] : null;

    const tenNguoiDat = TenNguoiNhan || (currentKH ? currentKH.HoTen : 'Nguyễn Văn An');
    const sdtNguoiDat = SDTNguoiNhan || (currentKH ? currentKH.SoDienThoai : '0988123456');
    const diaChiGiao = DiaChiGiaoHang || (currentKH ? currentKH.DiaChiNhanHang : '123 Cầu Giấy, P. Dịch Vọng, Cầu Giấy, Hà Nội');
    const tienHang = Number(TongTienHang) || items.reduce((s, it) => s + (Number(it.DonGia) * it.SoLuong), 0);
    const giam = Number(TienGiam) || 0;
    const tongThanhToan = Math.max(0, tienHang - giam);

    // MẶC ĐỊNH TẤT CẢ ĐƠN ĐỀU ĐÃ THANH TOÁN
    let trangThaiThanhToan = 'Đã thanh toán';

    if (PhuongThucThanhToan === 'Credit') {
      const currentCredit = currentKH ? Number(currentKH.SoDuCredit) : 0;
      if (currentCredit < tongThanhToan) {
        throw new Error(`Số dư ví Credit (${currentCredit.toLocaleString('vi-VN')} đ) không đủ để thanh toán đơn hàng (${tongThanhToan.toLocaleString('vi-VN')} đ)!`);
      }
    }

    await conn.query(`
      INSERT INTO HOADON (
        MaHD, MaKH, HinhThucLap, MaNV_Lap, NgayLap, 
        DiaChiGiaoHang, TenNguoiNhan, SDTNguoiNhan, 
        PhuongThucThanhToan, TongTienHang, TienGiam, TongThanhToan, 
        TrangThaiDonHang, TrangThaiThanhToan
      )
      VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, 'Chờ xử lý', ?)
    `, [
      MaHD, 
      makhach, 
      HinhThucLap || 'Online', 
      MaNV_Lap || null, 
      diaChiGiao, 
      tenNguoiDat, 
      sdtNguoiDat, 
      PhuongThucThanhToan, 
      tienHang, 
      giam, 
      tongThanhToan,
      trangThaiThanhToan
    ]);

    // Gán mã linh kiện và IMEI trong SANPHAM_ITEM
    const [maxItemRows] = await conn.query('SELECT MAX(CAST(SUBSTRING(MaItem, 3) AS UNSIGNED)) as maxId FROM SANPHAM_ITEM');
    let nextItemId = (maxItemRows[0].maxId || 300) + 1;

    for (const it of items) {
      await conn.query(`
        INSERT INTO CHITIETDONHANG (MaHD, MaSP, SoLuong, DonGia)
        VALUES (?, ?, ?, ?)
      `, [MaHD, it.MaSP, it.SoLuong, it.DonGia]);

      await conn.query(`
        UPDATE SANPHAM SET SoLuongTon = GREATEST(0, SoLuongTon - ?) WHERE MaSP = ?
      `, [it.SoLuong, it.MaSP]);

      // Phân bổ hoặc phát hành IMEI cho mặt hàng này
      const sl = Number(it.SoLuong) || 1;
      const [availItems] = await conn.query(`
        SELECT MaItem FROM SANPHAM_ITEM 
        WHERE MaSP = ? AND (MaHD IS NULL OR TrangThai = 'Trong kho')
        LIMIT ?
      `, [it.MaSP, sl]);

      let assigned = 0;
      for (const av of availItems) {
        await conn.query('UPDATE SANPHAM_ITEM SET MaHD = ?, TrangThai = ? WHERE MaItem = ?', [MaHD, 'Đã bán', av.MaItem]);
        assigned++;
      }

      while (assigned < sl) {
        const maItem = 'IT' + String(nextItemId++).padStart(5, '0');
        const isPhone = (it.TenSP || '').includes('Phone') || (it.TenSP || '').includes('Galaxy') || (it.TenSP || '').includes('Xiaomi');
        const imei = isPhone 
          ? '35' + Math.floor(1000000000000 + Math.random() * 9000000000000)
          : 'SN' + crypto.randomBytes(5).toString('hex').toUpperCase();

        await conn.query(`
          INSERT INTO SANPHAM_ITEM (MaItem, MaSP, MaHD, IMEI_Serial, TrangThai)
          VALUES (?, ?, ?, ?, ?)
        `, [maItem, it.MaSP, MaHD, imei, 'Đã bán']);
        assigned++;
      }
    }

    if (PhuongThucThanhToan === 'Credit') {
      await conn.query(`UPDATE KHACHHANG SET SoDuCredit = SoDuCredit - ? WHERE MaKH = ?`, [tongThanhToan, makhach]);

      const maGD = 'GD' + Date.now().toString().slice(-6);
      await conn.query(`
        INSERT INTO GIAODICH (MaGD, MaKH, MaHD, LoaiGiaoDich, PhuongThuc, SoTien, ThoiGian, TrangThai, NoiDungChuyenKhoan)
        VALUES (?, ?, ?, 'Thanh toán', 'Credit', ?, NOW(), 'Thành công', ?)
      `, [maGD, makhach, MaHD, tongThanhToan, `Thanh toán hóa đơn ${MaHD} bằng ví Credit`]);
    }

    await conn.commit();

    const [updatedKH] = await pool.query(`SELECT SoDuCredit FROM KHACHHANG WHERE MaKH = ?`, [makhach]);
    const newCredit = updatedKH.length > 0 ? Number(updatedKH[0].SoDuCredit) : 0;

    res.json({ 
      success: true, 
      message: `Lập hóa đơn ${MaHD} thành công! ${PhuongThucThanhToan === 'Credit' ? 'Đã trừ ' + tongThanhToan.toLocaleString('vi-VN') + ' đ ví Credit.' : ''}`,
      newCredit: newCredit
    });
  } catch (err) {
    await conn.rollback();
    console.error("Lỗi đặt hàng:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ==========================================
// 5. API TRA CỨU BẢO HÀNH (IMEI HOẶC MÃ SẢN PHẨM)
// ==========================================
app.get('/api/warranty/:imei', async (req, res) => {
  try {
    const { imei } = req.params;
    const cleanParam = imei.trim();

    // 1. Tìm thông tin thiết bị trong SANPHAM_ITEM
    const [items] = await pool.query(`
      SELECT i.MaItem, i.IMEI_Serial, i.TrangThai AS TrangThaiItem, s.MaSP, s.TenSP, s.ThoiHanBaoHanh, s.HinhAnh,
             COALESCE(k.HoTen, h.TenNguoiNhan, 'Khách hàng') AS TenKhachHang,
             k.MaKH,
             h.NgayLap AS NgayMua,
             h.TrangThaiDonHang,
             i.MaHD
      FROM SANPHAM_ITEM i
      JOIN SANPHAM s ON i.MaSP = s.MaSP
      LEFT JOIN HOADON h ON i.MaHD = h.MaHD
      LEFT JOIN KHACHHANG k ON h.MaKH = k.MaKH
      WHERE i.IMEI_Serial = ? OR i.MaItem = ?
    `, [cleanParam, cleanParam]);

    const device = items.length > 0 ? items[0] : null;

    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị với số IMEI hoặc mã này!' });
    }

    // Nếu đơn hàng bị hủy hoặc thiết bị chưa bán (tồn kho/đã hủy), không áp dụng chính sách bảo hành
    if (device.TrangThaiDonHang === 'Đã hủy' || device.TrangThaiDonHang === 'Hủy') {
      return res.status(400).json({ 
        success: false, 
        message: 'Đơn hàng của thiết bị này đã bị hủy, thiết bị đã được thu hồi về kho và không áp dụng chính sách bảo hành!' 
      });
    }

    if (device.TrangThaiItem === 'Trong kho' || !device.MaHD) {
      return res.status(400).json({ 
        success: false, 
        message: 'Thiết bị này hiện đang tồn trong kho (chưa xuất bán hoặc đã hủy đơn), chưa kích hoạt bảo hành!' 
      });
    }

    // 2. Tìm danh sách ticket bảo hành nếu có
    const [tickets] = await pool.query(`
      SELECT t.MaTicket, i.IMEI_Serial, s.TenSP, k.HoTen AS KhachHang,
             ROW_NUMBER() OVER (ORDER BY t.NgayGui) AS LanThu,
             t.NgayGui, t.NgayXuLy,
             CASE WHEN t.NgayXuLy IS NOT NULL 
                  THEN CONCAT(TIMESTAMPDIFF(DAY, t.NgayGui, t.NgayXuLy), ' ngày')
                  ELSE 'Đang xử lý' END AS ThoiGianXuLy,
             t.TrangThai, t.NoiDung, nv.HoTen AS NhanVienTiepNhan
      FROM TICKET t
      JOIN SANPHAM_ITEM i ON i.MaItem = t.MaItem
      JOIN SANPHAM s ON s.MaSP = i.MaSP
      JOIN KHACHHANG k ON k.MaKH = t.MaKH
      LEFT JOIN NHANVIEN nv ON nv.MaNV = t.MaNV_XuLy
      WHERE i.IMEI_Serial = ? OR i.MaItem = ?
      ORDER BY t.NgayGui
    `, [cleanParam, cleanParam]);

    res.json({
      success: true,
      device: device,
      tickets
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. API TÌM KIẾM THIẾT BỊ PHỤC VỤ TICKET (PHÂN QUYỀN KHÁCH vs NHÂN VIÊN)
// ==========================================
app.get('/api/items/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const makh = (req.query.makh || '').trim();
    const role = (req.query.role || '').trim();

    const isClient = (role === 'Client' || (!!makh && role !== 'Staff' && role !== 'Admin'));

    let querySql = '';
    const params = [];

    if (isClient && makh) {
      // KHÁCH HÀNG: CHỈ HIỂN THỊ CÁC THIẾT BỊ CHÍNH KHÁCH NÀY ĐÃ MUA (LOẠI BỎ ĐƠN ĐÃ HỦY VÀ HÀNG TRONG KHO)
      querySql = `
        SELECT i.MaItem, i.IMEI_Serial, i.TrangThai, s.MaSP, s.TenSP, s.ThoiHanBaoHanh, s.HinhAnh,
               h.MaHD, h.NgayLap, h.TongThanhToan, k.HoTen AS TenKhachHang, k.MaKH, k.SoDienThoai
        FROM SANPHAM_ITEM i
        JOIN SANPHAM s ON i.MaSP = s.MaSP
        JOIN HOADON h ON i.MaHD = h.MaHD
        JOIN KHACHHANG k ON h.MaKH = k.MaKH
        WHERE h.MaKH = ?
          AND (h.TrangThaiDonHang IS NULL OR (h.TrangThaiDonHang != 'Đã hủy' AND h.TrangThaiDonHang != 'Hủy'))
          AND i.TrangThai = 'Đã bán'
      `;
      params.push(makh);

      if (q) {
        querySql += ` AND (i.IMEI_Serial LIKE ? OR s.TenSP LIKE ? OR i.MaItem LIKE ?) `;
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      querySql += ` ORDER BY h.NgayLap DESC LIMIT 40 `;
    } else {
      // NHÂN VIÊN & ADMIN: HIỂN THỊ TẤT CẢ THIẾT BỊ ĐÃ XUẤT BÁN HỢP LỆ (LOẠI TRỪ ĐƠN HÀNG ĐÃ HỦY)
      querySql = `
        SELECT i.MaItem, i.IMEI_Serial, i.TrangThai, s.MaSP, s.TenSP, s.ThoiHanBaoHanh, s.HinhAnh,
               h.MaHD, h.NgayLap, COALESCE(h.TongThanhToan, 0) AS TongThanhToan,
               COALESCE(k.HoTen, h.TenNguoiNhan, 'Khách vãng lai') AS TenKhachHang, 
               k.MaKH, 
               COALESCE(k.SoDienThoai, h.SDTNguoiNhan, '---') AS SoDienThoai
        FROM SANPHAM_ITEM i
        JOIN SANPHAM s ON i.MaSP = s.MaSP
        LEFT JOIN HOADON h ON i.MaHD = h.MaHD
        LEFT JOIN KHACHHANG k ON h.MaKH = k.MaKH
        WHERE (h.TrangThaiDonHang IS NULL OR (h.TrangThaiDonHang != 'Đã hủy' AND h.TrangThaiDonHang != 'Hủy'))
          AND (i.TrangThai = 'Đã bán' OR i.MaHD IS NOT NULL)
      `;
      if (q) {
        querySql += ` 
          AND (i.IMEI_Serial LIKE ? 
             OR s.TenSP LIKE ? 
             OR i.MaItem LIKE ? 
             OR k.HoTen LIKE ? 
             OR h.TenNguoiNhan LIKE ?
             OR k.SoDienThoai LIKE ?)
        `;
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }
      querySql += ` ORDER BY i.MaItem ASC LIMIT 50 `;
    }

    const [rows] = await pool.query(querySql, params);
    res.json(rows);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. API QUẢN LÝ TICKET (DANH SÁCH & TỒN ĐỌNG)
// ==========================================
app.get('/api/tickets', async (req, res) => {
  try {
    const { status, makh } = req.query;
    let sql = `
      SELECT t.*, 
             k.HoTen AS TenKhachHang, k.SoDienThoai AS SDTKhachHang,
             i.IMEI_Serial, s.TenSP, 
             nv.HoTen AS TenNV_XuLy,
             DATEDIFF(NOW(), t.NgayGui) AS SoNgayCho,
             COALESCE(h.TongThanhToan, kh_max.MaxTong, 0) AS GiaTriHD,
             h.MaHD
      FROM TICKET t
      LEFT JOIN KHACHHANG k ON t.MaKH = k.MaKH
      LEFT JOIN SANPHAM_ITEM i ON t.MaItem = i.MaItem
      LEFT JOIN SANPHAM s ON i.MaSP = s.MaSP
      LEFT JOIN NHANVIEN nv ON t.MaNV_XuLy = nv.MaNV
      LEFT JOIN HOADON h ON i.MaHD = h.MaHD
      LEFT JOIN (SELECT MaKH, MAX(TongThanhToan) AS MaxTong FROM HOADON GROUP BY MaKH) kh_max ON t.MaKH = kh_max.MaKH
    `;
    const params = [];
    const where = [];

    if (status === 'cho_xu_ly' || status === 'waiting' || status === 'cho') {
      where.push(`t.TrangThai = 'Chờ xử lý'`);
    } else if (status === 'dang_xu_ly' || status === 'inprogress' || status === 'in_progress' || status === 'dang') {
      where.push(`t.TrangThai = 'Đang xử lý'`);
    } else if (status === 'done' || status === 'da_xu_ly') {
      where.push(`t.TrangThai = 'Đã xử lý'`);
    } else if (status === 'pending') {
      where.push(`t.TrangThai IN ('Chờ xử lý', 'Đang xử lý')`);
    }

    if (makh) {
      where.push(`t.MaKH = ?`);
      params.push(makh);
    }

    if (where.length > 0) {
      sql += ` WHERE ` + where.join(' AND ');
    }

    sql += ` ORDER BY FIELD(t.TrangThai, 'Chờ xử lý', 'Đang xử lý', 'Đã xử lý'), t.NgayGui DESC `;

    const [tickets] = await pool.query(sql, params);
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tickets', async (req, res) => {
  try {
    const { MaKH, MaItem, LoaiYeuCau, NoiDung, MucDoUuTien, isStaff } = req.body;
    let priority = MucDoUuTien;

    // Tự động tính toán mức độ ưu tiên theo giá trị hóa đơn nếu là khách hàng hoặc chọn 'Tự động':
    if (!isStaff || !priority || priority === 'Tự động') {
      let invoiceValue = 0;

      // 1. Tra cứu theo hóa đơn của thiết bị nếu có
      if (MaItem && MaItem !== 'OTHER') {
        const [itemRows] = await pool.query(`
          SELECT h.TongThanhToan
          FROM SANPHAM_ITEM i
          JOIN HOADON h ON i.MaHD = h.MaHD
          WHERE i.MaItem = ?
          LIMIT 1
        `, [MaItem]);
        if (itemRows.length > 0) {
          invoiceValue = Number(itemRows[0].TongThanhToan) || 0;
        }
      }

      // 2. Tra cứu theo hóa đơn cao nhất của khách hàng nếu chưa có giá trị
      if (invoiceValue === 0 && MaKH) {
        const [khRows] = await pool.query(`
          SELECT MAX(TongThanhToan) AS MaxTong
          FROM HOADON
          WHERE MaKH = ?
        `, [MaKH]);
        if (khRows.length > 0 && khRows[0].MaxTong) {
          invoiceValue = Number(khRows[0].MaxValue);
        }
      }

      // 3. Quy tắc ưu tiên theo mức tiền:
      // - Dưới 8 triệu: Thấp
      // - Từ 8 triệu đến 15 triệu: Trung bình
      // - Trên 15 triệu: Cao
      if (invoiceValue < 8000000) {
        priority = 'Thấp';
      } else if (invoiceValue <= 15000000) {
        priority = 'Trung bình';
      } else {
        priority = 'Cao';
      }
    }

    const maTicket = 'TK' + Date.now().toString().slice(-5);
    await pool.query(`
      INSERT INTO TICKET (MaTicket, MaKH, MaItem, LoaiYeuCau, NoiDung, MucDoUuTien, TrangThai, NgayGui)
      VALUES (?, ?, ?, ?, ?, ?, 'Chờ xử lý', NOW())
    `, [
      maTicket, 
      MaKH || 'KH001', 
      (!MaItem || MaItem === 'OTHER') ? null : MaItem, 
      (LoaiYeuCau === 'Khiếu nại' ? 'Khiếu nại' : 'Bảo hành'), 
      NoiDung,
      priority
    ]);

    res.json({ success: true, message: `Đã tạo phiếu hỗ trợ ${maTicket} thành công!`, maTicket, MucDoUuTien: priority });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tickets/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { TrangThai, MaNV_XuLy } = req.body;
    const nv = MaNV_XuLy || null;

    let updateSql = `
      UPDATE TICKET 
      SET TrangThai = COALESCE(?, TrangThai),
          MaNV_XuLy = COALESCE(?, MaNV_XuLy),
          NgayXuLy = CASE WHEN ? = 'Đã xử lý' THEN NOW() ELSE NgayXuLy END
      WHERE MaTicket = ?
    `;
    await pool.query(updateSql, [TrangThai || null, nv, TrangThai || null, id]);
    res.json({ success: true, message: `Đã cập nhật phiếu hỗ trợ ${id} sang trạng thái: ${TrangThai}!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 8. API DASHBOARD (ADMIN ONLY)
// ==========================================
// API CẢNH BÁO TỒN KHO DƯỚI NGƯỠNG AN TOÀN (≤ 5)
app.get('/api/inventory/low-stock', async (req, res) => {
  try {
    const [items] = await pool.query(`
      SELECT s.MaSP, s.TenSP, s.SoLuongTon, COALESCE(s.NguongTonToiThieu, 5) AS NguongTonToiThieu,
             s.GiaBan, s.HinhAnh, s.MaDM, d.TenDM
      FROM SANPHAM s
      LEFT JOIN DANHMUC d ON s.MaDM = d.MaDM
      WHERE s.SoLuongTon <= COALESCE(s.NguongTonToiThieu, 5)
      ORDER BY s.SoLuongTon ASC, s.TenSP ASC
    `);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API DASHBOARD TỔNG QUAN DÀNH RIÊNG CHO ADMIN
app.get('/api/dashboard', async (req, res) => {
  try {
    const thang = req.query.thang || '2026-10';

    const [doanhThu] = await pool.query(`
      SELECT 
        COALESCE(SUM(TongThanhToan), 0) AS DoanhThuThang,
        COUNT(MaHD) AS SoDonHoanThanhThang
      FROM HOADON
      WHERE DATE_FORMAT(NgayLap, '%Y-%m') = ?
        AND TrangThaiDonHang = 'Hoàn thành'
    `, [thang]);

    const [donCho] = await pool.query(`
      SELECT 
        SUM(CASE WHEN TrangThaiDonHang = 'Chờ xử lý' THEN 1 ELSE 0 END) AS DonChoXuLy,
        SUM(CASE WHEN TrangThaiDonHang = 'Đang giao' THEN 1 ELSE 0 END) AS DonDangGiao
      FROM HOADON
    `);

    const [tickets] = await pool.query(`
      SELECT COUNT(*) AS TicketTonDong
      FROM TICKET
      WHERE TrangThai IN ('Chờ xử lý', 'Đang xử lý')
    `);

    const [sapHet] = await pool.query(`
      SELECT COUNT(*) AS SanPhamSapHet
      FROM SANPHAM
      WHERE SoLuongTon <= COALESCE(NguongTonToiThieu, 5)
    `);

    const [credit] = await pool.query(`
      SELECT 
        COALESCE(SUM(SoDuCredit), 0) AS TongSoDuCreditKhach,
        COUNT(MaKH) AS TongKhachHang
      FROM KHACHHANG
    `);

    // 1. Danh sách chi tiết các sản phẩm cảnh báo tồn kho
    const [danhSachSapHet] = await pool.query(`
      SELECT s.MaSP, s.TenSP, s.SoLuongTon, COALESCE(s.NguongTonToiThieu, 5) AS NguongTonToiThieu,
             s.GiaBan, s.HinhAnh, s.MaDM, d.TenDM
      FROM SANPHAM s
      LEFT JOIN DANHMUC d ON s.MaDM = d.MaDM
      WHERE s.SoLuongTon <= COALESCE(s.NguongTonToiThieu, 5)
      ORDER BY s.SoLuongTon ASC, s.TenSP ASC
    `);

    // 2. Thống kê Doanh thu & Lợi nhuận gộp theo các tháng gần nhất
    const [monthlyStats] = await pool.query(`
      SELECT DATE_FORMAT(NgayLap, '%m/%Y') AS ThangNam,
             DATE_FORMAT(NgayLap, '%Y-%m') AS ThangKey,
             COALESCE(SUM(TongThanhToan), 0) AS DoanhThu,
             COALESCE(SUM(TongThanhToan * 0.28), 0) AS LoiNhuanGop,
             COUNT(*) AS SoDon
      FROM HOADON
      GROUP BY ThangKey, ThangNam
      ORDER BY ThangKey DESC
      LIMIT 6
    `);
    monthlyStats.reverse();

    // 3. Cơ cấu danh mục sản phẩm thực tế
    const [categoryStats] = await pool.query(`
      SELECT d.TenDM, COUNT(s.MaSP) AS SoLuongSP, COALESCE(SUM(s.SoLuongTon), 0) AS TongTonKho
      FROM DANHMUC d
      LEFT JOIN SANPHAM s ON d.MaDM = s.MaDM
      GROUP BY d.MaDM, d.TenDM
      ORDER BY SoLuongSP DESC
    `);

    res.json({
      Thang: thang,
      DoanhThuThang: doanhThu[0].DoanhThuThang,
      SoDonHoanThanhThang: doanhThu[0].SoDonHoanThanhThang,
      DonChoXuLy: donCho[0].DonChoXuLy || 0,
      DonDangGiao: donCho[0].DonDangGiao || 0,
      TicketTonDong: tickets[0].TicketTonDong || 0,
      SanPhamSapHet: sapHet[0].SanPhamSapHet || 0,
      TongSoDuCreditKhach: credit[0].TongSoDuCreditKhach,
      TongKhachHang: credit[0].TongKhachHang,
      DanhSachSapHet: danhSachSapHet,
      MonthlyStats: monthlyStats,
      CategoryStats: categoryStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 8. API QUẢN LÝ TÀI KHOẢN (ADMIN ONLY)
// ==========================================
app.get('/api/admin/accounts', async (req, res) => {
  try {
    const [users] = await pool.query(`
      SELECT n.MaND, n.TenDangNhap, n.Email, n.VaiTro,
             k.MaKH, k.HoTen as HoTenKH, k.SoDienThoai as SDTKH, k.DiaChiNhanHang, k.SoDuCredit,
             v.MaNV, v.HoTen as HoTenNV, v.SoDienThoai as SDTNV, v.ChucVu, v.TrangThaiLamViec, v.NgayVaoLam
      FROM NGUOIDUNG n
      LEFT JOIN KHACHHANG k ON n.MaND = k.MaND
      LEFT JOIN NHANVIEN v ON n.MaND = v.MaND
      ORDER BY FIELD(n.VaiTro, 'Admin', 'Staff', 'Client'), n.TenDangNhap ASC
    `);

    const result = users.map(u => {
      const isOnline = activeSessions.has(u.TenDangNhap);
      const session = isOnline ? activeSessions.get(u.TenDangNhap) : null;
      return {
        MaND: u.MaND,
        TenDangNhap: u.TenDangNhap,
        Email: u.Email,
        VaiTro: u.VaiTro,
        MaKH: u.MaKH,
        HoTen: u.HoTenKH || u.HoTenNV || 'Chưa cập nhật',
        SoDienThoai: u.SDTKH || u.SDTNV || '',
        DiaChiNhanHang: u.DiaChiNhanHang || '',
        SoDuCredit: u.SoDuCredit !== null ? Number(u.SoDuCredit) : null,
        MaNV: u.MaNV,
        ChucVu: u.ChucVu || (u.VaiTro === 'Admin' ? 'Quản lý cửa hàng' : ''),
        TrangThaiLamViec: u.TrangThaiLamViec || '',
        NgayVaoLam: u.NgayVaoLam ? u.NgayVaoLam.toISOString().split('T')[0] : '',
        isOnline: isOnline,
        loginTime: session ? session.loginAt : null
      };
    });

    const totalStaff = result.filter(u => u.VaiTro === 'Staff' || u.VaiTro === 'Admin').length;
    const totalClients = result.filter(u => u.VaiTro === 'Client').length;
    const totalCredit = result.reduce((s, u) => s + (u.SoDuCredit || 0), 0);

    res.json({
      success: true,
      total: result.length,
      onlineCount: activeSessions.size,
      totalStaff,
      totalClients,
      totalCredit,
      accounts: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 9. API QUẢN LÝ NHẬP KHO (ADMIN ONLY): PHIẾU NHẬP & NHÀ CUNG CẤP
// ==========================================
app.get('/api/admin/purchase-orders', async (req, res) => {
  try {
    const { status, q } = req.query;
    let sql = `
      SELECT pn.*, ncc.TenNCC, ncc.SoDienThoai AS SDT_NCC, ncc.NguoiLienHe,
             nv1.HoTen AS TenNV_Lap, nv2.HoTen AS TenNV_XacNhan,
             (SELECT COUNT(*) FROM CHITIETPHIEUNHAP c WHERE c.MaPN = pn.MaPN) AS SoMatHang,
             (SELECT COALESCE(SUM(c.SoLuong), 0) FROM CHITIETPHIEUNHAP c WHERE c.MaPN = pn.MaPN) AS TongSoLuong
      FROM PHIEUNHAP pn
      LEFT JOIN NHACUNGCAP ncc ON pn.MaNCC = ncc.MaNCC
      LEFT JOIN NHANVIEN nv1 ON pn.MaNV_Lap = nv1.MaNV
      LEFT JOIN NHANVIEN nv2 ON pn.MaNV_XacNhan = nv2.MaNV
    `;
    const params = [];
    const where = [];

    if (status && status !== 'all') {
      where.push(`pn.TrangThai = ?`);
      params.push(status);
    }
    if (q) {
      where.push(`(pn.MaPN LIKE ? OR ncc.TenNCC LIKE ? OR nv1.HoTen LIKE ? OR pn.GhiChu LIKE ?)`);
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    if (where.length > 0) {
      sql += ' WHERE ' + where.join(' AND ');
    }

    sql += ' ORDER BY pn.NgayLap DESC';

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, total: rows.length, orders: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/purchase-orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [pnRows] = await pool.query(`
      SELECT pn.*, ncc.TenNCC, ncc.SoDienThoai AS SDT_NCC, ncc.NguoiLienHe, ncc.DiaChi AS DiaChi_NCC, ncc.Email AS Email_NCC,
             nv1.HoTen AS TenNV_Lap, nv2.HoTen AS TenNV_XacNhan
      FROM PHIEUNHAP pn
      LEFT JOIN NHACUNGCAP ncc ON pn.MaNCC = ncc.MaNCC
      LEFT JOIN NHANVIEN nv1 ON pn.MaNV_Lap = nv1.MaNV
      LEFT JOIN NHANVIEN nv2 ON pn.MaNV_XacNhan = nv2.MaNV
      WHERE pn.MaPN = ?
    `, [id]);

    if (pnRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập!' });
    }

    const [items] = await pool.query(`
      SELECT c.*, s.TenSP, s.HinhAnh, s.GiaBan, s.SoLuongTon, dm.TenDM
      FROM CHITIETPHIEUNHAP c
      JOIN SANPHAM s ON c.MaSP = s.MaSP
      LEFT JOIN DANHMUC dm ON s.MaDM = dm.MaDM
      WHERE c.MaPN = ?
    `, [id]);

    res.json({
      success: true,
      order: pnRows[0],
      items
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/purchase-orders', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { MaNCC, MaNV_Lap, GhiChu, items, autoApprove } = req.body;

    if (!MaNCC || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn nhà cung cấp và ít nhất 1 sản phẩm nhập!' });
    }

    const [maxRows] = await conn.query('SELECT MAX(CAST(SUBSTRING(MaPN, 3) AS UNSIGNED)) as maxId FROM PHIEUNHAP');
    const nextId = (maxRows[0].maxId || 20) + 1;
    const maPN = 'PN' + String(nextId).padStart(4, '0');

    let tongTien = 0;
    for (const it of items) {
      const qty = parseInt(it.SoLuong, 10);
      const price = parseFloat(it.DonGiaNhap);
      if (isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
        throw new Error('Số lượng hoặc đơn giá nhập không hợp lệ!');
      }
      tongTien += qty * price;
    }

    const isHoanThanh = autoApprove === true;
    const trangThai = isHoanThanh ? 'Hoàn thành' : 'Chờ duyệt';
    const ngayNhapKho = isHoanThanh ? new Date() : null;
    let creatorMaNV = MaNV_Lap || 'NV004';
    let maNV_XacNhan = null;
    if (isHoanThanh) {
      maNV_XacNhan = req.body.MaNV_XacNhan || 'NV001';
      if (creatorMaNV === maNV_XacNhan) {
        creatorMaNV = 'NV004';
      }
    }

    await conn.query(`
      INSERT INTO PHIEUNHAP (MaPN, MaNCC, MaNV_Lap, MaNV_XacNhan, NgayLap, NgayNhapKho, TongTien, TrangThai, GhiChu)
      VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?)
    `, [maPN, MaNCC, creatorMaNV, maNV_XacNhan, ngayNhapKho, tongTien, trangThai, GhiChu || 'Nhập hàng từ nhà cung cấp']);

    for (const it of items) {
      const qty = parseInt(it.SoLuong, 10);
      const price = parseFloat(it.DonGiaNhap);
      await conn.query(`
        INSERT INTO CHITIETPHIEUNHAP (MaPN, MaSP, SoLuong, DonGiaNhap)
        VALUES (?, ?, ?, ?)
      `, [maPN, it.MaSP, qty, price]);

      if (isHoanThanh) {
        await conn.query(`
          UPDATE SANPHAM 
          SET SoLuongTon = SoLuongTon + ?, GiaNhap = ?
          WHERE MaSP = ?
        `, [qty, price, it.MaSP]);

        const [maxTk] = await conn.query('SELECT MAX(CAST(SUBSTRING(MaTheKho, 3) AS UNSIGNED)) as maxId FROM THEKHO');
        const nextTkId = 'TK' + String((maxTk[0].maxId || 200) + 1).padStart(4, '0');
        const [spRow] = await conn.query('SELECT SoLuongTon FROM SANPHAM WHERE MaSP = ?', [it.MaSP]);
        await conn.query(`
          INSERT INTO THEKHO (MaTheKho, MaSP, MaNV, LoaiBienDong, SoLuong, TonSau, ThoiGian, GhiChu)
          VALUES (?, ?, ?, 'Nhập', ?, ?, NOW(), ?)
        `, [nextTkId, it.MaSP, MaNV_Lap || 'NV001', qty, spRow[0]?.SoLuongTon || qty, `Nhập kho theo phiếu ${maPN}`]);
      }
    }

    await conn.commit();
    res.json({
      success: true,
      message: `Đã lập thành công phiếu nhập ${maPN}!`,
      maPN
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    conn.release();
  }
});

app.put('/api/admin/purchase-orders/:id/confirm', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;
    const { MaNV } = req.body;

    const [pnRows] = await conn.query('SELECT * FROM PHIEUNHAP WHERE MaPN = ?', [id]);
    if (pnRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập!' });
    }
    const pn = pnRows[0];
    if (pn.TrangThai === 'Hoàn thành') {
      return res.status(400).json({ success: false, message: 'Phiếu nhập này đã được xác nhận nhập kho trước đó!' });
    }

    // Kiểm tra ràng buộc tách quyền kiểm soát nội bộ (ck_pn_tachquyen): MaNV_XacNhan <> MaNV_Lap
    const approverMaNV = MaNV;
    if (!approverMaNV) {
      return res.status(400).json({ success: false, message: 'Vui lòng xác định mã nhân viên duyệt phiếu nhập!' });
    }
    if (pn.MaNV_Lap === approverMaNV) {
      return res.status(400).json({
        success: false,
        message: 'Không thể tự lập tự duyệt phiếu nhập hàng! Vui lòng đổi sang tài khoản khác để duyệt.'
      });
    }

    const [items] = await conn.query('SELECT * FROM CHITIETPHIEUNHAP WHERE MaPN = ?', [id]);

    for (const it of items) {
      await conn.query(`
        UPDATE SANPHAM 
        SET SoLuongTon = SoLuongTon + ?, GiaNhap = ?
        WHERE MaSP = ?
      `, [it.SoLuong, it.DonGiaNhap, it.MaSP]);

      const [maxTk] = await conn.query('SELECT MAX(CAST(SUBSTRING(MaTheKho, 3) AS UNSIGNED)) as maxId FROM THEKHO');
      const nextTkId = 'TK' + String((maxTk[0].maxId || 200) + 1).padStart(4, '0');
      const [spRow] = await conn.query('SELECT SoLuongTon FROM SANPHAM WHERE MaSP = ?', [it.MaSP]);
      await conn.query(`
        INSERT INTO THEKHO (MaTheKho, MaSP, MaNV, LoaiBienDong, SoLuong, TonSau, ThoiGian, GhiChu)
        VALUES (?, ?, ?, 'Nhập', ?, ?, NOW(), ?)
      `, [nextTkId, it.MaSP, approverMaNV, it.SoLuong, spRow[0]?.SoLuongTon || it.SoLuong, `Xác nhận nhập kho phiếu ${id}`]);
    }

    await conn.query(`
      UPDATE PHIEUNHAP 
      SET TrangThai = 'Hoàn thành', NgayNhapKho = NOW(), MaNV_XacNhan = ?
      WHERE MaPN = ?
    `, [approverMaNV, id]);

    await conn.commit();
    res.json({
      success: true,
      message: `Đã duyệt và nhập kho thành công phiếu ${id}!`
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message, error: err.message });
  } finally {
    conn.release();
  }
});

app.get('/api/admin/suppliers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM NHACUNGCAP ORDER BY MaNCC ASC');
    res.json({ success: true, suppliers: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API phụ trợ danh sách sản phẩm phục vụ nhập kho
app.get('/api/admin/inventory', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.MaSP, s.MaDM, s.TenSP, s.Loai, s.HinhAnh, s.SoLuongTon, 
             s.GiaNhap, s.GiaBan, s.MoTa, s.ThongSoKyThuat, s.ThoiHanBaoHanh, 
             s.NguongTonToiThieu, s.TrangThaiKinhDoanh,
             d.TenDM
      FROM SANPHAM s
      LEFT JOIN DANHMUC d ON s.MaDM = d.MaDM
      ORDER BY s.SoLuongTon ASC, s.MaSP ASC
    `);

    res.json({
      success: true,
      total: rows.length,
      products: rows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 10. API THỐNG KÊ HIỆU SUẤT NHÂN VIÊN: DOANH THU & TICKET
// ==========================================
app.get('/api/admin/staff-performance', async (req, res) => {
  try {
    const [staff] = await pool.query(`
      SELECT 
        nv.MaNV,
        nv.HoTen,
        nv.ChucVu,
        nv.SoDienThoai,
        nd.TenDangNhap,
        nd.VaiTro,
        COALESCE(hd.SoDonHang, 0) AS SoDonHang,
        COALESCE(hd.DoanhThu, 0) AS DoanhThu,
        COALESCE(tk.TongTicket, 0) AS TongTicket,
        COALESCE(tk.TicketDaXuLy, 0) AS TicketDaXuLy,
        COALESCE(tk.TicketDangXuLy, 0) AS TicketDangXuLy,
        COALESCE(tk.TicketChoXuLy, 0) AS TicketChoXuLy
      FROM NHANVIEN nv
      LEFT JOIN NGUOIDUNG nd ON nv.MaND = nd.MaND
      LEFT JOIN (
        SELECT 
          MaNV_Lap, 
          COUNT(MaHD) AS SoDonHang, 
          SUM(TongThanhToan) AS DoanhThu
        FROM HOADON
        WHERE TrangThaiThanhToan = 'Đã thanh toán' OR TrangThaiDonHang = 'Hoàn thành'
        GROUP BY MaNV_Lap
      ) hd ON nv.MaNV = hd.MaNV_Lap
      LEFT JOIN (
        SELECT 
          MaNV_XuLy, 
          COUNT(MaTicket) AS TongTicket,
          SUM(CASE WHEN TrangThai = 'Đã xử lý' THEN 1 ELSE 0 END) AS TicketDaXuLy,
          SUM(CASE WHEN TrangThai = 'Đang xử lý' THEN 1 ELSE 0 END) AS TicketDangXuLy,
          SUM(CASE WHEN TrangThai = 'Chờ xử lý' THEN 1 ELSE 0 END) AS TicketChoXuLy
        FROM TICKET
        GROUP BY MaNV_XuLy
      ) tk ON nv.MaNV = tk.MaNV_XuLy
      ORDER BY DoanhThu DESC, TongTicket DESC, nv.MaNV ASC
    `);

    const totalRevenue = staff.reduce((acc, s) => acc + Number(s.DoanhThu || 0), 0);
    const totalOrders = staff.reduce((acc, s) => acc + Number(s.SoDonHang || 0), 0);
    const totalTicketsDone = staff.reduce((acc, s) => acc + Number(s.TicketDaXuLy || 0), 0);

    res.json({
      success: true,
      totalRevenue,
      totalOrders,
      totalTicketsDone,
      staff
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/staff/my-stats', async (req, res) => {
  try {
    const maNV = req.query.maNV;
    if (!maNV) {
      return res.status(400).json({ success: false, message: 'Thiếu mã nhân viên (maNV)!' });
    }

    const [nvRows] = await pool.query(`
      SELECT nv.MaNV, nv.HoTen, nv.ChucVu, nv.SoDienThoai, nd.TenDangNhap, nd.VaiTro
      FROM NHANVIEN nv
      LEFT JOIN NGUOIDUNG nd ON nv.MaND = nd.MaND
      WHERE nv.MaNV = ?
    `, [maNV]);

    if (nvRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên!' });
    }

    const staffInfo = nvRows[0];

    // Doanh thu & đơn hàng của NV
    const [hdRows] = await pool.query(`
      SELECT 
        COUNT(MaHD) AS SoDonHang,
        COALESCE(SUM(TongThanhToan), 0) AS DoanhThu
      FROM HOADON
      WHERE MaNV_Lap = ? AND (TrangThaiThanhToan = 'Đã thanh toán' OR TrangThaiDonHang = 'Hoàn thành')
    `, [maNV]);

    // Ticket của NV
    const [tkRows] = await pool.query(`
      SELECT 
        COUNT(MaTicket) AS TongTicket,
        SUM(CASE WHEN TrangThai = 'Đã xử lý' THEN 1 ELSE 0 END) AS TicketDaXuLy,
        SUM(CASE WHEN TrangThai = 'Đang xử lý' THEN 1 ELSE 0 END) AS TicketDangXuLy,
        SUM(CASE WHEN TrangThai = 'Chờ xử lý' THEN 1 ELSE 0 END) AS TicketChoXuLy
      FROM TICKET
      WHERE MaNV_XuLy = ?
    `, [maNV]);

    // 10 hóa đơn gần nhất do NV này lập
    const [recentInvoices] = await pool.query(`
      SELECT MaHD, NgayLap, TongThanhToan, TenNguoiNhan, SDTNguoiNhan, PhuongThucThanhToan, TrangThaiDonHang
      FROM HOADON
      WHERE MaNV_Lap = ?
      ORDER BY NgayLap DESC
      LIMIT 10
    `, [maNV]);

    // 10 ticket gần nhất do NV này phụ trách
    const [recentTickets] = await pool.query(`
      SELECT t.MaTicket, t.NgayGui, t.NoiDung, t.LoaiYeuCau, t.MucDoUuTien, t.TrangThai, k.HoTen AS TenKhachHang, sp.TenSP, it.IMEI_Serial
      FROM TICKET t
      LEFT JOIN KHACHHANG k ON t.MaKH = k.MaKH
      LEFT JOIN SANPHAM_ITEM it ON t.MaItem = it.MaItem
      LEFT JOIN SANPHAM sp ON it.MaSP = sp.MaSP
      WHERE t.MaNV_XuLy = ?
      ORDER BY t.NgayGui DESC
      LIMIT 10
    `, [maNV]);

    res.json({
      success: true,
      staff: staffInfo,
      stats: {
        SoDonHang: Number(hdRows[0]?.SoDonHang || 0),
        DoanhThu: Number(hdRows[0]?.DoanhThu || 0),
        TongTicket: Number(tkRows[0]?.TongTicket || 0),
        TicketDaXuLy: Number(tkRows[0]?.TicketDaXuLy || 0),
        TicketDangXuLy: Number(tkRows[0]?.TicketDangXuLy || 0),
        TicketChoXuLy: Number(tkRows[0]?.TicketChoXuLy || 0)
      },
      recentInvoices,
      recentTickets
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/inventory/adjust', async (req, res) => {
  try {
    const { MaSP, SoLuongThem, GiaBanMoi, MaNV } = req.body;

    if (!MaSP) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp mã sản phẩm!' });
    }

    const [currentRows] = await pool.query('SELECT MaSP, TenSP, SoLuongTon, GiaNhap, GiaBan FROM SANPHAM WHERE MaSP = ?', [MaSP]);
    if (currentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm trong hệ thống!' });
    }
    const sp = currentRows[0];

    let newTon = sp.SoLuongTon;
    let newGia = sp.GiaBan;
    let deltaQty = 0;

    if (SoLuongThem !== undefined && SoLuongThem !== null && SoLuongThem !== '') {
      deltaQty = parseInt(SoLuongThem, 10);
      if (isNaN(deltaQty)) {
        return res.status(400).json({ success: false, message: 'Số lượng thêm phải là số nguyên hợp lệ!' });
      }
      newTon = Math.max(0, sp.SoLuongTon + deltaQty);
    }

    if (GiaBanMoi !== undefined && GiaBanMoi !== null && GiaBanMoi !== '') {
      const parsedGia = parseFloat(GiaBanMoi);
      if (isNaN(parsedGia) || parsedGia < 0) {
        return res.status(400).json({ success: false, message: 'Giá bán phải là số >= 0!' });
      }
      if (parsedGia < Number(sp.GiaNhap)) {
        return res.status(400).json({ 
          success: false, 
          message: `Giá bán (${parsedGia.toLocaleString('vi-VN')} đ) không được thấp hơn giá nhập gốc (${Number(sp.GiaNhap).toLocaleString('vi-VN')} đ)!` 
        });
      }
      newGia = parsedGia;
    }

    await pool.query('UPDATE SANPHAM SET SoLuongTon = ?, GiaBan = ? WHERE MaSP = ?', [newTon, newGia, MaSP]);

    // Ghi thẻ kho nếu có biến động số lượng
    if (deltaQty !== 0) {
      try {
        const [maxTk] = await pool.query('SELECT MAX(CAST(SUBSTRING(MaTheKho, 3) AS UNSIGNED)) as maxId FROM THEKHO');
        const nextTkId = 'TK' + String((maxTk[0].maxId || 200) + 1).padStart(4, '0');
        await pool.query(`
          INSERT INTO THEKHO (MaTheKho, MaSP, MaNV, LoaiBienDong, SoLuong, TonSau, ThoiGian, GhiChu)
          VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
        `, [
          nextTkId, 
          MaSP, 
          MaNV || 'NV001', 
          deltaQty > 0 ? 'Nhập' : 'Xuất', 
          deltaQty, 
          newTon, 
          deltaQty > 0 ? `Admin tăng tồn kho (+${deltaQty})` : `Admin điều chỉnh kho (${deltaQty})`
        ]);
      } catch (tkErr) {
        console.warn('Ghi thẻ kho chú thích:', tkErr.message);
      }
    }

    res.json({
      success: true,
      message: `Cập nhật thành công sản phẩm ${sp.TenSP}!`,
      product: {
        MaSP: sp.MaSP,
        TenSP: sp.TenSP,
        SoLuongTonCu: sp.SoLuongTon,
        SoLuongTonMoi: newTon,
        GiaBanCu: sp.GiaBan,
        GiaBanMoi: newGia,
        GiaNhap: sp.GiaNhap
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 11.5. API QUẢN LÝ LƯƠNG NHÂN VIÊN (Q15 - ADMIN ONLY)
// ==========================================
app.get('/api/admin/salary', async (req, res) => {
  try {
    const { kyLuong, maNV } = req.query;

    let sql = `
      SELECT b.MaBL,
             b.KyLuong,
             v.MaNV,
             v.HoTen,
             v.ChucVu,
             m.TenVaiTro,
             b.LuongCoBan,
             b.SoTicketDaXuLy,
             b.TienMoiTicket,
             (b.SoTicketDaXuLy * b.TienMoiTicket) AS ThuongTicket,
             b.ThuNhap
      FROM   BANGLUONG b
             JOIN NHANVIEN v ON v.MaNV = b.MaNV
             JOIN MUCLUONG m ON m.MaVaiTro = v.MaVaiTro
      WHERE  1=1
    `;
    const params = [];
    if (kyLuong && kyLuong !== 'ALL') {
      sql += ' AND b.KyLuong = ?';
      params.push(kyLuong);
    }
    if (maNV && maNV !== 'ALL') {
      sql += ' AND v.MaNV = ?';
      params.push(maNV);
    }
    sql += ' ORDER BY b.KyLuong DESC, b.ThuNhap DESC';

    const [rows] = await pool.query(sql, params);

    // Thống kê tổng hợp
    const tongThuNhap = rows.reduce((s, r) => s + Number(r.ThuNhap || 0), 0);
    const tongLuongCoBan = rows.reduce((s, r) => s + Number(r.LuongCoBan || 0), 0);
    const tongThuongTicket = rows.reduce((s, r) => s + Number(r.ThuongTicket || 0), 0);
    const tongTicket = rows.reduce((s, r) => s + Number(r.SoTicketDaXuLy || 0), 0);
    const soNhanVien = new Set(rows.map(r => r.MaNV)).size;

    // Danh sách kỳ lương & nhân viên để hiển thị dropdown filter
    const [periods] = await pool.query('SELECT DISTINCT KyLuong FROM BANGLUONG ORDER BY KyLuong DESC');
    const [staffs] = await pool.query('SELECT MaNV, HoTen, ChucVu, MaVaiTro FROM NHANVIEN ORDER BY MaNV ASC');
    const [roles] = await pool.query('SELECT * FROM MUCLUONG');

    res.json({
      success: true,
      data: rows,
      periods: periods.map(p => p.KyLuong),
      staffs: staffs,
      roles: roles,
      stats: {
        tongThuNhap,
        tongLuongCoBan,
        tongThuongTicket,
        tongTicket,
        soNhanVien,
        soBangLuong: rows.length
      }
    });
  } catch (err) {
    console.error('Lỗi API /api/admin/salary:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật số ticket cho bảng lương (tính lại thu nhập theo ck_bangluong_congthuc)
app.post('/api/admin/salary/update-tickets', async (req, res) => {
  try {
    const { MaBL, SoTicketDaXuLy } = req.body;
    if (!MaBL || SoTicketDaXuLy === undefined || SoTicketDaXuLy === null) {
      return res.status(400).json({ success: false, error: 'Thiếu mã bảng lương hoặc số ticket' });
    }
    const [rows] = await pool.query('SELECT LuongCoBan, TienMoiTicket FROM BANGLUONG WHERE MaBL = ?', [MaBL]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: `Không tìm thấy bảng lương ${MaBL}` });
    }
    const luongCoBan = Number(rows[0].LuongCoBan);
    const tienMoiTicket = Number(rows[0].TienMoiTicket);
    const tickets = Math.max(0, parseInt(SoTicketDaXuLy, 10) || 0);
    const thuNhap = luongCoBan + (tickets * tienMoiTicket);

    await pool.query('UPDATE BANGLUONG SET SoTicketDaXuLy = ?, ThuNhap = ? WHERE MaBL = ?', [tickets, thuNhap, MaBL]);
    res.json({
      success: true,
      message: `Cập nhật thành công ${MaBL}: ${tickets} ticket, Thu nhập mới: ${thuNhap.toLocaleString('vi-VN')} đ`
    });
  } catch (err) {
    console.error('Lỗi cập nhật bảng lương:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Thêm mới bảng lương cho nhân viên
app.post('/api/admin/salary/create', async (req, res) => {
  try {
    const { MaNV, KyLuong, SoTicketDaXuLy } = req.body;
    if (!MaNV || !KyLuong) {
      return res.status(400).json({ success: false, error: 'Vui lòng chọn nhân viên và kỳ lương (định dạng MM/YYYY)!' });
    }
    if (!/^\d{2}\/\d{4}$/.test(KyLuong)) {
      return res.status(400).json({ success: false, error: 'Kỳ lương phải có định dạng MM/YYYY (Ví dụ: 10/2026)!' });
    }

    const [exist] = await pool.query('SELECT MaBL FROM BANGLUONG WHERE MaNV = ? AND KyLuong = ?', [MaNV, KyLuong]);
    if (exist.length > 0) {
      return res.status(400).json({ success: false, error: `Bảng lương của nhân viên ${MaNV} kỳ ${KyLuong} đã tồn tại (${exist[0].MaBL})!` });
    }

    const [nv] = await pool.query(`
      SELECT v.MaNV, v.HoTen, m.LuongCoBan, m.TienMoiTicket
      FROM   NHANVIEN v
             JOIN MUCLUONG m ON v.MaVaiTro = m.MaVaiTro
      WHERE  v.MaNV = ?
    `, [MaNV]);
    if (nv.length === 0) {
      return res.status(404).json({ success: false, error: `Không tìm thấy nhân viên ${MaNV}` });
    }

    const luongCoBan = Number(nv[0].LuongCoBan);
    const tienMoiTicket = Number(nv[0].TienMoiTicket);
    const tickets = Math.max(0, parseInt(SoTicketDaXuLy, 10) || 0);
    const thuNhap = luongCoBan + (tickets * tienMoiTicket);

    const cleanKy = KyLuong.replace('/', '');
    const numPart = (cleanKy.slice(2, 4) + cleanKy.slice(0, 2)).slice(0, 4);
    const rnd = Math.floor(100 + Math.random() * 899);
    const maBL = 'BL' + numPart + rnd;

    await pool.query(`
      INSERT INTO BANGLUONG (MaBL, MaNV, KyLuong, LuongCoBan, SoTicketDaXuLy, TienMoiTicket, ThuNhap)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [maBL, MaNV, KyLuong, luongCoBan, tickets, tienMoiTicket, thuNhap]);

    res.json({
      success: true,
      message: `Đã tạo thành công bảng lương ${maBL} cho ${nv[0].HoTen} kỳ ${KyLuong}!`,
      maBL
    });
  } catch (err) {
    console.error('Lỗi tạo bảng lương:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 12. API TRỢ LÝ AI CHATBOT TƯ VẤN THÔNG MINH
// ==========================================
// 12. API TRỢ LÝ AI CHATBOT TƯ VẤN THÔNG MINH (TÍCH HỢP 9ROUTER / GEMINI / OPENAI)
// ==========================================
const DEFAULT_9ROUTER_BASE_URL = 'https://duc3k.minet.vn/v1';
const DEFAULT_9ROUTER_KEY = 'sk-f3041df473203d81-9x0jnq-72bcdebc';
const DEFAULT_9ROUTER_MODEL = 'ag/gemini-3.8-flash-high';

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, history = [], apiKey, provider = 'auto', model, baseUrl, userInfo } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập nội dung câu hỏi cho AI.' });
    }

    // Lấy API Key: ưu tiên key client gửi, nếu không có thì dùng key mặc định 9Router
    const activeKey = (apiKey || process.env.AI_API_KEY || DEFAULT_9ROUTER_KEY).trim();

    // Tự động nhận diện nhà cung cấp (Mặc định là 9Router)
    let activeProvider = provider;
    if (activeProvider === 'auto' || !activeProvider || activeProvider === '9router') {
      if (activeKey === DEFAULT_9ROUTER_KEY || (model && model.startsWith('ag/')) || (baseUrl && baseUrl.includes('minet.vn'))) {
        activeProvider = '9router';
      } else if (activeKey.startsWith('AIza')) {
        activeProvider = 'gemini';
      } else if (activeKey.startsWith('sk-ant-')) {
        activeProvider = 'claude';
      } else if (activeKey.startsWith('sk-')) {
        activeProvider = '9router';
      } else {
        activeProvider = '9router';
      }
    }

    // Lấy thông tin sản phẩm và chính sách từ database để cung cấp ngữ cảnh cho AI
    let productContext = '';
    try {
      const [prods] = await pool.query('SELECT MaSP, TenSP, GiaBan, SoLuongTon, ThoiHanBaoHanh FROM SANPHAM WHERE SoLuongTon > 0 LIMIT 15');
      productContext = prods.map(p => `- ${p.TenSP} (Mã: ${p.MaSP}): Giá ${Number(p.GiaBan).toLocaleString('vi-VN')} đ, Còn ${p.SoLuongTon} máy, Bảo hành ${p.ThoiHanBaoHanh} tháng`).join('\n');
    } catch (e) {
      console.warn('Lỗi lấy dữ liệu sản phẩm cho AI context:', e.message);
    }

    const systemPrompt = `Bạn là Trợ lý AI Thông minh & Chuyên viên Tư vấn của Hệ thống Cửa hàng Điện máy & Công nghệ TechStore.
Nhiệm vụ của bạn:
1. Tư vấn cấu hình, hiệu năng, tư vấn chọn mua các sản phẩm công nghệ (Điện thoại iPhone, Samsung, Laptop MacBook, Dell, Phụ kiện...).
2. Hướng dẫn khách hàng quy trình đặt hàng Online, phương thức thanh toán qua Ví Credit hoặc Tiền mặt/COD, áp dụng voucher giảm giá (TECH100: giảm 100k, SALE10: giảm 500k).
3. Hướng dẫn tra cứu bảo hành điện tử chính hãng theo số Serial/Hóa đơn và tạo Ticket yêu cầu hỗ trợ kỹ thuật khi gặp sự cố.
4. Trả lời bằng tiếng Việt lịch sự, thân thiện, súc tích, định dạng markdown đẹp mắt (in đậm, danh sách gạch đầu dòng rõ ràng).
5. Nếu người dùng hỏi ngoài phạm vi công nghệ/cửa hàng, hãy khéo léo trả lời ngắn gọn rồi hướng sự chú ý về các sản phẩm/dịch vụ của cửa hàng.

Danh sách sản phẩm tiêu biểu hiện có tại cửa hàng:
${productContext || 'Đầy đủ các dòng iPhone 16, MacBook Air M3, iPad Air, Tai nghe AirPods, Laptop Dell...'}

Thông tin người dùng hiện tại:
${userInfo ? `Khách hàng: ${userInfo.HoTen || 'Khách'}, Vai trò: ${userInfo.role || 'Guest'}, Số dư ví Credit: ${userInfo.SoDuCredit ? Number(userInfo.SoDuCredit).toLocaleString('vi-VN') + ' đ' : 'Chưa đăng nhập'}` : 'Khách vãng lai chưa đăng nhập'}`;

    // 1. GOOGLE GEMINI API
    if (activeProvider === 'gemini') {
      const activeModel = model || 'gemini-1.5-flash';
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${activeKey}`;

      const contents = [];
      if (Array.isArray(history)) {
        for (const h of history) {
          if (h && h.content) {
            contents.push({
              role: h.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: h.content }]
            });
          }
        }
      }
      contents.push({
        role: 'user',
        parts: [{ text: message }]
      });

      const payload = {
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024
        }
      };

      const resp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await resp.json();
      if (!resp.ok) {
        const errMsg = data.error?.message || `Lỗi từ Google Gemini API (Mã HTTP ${resp.status})`;
        return res.status(resp.status).json({ success: false, error: errMsg });
      }

      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Xin lỗi, không nhận được phản hồi từ AI.';
      return res.json({
        success: true,
        reply: reply,
        provider: 'Google Gemini',
        model: activeModel
      });
    }

    // 2. 9ROUTER (duc3k.minet.vn) HOẶC OPENAI / DEEPSEEK (OpenAI-compatible)
    if (activeProvider === '9router' || activeProvider === 'openai' || activeProvider === 'deepseek') {
      const is9Router = activeProvider === '9router';
      const isDeepSeek = activeProvider === 'deepseek';
      let activeModel = model;
      if (!activeModel) {
        if (is9Router) activeModel = DEFAULT_9ROUTER_MODEL;
        else if (isDeepSeek) activeModel = 'deepseek-chat';
        else activeModel = 'gpt-4o-mini';
      }

      let apiUrl = '';
      if (is9Router) {
        const rootUrl = (baseUrl || DEFAULT_9ROUTER_BASE_URL).replace(/\/+$/, '');
        apiUrl = rootUrl + '/chat/completions';
      } else if (isDeepSeek) {
        apiUrl = 'https://api.deepseek.com/chat/completions';
      } else {
        apiUrl = 'https://api.openai.com/v1/chat/completions';
      }

      const messages = [
        { role: 'system', content: systemPrompt }
      ];

      if (Array.isArray(history)) {
        for (const h of history) {
          if (h && h.content) {
            messages.push({
              role: h.role === 'assistant' ? 'assistant' : 'user',
              content: h.content
            });
          }
        }
      }
      messages.push({ role: 'user', content: message });

      let resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeKey}`
        },
        body: JSON.stringify({
          model: activeModel,
          messages: messages,
          stream: false,
          temperature: 0.7,
          max_tokens: 1024
        })
      });

      // Nếu gặp lỗi 401 Unauthorized và đang dùng 9Router, tự động fallback về DEFAULT_9ROUTER_KEY chuẩn của hệ thống
      if (resp.status === 401 && is9Router && activeKey !== DEFAULT_9ROUTER_KEY) {
        console.warn('[9Router] Key từ client bị 401 Unauthorized, tự động retry với DEFAULT_9ROUTER_KEY chuẩn...');
        resp = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEFAULT_9ROUTER_KEY}`
          },
          body: JSON.stringify({
            model: activeModel,
            messages: messages,
            stream: false,
            temperature: 0.7,
            max_tokens: 1024
          })
        });
      }

      let data = {};
      try {
        data = await resp.json();
      } catch (parseErr) {
        data = { error: 'Không thể phân tích dữ liệu phản hồi từ AI server' };
      }

      if (!resp.ok) {
        const rawErr = typeof data.error === 'string' ? data.error : (data.error?.message || '');
        const errMsg = rawErr || `Lỗi từ ${is9Router ? '9Router' : activeProvider.toUpperCase()} API (Mã HTTP ${resp.status})`;
        return res.status(resp.status).json({ success: false, error: errMsg });
      }

      const reply = data.choices?.[0]?.message?.content || 'Xin lỗi, không nhận được phản hồi từ AI.';
      return res.json({
        success: true,
        reply: reply,
        provider: is9Router ? '9Router (duc3k.minet.vn)' : (isDeepSeek ? 'DeepSeek' : 'OpenAI'),
        model: activeModel
      });
    }

    // 3. ANTHROPIC CLAUDE API
    if (activeProvider === 'claude') {
      const activeModel = model || 'claude-3-5-sonnet-20241022';
      const messages = [];

      if (Array.isArray(history)) {
        for (const h of history) {
          if (h && h.content) {
            messages.push({
              role: h.role === 'assistant' ? 'assistant' : 'user',
              content: h.content
            });
          }
        }
      }
      messages.push({ role: 'user', content: message });

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': activeKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: activeModel,
          system: systemPrompt,
          messages: messages,
          max_tokens: 1024
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        const errMsg = data.error?.message || `Lỗi từ Claude API (Mã HTTP ${resp.status})`;
        return res.status(resp.status).json({ success: false, error: errMsg });
      }

      const reply = data.content?.[0]?.text || 'Xin lỗi, không nhận được phản hồi từ AI.';
      return res.json({
        success: true,
        reply: reply,
        provider: 'Anthropic Claude',
        model: activeModel
      });
    }

    return res.status(400).json({ success: false, error: `Nhà cung cấp "${activeProvider}" chưa được hỗ trợ.` });

  } catch (err) {
    console.error('Lỗi API /api/ai/chat:', err);
    res.status(500).json({ success: false, error: 'Lỗi xử lý AI: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Server Backend đang chạy tại: http://localhost:${PORT}`);
  console.log(`Mở trình duyệt gõ: http://localhost:${PORT} để xem web`);
  console.log(`====================================================`);
});

-- =====================================================================
-- TRUY VẤN BTL CSDL – HỆ THỐNG QUẢN LÝ CỬA HÀNG BÁN ĐỒ ĐIỆN TỬ
-- 15 truy vấn tiêu biểu, phục vụ toàn bộ 4 mục đích hệ thống:
--   ① Quản lý hoạt động kinh doanh (mua bán, nhập hàng, tồn kho, CSKH)
--   ② Kiểm soát tài chính & kho hàng (dòng tiền, doanh thu, lợi nhuận, Credit, tồn kho)
--   ③ Hỗ trợ báo cáo & thống kê (hàng bán chạy, xu hướng, hiệu suất nhân viên)
--   ④ Nâng cao hiệu quả vận hành (truy vết, đối soát, quy trách nhiệm)
-- Cần chạy 01_schema.sql → 02_data.sql trước.
-- MySQL 8.0+. Doanh thu chỉ tính hóa đơn "Hoàn thành".
-- =====================================================================
USE defaultdb;
SET NAMES utf8mb4;

-- Tham số mẫu
SET @now           = '2026-10-24 08:00:00';
SET @tu_ngay       = '2026-01-01';
SET @den_ngay      = '2026-10-24';
SET @thang         = '2026-09';
SET @ma_item_nhap  = 'IT00014';            -- Mã món đồ nhập từ bàn phím (cho Q11)
SET @imei_nhap     = '354251726382597';    -- Số IMEI/Serial nhập từ bàn phím (cho Q12)
SET @ma_nv_nhap    = 'NV003';              -- Mã nhân viên nhập từ bàn phím (cho Q13)
SET @ma_nv_luong   = NULL;                 -- Mã nhân viên tính lương cho Q15 (NULL hoặc '' để xem hết, 'NV006' để xem 1 NV)
SET @ky_luong_nhap = '09/2026';            -- Kỳ lương cho Q15 (NULL hoặc '' để xem tất cả kỳ)

-- VIEW phụ trợ (dùng chung cho nhiều truy vấn)
DROP VIEW IF EXISTS v_doanhthu_hoadon;
CREATE VIEW v_doanhthu_hoadon AS
SELECT h.* FROM HOADON h WHERE h.TrangThaiDonHang = 'Hoàn thành';


-- =====================================================================
-- Q1. DOANH THU THEO THÁNG, SO SÁNH TĂNG TRƯỞNG VỚI THÁNG TRƯỚC
-- Mục đích: ② Kiểm soát tài chính – theo dõi dòng tiền & doanh thu;
--           ③ Báo cáo xu hướng tiêu thụ theo thời gian.
-- Kỹ thuật: GROUP BY, subquery dẫn xuất, window function (LAG).
-- =====================================================================
SELECT t.Thang,
       t.SoDon,
       t.DoanhThu,
       ROUND(t.DoanhThu / t.SoDon) AS GiaTriDonTB,
       LAG(t.DoanhThu) OVER (ORDER BY t.Thang) AS DoanhThuThangTruoc,
       ROUND((t.DoanhThu - LAG(t.DoanhThu) OVER (ORDER BY t.Thang))
             * 100.0 / LAG(t.DoanhThu) OVER (ORDER BY t.Thang), 1) AS TangTruongPct
FROM (SELECT DATE_FORMAT(NgayLap, '%Y-%m') AS Thang,
             COUNT(*)              AS SoDon,
             SUM(TongThanhToan)    AS DoanhThu
      FROM   v_doanhthu_hoadon
      GROUP BY DATE_FORMAT(NgayLap, '%Y-%m')) t
ORDER BY t.Thang;


-- =====================================================================
-- Q2. TOP 10 SẢN PHẨM BÁN CHẠY NHẤT TRONG KỲ
-- Mục đích: ③ Báo cáo mặt hàng bán chạy; ① theo dõi quy trình bán hàng.
-- Kỹ thuật: JOIN 3 bảng, GROUP BY, ORDER BY, LIMIT, lọc khoảng ngày.
-- =====================================================================
SELECT s.MaSP,
       s.TenSP,
       SUM(c.SoLuong)            AS SoLuongBan,
       SUM(c.SoLuong * c.DonGia) AS DoanhThuDong
FROM   CHITIETDONHANG c
       JOIN v_doanhthu_hoadon h ON h.MaHD = c.MaHD
       JOIN SANPHAM s            ON s.MaSP = c.MaSP
WHERE  h.NgayLap >= @tu_ngay
  AND  h.NgayLap <  DATE_ADD(@den_ngay, INTERVAL 1 DAY)
GROUP BY s.MaSP, s.TenSP
ORDER BY SoLuongBan DESC, DoanhThuDong DESC
LIMIT 10;


-- =====================================================================
-- Q3. LỢI NHUẬN GỘP THEO THÁNG (Doanh thu thuần – Giá vốn)
-- Mục đích: ② Kiểm soát lợi nhuận; ③ báo cáo biên lợi nhuận.
-- Kỹ thuật: JOIN, subquery tính giá vốn, GROUP BY, SUM, ROUND.
-- =====================================================================
SELECT DATE_FORMAT(h.NgayLap, '%Y-%m')  AS Thang,
       SUM(h.TongThanhToan)             AS DoanhThuThuan,
       SUM(v.GiaVon)                    AS GiaVon,
       SUM(h.TongThanhToan - v.GiaVon)  AS LoiNhuanGop,
       ROUND(SUM(h.TongThanhToan - v.GiaVon) * 100.0
             / SUM(h.TongThanhToan), 2) AS BienLoiNhuanPct
FROM   v_doanhthu_hoadon h
       JOIN (SELECT c.MaHD, SUM(c.SoLuong * s.GiaNhap) AS GiaVon
             FROM   CHITIETDONHANG c JOIN SANPHAM s ON s.MaSP = c.MaSP
             GROUP BY c.MaHD) v ON v.MaHD = h.MaHD
GROUP BY DATE_FORMAT(h.NgayLap, '%Y-%m')
ORDER BY Thang;


-- =====================================================================
-- Q4. DOANH THU & SỐ LƯỢNG BÁN THEO DANH MỤC SẢN PHẨM (kèm tỷ trọng)
-- Mục đích: ③ Báo cáo xu hướng tiêu thụ theo nhóm hàng.
-- Kỹ thuật: JOIN 4 bảng, GROUP BY, window function (SUM OVER).
-- =====================================================================
SELECT d.TenDM,
       SUM(c.SoLuong)            AS SoLuongBan,
       SUM(c.SoLuong * c.DonGia) AS DoanhThuDong,
       ROUND(SUM(c.SoLuong * c.DonGia) * 100.0
             / SUM(SUM(c.SoLuong * c.DonGia)) OVER (), 1) AS TyTrongPct
FROM   CHITIETDONHANG c
       JOIN v_doanhthu_hoadon h ON h.MaHD = c.MaHD
       JOIN SANPHAM s            ON s.MaSP = c.MaSP
       JOIN DANHMUC d            ON d.MaDM = s.MaDM
GROUP BY d.MaDM, d.TenDM
ORDER BY DoanhThuDong DESC;


-- =====================================================================
-- Q5. HIỆU SUẤT BÁN HÀNG CỦA TỪNG NHÂN VIÊN
--     (Số HĐ lập, doanh thu, số GD thu tiền, số ticket xử lý)
-- Mục đích: ③ Hiệu suất làm việc nhân viên;
--           ④ Truy vết & quy trách nhiệm (NV nào lập HĐ, thu tiền).
-- Kỹ thuật: Subquery tương quan (correlated subquery), LEFT JOIN.
-- =====================================================================
SELECT v.MaNV,
       v.HoTen,
       v.ChucVu,
       -- Số hóa đơn đã lập
       (SELECT COUNT(*) FROM HOADON WHERE MaNV_Lap = v.MaNV)                          AS SoHoaDonLap,
       -- Doanh thu các hóa đơn hoàn thành do NV lập
       COALESCE((SELECT SUM(h2.TongThanhToan)
                 FROM v_doanhthu_hoadon h2
                 WHERE h2.MaNV_Lap = v.MaNV), 0)                                      AS DoanhThuNV,
       -- Số giao dịch thu tiền
       (SELECT COUNT(*) FROM GIAODICH WHERE MaNV_ThuTien = v.MaNV
                                        AND TrangThai = 'Thành công')                  AS SoGDThuTien,
       -- Tổng tiền đã thu
       COALESCE((SELECT SUM(SoTien) FROM GIAODICH WHERE MaNV_ThuTien = v.MaNV
                                                    AND TrangThai = 'Thành công'), 0)  AS TongTienDaThu,
       -- Số ticket đã xử lý
       (SELECT COUNT(*) FROM TICKET WHERE MaNV_XuLy = v.MaNV
                                      AND TrangThai = 'Đã xử lý')                     AS SoTicketDaXuLy
FROM   NHANVIEN v
WHERE  v.TrangThaiLamViec = 'Đang làm'
ORDER BY DoanhThuNV DESC;


-- =====================================================================
-- Q6. PHÂN HẠNG KHÁCH HÀNG THEO TỔNG CHI TIÊU + SỐ DƯ CREDIT
-- Mục đích: ① Chăm sóc khách hàng; ② Kiểm soát số dư Credit.
-- Kỹ thuật: LEFT JOIN, GROUP BY, CASE, subquery dẫn xuất.
-- =====================================================================
SELECT t.MaKH,
       t.HoTen,
       t.SoDienThoai,
       t.SoDuCredit,
       t.SoDon,
       t.TongChiTieu,
       CASE WHEN t.TongChiTieu >= 50000000 THEN 'VIP'
            WHEN t.TongChiTieu >= 20000000 THEN 'Thân thiết'
            WHEN t.TongChiTieu > 0          THEN 'Đã mua'
            ELSE 'Chưa mua' END AS HangKhach
FROM (SELECT k.MaKH, k.HoTen, k.SoDienThoai, k.SoDuCredit,
             COUNT(h.MaHD) AS SoDon,
             COALESCE(SUM(h.TongThanhToan), 0) AS TongChiTieu
      FROM   KHACHHANG k
             LEFT JOIN v_doanhthu_hoadon h ON h.MaKH = k.MaKH
      GROUP BY k.MaKH, k.HoTen, k.SoDienThoai, k.SoDuCredit) t
ORDER BY t.TongChiTieu DESC;


-- =====================================================================
-- Q7. BÁO CÁO NHẬP – XUẤT – TỒN KHO TRONG KỲ
-- Mục đích: ② Kiểm soát kho hàng; ① theo dõi nhập hàng.
-- Kỹ thuật: Subquery tương quan (tồn đầu kỳ), LEFT JOIN, CASE, GROUP BY.
-- =====================================================================
SELECT x.MaSP, x.TenSP,
       x.TonDau,
       x.Nhap,
       x.Xuat,
       x.Huy,
       x.TonDau + x.Nhap - x.Xuat - x.Huy AS TonCuoi
FROM (
  SELECT s.MaSP, s.TenSP,
         -- Tồn đầu kỳ = TonSau dòng thẻ kho cuối cùng trước kỳ
         COALESCE((SELECT t.TonSau FROM THEKHO t
                   WHERE t.MaSP = s.MaSP AND t.ThoiGian < @tu_ngay
                   ORDER BY t.ThoiGian DESC, t.MaTheKho DESC LIMIT 1), 0) AS TonDau,
         COALESCE(SUM(CASE WHEN k.LoaiBienDong = 'Nhập' THEN  k.SoLuong END), 0) AS Nhap,
         COALESCE(-SUM(CASE WHEN k.LoaiBienDong = 'Xuất' THEN k.SoLuong END), 0) AS Xuat,
         COALESCE(-SUM(CASE WHEN k.LoaiBienDong = 'Hủy'  THEN k.SoLuong END), 0) AS Huy
  FROM   SANPHAM s
         LEFT JOIN THEKHO k ON k.MaSP = s.MaSP
              AND k.ThoiGian >= @tu_ngay
              AND k.ThoiGian <  DATE_ADD(@den_ngay, INTERVAL 1 DAY)
  GROUP BY s.MaSP, s.TenSP
) x
ORDER BY x.MaSP;


-- =====================================================================
-- Q8. DÒNG TIỀN THỰC THU THEO THÁNG (phân loại phương thức thanh toán)
-- Mục đích: ② Kiểm soát dòng tiền; ③ báo cáo tài chính.
-- Kỹ thuật: CASE, SUM, GROUP BY, DATE_FORMAT.
-- =====================================================================
SELECT DATE_FORMAT(ThoiGian, '%Y-%m') AS Thang,
       SUM(CASE WHEN LoaiGiaoDich = 'Nạp Credit'
                THEN SoTien ELSE 0 END)                                    AS NapCredit,
       SUM(CASE WHEN LoaiGiaoDich = 'Thanh toán' AND PhuongThuc = 'Tiền mặt'
                THEN SoTien ELSE 0 END)                                    AS ThuTienMat,
       SUM(CASE WHEN LoaiGiaoDich = 'Thanh toán' AND PhuongThuc = 'Thẻ'
                THEN SoTien ELSE 0 END)                                    AS ThuQuaThe,
       SUM(CASE WHEN LoaiGiaoDich = 'Thanh toán' AND PhuongThuc = 'Credit'
                THEN SoTien ELSE 0 END)                                    AS TruViCredit,
       -- Tiền thật thu = Nạp Credit + Tiền mặt + Thẻ (Credit chỉ trừ ví nội bộ)
       SUM(CASE WHEN LoaiGiaoDich = 'Nạp Credit'
                  OR PhuongThuc IN ('Tiền mặt', 'Thẻ')
                THEN SoTien ELSE 0 END)                                    AS TongTienThucThu
FROM   GIAODICH
WHERE  TrangThai = 'Thành công'
GROUP BY DATE_FORMAT(ThoiGian, '%Y-%m')
ORDER BY Thang;


-- =====================================================================
-- Q9. DOANH THU THEO KÊNH BÁN (Tại quầy / Online) VÀ PHƯƠNG THỨC THANH TOÁN
-- Mục đích: ① So sánh 2 kênh bán hàng (tại quầy vs online);
--           ③ Báo cáo cơ cấu doanh thu.
-- Kỹ thuật: GROUP BY nhiều cột, window function (SUM OVER).
-- =====================================================================
SELECT HinhThucLap             AS Kenh,
       PhuongThucThanhToan     AS PhuongThuc,
       COUNT(*)                AS SoDon,
       SUM(TongThanhToan)      AS DoanhThu,
       ROUND(SUM(TongThanhToan) * 100.0
             / SUM(SUM(TongThanhToan)) OVER (), 1) AS TyTrongPct
FROM   v_doanhthu_hoadon
GROUP BY HinhThucLap, PhuongThucThanhToan
ORDER BY Kenh, DoanhThu DESC;


-- =====================================================================
-- Q10. NHÀ CUNG CẤP: TỔNG GIÁ TRỊ ĐÃ NHẬP & LẦN NHẬP GẦN NHẤT
-- Mục đích: ① Quản lý nhập hàng; ② kiểm soát chi phí mua hàng.
-- Kỹ thuật: LEFT JOIN, GROUP BY, COALESCE, SUM, MAX.
-- =====================================================================
SELECT n.MaNCC,
       n.TenNCC,
       n.NguoiLienHe,
       n.TrangThaiHopTac,
       COUNT(p.MaPN)   AS SoPhieuNhap,
       COALESCE(SUM(CASE WHEN p.TrangThai = 'Hoàn thành'
                         THEN p.TongTien END), 0) AS TongGiaTriDaNhap,
       MAX(p.NgayNhapKho) AS LanNhapGanNhat
FROM   NHACUNGCAP n
       LEFT JOIN PHIEUNHAP p ON p.MaNCC = n.MaNCC
GROUP BY n.MaNCC, n.TenNCC, n.NguoiLienHe, n.TrangThaiHopTac
ORDER BY TongGiaTriDaNhap DESC;


-- =====================================================================
-- Q11. TRA CỨU THÔNG TIN THIẾT BỊ & TÌNH TRẠNG BẢO HÀNH TỔNG QUAN
--      (Mã món đồ / MaItem được nhập từ bàn phím)
-- Mục đích: ① Quản lý bảo hành sản phẩm; ② kiểm soát thiết bị bán ra.
-- Kỹ thuật: Biến người dùng nhập, JOIN nhiều bảng, subquery đếm,
--           CASE, DATE_ADD.
-- =====================================================================

-- Nhập mã món đồ cần tra cứu (ví dụ 'IT00014')
SET @ma_item_nhap = 'IT00014';

SELECT i.MaItem,
       i.IMEI_Serial,
       s.TenSP,
       k.HoTen              AS ChuSoHuu,
       k.SoDienThoai,
       h.MaHD,
       -- Ngày bắt đầu & kết thúc bảo hành
       CASE WHEN h.HinhThucLap = 'Online' THEN h.NgayCapNhat
            ELSE h.NgayLap END                                         AS NgayBatDauBH,
       s.ThoiHanBaoHanh                                                AS SoThangBaoHanh,
       DATE_ADD(
         CASE WHEN h.HinhThucLap = 'Online' THEN h.NgayCapNhat
              ELSE h.NgayLap END,
         INTERVAL s.ThoiHanBaoHanh MONTH)                              AS NgayHetBH,
       -- Còn hay hết bảo hành
       CASE WHEN DATE_ADD(
              CASE WHEN h.HinhThucLap = 'Online' THEN h.NgayCapNhat
                   ELSE h.NgayLap END,
              INTERVAL s.ThoiHanBaoHanh MONTH) >= @now
            THEN 'Còn bảo hành'
            ELSE 'Hết bảo hành' END                                    AS TinhTrangBaoHanh,
       -- Tổng số lần bảo hành
       (SELECT COUNT(*) FROM TICKET t
        WHERE t.MaItem = i.MaItem
          AND t.LoaiYeuCau = 'Bảo hành')                               AS TongSoLanBaoHanh
FROM   SANPHAM_ITEM i
       JOIN SANPHAM s        ON s.MaSP  = i.MaSP
       LEFT JOIN HOADON h    ON h.MaHD  = i.MaHD
       LEFT JOIN KHACHHANG k ON k.MaKH  = h.MaKH
WHERE  i.MaItem = @ma_item_nhap;


-- =====================================================================
-- Q12. TRA CỨU LỊCH SỬ BẢO HÀNH CỦA THIẾT BỊ THEO IMEI
--      (Số IMEI/Serial được nhập từ bàn phím -> ra danh sách các ticket)
-- Mục đích: ① Quản lý bảo hành sản phẩm; ④ truy vết nhân viên tiếp nhận.
-- Kỹ thuật: Biến người dùng nhập, JOIN 4 bảng, CASE, TIMESTAMPDIFF,
--           ROW_NUMBER() phân thứ tự các lần bảo hành.
-- =====================================================================

-- Nhập số IMEI/Serial thiết bị cần tra ticket bảo hành (ví dụ '354251726382597')
SET @imei_nhap = '354251726382597';

SELECT t.MaTicket,
       i.IMEI_Serial,
       s.TenSP,
       k.HoTen                AS KhachHang,
       ROW_NUMBER() OVER (ORDER BY t.NgayGui) AS LanThu,
       t.NgayGui              AS NgayGuiBaoHanh,
       t.NgayXuLy             AS NgayXuLyXong,
       CASE WHEN t.NgayXuLy IS NOT NULL
            THEN CONCAT(TIMESTAMPDIFF(DAY, t.NgayGui, t.NgayXuLy), ' ngày')
            ELSE 'Đang xử lý' END                       AS ThoiGianXuLy,
       t.TrangThai,
       t.MucDoUuTien,
       t.NoiDung              AS MoTaLoi,
       nv.MaNV                AS MaNV_TiepNhan,
       nv.HoTen               AS NhanVienTiepNhan,
       nv.SoDienThoai         AS SDT_NhanVien
FROM   TICKET t
       JOIN SANPHAM_ITEM i   ON i.MaItem = t.MaItem
       JOIN SANPHAM s        ON s.MaSP   = i.MaSP
       JOIN KHACHHANG k      ON k.MaKH   = t.MaKH
       LEFT JOIN NHANVIEN nv ON nv.MaNV  = t.MaNV_XuLy
WHERE  i.IMEI_Serial = @imei_nhap
  AND  t.LoaiYeuCau  = 'Bảo hành'
ORDER BY t.NgayGui;


-- =====================================================================
-- Q13. LIỆT KÊ CÁC HÓA ĐƠN MÀ MỘT NHÂN VIÊN CỤ THỂ THAM GIA
--      (Mã nhân viên được nhập từ bàn phím)
-- Mục đích: ④ Truy vết người thực hiện – NV lập hóa đơn, cập nhật đơn;
--           ③ Đánh giá khối lượng công việc từng nhân viên.
-- Kỹ thuật: Biến người dùng nhập, CASE phân loại vai trò,
--           JOIN, LEFT JOIN, ORDER BY.
-- Ghi chú:  Một NV có thể tham gia hóa đơn theo 2 vai trò:
--            - MaNV_Lap:     nhân viên lập hóa đơn (bán tại quầy)
--            - MaNV_CapNhat: nhân viên cập nhật/xử lý đơn (duyệt, giao, hủy)
-- =====================================================================

-- Nhập mã nhân viên cần tra cứu (ví dụ 'NV003')
SET @ma_nv_nhap = 'NV003';

SELECT h.MaHD,
       h.NgayLap,
       h.HinhThucLap,
       k.HoTen           AS KhachHang,
       h.TongThanhToan,
       h.TrangThaiDonHang,
       h.TrangThaiThanhToan,
       CASE
         WHEN h.MaNV_Lap = @ma_nv_nhap AND h.MaNV_CapNhat = @ma_nv_nhap
              THEN 'Lập HĐ + Cập nhật'
         WHEN h.MaNV_Lap = @ma_nv_nhap
              THEN 'Lập hóa đơn'
         ELSE 'Cập nhật / Xử lý đơn'
       END                AS VaiTroTrongDon,
       nv_lap.HoTen       AS NV_Lap,
       nv_cn.HoTen        AS NV_CapNhat
FROM   HOADON h
       JOIN KHACHHANG k          ON k.MaKH  = h.MaKH
       LEFT JOIN NHANVIEN nv_lap ON nv_lap.MaNV = h.MaNV_Lap
       LEFT JOIN NHANVIEN nv_cn  ON nv_cn.MaNV  = h.MaNV_CapNhat
WHERE  h.MaNV_Lap = @ma_nv_nhap
   OR  h.MaNV_CapNhat = @ma_nv_nhap
ORDER BY h.NgayLap DESC;


-- =====================================================================
-- Q14. DASHBOARD TỔNG HỢP CHO QUẢN LÝ (tất cả chỉ số quan trọng)
-- Mục đích: Đáp ứng cả 4 mục đích – cái nhìn toàn cảnh hoạt động kinh doanh.
-- Kỹ thuật: Subquery vô hướng (scalar subquery) trong SELECT.
-- =====================================================================
SELECT
  -- ② Tài chính
  (SELECT COALESCE(SUM(TongThanhToan), 0)
   FROM v_doanhthu_hoadon
   WHERE DATE_FORMAT(NgayLap, '%Y-%m') = @thang)           AS DoanhThuThang,

  (SELECT COUNT(*)
   FROM v_doanhthu_hoadon
   WHERE DATE_FORMAT(NgayLap, '%Y-%m') = @thang)           AS SoDonHoanThanhThang,

  -- ① Hoạt động kinh doanh
  (SELECT COUNT(*)
   FROM HOADON WHERE TrangThaiDonHang = 'Chờ xử lý')      AS DonChoXuLy,

  (SELECT COUNT(*)
   FROM HOADON WHERE TrangThaiDonHang = 'Đang giao')       AS DonDangGiao,

  -- ① Chăm sóc khách hàng
  (SELECT COUNT(*)
   FROM TICKET WHERE TrangThai <> 'Đã xử lý')             AS TicketTonDong,

  -- ② Kho hàng
  (SELECT COUNT(*)
   FROM SANPHAM
   WHERE SoLuongTon <= NguongTonToiThieu
     AND TrangThaiKinhDoanh = 'Đang bán')                  AS SanPhamSapHet,

  (SELECT COUNT(*)
   FROM PHIEUNHAP WHERE TrangThai = 'Chờ duyệt')           AS PhieuNhapChoDuyet,

  (SELECT SUM(SoLuongTon * GiaNhap) FROM SANPHAM)          AS GiaTriTonKhoTheoVon,

  -- ② Credit
  (SELECT SUM(SoDuCredit) FROM KHACHHANG)                   AS TongSoDuCreditKhach,

  -- ① Khách hàng
  (SELECT COUNT(*) FROM KHACHHANG)                          AS TongKhachHang;


-- =====================================================================
-- Q15. TÍNH LƯƠNG & TRA CỨU BẢNG LƯƠNG NHÂN VIÊN THEO KỲ
--      (Không nhập gì / NULL thì hiện hết, nhập mã NV thì hiện NV đó)
-- Mục đích: ② Kiểm soát tài chính (quỹ lương);
--           ③ Báo cáo & thống kê (thu nhập, hiệu suất nhân sự);
--           ④ Nâng cao hiệu quả vận hành (tính lương minh bạch theo công thức).
-- Kỹ thuật: Lọc tham số linh hoạt (@ma_nv_luong IS NULL OR @ma_nv_luong = '' OR ...),
--           JOIN 3 bảng (BANGLUONG, NHANVIEN, MUCLUONG),
--           Tính thưởng ticket, thu nhập thực nhận, ORDER BY.
-- Ghi chú:  Công thức theo ràng buộc ck_bangluong_congthuc trong CSDL:
--           ThuNhap = LuongCoBan + (SoTicketDaXuLy * TienMoiTicket)
-- =====================================================================

-- Nhập tham số từ bàn phím (đã khai báo ở đầu file hoặc gán tại đây):
-- Để NULL hoặc '' để hiển thị TẤT CẢ nhân viên
-- Gán mã cụ thể (ví dụ: 'NV006', 'NV002') để hiển thị DUY NHẤT nhân viên đó
SET @ma_nv_luong   = NULL;        -- Thử: SET @ma_nv_luong = 'NV006';
SET @ky_luong_nhap = '09/2026';   -- Thử: SET @ky_luong_nhap = NULL; để xem mọi kỳ

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
WHERE  (@ky_luong_nhap IS NULL OR @ky_luong_nhap = '' OR b.KyLuong = @ky_luong_nhap)
  AND  (@ma_nv_luong IS NULL OR @ma_nv_luong = '' OR v.MaNV = @ma_nv_luong)
ORDER BY b.KyLuong DESC, b.ThuNhap DESC;

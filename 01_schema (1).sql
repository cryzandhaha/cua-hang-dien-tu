-- =====================================================================
-- SCHEMA - CỬA HÀNG ĐỒ ĐIỆN TỬ  (MySQL 8.0.16+ / MariaDB 10.5+)
-- Sinh từ file "Sơ đồ thực thể liên kết.docx": 17 bảng / 5 phân hệ
-- Ghi chú nghiệp vụ:
--   * Mỗi khách hàng chỉ có 1 địa chỉ  -> KHACHHANG.DiaChiNhanHang; đơn Online luôn
--     giao về đúng địa chỉ này (trigger trg_hoadon_bi / trg_hoadon_bu bắt buộc).
--   * Không có trả hàng / trả một phần -> TrangThaiDonHang chỉ gồm:
--     Chờ xử lý / Đang giao / Hoàn thành / Đã hủy; Ticket chỉ gồm Bảo hành / Khiếu nại.
-- =====================================================================
USE defaultdb;
SET NAMES utf8mb4;

-- 1. Bảng NGUOIDUNG (Tài khoản định danh tập trung)
CREATE TABLE NGUOIDUNG (
  MaND                  VARCHAR(10) NOT NULL COMMENT 'Mã định danh hệ thống [10 ký tự]',
  TenDangNhap           VARCHAR(50) NOT NULL UNIQUE COMMENT 'Tên đăng nhập [50 ký tự]',
  MatKhau               VARCHAR(255) NOT NULL COMMENT 'Mật khẩu (đã mã hóa) [255 ký tự]',
  Email                 VARCHAR(100) COMMENT 'Thư điện tử [100 ký tự]',
  VaiTro                VARCHAR(20) NOT NULL COMMENT 'Phân quyền truy cập [Client/Staff/Admin]',
  PRIMARY KEY (MaND),
  CONSTRAINT ck_nguoidung_vaitro CHECK (VaiTro IN ('Client', 'Staff', 'Admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Bảng KHACHHANG
CREATE TABLE KHACHHANG (
  MaKH                  VARCHAR(10) NOT NULL COMMENT 'Mã khách hàng [10 ký tự]',
  MaND                  VARCHAR(10) NOT NULL UNIQUE COMMENT 'Liên kết NGUOIDUNG [10 ký tự]',
  HoTen                 VARCHAR(100) NOT NULL COMMENT 'Tên khách hàng [100 ký tự]',
  SoDienThoai           VARCHAR(15) COMMENT 'Số điện thoại liên hệ [10-15 số]',
  DiaChiNhanHang        VARCHAR(255) COMMENT 'Địa chỉ mặc định [255 ký tự]',
  SoDuCredit            DECIMAL(15,0) NOT NULL DEFAULT 0 COMMENT 'Số dư ví ảo [>= 0]',
  PRIMARY KEY (MaKH),
  CONSTRAINT ck_khachhang_soducredit CHECK (SoDuCredit >= 0),
  CONSTRAINT fk_khachhang_mand FOREIGN KEY (MaND) REFERENCES NGUOIDUNG(MaND)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Bảng MUCLUONG
CREATE TABLE MUCLUONG (
  MaVaiTro              VARCHAR(20) NOT NULL COMMENT 'Mã cấp bậc/vị trí [20 ký tự]',
  TenVaiTro             VARCHAR(50) NOT NULL COMMENT 'Tên chức danh [50 ký tự]',
  LuongCoBan            DECIMAL(15,0) NOT NULL COMMENT 'Lương cơ bản [>= 0]',
  TienMoiTicket         DECIMAL(15,0) NOT NULL COMMENT 'Thưởng khi xử lý Ticket [>= 0]',
  PRIMARY KEY (MaVaiTro),
  CONSTRAINT ck_mucluong_luongcoban CHECK (LuongCoBan >= 0),
  CONSTRAINT ck_mucluong_tienmoiticket CHECK (TienMoiTicket >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Bảng NHANVIEN
CREATE TABLE NHANVIEN (
  MaNV                  VARCHAR(10) NOT NULL COMMENT 'Mã nhân viên [10 ký tự]',
  MaND                  VARCHAR(10) NOT NULL UNIQUE COMMENT 'Liên kết NGUOIDUNG [10 ký tự]',
  MaVaiTro              VARCHAR(20) NOT NULL COMMENT 'Liên kết MUCLUONG [20 ký tự]',
  HoTen                 VARCHAR(100) NOT NULL COMMENT 'Tên nhân viên [100 ký tự]',
  SoDienThoai           VARCHAR(15) COMMENT 'Số điện thoại [10-15 số]',
  ChucVu                VARCHAR(50) COMMENT 'Vị trí công tác [50 ký tự]',
  NgayVaoLam            DATE NOT NULL COMMENT 'Ngày bắt đầu làm [Ngày hợp lệ]',
  TrangThaiLamViec      VARCHAR(30) NOT NULL DEFAULT 'Đang làm' COMMENT 'Tình trạng [Đang làm/Nghỉ việc]',
  PRIMARY KEY (MaNV),
  CONSTRAINT ck_nhanvien_trangthailamviec CHECK (TrangThaiLamViec IN ('Đang làm', 'Nghỉ việc')),
  CONSTRAINT fk_nhanvien_mand FOREIGN KEY (MaND) REFERENCES NGUOIDUNG(MaND),
  CONSTRAINT fk_nhanvien_mavaitro FOREIGN KEY (MaVaiTro) REFERENCES MUCLUONG(MaVaiTro)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Bảng BANGLUONG
CREATE TABLE BANGLUONG (
  MaBL                  VARCHAR(10) NOT NULL COMMENT 'Mã bảng lương [10 ký tự]',
  MaNV                  VARCHAR(10) NOT NULL COMMENT 'Liên kết NHANVIEN [10 ký tự]',
  KyLuong               CHAR(7) NOT NULL COMMENT 'Tháng trả lương [MM/YYYY]',
  LuongCoBan            DECIMAL(15,0) NOT NULL COMMENT 'Lương cứng [>= 0]',
  SoTicketDaXuLy        INT NOT NULL COMMENT 'Số lượng ticket giải quyết [>= 0]',
  TienMoiTicket         DECIMAL(15,0) NOT NULL COMMENT 'Mức thưởng/ticket [>= 0]',
  ThuNhap               DECIMAL(15,0) NOT NULL COMMENT 'Tổng lương thực nhận [>= 0]',
  PRIMARY KEY (MaBL),
  CONSTRAINT ck_bangluong_luongcoban CHECK (LuongCoBan >= 0),
  CONSTRAINT ck_bangluong_soticketdaxuly CHECK (SoTicketDaXuLy >= 0),
  CONSTRAINT ck_bangluong_tienmoiticket CHECK (TienMoiTicket >= 0),
  CONSTRAINT ck_bangluong_thunhap CHECK (ThuNhap >= 0),
  CONSTRAINT uq_bangluong_nv_ky UNIQUE (MaNV, KyLuong),
  CONSTRAINT ck_bangluong_ky CHECK (KyLuong LIKE '__/____'),
  CONSTRAINT ck_bangluong_congthuc CHECK (ThuNhap = LuongCoBan + SoTicketDaXuLy * TienMoiTicket),
  CONSTRAINT fk_bangluong_manv FOREIGN KEY (MaNV) REFERENCES NHANVIEN(MaNV)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Bảng DANHMUC
CREATE TABLE DANHMUC (
  MaDM                  VARCHAR(10) NOT NULL COMMENT 'Mã danh mục [10 ký tự]',
  TenDM                 VARCHAR(100) NOT NULL COMMENT 'Tên nhóm hàng [100 ký tự]',
  MoTa                  VARCHAR(255) COMMENT 'Mô tả chi tiết [255 ký tự]',
  PRIMARY KEY (MaDM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Bảng SANPHAM
CREATE TABLE SANPHAM (
  MaSP                  VARCHAR(10) NOT NULL COMMENT 'Mã sản phẩm [10 ký tự]',
  MaDM                  VARCHAR(10) NOT NULL COMMENT 'Liên kết DANHMUC [10 ký tự]',
  TenSP                 VARCHAR(150) NOT NULL COMMENT 'Tên sản phẩm [150 ký tự]',
  Loai                  VARCHAR(50) COMMENT 'Phân loại [50 ký tự]',
  HinhAnh               VARCHAR(255) COMMENT 'Đường dẫn URL ảnh Web [255 ký tự]',
  SoLuongTon            INT NOT NULL DEFAULT 0 COMMENT 'Tồn kho hiện tại [>= 0]',
  GiaNhap               DECIMAL(15,0) NOT NULL DEFAULT 0 COMMENT 'Giá gốc [>= 0]',
  GiaBan                DECIMAL(15,0) NOT NULL DEFAULT 0 COMMENT 'Giá niêm yết [>= 0]',
  MoTa                  VARCHAR(500) COMMENT 'Bài viết mô tả [500 ký tự]',
  ThongSoKyThuat        VARCHAR(500) COMMENT 'Cấu hình chi tiết [500 ký tự]',
  ThoiHanBaoHanh        INT NOT NULL DEFAULT 12 COMMENT 'Số tháng bảo hành [>= 0]',
  NguongTonToiThieu     INT NOT NULL DEFAULT 5 COMMENT 'Cảnh báo hết hàng [>= 0]',
  TrangThaiKinhDoanh    VARCHAR(30) NOT NULL DEFAULT 'Đang bán' COMMENT 'Tình trạng [Đang bán/Ngừng bán]',
  PRIMARY KEY (MaSP),
  CONSTRAINT ck_sanpham_soluongton CHECK (SoLuongTon >= 0),
  CONSTRAINT ck_sanpham_gianhap CHECK (GiaNhap >= 0),
  CONSTRAINT ck_sanpham_giaban CHECK (GiaBan >= 0),
  CONSTRAINT ck_sanpham_thoihanbaohanh CHECK (ThoiHanBaoHanh >= 0),
  CONSTRAINT ck_sanpham_nguongtontoithieu CHECK (NguongTonToiThieu >= 0),
  CONSTRAINT ck_sanpham_trangthaikinhdoanh CHECK (TrangThaiKinhDoanh IN ('Đang bán', 'Ngừng bán')),
  CONSTRAINT ck_sp_gia CHECK (GiaBan >= GiaNhap),
  CONSTRAINT fk_sanpham_madm FOREIGN KEY (MaDM) REFERENCES DANHMUC(MaDM),
  INDEX idx_sp_ten (TenSP)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. Bảng NHACUNGCAP
CREATE TABLE NHACUNGCAP (
  MaNCC                 VARCHAR(10) NOT NULL COMMENT 'Mã nhà cung cấp [10 ký tự]',
  TenNCC                VARCHAR(150) NOT NULL COMMENT 'Tên đối tác [150 ký tự]',
  NguoiLienHe           VARCHAR(100) COMMENT 'Đầu mối liên lạc [100 ký tự]',
  SoDienThoai           VARCHAR(15) COMMENT 'SDT nhà cung cấp [10-15 số]',
  Email                 VARCHAR(100) COMMENT 'Email liên hệ [100 ký tự]',
  DiaChi                VARCHAR(255) COMMENT 'Địa chỉ kho đối tác [255 ký tự]',
  TrangThaiHopTac       VARCHAR(30) NOT NULL DEFAULT 'Đang hợp tác' COMMENT 'Tình trạng [Đang hợp tác/Ngừng]',
  PRIMARY KEY (MaNCC),
  CONSTRAINT ck_nhacungcap_trangthaihoptac CHECK (TrangThaiHopTac IN ('Đang hợp tác', 'Ngừng hợp tác'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. Bảng PHIEUNHAP
CREATE TABLE PHIEUNHAP (
  MaPN                  VARCHAR(10) NOT NULL COMMENT 'Mã phiếu nhập [10 ký tự]',
  MaNCC                 VARCHAR(10) NOT NULL COMMENT 'Đối tác cấp hàng [10 ký tự]',
  MaNV_Lap              VARCHAR(10) NOT NULL COMMENT 'NV tạo phiếu [10 ký tự]',
  MaNV_XacNhan          VARCHAR(10) COMMENT 'Quản lý duyệt [10 ký tự]',
  NgayLap               DATETIME NOT NULL COMMENT 'Thời điểm tạo [Ngày giờ hợp lệ]',
  NgayNhapKho           DATETIME COMMENT 'Thời điểm hàng về [Ngày giờ hợp lệ]',
  TongTien              DECIMAL(15,0) NOT NULL DEFAULT 0 COMMENT 'Tổng giá trị lô hàng [>= 0]',
  TrangThai             VARCHAR(30) NOT NULL DEFAULT 'Chờ duyệt' COMMENT 'Tình trạng phiếu [Chờ duyệt/Hoàn thành]',
  GhiChu                VARCHAR(255) COMMENT 'Ghi chú thêm [255 ký tự]',
  PRIMARY KEY (MaPN),
  CONSTRAINT ck_phieunhap_tongtien CHECK (TongTien >= 0),
  CONSTRAINT ck_phieunhap_trangthai CHECK (TrangThai IN ('Chờ duyệt', 'Hoàn thành')),
  CONSTRAINT ck_pn_ngay CHECK (NgayNhapKho IS NULL OR NgayNhapKho >= NgayLap),
  CONSTRAINT ck_pn_tachquyen CHECK (MaNV_XacNhan IS NULL OR MaNV_XacNhan <> MaNV_Lap),
  CONSTRAINT fk_phieunhap_mancc FOREIGN KEY (MaNCC) REFERENCES NHACUNGCAP(MaNCC),
  CONSTRAINT fk_phieunhap_manv_lap FOREIGN KEY (MaNV_Lap) REFERENCES NHANVIEN(MaNV),
  CONSTRAINT fk_phieunhap_manv_xacnhan FOREIGN KEY (MaNV_XacNhan) REFERENCES NHANVIEN(MaNV)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 11. Bảng CHITIETPHIEUNHAP
CREATE TABLE CHITIETPHIEUNHAP (
  MaPN                  VARCHAR(10) NOT NULL COMMENT 'Phiếu nhập liên kết [10 ký tự]',
  MaSP                  VARCHAR(10) NOT NULL COMMENT 'Sản phẩm nhập [10 ký tự]',
  SoLuong               INT NOT NULL COMMENT 'Số lượng nhập [> 0]',
  DonGiaNhap            DECIMAL(15,0) NOT NULL COMMENT 'Giá chốt nhập [>= 0]',
  PRIMARY KEY (MaPN, MaSP),
  CONSTRAINT ck_chitietphieunhap_soluong CHECK (SoLuong > 0),
  CONSTRAINT ck_chitietphieunhap_dongianhap CHECK (DonGiaNhap >= 0),
  CONSTRAINT fk_chitietphieunhap_mapn FOREIGN KEY (MaPN) REFERENCES PHIEUNHAP(MaPN),
  CONSTRAINT fk_chitietphieunhap_masp FOREIGN KEY (MaSP) REFERENCES SANPHAM(MaSP)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 13. Bảng MAGIAMGIA
CREATE TABLE MAGIAMGIA (
  MaGG                  VARCHAR(20) NOT NULL COMMENT 'Mã code giảm giá [20 ký tự]',
  KieuGiam              VARCHAR(20) NOT NULL COMMENT 'Loại giảm [Phần trăm/Cố định]',
  GiaTriGiam            DECIMAL(15,2) NOT NULL COMMENT 'Mức giảm [> 0]',
  GiamToiDa             DECIMAL(15,0) NOT NULL COMMENT 'Chặn trần tiền giảm [> 0]',
  NgayBatDau            DATE NOT NULL COMMENT 'Mở mã [Ngày hợp lệ]',
  NgayHetHan            DATE NOT NULL COMMENT 'Đóng mã [Ngày hợp lệ]',
  SoLuongPhatHanh       INT NOT NULL COMMENT 'Tổng lượng mã [> 0]',
  SoLuongConLai         INT NOT NULL COMMENT 'Mã chưa dùng [>= 0]',
  PRIMARY KEY (MaGG),
  CONSTRAINT ck_magiamgia_kieugiam CHECK (KieuGiam IN ('Phần trăm', 'Cố định')),
  CONSTRAINT ck_magiamgia_giatrigiam CHECK (GiaTriGiam > 0),
  CONSTRAINT ck_magiamgia_giamtoida CHECK (GiamToiDa > 0),
  CONSTRAINT ck_magiamgia_soluongphathanh CHECK (SoLuongPhatHanh > 0),
  CONSTRAINT ck_magiamgia_soluongconlai CHECK (SoLuongConLai >= 0),
  CONSTRAINT ck_gg_ngay CHECK (NgayHetHan >= NgayBatDau),
  CONSTRAINT ck_gg_phantram CHECK (KieuGiam <> 'Phần trăm' OR GiaTriGiam <= 100),
  CONSTRAINT ck_gg_conlai CHECK (SoLuongConLai <= SoLuongPhatHanh)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 14. Bảng HOADON
CREATE TABLE HOADON (
  MaHD                  VARCHAR(10) NOT NULL COMMENT 'Mã hóa đơn [10 ký tự]',
  MaKH                  VARCHAR(10) NOT NULL COMMENT 'Khách mua hàng [10 ký tự]',
  MaNV_Lap              VARCHAR(10) COMMENT 'NV tạo hóa đơn [10 ký tự]',
  MaNV_CapNhat          VARCHAR(10) COMMENT 'NV sửa cuối [10 ký tự]',
  MaGG                  VARCHAR(20) COMMENT 'Khuyến mãi áp dụng [20 ký tự]',
  NgayLap               DATETIME NOT NULL COMMENT 'Thời điểm lập [Ngày giờ hợp lệ]',
  HinhThucLap           VARCHAR(20) NOT NULL COMMENT 'Kênh mua [Tại quầy/Online]',
  DiaChiGiaoHang        VARCHAR(255) COMMENT 'Địa chỉ nhận thực tế [255 ký tự]',
  TenNguoiNhan          VARCHAR(100) COMMENT 'Tên người nhận thực tế [100 ký tự]',
  SDTNguoiNhan          VARCHAR(15) COMMENT 'SDT người nhận thực tế [10-15 số]',
  PhuongThucThanhToan   VARCHAR(30) COMMENT 'Cách thanh toán [Tiền mặt/Thẻ/Credit]',
  TongTienHang          DECIMAL(15,0) NOT NULL DEFAULT 0 COMMENT 'Tổng tiền SP [>= 0]',
  TienGiam              DECIMAL(15,0) NOT NULL DEFAULT 0 COMMENT 'Tiền được trừ [>= 0]',
  TongThanhToan         DECIMAL(15,0) NOT NULL DEFAULT 0 COMMENT 'Thực tế phải trả [>= 0]',
  TrangThaiDonHang      VARCHAR(30) NOT NULL DEFAULT 'Chờ xử lý' COMMENT 'Tình trạng đơn [Chờ/Giao/Hoàn/Hủy]',
  TrangThaiThanhToan    VARCHAR(30) NOT NULL DEFAULT 'Chưa thanh toán' COMMENT 'Tình trạng tiền [Chưa/Đã thanh toán]',
  NgayCapNhat           DATETIME COMMENT 'Lần sửa cuối [Ngày giờ hợp lệ]',
  PRIMARY KEY (MaHD),
  CONSTRAINT ck_hoadon_hinhthuclap CHECK (HinhThucLap IN ('Tại quầy', 'Online')),
  CONSTRAINT ck_hoadon_phuongthucthanhtoan CHECK (PhuongThucThanhToan IN ('Tiền mặt', 'Thẻ', 'Credit', 'Chuyển khoản QR (MB Bank)', 'Chuyển khoản QR', 'Chuyển khoản')),
  CONSTRAINT ck_hoadon_tongtienhang CHECK (TongTienHang >= 0),
  CONSTRAINT ck_hoadon_tiengiam CHECK (TienGiam >= 0),
  CONSTRAINT ck_hoadon_tongthanhtoan CHECK (TongThanhToan >= 0),
  CONSTRAINT ck_hoadon_trangthaidonhang CHECK (TrangThaiDonHang IN ('Chờ xử lý', 'Đang giao', 'Hoàn thành', 'Đã hủy')),
  CONSTRAINT ck_hoadon_trangthaithanhtoan CHECK (TrangThaiThanhToan IN ('Chưa thanh toán', 'Đã thanh toán')),
  CONSTRAINT ck_hd_tong CHECK (TongThanhToan = TongTienHang - TienGiam),
  CONSTRAINT ck_hd_giam CHECK (TienGiam <= TongTienHang),
  CONSTRAINT fk_hoadon_makh FOREIGN KEY (MaKH) REFERENCES KHACHHANG(MaKH),
  CONSTRAINT fk_hoadon_manv_lap FOREIGN KEY (MaNV_Lap) REFERENCES NHANVIEN(MaNV),
  CONSTRAINT fk_hoadon_manv_capnhat FOREIGN KEY (MaNV_CapNhat) REFERENCES NHANVIEN(MaNV),
  CONSTRAINT fk_hoadon_magg FOREIGN KEY (MaGG) REFERENCES MAGIAMGIA(MaGG),
  INDEX idx_hd_ngaylap (NgayLap),
  INDEX idx_hd_trangthai (TrangThaiDonHang, TrangThaiThanhToan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 15. Bảng CHITIETDONHANG
CREATE TABLE CHITIETDONHANG (
  MaHD                  VARCHAR(10) NOT NULL COMMENT 'Hóa đơn liên kết [10 ký tự]',
  MaSP                  VARCHAR(10) NOT NULL COMMENT 'Sản phẩm mua [10 ký tự]',
  SoLuong               INT NOT NULL COMMENT 'Số lượng [> 0]',
  DonGia                DECIMAL(15,0) NOT NULL COMMENT 'Giá chốt bán [>= 0]',
  DiemDanhGia           INT COMMENT 'Review số sao [1 đến 5]',
  NhanXet               TEXT COMMENT 'Review nội dung [Tối đa 65,535 ký tự]',
  PRIMARY KEY (MaHD, MaSP),
  CONSTRAINT ck_chitietdonhang_soluong CHECK (SoLuong > 0),
  CONSTRAINT ck_chitietdonhang_dongia CHECK (DonGia >= 0),
  CONSTRAINT ck_chitietdonhang_diemdanhgia CHECK (DiemDanhGia BETWEEN 1 AND 5),
  CONSTRAINT fk_chitietdonhang_mahd FOREIGN KEY (MaHD) REFERENCES HOADON(MaHD),
  CONSTRAINT fk_chitietdonhang_masp FOREIGN KEY (MaSP) REFERENCES SANPHAM(MaSP)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Bảng SANPHAM_ITEM (Quản lý IMEI vật lý)
CREATE TABLE SANPHAM_ITEM (
  MaItem                VARCHAR(10) NOT NULL COMMENT 'Mã item nội bộ [10 ký tự]',
  MaSP                  VARCHAR(10) NOT NULL COMMENT 'Liên kết SANPHAM [10 ký tự]',
  MaHD                  VARCHAR(10) COMMENT 'Đơn hàng xuất bán [10 ký tự]',
  IMEI_Serial           VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã vật lý định danh [50 ký tự]',
  TrangThai             VARCHAR(30) NOT NULL DEFAULT 'Trong kho' COMMENT 'Trạng thái thiết bị [Trong kho/Đã bán/Lỗi]',
  PRIMARY KEY (MaItem),
  CONSTRAINT ck_sanpham_item_trangthai CHECK (TrangThai IN ('Trong kho', 'Đã bán', 'Lỗi')),
  CONSTRAINT fk_sanpham_item_masp FOREIGN KEY (MaSP) REFERENCES SANPHAM(MaSP),
  CONSTRAINT fk_sanpham_item_mahd FOREIGN KEY (MaHD) REFERENCES HOADON(MaHD),
  INDEX idx_item_sp_tt (MaSP, TrangThai)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 12. Bảng THEKHO (Sổ kho lưu vết biến động)
CREATE TABLE THEKHO (
  MaTheKho              VARCHAR(10) NOT NULL COMMENT 'Mã dòng thẻ kho [10 ký tự]',
  MaSP                  VARCHAR(10) NOT NULL COMMENT 'Sản phẩm biến động [10 ký tự]',
  MaPN                  VARCHAR(10) COMMENT 'Nguồn gốc (Nếu nhập) [10 ký tự]',
  MaHD                  VARCHAR(10) COMMENT 'Nguồn gốc (Nếu xuất) [10 ký tự]',
  MaNV                  VARCHAR(10) NOT NULL COMMENT 'NV thao tác [10 ký tự]',
  LoaiBienDong          VARCHAR(20) NOT NULL COMMENT 'Dạng biến động [Nhập/Xuất/Hủy]',
  SoLuong               INT NOT NULL COMMENT 'Số lượng tăng/giảm [Số nguyên]',
  TonSau                INT NOT NULL COMMENT 'Tồn kho sau thao tác [>= 0]',
  ThoiGian              DATETIME NOT NULL COMMENT 'Thời điểm ghi nhận [Ngày giờ hợp lệ]',
  GhiChu                VARCHAR(255) COMMENT 'Lý do biến động [255 ký tự]',
  PRIMARY KEY (MaTheKho),
  CONSTRAINT ck_thekho_loaibiendong CHECK (LoaiBienDong IN ('Nhập', 'Xuất', 'Hủy')),
  CONSTRAINT ck_thekho_tonsau CHECK (TonSau >= 0),
  CONSTRAINT ck_tk_dau CHECK ((LoaiBienDong = 'Nhập' AND SoLuong > 0) OR (LoaiBienDong IN ('Xuất','Hủy') AND SoLuong < 0)),
  CONSTRAINT fk_thekho_masp FOREIGN KEY (MaSP) REFERENCES SANPHAM(MaSP),
  CONSTRAINT fk_thekho_mapn FOREIGN KEY (MaPN) REFERENCES PHIEUNHAP(MaPN),
  CONSTRAINT fk_thekho_mahd FOREIGN KEY (MaHD) REFERENCES HOADON(MaHD),
  CONSTRAINT fk_thekho_manv FOREIGN KEY (MaNV) REFERENCES NHANVIEN(MaNV),
  INDEX idx_tk_sp_tg (MaSP, ThoiGian)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 16. Bảng GIAODICH
CREATE TABLE GIAODICH (
  MaGD                  VARCHAR(10) NOT NULL COMMENT 'Mã giao dịch [10 ký tự]',
  MaKH                  VARCHAR(10) NOT NULL COMMENT 'Khách hàng nạp/trả [10 ký tự]',
  MaHD                  VARCHAR(10) COMMENT 'Đơn hàng cần thanh toán [10 ký tự]',
  MaNV_ThuTien          VARCHAR(10) COMMENT 'NV xác nhận [10 ký tự]',
  LoaiGiaoDich          VARCHAR(30) NOT NULL COMMENT 'Phân loại [Nạp Credit/Thanh toán]',
  PhuongThuc            VARCHAR(30) COMMENT 'Cách chuyển tiền [30 ký tự]',
  SoTien                DECIMAL(15,0) NOT NULL COMMENT 'Số tiền GD [> 0]',
  ThoiGian              DATETIME NOT NULL COMMENT 'Thời điểm GD [Ngày giờ hợp lệ]',
  TrangThai             VARCHAR(20) NOT NULL COMMENT 'Kết quả [Thành công/Thất bại]',
  TenNguoiGui           VARCHAR(100) COMMENT 'Tên tài khoản gửi [100 ký tự]',
  NoiDungChuyenKhoan    VARCHAR(255) COMMENT 'Ghi chú GD [255 ký tự]',
  PRIMARY KEY (MaGD),
  CONSTRAINT ck_giaodich_loaigiaodich CHECK (LoaiGiaoDich IN ('Nạp Credit', 'Thanh toán')),
  CONSTRAINT ck_giaodich_sotien CHECK (SoTien > 0),
  CONSTRAINT ck_giaodich_trangthai CHECK (TrangThai IN ('Thành công', 'Thất bại')),
  CONSTRAINT fk_giaodich_makh FOREIGN KEY (MaKH) REFERENCES KHACHHANG(MaKH),
  CONSTRAINT fk_giaodich_mahd FOREIGN KEY (MaHD) REFERENCES HOADON(MaHD),
  CONSTRAINT fk_giaodich_manv_thutien FOREIGN KEY (MaNV_ThuTien) REFERENCES NHANVIEN(MaNV),
  INDEX idx_gd_thoigian (ThoiGian)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 17. Bảng TICKET
CREATE TABLE TICKET (
  MaTicket              VARCHAR(10) NOT NULL COMMENT 'Mã phiếu hỗ trợ [10 ký tự]',
  MaKH                  VARCHAR(10) NOT NULL COMMENT 'Khách hàng tạo ticket [10 ký tự]',
  MaItem                VARCHAR(10) COMMENT 'IMEI thiết bị lỗi [10 ký tự]',
  MaNV_XuLy             VARCHAR(10) COMMENT 'NV tiếp nhận [10 ký tự]',
  LoaiYeuCau            VARCHAR(50) COMMENT 'Loại yêu cầu [Bảo hành/Khiếu nại]',
  NoiDung               VARCHAR(1000) COMMENT 'Chi tiết vấn đề [1000 ký tự]',
  MucDoUuTien           VARCHAR(20) NOT NULL DEFAULT 'Trung bình' COMMENT 'Cấp độ ưu tiên [Cao/Trung bình/Thấp]',
  TrangThai             VARCHAR(30) NOT NULL DEFAULT 'Chờ xử lý' COMMENT 'Tiến độ giải quyết [Chờ/Đang/Đã xử lý]',
  NgayGui               DATETIME NOT NULL COMMENT 'Thời điểm tạo [Ngày giờ hợp lệ]',
  NgayXuLy              DATETIME COMMENT 'Ngày đóng ticket [Ngày giờ hợp lệ]',
  PRIMARY KEY (MaTicket),
  CONSTRAINT ck_ticket_loaiyeucau CHECK (LoaiYeuCau IN ('Bảo hành', 'Khiếu nại')),
  CONSTRAINT ck_ticket_mucdouutien CHECK (MucDoUuTien IN ('Cao', 'Trung bình', 'Thấp')),
  CONSTRAINT ck_ticket_trangthai CHECK (TrangThai IN ('Chờ xử lý', 'Đang xử lý', 'Đã xử lý')),
  CONSTRAINT ck_ticket_ngay CHECK (NgayXuLy IS NULL OR NgayXuLy >= NgayGui),
  CONSTRAINT fk_ticket_makh FOREIGN KEY (MaKH) REFERENCES KHACHHANG(MaKH),
  CONSTRAINT fk_ticket_maitem FOREIGN KEY (MaItem) REFERENCES SANPHAM_ITEM(MaItem),
  CONSTRAINT fk_ticket_manv_xuly FOREIGN KEY (MaNV_XuLy) REFERENCES NHANVIEN(MaNV),
  INDEX idx_ticket_trangthai (TrangThai, MucDoUuTien)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- TRIGGERS (ràng buộc nghiệp vụ không viết được bằng CHECK)
-- =====================================================================
DELIMITER $$

-- Mỗi khách hàng chỉ có 1 địa chỉ: đơn Online luôn lấy địa chỉ/tên/SĐT từ hồ sơ khách hàng
CREATE TRIGGER trg_hoadon_bi BEFORE INSERT ON HOADON FOR EACH ROW
BEGIN
  DECLARE v_dc  VARCHAR(255);
  DECLARE v_ten VARCHAR(100);
  DECLARE v_sdt VARCHAR(15);
  IF NEW.HinhThucLap = 'Online' THEN
    SELECT DiaChiNhanHang, HoTen, SoDienThoai INTO v_dc, v_ten, v_sdt
      FROM KHACHHANG WHERE MaKH = NEW.MaKH;
    IF v_dc IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khách hàng chưa có địa chỉ nhận hàng';
    END IF;
    SET NEW.DiaChiGiaoHang = v_dc;
    SET NEW.TenNguoiNhan   = v_ten;
    SET NEW.SDTNguoiNhan   = v_sdt;
  END IF;
END$$

CREATE TRIGGER trg_hoadon_bu BEFORE UPDATE ON HOADON FOR EACH ROW
BEGIN
  IF NEW.HinhThucLap = 'Online' AND (
       NOT (NEW.DiaChiGiaoHang <=> OLD.DiaChiGiaoHang) OR
       NOT (NEW.TenNguoiNhan   <=> OLD.TenNguoiNhan)   OR
       NOT (NEW.SDTNguoiNhan   <=> OLD.SDTNguoiNhan)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Đơn Online chỉ được giao về địa chỉ trong hồ sơ khách hàng';
  END IF;
  IF OLD.TrangThaiDonHang IN ('Hoàn thành','Đã hủy') AND NEW.TrangThaiDonHang <> OLD.TrangThaiDonHang THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Đơn đã kết thúc, không thể đổi trạng thái (không có trả hàng)';
  END IF;
END$$

-- Chỉ được đánh giá khi đơn đã hoàn thành
CREATE TRIGGER trg_ctdh_bu BEFORE UPDATE ON CHITIETDONHANG FOR EACH ROW
BEGIN
  DECLARE v_tt VARCHAR(30);
  IF NEW.DiemDanhGia IS NOT NULL OR NEW.NhanXet IS NOT NULL THEN
    SELECT TrangThaiDonHang INTO v_tt FROM HOADON WHERE MaHD = NEW.MaHD;
    IF v_tt <> 'Hoàn thành' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ được đánh giá khi đơn hàng đã hoàn thành';
    END IF;
  END IF;
END$$

-- Ticket chỉ được tạo cho thiết bị mà chính khách hàng đó đã mua
CREATE TRIGGER trg_ticket_bi BEFORE INSERT ON TICKET FOR EACH ROW
BEGIN
  DECLARE v_kh VARCHAR(10);
  IF NEW.MaItem IS NOT NULL THEN
    SELECT h.MaKH INTO v_kh
      FROM SANPHAM_ITEM i JOIN HOADON h ON h.MaHD = i.MaHD
     WHERE i.MaItem = NEW.MaItem;
    IF v_kh IS NULL OR v_kh <> NEW.MaKH THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Thiết bị này chưa được bán cho khách hàng tạo ticket';
    END IF;
  END IF;
END$$

DELIMITER ;

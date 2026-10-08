import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/config/database.js';
const config = loadConfig();
const pool = createPool(config);
const rooms = [
  { number: '801', name: 'Deluxe Skyline', type: 'deluxe', price: 1650000, capacity: 2, size: 34, bed: '1 giường King',
    view: 'Toàn cảnh thành phố', floor: 8, featured: true,
    amenities: ['Bữa sáng', 'Bồn tắm', 'Wi-Fi tốc độ cao', 'Smart TV', 'Minibar'],
    description: 'Không gian thư thái trên tầng cao với cửa sổ tràn viền, chất liệu gỗ ấm và góc đọc sách nhìn ra đường chân trời.',
    palette: ['#a9c7c2', '#ead9bc', '#234d5f'] },
  { number: '503', name: 'Premier Garden', type: 'premier', price: 1850000, capacity: 2, size: 38, bed: '1 giường King',
    view: 'Vườn nhiệt đới', floor: 5, featured: true,
    amenities: ['Ban công riêng', 'Bữa sáng', 'Máy pha cà phê', 'Áo choàng tắm'],
    description: 'Một khoảng xanh riêng tư giữa thành phố, với ban công rộng và thiết kế nhẹ nhàng lấy cảm hứng từ thiên nhiên.',
    palette: ['#79967d', '#e8dfc9', '#173f39'] },
  { number: '606', name: 'Family Haven', type: 'family', price: 2650000, capacity: 4, size: 52, bed: '1 King + 2 giường đơn',
    view: 'Hồ bơi & sân trong', floor: 6, featured: true,
    amenities: ['Phòng khách', 'Bồn tắm', 'Bữa sáng 4 khách', 'Bàn ăn', 'Nôi theo yêu cầu'],
    description: 'Căn phòng rộng rãi dành cho gia đình, tách biệt khu nghỉ và khu sinh hoạt để mọi thành viên đều thoải mái.',
    palette: ['#d4a574', '#efe3ce', '#2d5966'] },
  { number: '1002', name: 'Executive River', type: 'executive', price: 2350000, capacity: 2, size: 42, bed: '1 giường King',
    view: 'Hướng sông', floor: 10, featured: false,
    amenities: ['Executive lounge', 'Bữa sáng', 'Bàn làm việc', 'Late check-out'],
    description: 'Tĩnh lặng, riêng tư và đầy đủ tiện nghi cho chuyến công tác hoặc kỳ nghỉ cuối tuần sang trọng.',
    palette: ['#7596a5', '#ddc9a7', '#17384d'] },
  { number: '1201', name: 'CloudStay Suite', type: 'suite', price: 3450000, capacity: 3, size: 68, bed: '1 King + sofa giường',
    view: 'Góc nhìn 270°', floor: 12, featured: true,
    amenities: ['Phòng khách riêng', 'Bồn tắm lớn', 'Bữa sáng', 'Quầy bar', 'Butler theo giờ'],
    description: 'Hạng phòng đặc trưng của CloudStay với phòng khách riêng, tầm nhìn rộng và từng chi tiết được chăm chút.',
    palette: ['#b48a5a', '#eadfcf', '#1b4051'] },
  { number: '407', name: 'Twin Comfort', type: 'twin', price: 1250000, capacity: 2, size: 30, bed: '2 giường đơn',
    view: 'Khu phố yên tĩnh', floor: 4, featured: false,
    amenities: ['Wi-Fi tốc độ cao', 'Smart TV', 'Vòi sen mưa', 'Két an toàn'],
    description: 'Lựa chọn gọn gàng và tiện nghi cho hai người, với hai giường riêng cùng ánh sáng tự nhiên dễ chịu.',
    palette: ['#8aa6b1', '#eee4d2', '#315565'] }
];
try {
  for (const r of rooms) await pool.query(
    `INSERT INTO booking.rooms (room_number, name, room_type, price_per_night, capacity, size_sqm, bed_type,
       view_label, floor, featured, equipment, description, palette)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (name) DO UPDATE SET room_number = EXCLUDED.room_number, room_type = EXCLUDED.room_type,
       price_per_night = EXCLUDED.price_per_night, capacity = EXCLUDED.capacity, size_sqm = EXCLUDED.size_sqm,
       bed_type = EXCLUDED.bed_type, view_label = EXCLUDED.view_label, floor = EXCLUDED.floor,
       featured = EXCLUDED.featured, equipment = EXCLUDED.equipment, description = EXCLUDED.description,
       palette = EXCLUDED.palette, updated_at = now()`,
    [r.number, r.name, r.type, r.price, r.capacity, r.size, r.bed, r.view, r.floor, r.featured,
      JSON.stringify(r.amenities), r.description, JSON.stringify(r.palette)]);
  console.log(JSON.stringify({ service: config.serviceName, event: 'seed_complete', rooms: rooms.length }));
} finally { await pool.end(); }
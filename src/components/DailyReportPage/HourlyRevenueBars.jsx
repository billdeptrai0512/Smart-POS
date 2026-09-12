import { BarChart, Bar, CartesianGrid, XAxis } from 'recharts'

// Tách khỏi SalesCard CHỈ để giữ recharts (vendor-charts, ~105KB gz) ra khỏi chunk vào
// trang — SalesCard render ở tab mặc định (Dòng tiền) nên import tĩnh ở đó khiến mọi lần
// mở /daily-report phải tải + parse xong recharts rồi mới mount được. Xem lazy() ở SalesCard.
export default function HourlyRevenueBars({ width, height, data, renderBar }) {
    return (
        <BarChart width={width} height={height} data={data} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#44403c" vertical={false} />
            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} tickMargin={10} />
            <Bar dataKey="hourRevenue" shape={renderBar} />
        </BarChart>
    )
}

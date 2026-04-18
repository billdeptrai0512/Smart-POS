import { TrendingUp } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, Tooltip as RechartsTooltip } from 'recharts'
import { formatVND } from '../../utils'

export default function RevenueChart({ lineChartData }) {
    return (
        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60">
            <div className="flex flex-col mb-4 pl-2">
                <div className="flex justify-between items-center gap-2">
                    <h3 className="text-[13px] font-black uppercase text-text-second">Dòng tiền</h3>
                    <TrendingUp className="text-warning" size={20} />
                </div>
            </div>

            {lineChartData.length > 0 ? (
                <div className="h-[220px] w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={lineChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#44403c" vertical={false} />
                            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} tickMargin={10} />
                            <RechartsTooltip
                                contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c', borderRadius: '12px' }}
                                itemStyle={{ color: '#f59e0b', fontSize: '13px', fontWeight: 'bold' }}
                                formatter={(value) => [formatVND(value), 'Doanh thu']}
                                labelStyle={{ color: '#fafaf9', fontWeight: 'bold', marginBottom: '4px' }}
                            />
                            <Line type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={4} dot={{ fill: '#1c1917', stroke: '#f59e0b', strokeWidth: 3, r: 4 }} activeDot={{ r: 7, fill: '#f59e0b', stroke: '#fff', strokeWidth: 2 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                    Chưa có dòng tiền trong ngày
                </div>
            )}
        </div>
    )
}

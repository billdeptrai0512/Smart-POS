import { Building2, Users } from 'lucide-react'

export default function AddressHeader({ isStaff, activeTab, setActiveTab, profile, dateOnly, setError, addressCount, staffCount }) {
    return (
        <header className="shrink-0 pt-6 pb-6 bg-surface border-b border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.03)] relative z-20">
            <div className="px-6">
                {!isStaff ? (
                    <div className="grid grid-cols-2 gap-3">
                        {/* Card trái: user + Cơ sở tab */}
                        <button
                            onClick={() => { setActiveTab('branches'); setError('') }}
                            className={`rounded-[20px] p-3 sm:p-3.5 border text-left flex flex-col justify-between gap-[2px] relative overflow-hidden transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${activeTab === 'branches'
                                ? 'bg-primary/5 border-primary/20 shadow-[0_4px_20px_rgba(245,158,11,0.08)]'
                                : 'bg-bg border-border/60 hover:bg-surface-light'}`}
                        >
                            <div className="flex flex-col justify-between items-start relative z-10">
                                <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">Xin chào</span>
                                <span className={`text-[15px] sm:text-[16px] font-black tracking-tight leading-none ${activeTab === 'branches' ? 'text-primary' : 'text-text'}`}>
                                    {profile?.name || '...'}
                                </span>
                            </div>
                            <div className={`w-full h-[1px] rounded-full relative z-10 my-[3px] mt-[4px] ${activeTab === 'branches' ? 'bg-primary/20' : 'bg-border/60'}`} />
                            <div className="flex items-center gap-1.5 relative z-10 mt-[6px]">
                                <Building2 size={13} className={activeTab === 'branches' ? 'text-primary' : 'text-text-secondary'} />
                                <span className={`text-[12px] sm:text-[13px] font-black uppercase tracking-wider ${activeTab === 'branches' ? 'text-primary' : 'text-text-secondary'}`}>
                                    {addressCount} Cơ sở
                                </span>
                            </div>
                            {activeTab === 'branches' && (
                                <div className="absolute bottom-0 right-0 w-20 h-20 bg-primary/10 rounded-full blur-2xl -mr-8 -mb-8 pointer-events-none" />
                            )}
                        </button>

                        {/* Card phải: ngày + Nhân viên tab */}
                        <button
                            onClick={() => { setActiveTab('staff'); setError('') }}
                            className={`rounded-[20px] p-3 sm:p-3.5 border text-left flex flex-col justify-between gap-[2px] relative overflow-hidden transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${activeTab === 'staff'
                                ? 'bg-primary/5 border-primary/20 shadow-[0_4px_20px_rgba(245,158,11,0.08)]'
                                : 'bg-bg border-border/60 hover:bg-surface-light'}`}
                        >
                            <div className="flex flex-col justify-between items-start relative z-10">
                                <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">Hôm nay</span>
                                <span className={`text-[15px] sm:text-[16px] font-black tracking-tight leading-none ${activeTab === 'staff' ? 'text-primary' : 'text-text'}`}>
                                    {dateOnly}
                                </span>
                            </div>
                            <div className={`w-full h-[1px] rounded-full relative z-10 my-[3px] ${activeTab === 'staff' ? 'bg-primary/20' : 'bg-border/60'}`} />
                            <div className="flex items-center gap-1.5 relative z-10 mt-[6px]">
                                <Users size={13} className={activeTab === 'staff' ? 'text-primary' : 'text-text-secondary'} />
                                <span className={`text-[12px] sm:text-[13px] font-black uppercase tracking-wider ${activeTab === 'staff' ? 'text-primary' : 'text-text-secondary'}`}>
                                    {staffCount} Nhân viên
                                </span>
                            </div>
                            {activeTab === 'staff' && (
                                <div className="absolute bottom-0 right-0 w-20 h-20 bg-primary/10 rounded-full blur-2xl -mr-8 -mb-8 pointer-events-none" />
                            )}
                        </button>
                    </div>
                ) : (
                    /* Staff: simple header, no tab */
                    <div className="bg-bg border border-border/60 rounded-[20px] p-3 sm:p-3.5">
                        <div className="flex flex-col justify-between items-start">
                            <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">Xin chào</span>
                            <span className="text-[15px] sm:text-[16px] text-text font-black tracking-tight leading-none">{profile?.name || '...'}</span>
                        </div>
                        <div className="w-full h-[1px] bg-border/60 rounded-full my-[3px] mt-[4px]" />
                        <div className="flex items-center gap-1.5 mt-[6px]">
                            <Building2 size={13} className="text-text-secondary" />
                            <span className="text-[12px] sm:text-[13px] font-black text-text-secondary uppercase tracking-wider">Chọn địa chỉ</span>
                        </div>
                    </div>
                )}
            </div>
        </header>
    )
}

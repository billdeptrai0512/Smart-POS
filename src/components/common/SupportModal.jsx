import { X } from 'lucide-react'
import zaloImg from '../../assets/zalo.webp'
import facebookImg from '../../assets/facebook.webp'

export const SUPPORT_LINKS = {
    zalo: 'https://zalo.me/g/yvsgvae1kejljidlxyih',
    facebook: 'https://www.facebook.com/groups/1540591197862324',
}

export default function SupportModal({ open, onClose }) {
    if (!open) return null

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4" onClick={onClose}>
            {/* Backdrop blur overlay */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" />
            
            {/* Modal Box */}
            <div 
                className="relative w-full max-w-sm bg-surface border border-border/60 rounded-[24px] shadow-2xl p-6 flex flex-col gap-5 animate-scale-up z-10"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[16px] font-black text-text">Hỗ trợ & Góp ý</span>
                        <span className="text-[12px] text-text-secondary">Chọn kênh liên hệ để được hỗ trợ nhanh nhất</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Options List */}
                <div className="flex flex-col gap-3">
                    {/* Zalo Option */}
                    <a
                        href={SUPPORT_LINKS.zalo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3.5 px-4 py-3 rounded-[14px] bg-[#0068ff]/10 hover:bg-[#0068ff]/15 border border-[#0068ff]/20 text-[#0068ff] transition-all font-bold text-[14px] active:scale-[0.98]"
                    >
                        <img 
                            src={zaloImg} 
                            alt="Zalo" 
                            className="w-8 h-8 rounded-[10px] object-cover shrink-0 shadow-sm"
                        />
                        <div className="flex flex-col text-left">
                            <span className="text-text font-bold">Cộng đồng Zalo</span>
                            <span className="text-[11px] text-text-secondary/80 font-normal">Trao đổi & hỗ trợ kỹ thuật</span>
                        </div>
                    </a>

                    {/* Facebook Option */}
                    <a
                        href={SUPPORT_LINKS.facebook}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3.5 px-4 py-3 rounded-[14px] bg-[#1877f2]/10 hover:bg-[#1877f2]/15 border border-[#1877f2]/20 text-[#1877f2] transition-all font-bold text-[14px] active:scale-[0.98]"
                    >
                        <img 
                            src={facebookImg} 
                            alt="Facebook" 
                            className="w-8 h-8 rounded-[10px] object-cover shrink-0 shadow-sm"
                        />
                        <div className="flex flex-col text-left">
                            <span className="text-text font-bold">Cộng đồng Facebook</span>
                            <span className="text-[11px] text-text-secondary/80 font-normal">Cập nhật tin tức & tính năng mới</span>
                        </div>
                    </a>
                </div>
            </div>
        </div>
    )
}

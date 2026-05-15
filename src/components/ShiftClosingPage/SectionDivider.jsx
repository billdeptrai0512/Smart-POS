export default function SectionDivider({ label }) {
    return (
        <div className="flex items-center gap-3 py-1 mb-3 px-1">
            <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">{label}</span>
            <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
        </div>
    )
}

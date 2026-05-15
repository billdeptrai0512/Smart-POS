import SectionDivider from './SectionDivider'

export default function NoteCard({ note, isSubmitting, onChange }) {
    return (
        <div>
            <SectionDivider label="Ghi chú" />
            <textarea
                placeholder="Ghi chú thêm (tùy chọn)..."
                value={note}
                onChange={e => onChange(e.target.value)}
                disabled={isSubmitting}
                rows={3}
                className="w-full bg-surface border border-border/60 rounded-[20px] px-4 py-3 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors resize-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            />
        </div>
    )
}

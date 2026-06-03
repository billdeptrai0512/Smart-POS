const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cnkvscwmdfkajhotcijl.supabase.co/';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNua3ZzY3dtZGZrYWpob3RjaWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NTM1ODcsImV4cCI6MjA5MDMyOTU4N30.D_Rj0_Z_FU6XX_1Vd5koKXzfxet600sR4TKt9u2lCVI';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
    // 1. Find address KOPHIN 75 QL1K
    const { data: addresses, error: addrErr } = await supabase
        .from('addresses')
        .select('*');
    
    if (addrErr) {
        console.error('Error fetching addresses:', addrErr);
        return;
    }
    
    const targetAddr = addresses.find(a => a.name && a.name.includes('75 QL1K'));
    if (!targetAddr) {
        console.error('Address not found among:', addresses.map(a => a.name));
        return;
    }
    console.log('Found Address:', targetAddr.name, 'ID:', targetAddr.id);
    
    // Range: May 2026 (local time 1/5 to 31/5)
    // Let's call the RPC function get_report_by_range to see what values it actually returns!
    const targetStart = '2026-05-01T00:00:00+07:00';
    const targetEnd = '2026-05-31T23:59:59+07:00';
    const prevStart = '2026-04-01T00:00:00+07:00';
    const prevEnd = '2026-04-30T23:59:59+07:00';
    
    const { data: reportData, error: reportErr } = await supabase.rpc('get_report_by_range', {
        p_address_id: targetAddr.id,
        p_target_start: new Date(targetStart).toISOString(),
        p_target_end: new Date(targetEnd).toISOString(),
        p_prev_start: new Date(prevStart).toISOString(),
        p_prev_end: new Date(prevEnd).toISOString()
    });
    
    if (reportErr) {
        console.error('Error from RPC get_report_by_range:', reportErr);
        return;
    }
    
    console.log('Report Data keys:', Object.keys(reportData));
    
    const orders = reportData.target_orders || [];
    const expenses = reportData.target_expenses || [];
    const payments = reportData.target_payments || [];
    const shiftClosings = reportData.target_shift_closings || [];
    
    console.log('Orders Count:', orders.length);
    console.log('Expenses Count:', expenses.length);
    console.log('Payments Count:', payments.length);
    console.log('Shift Closings Count:', shiftClosings.length);
    
    // Now let's calculate totals like ReportStats/CashFlowCard does.
    // First, calculateSyncedCashFlow (actualCash, actualTransfer)
    const closingMap = new Map();
    shiftClosings.forEach(s => {
        // Date key in VN
        const d = new Date(s.closed_at || s.created_at);
        // Date string VN
        const dateStr = d.toLocaleDateString('sv-SE'); // YYYY-MM-DD
        if (!closingMap.has(dateStr)) {
            closingMap.set(dateStr, { cash: 0, transfer: 0 });
        }
        const val = closingMap.get(dateStr);
        val.cash += s.actual_cash || 0;
        val.transfer += s.actual_transfer || 0;
    });
    
    const ordersByDate = new Map();
    orders.filter(o => !o.deleted_at).forEach(o => {
        const d = new Date(o.created_at || o.createdAt);
        const dateStr = d.toLocaleDateString('sv-SE');
        if (!ordersByDate.has(dateStr)) {
            ordersByDate.set(dateStr, []);
        }
        ordersByDate.get(dateStr).push(o);
    });
    
    const allDates = new Set([...closingMap.keys(), ...ordersByDate.keys()]);
    let totalCash = 0;
    let totalTransfer = 0;
    
    allDates.forEach(dateStr => {
        if (closingMap.has(dateStr)) {
            const closing = closingMap.get(dateStr);
            totalCash += closing.cash;
            totalTransfer += closing.transfer;
        } else {
            const dateOrders = ordersByDate.get(dateStr) || [];
            const cash = dateOrders.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.total || 0), 0);
            const transfer = dateOrders.filter(o => o.payment_method !== 'cash').reduce((sum, o) => sum + (o.total || 0), 0);
            totalCash += cash;
            totalTransfer += transfer;
        }
    });
    
    console.log('Synced Actual Cash (liveCash):', totalCash);
    console.log('Synced Actual Transfer (liveTransfer):', totalTransfer);
    
    // Group payments / expenses
    let inShiftRefillCash = 0;
    let inShiftOpsCash = 0;
    let postCloseCashOut = 0;
    let transferRefill = 0;
    
    for (const p of payments) {
        if (p.invoice_metadata?.adjustment) continue;
        const amt = Number(p.amount) || 0;
        if (p.payment_method === 'transfer') {
            transferRefill += amt;
            continue;
        }
        if (p.invoice_metadata?.cash_phase === 'in_shift') {
            inShiftRefillCash += amt;
        } else {
            postCloseCashOut += amt;
        }
    }
    
    const shiftExpenses = expenses.filter(e => !e.is_refill);
    for (const e of shiftExpenses) {
        if (e.metadata?.adjustment) continue;
        inShiftOpsCash += Number(e.amount) || 0;
    }
    
    const afterShiftOps = expenses.filter(e => e.is_refill && e.metadata?.free_form);
    for (const e of afterShiftOps) {
        if (e.metadata?.adjustment) continue;
        const amt = Number(e.amount) || 0;
        if (e.payment_method === 'transfer') {
            transferRefill += amt;
        } else {
            postCloseCashOut += amt;
        }
    }
    
    const inShiftCashOut = inShiftRefillCash + inShiftOpsCash;
    const actualTotal = totalCash + totalTransfer + inShiftCashOut;
    const takeHomeCash = Math.max(0, totalCash - postCloseCashOut);
    const takeHomeTransfer = Math.max(0, totalTransfer - transferRefill);
    const takeHome = takeHomeCash + takeHomeTransfer;
    
    console.log('--- computeCashFlowTotals Results ---');
    console.log('inShiftRefillCash:', inShiftRefillCash);
    console.log('inShiftOpsCash:', inShiftOpsCash);
    console.log('postCloseCashOut:', postCloseCashOut);
    console.log('transferRefill:', transferRefill);
    console.log('inShiftCashOut:', inShiftCashOut);
    console.log('actualTotal (Tổng thực thu):', actualTotal);
    console.log('takeHomeCash (Tiền mặt thực tế):', takeHomeCash);
    console.log('takeHomeTransfer (Chuyển khoản thực tế):', takeHomeTransfer);
    console.log('takeHome (Tổng thực nhận):', takeHome);
    
    // Let's print out if any of the days had negative balance
    console.log('--- Day by Day details ---');
    // Sort dates
    const sortedDates = [...allDates].sort();
    let computedCumulativeTakeHome = 0;
    
    for (const dateStr of sortedDates) {
        const dayShiftClosings = shiftClosings.filter(s => {
            const d = new Date(s.closed_at || s.created_at);
            return d.toLocaleDateString('sv-SE') === dateStr;
        });
        
        let dayCash = 0;
        let dayTransfer = 0;
        
        if (dayShiftClosings.length > 0) {
            dayCash = dayShiftClosings.reduce((sum, s) => sum + (s.actual_cash || 0), 0);
            dayTransfer = dayShiftClosings.reduce((sum, s) => sum + (s.actual_transfer || 0), 0);
        } else {
            const dateOrders = ordersByDate.get(dateStr) || [];
            dayCash = dateOrders.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.total || 0), 0);
            dayTransfer = dateOrders.filter(o => o.payment_method !== 'cash').reduce((sum, o) => sum + (o.total || 0), 0);
        }
        
        // Payments on this day
        const dayPayments = payments.filter(p => {
            const d = new Date(p.paid_at);
            return d.toLocaleDateString('sv-SE') === dateStr;
        });
        
        // Expenses on this day
        const dayExpenses = expenses.filter(e => {
            const d = new Date(e.created_at);
            return d.toLocaleDateString('sv-SE') === dateStr;
        });
        
        let dayPostCloseCashOut = 0;
        let dayTransferRefill = 0;
        
        for (const p of dayPayments) {
            if (p.invoice_metadata?.adjustment) continue;
            const amt = Number(p.amount) || 0;
            if (p.payment_method === 'transfer') {
                dayTransferRefill += amt;
            } else if (p.invoice_metadata?.cash_phase !== 'in_shift') {
                dayPostCloseCashOut += amt;
            }
        }
        
        const dayAfterShiftOps = dayExpenses.filter(e => e.is_refill && e.metadata?.free_form);
        for (const e of dayAfterShiftOps) {
            if (e.metadata?.adjustment) continue;
            const amt = Number(e.amount) || 0;
            if (e.payment_method === 'transfer') {
                dayTransferRefill += amt;
            } else {
                dayPostCloseCashOut += amt;
            }
        }
        
        const dayTakeHomeCashRaw = dayCash - dayPostCloseCashOut;
        const dayTakeHomeTransferRaw = dayTransfer - dayTransferRefill;
        
        console.log(`${dateStr} | closing? ${dayShiftClosings.length > 0} | cash: ${dayCash} | transfer: ${dayTransfer} | postCloseCashOut: ${dayPostCloseCashOut} | transferRefill: ${dayTransferRefill} | cashRaw: ${dayTakeHomeCashRaw} | transferRaw: ${dayTakeHomeTransferRaw}`);
    }
}

run();

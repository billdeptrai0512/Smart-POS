import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDateRange } from './ReportHeader';

describe('getDateRange', () => {
    beforeEach(() => {
        // Mock current date to be fixed for predictable tests
        // Set to Monday, April 27, 2026, 12:00:00 (Local time)
        vi.useFakeTimers();
        const mockDate = new Date(2026, 3, 27, 12, 0, 0); // Month is 0-indexed (3 = April)
        vi.setSystemTime(mockDate);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('range: day', () => {
        it('should return correct range for current day (offset = 0)', () => {
            const { start, end, days } = getDateRange('day', 0);
            expect(start.getDate()).toBe(27);
            expect(start.getHours()).toBe(0);
            expect(end.getDate()).toBe(27);
            expect(end.getHours()).toBe(23);
            expect(days).toBe(1);
        });
    });

    describe('range: week', () => {
        it('should return correct days for current week from monday up to today (offset = 0)', () => {
            // April 27, 2026 is a Monday
            const { start, end, days } = getDateRange('week', 0);

            // Start should be Monday (April 27) at 00:00:00
            expect(start.getDate()).toBe(27);
            expect(start.getHours()).toBe(0);

            // End should be Sunday of this week (27 + 6 = May 3)
            expect(end.getDate()).toBe(3);
            expect(end.getMonth()).toBe(4); // May

            // Since today is Monday (start of the week), elapsed days = 1
            expect(days).toBe(1);
        });

        it('should return correct days for previous week (offset = -1)', () => {
            // Last week should start on April 20
            const { start, end, days } = getDateRange('week', -1);

            expect(start.getDate()).toBe(20);
            expect(end.getDate()).toBe(26);
            expect(days).toBe(7); // Last week has full 7 days passed
        });

        it('should calculate days correctly if today is Wednesday', () => {
            // Set clock to Wednesday (April 29, 2026)
            vi.setSystemTime(new Date(2026, 3, 29, 12, 0, 0));
            const { days } = getDateRange('week', 0);
            expect(days).toBe(3); // Mon, Tue, Wed -> 3 days
        });

        it('should calculate days correctly if today is Sunday', () => {
            // Set clock to Sunday (May 3, 2026)
            vi.setSystemTime(new Date(2026, 4, 3, 12, 0, 0));
            const { days } = getDateRange('week', 0);
            expect(days).toBe(7); // Full week passed
        });
    });

    describe('range: month', () => {
        it('should return correct days up to today for current month (offset = 0)', () => {
            // Current is April 27, 2026
            const { start, end, days } = getDateRange('month', 0);

            expect(start.getDate()).toBe(1); // 1st of April
            expect(end.getDate()).toBe(27); // Current day is 27th
            expect(days).toBe(27); // 27 days have passed
        });

        it('should return all days of previous month (offset = -1)', () => {
            // Previous month is March, which has 31 days
            const { start, end, days } = getDateRange('month', -1);

            expect(start.getMonth()).toBe(2); // March (index 2)
            expect(start.getDate()).toBe(1);

            expect(end.getMonth()).toBe(2);
            expect(end.getDate()).toBe(31);

            expect(days).toBe(31);
        });

        it('should return all days of February in a leap year (mock edge case)', () => {
            // Set clock to March 15, 2024 (2024 is a leap year)
            vi.setSystemTime(new Date(2024, 2, 15, 12, 0, 0));
            // Get previous month (offset = -1), which should be February
            const { start, end, days } = getDateRange('month', -1);

            expect(start.getMonth()).toBe(1); // Feb
            expect(end.getMonth()).toBe(1); // Feb
            expect(end.getDate()).toBe(29);
            expect(days).toBe(29);
        });

        it('should return correct days if today is the 1st of the month', () => {
            // Set clock to April 1, 2026
            vi.setSystemTime(new Date(2026, 3, 1, 12, 0, 0));
            const { days } = getDateRange('month', 0);

            expect(days).toBe(1);
        });
    });
});

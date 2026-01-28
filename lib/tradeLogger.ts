import * as fs from 'fs';
import * as path from 'path';

const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function getDateString(date: Date = new Date()): string {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getLogFilePath(date: Date = new Date()): string {
    return path.join(LOGS_DIR, `${getDateString(date)}.json`);
}

export interface TradeLog {
    timestamp: string;
    symbol: string;
    side: 'buy' | 'sell';
    price: number;
    qty: number;
    notional: number;
    threshold?: number;
    orderId?: string;
}

function readLogFile(date: Date = new Date()): TradeLog[] {
    const filePath = getLogFilePath(date);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

function writeLogFile(trades: TradeLog[], date: Date = new Date()): void {
    const filePath = getLogFilePath(date);
    fs.writeFileSync(filePath, JSON.stringify(trades, null, 2));
}

export function logTrade(trade: Omit<TradeLog, 'timestamp'>): void {
    const trades = readLogFile();
    trades.push({
        ...trade,
        timestamp: new Date().toISOString(),
    });
    writeLogFile(trades);
}

export function getTodaysTrades(): TradeLog[] {
    return readLogFile(new Date());
}

export function getYesterdaysTrades(): TradeLog[] {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return readLogFile(yesterday);
}

export function formatTradesForDiscord(trades: TradeLog[], dateLabel: string): string {
    if (trades.length === 0) {
        return `**${dateLabel}**\nNo trades placed.`;
    }

    const buyTrades = trades.filter(t => t.side === 'buy');
    const sellTrades = trades.filter(t => t.side === 'sell');
    
    const totalBuyNotional = buyTrades.reduce((sum, t) => sum + t.notional, 0);
    const totalSellNotional = sellTrades.reduce((sum, t) => sum + t.notional, 0);

    const lines = [
        `**${dateLabel}**`,
        `📊 **${trades.length} trades** (${buyTrades.length} buys, ${sellTrades.length} sells)`,
        '',
    ];

    // Group by symbol
    const bySymbol: Record<string, TradeLog[]> = {};
    for (const trade of trades) {
        if (!bySymbol[trade.symbol]) bySymbol[trade.symbol] = [];
        bySymbol[trade.symbol].push(trade);
    }

    for (const [symbol, symbolTrades] of Object.entries(bySymbol)) {
        const buys = symbolTrades.filter(t => t.side === 'buy');
        const sells = symbolTrades.filter(t => t.side === 'sell');
        
        let line = `**${symbol}**: `;
        if (buys.length > 0) {
            line += `🟢 ${buys.length} buy${buys.length > 1 ? 's' : ''} `;
        }
        if (sells.length > 0) {
            line += `🔴 ${sells.length} sell${sells.length > 1 ? 's' : ''} `;
        }
        lines.push(line);
        
        for (const trade of symbolTrades) {
            const emoji = trade.side === 'buy' ? '🟢' : '🔴';
            const time = new Date(trade.timestamp).toLocaleTimeString();
            lines.push(`  ${emoji} ${trade.qty.toFixed(4)} @ $${trade.price.toFixed(2)} (${time})`);
        }
    }

    lines.push('');
    lines.push(`💰 Total: $${totalBuyNotional.toFixed(2)} bought, $${totalSellNotional.toFixed(2)} sold`);

    return lines.join('\n');
}

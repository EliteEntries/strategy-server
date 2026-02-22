import { getCandles, getPrices } from 'elite-entries';
import { loadPortfolioConfig } from './portfolioAnalyzer';

// ── Types ──────────────────────────────────────────────
interface SymbolYTD {
    symbol: string;
    ytdStartPrice: number;
    currentPrice: number;
    change: number;
    percentChange: number;
    // Position-level data (if we hold it)
    avgCost: number | null;
    quantity: number | null;
    costBasisReturn: number | null;  // (current - avgCost) / avgCost — total return
    positionYTD: number | null;      // Modified Dietz return accounting for buys/sells
    positionYTDDollar: number | null; // actual $ P/L on the position YTD
    ytdBuys: number;                  // number of buy fills YTD
    ytdSells: number;                 // number of sell fills YTD
    totalCostBasis: number | null;    // qty × avgCost — total capital deployed
    unrealizedPL: number | null;
    positionValue: number | null;
}

interface FundYTD {
    startValue: number;
    currentValue: number;
    change: number;
    percentChange: number;
    positions: {
        symbol: string;
        quantity: number;
        startPrice: number;
        currentPrice: number;
        startValue: number;
        currentValue: number;
        change: number;
        percentChange: number;
        weight: number;
        contribution: number; // weighted contribution to fund return
    }[];
}

// ── Helpers ────────────────────────────────────────────
function getYTDStart(): Date {
    const now = new Date();
    // First trading day of the year (Jan 2 or first weekday after)
    const jan2 = new Date(now.getFullYear(), 0, 2);
    const day = jan2.getDay();
    if (day === 0) jan2.setDate(3); // Sunday -> Monday
    if (day === 6) jan2.setDate(4); // Saturday -> Monday
    return jan2;
}

// ── Fetch a single symbol's Jan 2 close price ─────────
async function getYTDStartPrice(symbol: string, ytdStart: Date): Promise<number | null> {
    try {
        const candles = await getCandles({
            symbols: [symbol],
            timeframe: '1Day',
            limit: 1,
            start: ytdStart,
            end: new Date(ytdStart.getTime() + 24 * 60 * 60 * 1000),
        });
        // candles is a Map-like iterable — grab first entry
        for (const [, bars] of candles) {
            if (bars?.length) return bars[0].ClosePrice;
        }
    } catch { /* symbol may not have existed at YTD start */ }
    return null;
}

// ── Fetch filled orders from Alpaca API ────────────────
interface FilledOrder {
    symbol: string;
    side: 'buy' | 'sell';
    filledQty: number;
    filledPrice: number;
    filledAt: Date;
}

async function getYTDOrders(): Promise<FilledOrder[]> {
    const key = process.env.ALPACA_KEY;
    const secret = process.env.ALPACA_SECRET;
    if (!key || !secret) return [];

    const ytdStart = getYTDStart();
    const allOrders: FilledOrder[] = [];
    let after = ytdStart.toISOString();
    // Paginate through all closed orders YTD
    while (true) {
        const url = `https://api.alpaca.markets/v2/orders?status=closed&after=${after}&limit=500&direction=asc`;
        const res = await fetch(url, {
            headers: {
                'APCA-API-KEY-ID': key,
                'APCA-API-SECRET-KEY': secret,
            },
        });
        if (!res.ok) break;
        const orders: any[] = await res.json();
        if (orders.length === 0) break;
        for (const o of orders) {
            if (o.status === 'filled' && o.filled_at && parseFloat(o.filled_qty) > 0) {
                allOrders.push({
                    symbol: o.symbol,
                    side: o.side,
                    filledQty: parseFloat(o.filled_qty),
                    filledPrice: parseFloat(o.filled_avg_price),
                    filledAt: new Date(o.filled_at),
                });
            }
        }
        if (orders.length < 500) break;
        // Next page: use last order's created_at
        after = orders[orders.length - 1].created_at;
    }
    return allOrders;
}

// ── Modified Dietz return for a symbol's position ──────
// Accounts for the actual cashflows (buys/sells) during the period
function calcPositionYTD(
    startQty: number,
    startPrice: number,
    currentPrice: number,
    orders: FilledOrder[],
    ytdStart: Date,
): { returnPct: number; dollarPL: number } {
    const now = new Date();
    const totalDays = (now.getTime() - ytdStart.getTime()) / (1000 * 60 * 60 * 24);
    if (totalDays <= 0) return { returnPct: 0, dollarPL: 0 };

    // Starting value of the position on Jan 2
    const startValue = startQty * startPrice;

    // Track cashflows: buys are positive (capital in), sells are negative (capital out)
    let totalCashflow = 0;
    let weightedCashflow = 0;
    let runningQty = startQty;
    let endQty = startQty;

    for (const order of orders) {
        const daysSinceStart = (order.filledAt.getTime() - ytdStart.getTime()) / (1000 * 60 * 60 * 24);
        const weight = 1 - (daysSinceStart / totalDays); // weight: 1 at start, 0 at end
        const cashflow = order.filledQty * order.filledPrice;

        if (order.side === 'buy') {
            totalCashflow += cashflow;
            weightedCashflow += cashflow * weight;
            endQty += order.filledQty;
        } else {
            totalCashflow -= cashflow;
            weightedCashflow -= cashflow * weight;
            endQty -= order.filledQty;
        }
    }

    // End value = current shares × current price
    const endValue = endQty * currentPrice;

    // Modified Dietz: R = (endValue - startValue - totalCashflow) / (startValue + weightedCashflow)
    const gain = endValue - startValue - totalCashflow;
    const avgCapital = startValue + weightedCashflow;

    if (avgCapital <= 0) {
        // Position was opened entirely this year, no starting value
        // Simple return: gain / total invested
        const totalInvested = totalCashflow > 0 ? totalCashflow : 1;
        return { returnPct: (gain / totalInvested) * 100, dollarPL: gain };
    }

    return { returnPct: (gain / avgCapital) * 100, dollarPL: gain };
}

// ── Fetch our positions from Firebase ──────────────────
interface PositionData {
    symbol: string;
    quantity: number;
    avgCost: number;
    unrealizedPL: number;
    value: number;
}

async function getFirebasePositions(): Promise<Map<string, PositionData>> {
    const config = await loadPortfolioConfig();
    const admin = await import('firebase-admin');
    let db: FirebaseFirestore.Firestore;
    if (admin.apps.length) {
        db = admin.apps[0]!.firestore();
    } else {
        const { join } = await import('path');
        const sa = require(join(process.cwd(), 'eliteentries-algo-firebase-adminsdk-orrvo-c5c6d152c8.json'));
        admin.initializeApp({ credential: admin.credential.cert(sa) });
        db = admin.firestore();
    }
    const doc = await db
        .collection(config.firebase.collection)
        .doc(config.firebase.document)
        .get();
    if (!doc.exists) return new Map();
    const data = doc.data()!;
    const raw: any[] = data.positions || [];
    const map = new Map<string, PositionData>();
    for (const p of raw) {
        map.set(p.symbol, {
            symbol: p.symbol,
            quantity: parseFloat(p.quantity) || 0,
            avgCost: parseFloat(p.average) || 0,
            unrealizedPL: parseFloat(p.PL) || 0,
            value: parseFloat(p.value) || 0,
        });
    }
    return map;
}

async function getFirebaseAccountData(): Promise<{ equity: number; positions: Map<string, PositionData> }> {
    const config = await loadPortfolioConfig();
    const admin = await import('firebase-admin');
    let db: FirebaseFirestore.Firestore;
    if (admin.apps.length) {
        db = admin.apps[0]!.firestore();
    } else {
        const { join } = await import('path');
        const sa = require(join(process.cwd(), 'eliteentries-algo-firebase-adminsdk-orrvo-c5c6d152c8.json'));
        admin.initializeApp({ credential: admin.credential.cert(sa) });
        db = admin.firestore();
    }
    const doc = await db
        .collection(config.firebase.collection)
        .doc(config.firebase.document)
        .get();
    if (!doc.exists) throw new Error('Alpaca document not found');
    const data = doc.data()!;
    const raw: any[] = data.positions || [];
    const positions = new Map<string, PositionData>();
    for (const p of raw) {
        positions.set(p.symbol, {
            symbol: p.symbol,
            quantity: parseFloat(p.quantity) || 0,
            avgCost: parseFloat(p.average) || 0,
            unrealizedPL: parseFloat(p.PL) || 0,
            value: parseFloat(p.value) || 0,
        });
    }
    return { equity: parseFloat(data.equity) || 0, positions };
}

// ── Get YTD for specific symbols ───────────────────────
export async function getSymbolsYTD(symbols: string[]): Promise<string> {
    const upperSymbols = symbols.map(s => s.toUpperCase());
    const ytdStart = getYTDStart();

    // Fetch candles individually (API returns Map-like object that loses entries when batched)
    const startPrices = new Map<string, number>();
    await Promise.all(upperSymbols.map(async (sym) => {
        const price = await getYTDStartPrice(sym, ytdStart);
        if (price !== null) startPrices.set(sym, price);
    }));

    // Get current prices, positions, and order history
    const [currentPrices, positions, allOrders] = await Promise.all([
        getPrices({ symbols: upperSymbols }),
        getFirebasePositions(),
        getYTDOrders(),
    ]);

    // Group orders by symbol
    const ordersBySymbol = new Map<string, FilledOrder[]>();
    for (const o of allOrders) {
        if (!ordersBySymbol.has(o.symbol)) ordersBySymbol.set(o.symbol, []);
        ordersBySymbol.get(o.symbol)!.push(o);
    }

    const results: SymbolYTD[] = [];

    for (const symbol of upperSymbols) {
        const startPrice = startPrices.get(symbol);
        const priceData = currentPrices.get(symbol);
        const pos = positions.get(symbol);
        const symbolOrders = ordersBySymbol.get(symbol) || [];
        const ytdBuys = symbolOrders.filter(o => o.side === 'buy').length;
        const ytdSells = symbolOrders.filter(o => o.side === 'sell').length;

        if (!startPrice || !priceData) {
            results.push({
                symbol,
                ytdStartPrice: 0,
                currentPrice: 0,
                change: 0,
                percentChange: 0,
                avgCost: pos?.avgCost ?? null,
                quantity: pos?.quantity ?? null,
                costBasisReturn: null,
                positionYTD: null,
                positionYTDDollar: null,
                ytdBuys,
                ytdSells,
                totalCostBasis: pos ? pos.quantity * pos.avgCost : null,
                unrealizedPL: pos?.unrealizedPL ?? null,
                positionValue: pos?.value ?? null,
            });
            continue;
        }

        const currentPrice = priceData.Price;
        const change = currentPrice - startPrice;
        const percentChange = (change / startPrice) * 100;

        let costBasisReturn: number | null = null;
        let positionYTD: number | null = null;
        let positionYTDDollar: number | null = null;
        if (pos && pos.avgCost > 0) {
            costBasisReturn = ((currentPrice - pos.avgCost) / pos.avgCost) * 100;

            // Derive Jan 2 starting qty: current qty minus net buys since
            let startQty = pos.quantity;
            for (const o of symbolOrders) {
                if (o.side === 'buy') startQty -= o.filledQty;
                else startQty += o.filledQty;
            }
            startQty = Math.max(startQty, 0); // can't be negative

            // Modified Dietz return accounting for all cashflows
            const dietz = calcPositionYTD(startQty, startPrice, currentPrice, symbolOrders, ytdStart);
            positionYTD = dietz.returnPct;
            positionYTDDollar = dietz.dollarPL;
        }

        results.push({
            symbol,
            ytdStartPrice: startPrice,
            currentPrice,
            change,
            percentChange,
            avgCost: pos?.avgCost ?? null,
            quantity: pos?.quantity ?? null,
            costBasisReturn,
            positionYTD,
            positionYTDDollar,
            ytdBuys,
            ytdSells,
            totalCostBasis: pos ? pos.quantity * pos.avgCost : null,
            unrealizedPL: pos?.unrealizedPL ?? null,
            positionValue: pos?.value ?? null,
        });
    }

    // Format output
    const lines: string[] = [
        `**📈 YTD Performance**`,
        '',
    ];

    const sorted = results.sort((a, b) => b.percentChange - a.percentChange);
    for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i];
        if (i > 0) lines.push('');
        if (r.ytdStartPrice === 0) {
            lines.push(`❓ **${r.symbol}** — No data available`);
            continue;
        }
        const emoji = r.percentChange >= 0 ? '🟢' : '🔴';
        const sign = r.percentChange >= 0 ? '+' : '';
        lines.push(`${emoji} **${r.symbol}** — Stock: ${sign}${r.percentChange.toFixed(2)}% ($${r.ytdStartPrice.toFixed(2)} → $${r.currentPrice.toFixed(2)})`);

        // Show position metrics if we hold it
        if (r.avgCost !== null && r.costBasisReturn !== null && r.quantity !== null) {
            // Position YTD (Modified Dietz — accounts for buys/sells)
            if (r.positionYTD !== null) {
                const ytdPct = r.positionYTD;
                const ytdPL = r.positionYTDDollar ?? 0;
                const ytdEmoji = ytdPct >= 0 ? '🟢' : '🔴';
                const ytdPctSign = ytdPct >= 0 ? '+' : '';
                const ytdPlSign = ytdPL >= 0 ? '+' : '';
                let activity = '';
                if (r.ytdBuys > 0 || r.ytdSells > 0) {
                    const parts: string[] = [];
                    if (r.ytdBuys > 0) parts.push(`${r.ytdBuys} buy${r.ytdBuys > 1 ? 's' : ''}`);
                    if (r.ytdSells > 0) parts.push(`${r.ytdSells} sell${r.ytdSells > 1 ? 's' : ''}`);
                    activity = ` (${parts.join(', ')} YTD)`;
                }
                lines.push(`  ↳ ${ytdEmoji} Position YTD: ${ytdPctSign}${ytdPct.toFixed(2)}% · ${ytdPlSign}$${ytdPL.toFixed(2)}${activity}`);
            }

            // Cost basis return: total return since entry
            const cbEmoji = r.costBasisReturn >= 0 ? '🟢' : '🔴';
            const cbSign = r.costBasisReturn >= 0 ? '+' : '';
            const totalPL = r.positionValue! - r.totalCostBasis!;
            const plSign = totalPL >= 0 ? '+' : '';
            lines.push(`  ↳ ${cbEmoji} Cost Basis: ${cbSign}${r.costBasisReturn.toFixed(2)}% (avg $${r.avgCost.toFixed(2)} × ${r.quantity.toFixed(2)}) ${plSign}$${totalPL.toFixed(2)} total P/L`);
        }
    }

    return lines.join('\n');
}

// ── Get fund-level YTD ─────────────────────────────────
export async function getFundYTD(): Promise<string> {
    const { equity: currentEquity, positions: posMap } = await getFirebaseAccountData();
    const positions = Array.from(posMap.values());
    const allSymbols = positions.map(p => p.symbol);
    const ytdStart = getYTDStart();

    // Fetch Jan 2 close prices individually (getCandles multi-symbol returns broken Map-like)
    const startPrices = new Map<string, number>();
    await Promise.all(allSymbols.map(async (sym) => {
        const price = await getYTDStartPrice(sym, ytdStart);
        if (price !== null) startPrices.set(sym, price);
    }));

    // Get current prices
    const currentPrices = await getPrices({ symbols: allSymbols });

    // Calculate position-level start value to derive YTD-start equity
    // YTD start equity = current equity - total unrealized P/L since Jan 2
    let totalPositionStartValue = 0;
    let totalPositionCurrentValue = 0;
    const positionResults: FundYTD['positions'] = [];

    for (const pos of positions) {
        const priceData = currentPrices.get(pos.symbol);
        const currentPrice = priceData ? priceData.Price : 0;
        const startPrice = startPrices.get(pos.symbol) ?? currentPrice; // no data → 0% contribution

        const startValue = pos.quantity * startPrice;
        const currentValue = pos.quantity * currentPrice;

        totalPositionStartValue += startValue;
        totalPositionCurrentValue += currentValue;

        positionResults.push({
            symbol: pos.symbol,
            quantity: pos.quantity,
            startPrice,
            currentPrice,
            startValue,
            currentValue,
            change: currentValue - startValue,
            percentChange: startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0,
            weight: 0,     // calculated below
            contribution: 0, // calculated below
        });
    }

    // YTD-start equity ≈ current equity minus the position gains since Jan 2
    const totalPositionPL = totalPositionCurrentValue - totalPositionStartValue;
    const startEquity = currentEquity - totalPositionPL;

    const fundChange = currentEquity - startEquity;
    const fundPercentChange = startEquity > 0 ? (fundChange / startEquity) * 100 : 0;

    for (const p of positionResults) {
        p.weight = totalPositionCurrentValue > 0 ? (p.currentValue / totalPositionCurrentValue) * 100 : 0;
        p.contribution = startEquity > 0 ? (p.change / startEquity) * 100 : 0;
    }

    // Sort by contribution (biggest movers)
    positionResults.sort((a, b) => b.contribution - a.contribution);

    // Format output
    const fundEmoji = fundPercentChange >= 0 ? '🟢' : '🔴';
    const fundSign = fundPercentChange >= 0 ? '+' : '';

    const lines: string[] = [
        `**📈 Fund YTD Performance**`,
        `${fundEmoji} **${fundSign}${fundPercentChange.toFixed(2)}%** ($${startEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })} → $${currentEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })})`,
        `P/L: ${fundSign}$${fundChange.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        '',
        '**Top Contributors:**',
    ];

    // Top 5 gainers
    const gainers = positionResults.filter(p => p.contribution > 0).slice(0, 5);
    for (const p of gainers) {
        lines.push(`  🟢 **${p.symbol}** +${p.percentChange.toFixed(1)}% (${p.weight.toFixed(1)}% weight) → +${p.contribution.toFixed(2)}% contribution`);
    }

    // Top 5 losers
    const losers = positionResults.filter(p => p.contribution < 0).sort((a, b) => a.contribution - b.contribution).slice(0, 5);
    if (losers.length > 0) {
        lines.push('');
        lines.push('**Top Detractors:**');
        for (const p of losers) {
            lines.push(`  🔴 **${p.symbol}** ${p.percentChange.toFixed(1)}% (${p.weight.toFixed(1)}% weight) → ${p.contribution.toFixed(2)}% contribution`);
        }
    }

    return lines.join('\n');
}

import * as admin from 'firebase-admin';
import { promises as fs } from 'fs';
import { join } from 'path';

const PORTFOLIO_CONFIG = join(process.cwd(), 'data', 'portfolio.json');
const SERVICE_ACCOUNT = join(process.cwd(), 'eliteentries-algo-firebase-adminsdk-orrvo-c5c6d152c8.json');

// Initialize Firebase Admin (singleton)
let db: admin.firestore.Firestore;

function getFirestore(): admin.firestore.Firestore {
    if (!db) {
        if (!admin.apps.length) {
            const serviceAccount = require(SERVICE_ACCOUNT);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        }
        db = admin.firestore();
    }
    return db;
}

// ── Types ──────────────────────────────────────────────
export interface TierConfig {
    name: string;
    emoji: string;
    targetRange: [number, number]; // tier total % range
    perName: [number, number];     // per-position target band %
    hardCap: number;               // per-position hard max %
    symbols: string[];
}

export interface PortfolioConfig {
    tiers: Record<string, TierConfig>;
    firebase: { collection: string; document: string };
}

interface Position {
    symbol: string;
    value: number;
    average: number;
    quantity: number;
    PL: number;
}

interface PositionAnalysis {
    symbol: string;
    weight: number;
    value: number;
    status: '✅' | '⚠️' | '🚨';
    note: string;
}

interface TierAnalysis {
    config: TierConfig;
    tierKey: string;
    positions: PositionAnalysis[];
    totalWeight: number;
    tierStatus: '✅' | '⚠️' | '🚨';
    tierNote: string;
}

// ── Config loader ──────────────────────────────────────
export async function loadPortfolioConfig(): Promise<PortfolioConfig> {
    const content = await fs.readFile(PORTFOLIO_CONFIG, 'utf-8');
    return JSON.parse(content);
}

// ── Firebase reader ────────────────────────────────────
async function getPositions(config: PortfolioConfig): Promise<{ positions: Position[]; portfolioValue: number }> {
    const firestore = getFirestore();
    const doc = await firestore
        .collection(config.firebase.collection)
        .doc(config.firebase.document)
        .get();

    if (!doc.exists) throw new Error('Alpaca document not found in Firestore');

    const data = doc.data()!;
    const rawPositions: any[] = data.positions || [];

    const positions: Position[] = rawPositions.map((p: any) => ({
        symbol: p.symbol,
        value: parseFloat(p.value) || 0,
        average: parseFloat(p.average) || 0,
        quantity: parseFloat(p.quantity) || 0,
        PL: parseFloat(p.PL) || 0,
    }));

    // Use total position value (sum of all holdings), NOT account equity
    const portfolioValue = positions.reduce((sum, p) => sum + p.value, 0);

    return { positions, portfolioValue };
}

// ── Analysis engine ────────────────────────────────────
function analyzePosition(symbol: string, weight: number, value: number, tier: TierConfig): PositionAnalysis {
    const [low, high] = tier.perName;
    const hardCap = tier.hardCap;

    let status: '✅' | '⚠️' | '🚨' = '✅';
    let note = 'In band';

    if (weight > hardCap) {
        status = '🚨';
        note = `Over hard cap (${hardCap}%)`;
    } else if (weight > high) {
        status = '⚠️';
        note = `Above target, below hard cap`;
    } else if (weight < low) {
        status = '⚠️';
        note = `Below target`;
    }

    return { symbol, weight, value, status, note };
}

function analyzeTier(tierKey: string, tier: TierConfig, positions: Position[], portfolioValue: number): TierAnalysis {
    const tierPositions: PositionAnalysis[] = [];
    let totalValue = 0;

    // Find each configured symbol in positions
    for (const symbol of tier.symbols) {
        const pos = positions.find(p => p.symbol === symbol);
        if (pos) {
            const weight = (pos.value / portfolioValue) * 100;
            totalValue += pos.value;
            tierPositions.push(analyzePosition(symbol, weight, pos.value, tier));
        } else {
            tierPositions.push({ symbol, weight: 0, value: 0, status: '⚠️', note: 'No position' });
        }
    }

    // Check for unclassified positions in this tier
    // (positions that exist but aren't in any tier config)

    // Sort by weight descending
    tierPositions.sort((a, b) => b.weight - a.weight);

    const totalWeight = (totalValue / portfolioValue) * 100;
    const [targetLow, targetHigh] = tier.targetRange;

    let tierStatus: '✅' | '⚠️' | '🚨' = '✅';
    let tierNote = 'In range';

    if (totalWeight > targetHigh + 10) {
        tierStatus = '🚨';
        tierNote = `Significantly overweight (target ${targetLow}–${targetHigh}%)`;
    } else if (totalWeight > targetHigh) {
        tierStatus = '⚠️';
        tierNote = `Above target range (${targetLow}–${targetHigh}%)`;
    } else if (totalWeight < targetLow) {
        tierStatus = '⚠️';
        tierNote = `Below target range (${targetLow}–${targetHigh}%)`;
    }

    return { config: tier, tierKey, positions: tierPositions, totalWeight, tierStatus, tierNote };
}

// ── Main analysis function ─────────────────────────────
export async function analyzePortfolio(): Promise<string> {
    const config = await loadPortfolioConfig();
    const { positions, portfolioValue } = await getPositions(config);

    // Analyze each tier
    const tiers: TierAnalysis[] = [];
    const allClassifiedSymbols: string[] = [];

    for (const [key, tierConfig] of Object.entries(config.tiers)) {
        const analysis = analyzeTier(key, tierConfig, positions, portfolioValue);
        tiers.push(analysis);
        allClassifiedSymbols.push(...tierConfig.symbols);
    }

    // Find unclassified positions
    const unclassified = positions.filter(p => !allClassifiedSymbols.includes(p.symbol));

    // ── Format output ──────────────────────────────────
    const lines: string[] = [
        `**📊 Portfolio Analysis** — $${portfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        '',
    ];

    // Tier sections
    for (const tier of tiers) {
        const t = tier.config;
        lines.push(`${t.emoji} **${t.name} (${tier.tierKey})** — ${tier.tierStatus} ${tier.totalWeight.toFixed(1)}% (target ${t.targetRange[0]}–${t.targetRange[1]}%)`);
        lines.push(`Per name: ${t.perName[0]}–${t.perName[1]}% | Hard cap: ${t.hardCap}%`);

        for (const pos of tier.positions) {
            if (pos.weight === 0 && pos.note === 'No position') continue; // skip empty
            lines.push(`  ${pos.status} **${pos.symbol}** — ${pos.weight.toFixed(2)}% ($${pos.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}) ${pos.note !== 'In band' ? `*${pos.note}*` : ''}`);
        }
        lines.push('');
    }

    // Unclassified
    if (unclassified.length > 0) {
        lines.push('**❓ Unclassified Positions**');
        for (const pos of unclassified) {
            const weight = (pos.value / portfolioValue) * 100;
            lines.push(`  ❓ **${pos.symbol}** — ${weight.toFixed(2)}% ($${pos.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })})`);
        }
        lines.push('');
    }

    // Concentration metrics
    const allPositions = positions
        .map(p => ({ symbol: p.symbol, weight: (p.value / portfolioValue) * 100 }))
        .sort((a, b) => b.weight - a.weight);

    const top1 = allPositions[0];
    const top3 = allPositions.slice(0, 3).reduce((s, p) => s + p.weight, 0);
    const top5 = allPositions.slice(0, 5).reduce((s, p) => s + p.weight, 0);
    const top10 = allPositions.slice(0, 10).reduce((s, p) => s + p.weight, 0);

    lines.push('**🧮 Concentration**');
    lines.push(`  Top 1: ${top1?.symbol} ${top1?.weight.toFixed(1)}% ${top1?.weight <= 10 ? '✅' : '🚨'} (cap 10%)`);
    lines.push(`  Top 3: ${top3.toFixed(1)}% ${top3 <= 30 ? '✅' : '🚨'} (cap 30%)`);
    lines.push(`  Top 5: ${top5.toFixed(1)}% ${top5 <= 50 ? '✅' : '🚨'} (cap 50%)`);
    lines.push(`  Top 10: ${top10.toFixed(1)}% (target 65–70%)`);

    // Violations summary
    const violations: string[] = [];
    for (const tier of tiers) {
        for (const pos of tier.positions) {
            if (pos.status === '🚨') violations.push(`${pos.symbol} (${pos.weight.toFixed(1)}% — ${tier.tierKey} hard cap ${tier.config.hardCap}%)`);
        }
    }

    if (violations.length > 0) {
        lines.push('');
        lines.push('**🚨 Rule Violations**');
        for (const v of violations) lines.push(`  ❌ ${v}`);
    } else {
        lines.push('');
        lines.push('**✅ No hard cap violations**');
    }

    return lines.join('\n');
}

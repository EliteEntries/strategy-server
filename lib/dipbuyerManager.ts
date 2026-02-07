import { promises as fs } from 'fs';
import { join } from 'path';
import { add } from 'redbtn';

const DATA_FILE = join(process.cwd(), 'data', 'dipbuyers.json');

export interface DipbuyerConfig {
    dipbuyers: Record<string, string[]>;  // threshold -> symbols[]
    ripsellers: Record<string, string[]>; // threshold -> symbols[]
    settings: {
        defaultNotional: number;
        sellNotional: number;
        sellPriceMulti: number;
    };
}

// Load configuration from JSON file
export async function loadConfig(): Promise<DipbuyerConfig> {
    try {
        const content = await fs.readFile(DATA_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        // Return default config if file doesn't exist
        return {
            dipbuyers: {},
            ripsellers: {},
            settings: {
                defaultNotional: 200,
                sellNotional: 100,
                sellPriceMulti: 1.01
            }
        };
    }
}

// Save configuration to JSON file
export async function saveConfig(config: DipbuyerConfig): Promise<void> {
    const dir = join(process.cwd(), 'data');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(config, null, 2));
}

// Add a symbol to a dipbuyer threshold
export async function addDipbuyer(symbol: string, threshold: number): Promise<{ success: boolean; message: string; isNew: boolean }> {
    const config = await loadConfig();
    const thresholdKey = threshold.toString();
    
    if (!config.dipbuyers[thresholdKey]) {
        config.dipbuyers[thresholdKey] = [];
    }
    
    const upperSymbol = symbol.toUpperCase();
    
    if (config.dipbuyers[thresholdKey].includes(upperSymbol)) {
        return { 
            success: false, 
            message: `${upperSymbol} is already in the ${threshold}% dipbuyer list`,
            isNew: false
        };
    }
    
    const isNewThreshold = config.dipbuyers[thresholdKey].length === 0;
    config.dipbuyers[thresholdKey].push(upperSymbol);
    await saveConfig(config);
    
    return { 
        success: true, 
        message: isNewThreshold 
            ? `Added ${upperSymbol} to NEW ${threshold}% dipbuyer (threshold created!)`
            : `Added ${upperSymbol} to ${threshold}% dipbuyer`,
        isNew: isNewThreshold
    };
}

// Remove a symbol from a dipbuyer threshold
export async function removeDipbuyer(symbol: string, threshold: number): Promise<{ success: boolean; message: string; removedThreshold: boolean }> {
    const config = await loadConfig();
    const thresholdKey = threshold.toString();
    const upperSymbol = symbol.toUpperCase();
    
    if (!config.dipbuyers[thresholdKey]) {
        return { 
            success: false, 
            message: `No ${threshold}% dipbuyer exists`,
            removedThreshold: false
        };
    }
    
    const index = config.dipbuyers[thresholdKey].indexOf(upperSymbol);
    if (index === -1) {
        return { 
            success: false, 
            message: `${upperSymbol} is not in the ${threshold}% dipbuyer list`,
            removedThreshold: false
        };
    }
    
    config.dipbuyers[thresholdKey].splice(index, 1);
    
    // Remove empty threshold
    const removedThreshold = config.dipbuyers[thresholdKey].length === 0;
    if (removedThreshold) {
        delete config.dipbuyers[thresholdKey];
    }
    
    await saveConfig(config);
    
    return { 
        success: true, 
        message: removedThreshold
            ? `Removed ${upperSymbol} from ${threshold}% dipbuyer (threshold removed - no symbols left)`
            : `Removed ${upperSymbol} from ${threshold}% dipbuyer`,
        removedThreshold
    };
}

// Get all dipbuyers formatted for display
export async function listDipbuyers(): Promise<string> {
    const config = await loadConfig();
    const thresholds = Object.keys(config.dipbuyers).sort((a, b) => Number(a) - Number(b));
    
    if (thresholds.length === 0) {
        return 'No dipbuyers configured.';
    }
    
    const lines: string[] = ['**📊 Dipbuyer Configuration**', ''];
    
    for (const threshold of thresholds) {
        const symbols = config.dipbuyers[threshold];
        lines.push(`**${threshold}% Dipbuyer:**`);
        lines.push(symbols.length > 0 ? symbols.join(', ') : 'No symbols');
        lines.push('');
    }
    
    return lines.join('\n');
}

// Get all symbols from all thresholds (for setSymbolConfig compatibility)
export async function getAllSymbolsByThreshold(): Promise<Record<number, string[]>> {
    const config = await loadConfig();
    const result: Record<number, string[]> = {};
    
    for (const [threshold, symbols] of Object.entries(config.dipbuyers)) {
        result[Number(threshold)] = symbols;
    }
    
    return result;
}

// Get symbols for a specific threshold (used by strategies on each run)
export async function getSymbolsForThreshold(threshold: number): Promise<string[]> {
    const config = await loadConfig();
    return config.dipbuyers[threshold.toString()] || [];
}

// Get all active thresholds
export async function getActiveThresholds(): Promise<number[]> {
    const config = await loadConfig();
    return Object.keys(config.dipbuyers)
        .map(Number)
        .filter(t => config.dipbuyers[t.toString()].length > 0);
}

// Register all dipbuyers with redbtn
export async function registerAllDipbuyers(): Promise<void> {
    const config = await loadConfig();
    
    for (const [threshold, symbols] of Object.entries(config.dipbuyers)) {
        if (symbols.length === 0) continue;
        
        const thresholdNum = Number(threshold);
        
        await add({
            name: 'dipbuyer',
            loaders: [{
                package: './dist/connectors/elite-entries',
                action: 'updatePrices',
            }],
            triggers: [{
                package: './dist/connectors/strategies',
                action: 'dipBuyer',
                params: {
                    threshold: thresholdNum,
                    sell: true
                }
            }],
            actions: [{
                package: './dist/connectors/elite-entries',
                action: 'trade',
                condition: 't',
                params: {
                    notional: config.settings.defaultNotional,
                    threshold: thresholdNum,
                }
            }, {
                package: './dist/connectors/elite-entries',
                action: 'trade',
                condition: 't',
                params: {
                    notional: config.settings.sellNotional,
                    threshold: thresholdNum,
                    side: 'sell',
                    priceMulti: config.settings.sellPriceMulti,
                    time_in_force: 'day',
                }
            }],
        });
        
        console.log(`\x1b[32mRegistered ${threshold}% dipbuyer with symbols: ${symbols.join(', ')}\x1b[0m`);
    }
}

// Register a single new dipbuyer threshold (for hot-adding)
export async function registerSingleDipbuyer(threshold: number): Promise<void> {
    const config = await loadConfig();
    const symbols = config.dipbuyers[threshold.toString()];
    
    if (!symbols || symbols.length === 0) return;
    
    await add({
        name: 'dipbuyer',
        loaders: [{
            package: './dist/connectors/elite-entries',
            action: 'updatePrices',
        }],
        triggers: [{
            package: './dist/connectors/strategies',
            action: 'dipBuyer',
            params: {
                threshold: threshold,
                sell: true
            }
        }],
        actions: [{
            package: './dist/connectors/elite-entries',
            action: 'trade',
            condition: 't',
            params: {
                notional: config.settings.defaultNotional,
                threshold: threshold,
            }
        }, {
            package: './dist/connectors/elite-entries',
            action: 'trade',
            condition: 't',
            params: {
                notional: config.settings.sellNotional,
                threshold: threshold,
                side: 'sell',
                priceMulti: config.settings.sellPriceMulti,
                time_in_force: 'day',
            }
        }],
    });
    
    console.log(`\x1b[32mRegistered NEW ${threshold}% dipbuyer with symbols: ${symbols.join(', ')}\x1b[0m`);
}

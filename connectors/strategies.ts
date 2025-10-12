import { sendDiscordMessage } from '../lib/discord';

const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || ''; // Set this in your .env

export const dipBuyer = async (params: any, REDBTN: any) => {
    async function main(symbol: string){
        if (!REDBTN.data[symbol]) REDBTN.data[symbol] = {};
        if (!REDBTN.data[symbol][`high-${params.threshold}`]) REDBTN.data[symbol][`high-${params.threshold}`] = 0;
    
        let high = REDBTN.data[symbol][`high-${params.threshold}`];
        let price = REDBTN.data[symbol].price;
        
        if (price > high) {
            REDBTN.data[symbol][`high-${params.threshold}`] = price;
            return false;
        }
        
        if (price < high*(1-(params.threshold/100))) {
            REDBTN.data[symbol][`high-${params.threshold}`] = price;
            if (!REDBTN.data[symbol].orders || !REDBTN.data[symbol].orders.buy) REDBTN.data[symbol].orders = {buy: [], sell: []};
            REDBTN.data[symbol].orders.buy.push({symbol, price});
            if (params.sell) {
                
                REDBTN.data[symbol].orders.sell.push({symbol, price});
            }
            const msg = `Order added: ${symbol} at $${price.toFixed(2)} (threshold ${params.threshold}%)`;
            sendDiscordMessage(DISCORD_CHANNEL_ID, msg);
            console.log(`Price for ${symbol} dropped below ${params.threshold}% threshold`);
            return price;
        }
    }
    if (params.symbols) {
        let results: any[] = [];
        for await (const symbol of params.symbols) {
            results.push(await main(symbol));
        }
        const allFalse = results.every((r) => r === false);
        return !allFalse ? results : false;
    } else if (params.symbol) {
        return await main(params.symbol);
    }
    return false;
}

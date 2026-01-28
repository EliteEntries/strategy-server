import { getPrices, placeOrder } from 'elite-entries';
import { logTrade } from '../lib/tradeLogger';
/***************************************************************************
 *********************** Loader funcionts using redBtn  ********************
 *
 * updatePrices: Updates REDBTN.data with the latest prices for all symbols
 * updateCandles: Updates REDBTN.data with the latest candles for all symbols
 * 
 **************************************************************************/

 //Helpers
const roundMax5 = (v: number) => Math.round(v * 1e5) / 1e5
const roundMax2 = (v: number) => Math.round(v * 1e2) / 1e2

export const updatePrices = async (params: any, REDBTN: any) => {
    const automations = REDBTN.automations
    const symbols:string[] = []

    // 1. Check algorithm params for symbols
    for await (const automation of Object.keys(automations)) {
        const triggers = automations[automation].triggers
        for await (const trigger of triggers) {
            const params = trigger.params
            if (params.symbol && !symbols.includes(params.symbol)) {
                symbols.push(params.symbol)
            } else if (params.symbols) {
                for await (const symbol of params.symbols) {
                    if (!symbols.includes(symbol)) symbols.push(symbol)
                }
            }
        }
    }
    
    // 2. Get latest prices for all symbols
    const price = await getPrices({symbols})

    // 3. Edit redBtn data parameter with updated data
    for await (const p of price) {
        const symbol = p[0]
        if (!REDBTN.data[symbol]) REDBTN.data[symbol] = {}
        REDBTN.data[symbol].price = p[1].Price
    }
    return
}

export const trade = async (params: any, REDBTN: any) => {
    if (!params.symbols && !params.symbol) throw new Error('No symbol provided')
    async function main(symbol: string, price: number){
        const qty = roundMax5((params.notional || 0) / price);
        const side = params.side || 'buy';
        const order = { 
            symbol: symbol, 
            qty: qty, 
            limit_price: roundMax2(price * (params.priceMulti || 1)).toString(), 
            side: side, 
            time_in_force: params.time_in_force || 'day', 
            type: 'limit'
        }
        const res = await placeOrder({order, paper: process.env.PAPER || false})
        
        // Log the trade
        logTrade({
            symbol: symbol,
            side: side,
            price: price,
            qty: qty,
            notional: params.notional || 0,
            threshold: params.threshold,
            orderId: res?.id,
        });
        
        return res
    }
    if (params.symbols) {
        let results: any[] = []
        for await (const symbol of params.symbols) {
            if (!REDBTN.data[symbol].orders) continue
            const orders = REDBTN.data[symbol].orders[params.side || 'buy']
            if (orders?.length && orders.length > 0) {
                let i = 0
                    for await (const order of orders) {
                        const side = params.side || 'buy'
                        const color = side === 'buy' ? '\x1b[32m' : '\x1b[31m'
                        const amount = roundMax5((params.notional || 0) / order.price) || order.qty || order.amount || 100
                        console.log(`${amount} @ ${order.symbol} at ${color}${order.price}\x1b[0m `)
                        results.push(await main(order.symbol, order.price))
                        orders.splice(i, 1)
                        i++
                    }
            }
        }
        return results
    } else {
        let results: any[] = []
        const symbol = params.symbol
        if (REDBTN.data[symbol].orders && REDBTN.data[symbol].orders.length > 0) {
            let i = 0
            for await (const order of REDBTN.data[symbol].orders) {
                results.push(await main(order.symbol, order.price))
                REDBTN.data[symbol].orders.splice(i, 1)
                i++
            }
        }
        return results
    }
}




//! W.I.P
export const updateCandles = async (params: any, REDBTN: any) => {
    const automations = REDBTN.automations
    const symbols:any = {}

    // 1. Check algorithm params for symbols, timeframes, and limits
    for await (const automation of Object.keys(automations)) {
        const triggers = automations[automation].triggers
        for await (const trigger of triggers) {
            const params = trigger.params
            if (params.symbol ) {
            }
        }
    }
    
    // 2. Get historical data for new symbols that require candles
    // 3. Get latest prices for all symbols and cnadles that require updates
    // 4. Edit redBtn data parameter with updated data
    
    for await (const symbol of symbols) {
        
    }
    return
}

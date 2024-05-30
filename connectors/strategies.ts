
export const dipBuyer = async (params: any, REDBTN: any) => {
    async function main(symbol: string){
        // 1. Check if symbol exists in REDBTN.data
        if (!REDBTN.data[symbol]) REDBTN.data[symbol] = {}
        // 2. Check if high threshold exists in REDBTN.data
        if (!REDBTN.data[symbol][`high-${params.threshold}`]) REDBTN.data[symbol][`high-${params.threshold}`] = 0
    
        let high = REDBTN.data[symbol][`high-${params.threshold}`]
        let price = REDBTN.data[symbol].price
        
        // 3. Check if price is higher than the current high
        if (price > high) {
            REDBTN.data[symbol][`high-${params.threshold}`] = price
            return false
        }
        
        // 4. Check if price is below the threshold
        if (price < high*(1-(params.threshold/100))) {
            REDBTN.data[symbol][`high-${params.threshold}`] = price
            if (!REDBTN.data[symbol].orders) REDBTN.data[symbol].orders = {buy: [], sell: []}
            REDBTN.data[symbol].orders.buy.push({symbol, price})
            if (params.sell) {
                REDBTN.data[symbol].orders.sell.push({symbol, price})
            }
            console.log(`Price for ${symbol} dropped below ${params.threshold}% threshold`)
            //!NEEDS CLEANUP/BETTER LOG
            console.log(`Buy @ ${symbol} at \x1b[32m${price}\x1b[0m ${params.sell ? `and Sell @ \x1b[31m${price*1.01}` : ''}`)
            return price
        }
    }
    if (params.symbols) {
        let results: any[] = []
        for await (const symbol of params.symbols) {
            results.push(await main(symbol))
        }
        const allFalse = results.every((r) => r === false)
        return !allFalse ? results : false
    } else if (params.symbol) {
        return await main(params.symbol)
    }
    return false
}

import 'dotenv/config';
import { finish, set, status } from "redbtn";
import { createClient } from "redis";
import { registerAllDipbuyers, getAllSymbolsByThreshold } from "./lib/dipbuyerManager";
import './lib/discord'; // Initialize Discord bot

const redis = createClient({
    url: `redis://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_URL}`
})

;(async () => {
    console.log('\x1b[31m----------------- Starting System -----------------')
    await redis.connect()

    const dipbuyerData = await redis.get('dipbuyer')

    if (dipbuyerData) {
        const dipbuyer = JSON.parse(dipbuyerData)
        set(dipbuyer)
    }

    finish((redbtn: any) => {
        redis.set('dipbuyer', JSON.stringify(redbtn.data))
    })

    // Dynamically register all dipbuyers from JSON config
    await registerAllDipbuyers();
    
    // Get all symbols for logging
    const symbolsByThreshold = await getAllSymbolsByThreshold();

    const time = new Date()
    const isPassed10AM: boolean = time.getHours() >= 10
    const next10AM = isPassed10AM ? new Date(time.getFullYear(), time.getMonth(), time.getDate() + 1, 10, 0, 0) : new Date(time.getFullYear(), time.getMonth(), time.getDate(), 10, 0, 0)
    const timeUntilNext10AM = next10AM.getTime() - time.getTime()
    const timeUntilNextHour = 60 * 60 * 1000 - (time.getMinutes() * 60 * 1000 + time.getSeconds() * 1000 + time.getMilliseconds())

    log()
    setTimeout(setLogger, timeUntilNextHour) //timeUntilNext10AM


    function setLogger() {
        setTimeout(setLogger, 60 * 60 * 1000); // Next Hour
        log()
    }
    
    function log(){
        console.log(`\x1b[31m${new Date().toLocaleString()}`)
        const data = status().data
        for (const [threshold, symbols] of Object.entries(symbolsByThreshold)) {
            for (const symbol of symbols as string[]) {
                if (data[symbol]) {
                    console.log(`${symbol}: High - ${data[symbol][`high-${threshold}`]} | Price - ${data[symbol].price} `)
                }
            }
        }
    }

})();
/*
const data = {
    "userID":"BsYKPGE6SaZXJMUjJUtA7YMtSJw2",
    "key":"8kF7iz242u0zLCEmK8cVfQWBGpNgIUVb",
    "exchange":"alpaca",
    "order" : 'b5aace8f-5544-488b-99aa-4e3fe3f7669e',
    "account":"stocks",
    "paper":true
}

;(async () => {
    //console.log(await userData('george8794@gmail.com'))
    //console.log(await auth.getUser(data.userID) )
    const res = await getPrices({symbols:['AAPL','NVDA']})
    const prices: any[] = []
    for await (const price of res) {
        const { Symbol, Price } = price[1]
        prices.push({Symbol, Price})
    }
    console.log(prices)
    //console.log(await getLatestCandles({symbols:['AAPL','NVDA'], interval:'1min'}))
    let date = new Date()
    date.setDate(date.getDate() - 270)
    const candles = await getCandles({symbols:['GOOGL'], timeframe:'1Day', limit: 200, start:date, end:new Date()})
    for (const candle of candles) {
        console.log({ symbol: candle[0], candles: candle[1].length })
    }
    console.log(candles[0][1][candles[0][1].length - 1])
    //console.log(await getDoc('users', data.userID))
})();
*/

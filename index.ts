import 'dotenv/config';
import { add, finish, set, status } from "redbtn";
import { createClient } from "redis";
import { setSymbolConfig } from "./lib/discord";

const symbols2: string[] = ['JPM', 'INFL', 'VGK','ABNB','MSFT']
const symbols5: string[] = ['META', 'COST', 'V', 'JPM']
const symbolsSell: string[] = []
const threshold5 = 5
const threshold2 = 2
const thresholdSell = 2

// Configure Discord bot with symbol info
setSymbolConfig({ symbols2, symbols5, symbolsSell, threshold2, threshold5, thresholdSell });

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

    const dipbuyer2 = await add({
        name: 'dipbuyer',
        loaders: [{
            package: './dist/connectors/elite-entries',
            action: 'updatePrices',
        }],
        triggers: [{
            package: './dist/connectors/strategies',
            action: 'dipBuyer',
            params: {
                symbols: symbols2,
                threshold: threshold2,
                sell: true
            }
        }],
        actions: [{
            package: './dist/connectors/elite-entries',
            action: 'trade',
            condition: 't',
            params: {
                notional: 200,
                symbols: symbols2,
            }
        },{
            package: './dist/connectors/elite-entries',
            action: 'trade',
            condition: 't',
            params: {
                notional: 100,
                symbols: symbols2,
                side: 'sell',
                priceMulti: 1.01,
                time_in_force: 'day',
            }
        }],
    })

    const dipbuyer5 = await add({
        name: 'dipbuyer',
        loaders: [{
            package: './dist/connectors/elite-entries',
            action: 'updatePrices',
        }],
        triggers: [{
            package: './dist/connectors/strategies',
            action: 'dipBuyer',
            params: {
                symbols: symbols5,
                threshold: threshold5,
                sell: true
            }
        }],
        actions: [{
            package: './dist/connectors/elite-entries',
            action: 'trade',
            condition: 't',
            params: {
                notional: 200,
                symbols: symbols5,
            }
        },{
            package: './dist/connectors/elite-entries',
            action: 'trade',
            condition: 't',
            params: {
                notional: 100,
                symbols: symbols5,
                side: 'sell',
                priceMulti: 1.01,
                time_in_force: 'day',
            }
        }],
    })

    const dipbuyerSell = await add({
        name: 'dipbuyer',
        loaders: [{
            package: './dist/connectors/elite-entries',
            action: 'updatePrices',
        }],
        triggers: [{
            package: './dist/connectors/strategies',
            action: 'ripSeller',
            params: {
                symbols: symbolsSell,
                threshold: thresholdSell,
            }
        }],
        actions: [{
            package: './dist/connectors/elite-entries',
            action: 'trade',
            condition: 't',
            params: {
                notional: 100,
                symbols: symbolsSell,
                side: 'sell',
                time_in_force: 'day',
            }
        }],
    })

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
        //setTimeout(log, 4 * 60 * 60 * 1000); // 2 P.M.
        //setTimeout(log, 8 * 60 * 60 * 1000); // 6 P.M.
        //setTimeout(log, 12 * 60 * 60 * 1000); // 10 P.M.
        //setTimeout(setLogger, 24 * 60 * 60 * 1000); // Next Day
    }
    function log(){
        console.log(`\x1b[31m${new Date().toLocaleString()}`)
        const data = status().data
        for (const symbol of symbols5) {
            if (data[symbol]) {
                console.log(`${symbol}: High - ${data[symbol][`high-${threshold5}`]} | Price - ${data[symbol].price} `)
            }
        }
        for (const symbol of symbols2) {
            if (data[symbol]) {
                console.log(`${symbol}: High - ${data[symbol][`high-${threshold2}`]} | Price - ${data[symbol].price} `)
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

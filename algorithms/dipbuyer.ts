

async function start(data: any, redisClient: any) {
    const { symbol, interval, id, percent } = data;
    //get candle data from redis
    const candles =  await redisClient.get(`${symbol}:${interval}`);
    //get watermark price from redis
    const watermark = await redisClient.get(`${id}:watermark`);
    //check if last candle low (OHLCV) is below watermark*((100-percent)/100)
    const candle = candles[candles.length-1];
    if (candle[3] <= watermark*((100-percent)/100)) {
        //update watermark
        await redisClient.set(`${id}:watermark`, candle[3]);
        return true;
    }  else return false;
}

//example candle 
// [1617225600000, 2.0, 3.0, 1.0, 1.5, 1000]